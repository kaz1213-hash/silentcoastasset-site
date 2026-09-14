import crypto from 'node:crypto';

const WRITE_SCOPE = 'tanuki:site:write';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAIR_TTL_MS = 10 * 60 * 1000;
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const CLIENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function decodeJson(value, code) {
  try { return JSON.parse(Buffer.from(String(value),'base64url').toString('utf8')); }
  catch { throw new Error(code); }
}
function hmac(secret,value) { return crypto.createHmac('sha256',secret).update(value).digest('base64url'); }
function safeEqual(a,b) {
  const x=Buffer.from(String(a)); const y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function randomId(prefix, bytes=24) { return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`; }
function opaqueId(value,field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value)) throw new Error(`${field}_BAD_ID`);
  return value;
}
function text(value,max,field) {
  const out=String(value??'').trim();
  if (!out || out.length>max || /[\r\n\0]/.test(out)) throw new Error(`${field}_INVALID`);
  return out;
}
function pkceVerifier(value) {
  const out=String(value??'');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(out)) throw new Error('OAUTH_BAD_CODE_VERIFIER');
  return out;
}
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function safeRedirect(value) {
  let url;
  try { url=new URL(String(value)); } catch { throw new Error('OAUTH_BAD_REDIRECT_URI'); }
  const local = url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if (url.protocol!=='https:' && !local) throw new Error('OAUTH_BAD_REDIRECT_URI');
  if (url.username || url.password || url.hash) throw new Error('OAUTH_BAD_REDIRECT_URI');
  return url.toString();
}
function cleanBase(value) {
  let url;
  try { url=new URL(String(value)); } catch { throw new Error('OAUTH_BAD_PUBLIC_URL'); }
  const local = url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if (url.protocol!=='https:' && !local) throw new Error('OAUTH_HTTPS_REQUIRED');
  if (url.username || url.password || url.search || url.hash) throw new Error('OAUTH_BAD_PUBLIC_URL');
  return url.origin;
}
function scopeList(value) {
  const values=String(value??'').split(/\s+/).filter(Boolean);
  if (!values.length || values.some(x=>x!==WRITE_SCOPE)) throw new Error('OAUTH_BAD_SCOPE');
  return WRITE_SCOPE;
}
function parseToken(token,prefix,secret,code) {
  if (typeof token!=='string' || token.length<32 || token.length>8192) throw new Error(code);
  const [kind,payload,signature,extra]=token.split('.');
  if (kind!==prefix || !payload || !signature || extra!=null || !safeEqual(signature,hmac(secret,`${kind}.${payload}`))) throw new Error(code);
  return decodeJson(payload,code);
}
function signedToken(prefix,payload,secret) {
  const body=b64url(JSON.stringify(payload));
  return `${prefix}.${body}.${hmac(secret,`${prefix}.${body}`)}`;
}

export class McpOAuthBroker {
  constructor({
    secret,
    publicBaseUrl='https://relay.silentcoastasset.com',
    accessTtlMs=ACCESS_TTL_MS,
    refreshTtlMs=REFRESH_TTL_MS,
    pairTtlMs=PAIR_TTL_MS,
    approvalTtlMs=APPROVAL_TTL_MS,
    codeTtlMs=CODE_TTL_MS,
    clientTtlMs=CLIENT_TTL_MS,
  }={}) {
    if (typeof secret!=='string' || secret.length<32) throw new Error('OAUTH_SECRET_TOO_SHORT');
    this.secret=secret;
    this.issuer=cleanBase(publicBaseUrl);
    this.resource=`${this.issuer}/mcp`;
    this.accessTtlMs=accessTtlMs;
    this.refreshTtlMs=refreshTtlMs;
    this.pairTtlMs=pairTtlMs;
    this.approvalTtlMs=approvalTtlMs;
    this.codeTtlMs=codeTtlMs;
    this.clientTtlMs=clientTtlMs;
    this.pairingCodes=new Map();
    this.usedApprovals=new Map();
    this.authorizationCodes=new Map();
    this.refreshFamilies=new Map();
  }

  cleanup(now=Date.now()) {
    for (const [key,value] of this.pairingCodes) if (value.exp<=now) this.pairingCodes.delete(key);
    for (const [key,exp] of this.usedApprovals) if (exp<=now) this.usedApprovals.delete(key);
    for (const [key,value] of this.authorizationCodes) if (value.exp<=now) this.authorizationCodes.delete(key);
    for (const [key,value] of this.refreshFamilies) if (value.exp<=now) this.refreshFamilies.delete(key);
  }

  protectedResourceMetadata() {
    return { resource:this.resource, authorization_servers:[this.issuer], scopes_supported:[WRITE_SCOPE], bearer_methods_supported:['header'] };
  }

  authorizationServerMetadata() {
    return {
      issuer:this.issuer,
      authorization_endpoint:`${this.issuer}/oauth/authorize`,
      token_endpoint:`${this.issuer}/oauth/token`,
      registration_endpoint:`${this.issuer}/oauth/register`,
      response_types_supported:['code'],
      grant_types_supported:['authorization_code','refresh_token'],
      code_challenge_methods_supported:['S256'],
      token_endpoint_auth_methods_supported:['none'],
      scopes_supported:[WRITE_SCOPE],
    };
  }

  registerClient(input, {now=Date.now()}={}) {
    if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('OAUTH_BAD_CLIENT_METADATA');
    const name=text(input.client_name || 'MCP client',120,'OAUTH_CLIENT_NAME');
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length<1 || input.redirect_uris.length>10) throw new Error('OAUTH_BAD_REDIRECT_URIS');
    const redirects=[...new Set(input.redirect_uris.map(safeRedirect))];
    if (redirects.length!==input.redirect_uris.length) throw new Error('OAUTH_DUPLICATE_REDIRECT_URI');
    if (input.token_endpoint_auth_method && input.token_endpoint_auth_method!=='none') throw new Error('OAUTH_PUBLIC_CLIENT_ONLY');
    if (input.response_types && (!Array.isArray(input.response_types) || input.response_types.some(x=>x!=='code'))) throw new Error('OAUTH_BAD_RESPONSE_TYPES');
    if (input.grant_types && (!Array.isArray(input.grant_types) || input.grant_types.some(x=>!['authorization_code','refresh_token'].includes(x)))) throw new Error('OAUTH_BAD_GRANT_TYPES');
    const issued=Math.floor(now/1000);
    const clientId=signedToken('c1',{v:1,name,redirects,iat:issued,exp:Math.floor((now+this.clientTtlMs)/1000)},this.secret);
    return {
      client_id:clientId,
      client_name:name,
      redirect_uris:redirects,
      client_id_issued_at:issued,
      token_endpoint_auth_method:'none',
      response_types:['code'],
      grant_types:['authorization_code','refresh_token'],
    };
  }

  clientMetadata(clientId,{now=Date.now()}={}) {
    const payload=parseToken(clientId,'c1',this.secret,'OAUTH_BAD_CLIENT_ID');
    if (payload?.v!==1 || !Array.isArray(payload.redirects) || !payload.redirects.length || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) throw new Error('OAUTH_BAD_CLIENT_ID');
    return payload;
  }

  startPairing({tenantId,projectId},{now=Date.now()}={}) {
    this.cleanup(now);
    const identity={tenantId:opaqueId(tenantId,'TENANT'),projectId:opaqueId(projectId,'PROJECT')};
    const code=randomId('pair',24);
    this.pairingCodes.set(code,{...identity,exp:now+this.pairTtlMs});
    return { pairing_url:`${this.issuer}/pair/${encodeURIComponent(code)}`, expires_in:Math.floor(this.pairTtlMs/1000) };
  }

  consumePairingCode(code,{now=Date.now()}={}) {
    this.cleanup(now);
    const row=this.pairingCodes.get(String(code));
    if (!row || row.exp<=now) throw new Error('PAIRING_INVALID_OR_EXPIRED');
    this.pairingCodes.delete(String(code));
    return signedToken('p1',{v:1,sub:row.tenantId,prj:row.projectId,exp:Math.floor((now+this.pairTtlMs)/1000)},this.secret);
  }

  verifyPairingCookie(token,{now=Date.now()}={}) {
    const payload=parseToken(token,'p1',this.secret,'PAIRING_COOKIE_INVALID');
    if (payload?.v!==1 || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) throw new Error('PAIRING_COOKIE_INVALID');
    return { tenantId:opaqueId(payload.sub,'TENANT'),projectId:opaqueId(payload.prj,'PROJECT') };
  }

  beginAuthorization(params,pairCookie,{now=Date.now()}={}) {
    const pair=this.verifyPairingCookie(pairCookie,{now});
    if (!params || typeof params!=='object') throw new Error('OAUTH_BAD_REQUEST');
    if (params.response_type!=='code') throw new Error('OAUTH_BAD_RESPONSE_TYPE');
    const clientId=text(params.client_id,8192,'OAUTH_CLIENT_ID');
    const client=this.clientMetadata(clientId,{now});
    const redirectUri=safeRedirect(params.redirect_uri);
    if (!client.redirects.includes(redirectUri)) throw new Error('OAUTH_REDIRECT_MISMATCH');
    if (params.code_challenge_method!=='S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(params.code_challenge??''))) throw new Error('OAUTH_PKCE_REQUIRED');
    if (String(params.resource??'')!==this.resource) throw new Error('OAUTH_RESOURCE_MISMATCH');
    const scope=scopeList(params.scope);
    const state=params.state==null ? '' : text(params.state,1024,'OAUTH_STATE');
    const approval=signedToken('a1',{
      v:1,jti:randomId('approval',18),sub:pair.tenantId,prj:pair.projectId,client:clientId,redirect:redirectUri,
      challenge:String(params.code_challenge),scope,resource:this.resource,state,
      exp:Math.floor((now+this.approvalTtlMs)/1000),
    },this.secret);
    return { approval_token:approval, client_name:client.name, scope, expires_in:Math.floor(this.approvalTtlMs/1000) };
  }

  approveAuthorization(approvalToken,{now=Date.now()}={}) {
    this.cleanup(now);
    const payload=parseToken(approvalToken,'a1',this.secret,'OAUTH_APPROVAL_INVALID');
    if (payload?.v!==1 || typeof payload.jti!=='string' || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) throw new Error('OAUTH_APPROVAL_INVALID');
    if (this.usedApprovals.has(payload.jti)) throw new Error('OAUTH_APPROVAL_REUSED');
    this.clientMetadata(payload.client,{now});
    this.usedApprovals.set(payload.jti,payload.exp*1000);
    const code=randomId('code',24);
    this.authorizationCodes.set(code,{...payload,exp:now+this.codeTtlMs});
    const redirect=new URL(payload.redirect);
    redirect.searchParams.set('code',code);
    if (payload.state) redirect.searchParams.set('state',payload.state);
    return { redirect_url:redirect.toString() };
  }

  exchangeAuthorizationCode(input,{now=Date.now()}={}) {
    this.cleanup(now);
    const code=text(input?.code,256,'OAUTH_CODE');
    const row=this.authorizationCodes.get(code);
    if (!row || row.exp<=now) throw new Error('OAUTH_INVALID_GRANT');
    this.authorizationCodes.delete(code);
    const clientId=text(input.client_id,8192,'OAUTH_CLIENT_ID');
    if (clientId!==row.client) throw new Error('OAUTH_INVALID_GRANT');
    if (safeRedirect(input.redirect_uri)!==row.redirect) throw new Error('OAUTH_INVALID_GRANT');
    if (String(input.resource??'')!==row.resource) throw new Error('OAUTH_RESOURCE_MISMATCH');
    if (pkceChallenge(pkceVerifier(input.code_verifier))!==row.challenge) throw new Error('OAUTH_INVALID_GRANT');
    return this.issueGrant(row,{now});
  }

  issueGrant(row,{now=Date.now()}={}) {
    const grant=randomId('grant',18);
    const jti=randomId('rt',18);
    const refreshExp=now+this.refreshTtlMs;
    this.refreshFamilies.set(grant,{jti,exp:refreshExp});
    return this.issueTokens({...row,grant,jti,refreshExp},{now});
  }

  issueTokens(row,{now=Date.now()}={}) {
    const access=signedToken('m1',{
      v:1,sub:opaqueId(row.sub,'TENANT'),prj:opaqueId(row.prj,'PROJECT'),client:row.client,
      aud:this.resource,scope:WRITE_SCOPE,iat:Math.floor(now/1000),exp:Math.floor((now+this.accessTtlMs)/1000),
    },this.secret);
    const refresh=signedToken('r2',{
      v:1,sub:row.sub,prj:row.prj,client:row.client,aud:this.resource,scope:WRITE_SCOPE,
      grant:row.grant,jti:row.jti,exp:Math.floor(row.refreshExp/1000),
    },this.secret);
    return { access_token:access,token_type:'Bearer',expires_in:Math.floor(this.accessTtlMs/1000),refresh_token:refresh,scope:WRITE_SCOPE };
  }

  refresh(input,{now=Date.now()}={}) {
    this.cleanup(now);
    const payload=parseToken(input?.refresh_token,'r2',this.secret,'OAUTH_INVALID_GRANT');
    if (payload?.v!==1 || payload.aud!==this.resource || payload.scope!==WRITE_SCOPE || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) throw new Error('OAUTH_INVALID_GRANT');
    const clientId=text(input.client_id,8192,'OAUTH_CLIENT_ID');
    if (clientId!==payload.client) throw new Error('OAUTH_INVALID_GRANT');
    if (String(input.resource??'')!==this.resource) throw new Error('OAUTH_RESOURCE_MISMATCH');
    const family=this.refreshFamilies.get(payload.grant);
    if (!family || family.exp<=now || family.jti!==payload.jti) throw new Error('OAUTH_INVALID_GRANT');
    const nextJti=randomId('rt',18);
    family.jti=nextJti;
    const row={...payload,jti:nextJti,refreshExp:family.exp};
    return this.issueTokens(row,{now});
  }

  verifyAccessToken(token,{now=Date.now(),requiredScope=WRITE_SCOPE}={}) {
    const payload=parseToken(token,'m1',this.secret,'MCP_ACCESS_INVALID');
    if (payload?.v!==1 || payload.aud!==this.resource || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) throw new Error('MCP_ACCESS_INVALID');
    if (requiredScope && payload.scope!==requiredScope) throw new Error('MCP_SCOPE_INSUFFICIENT');
    return { tenantId:opaqueId(payload.sub,'TENANT'),projectId:opaqueId(payload.prj,'PROJECT'),clientId:payload.client,scope:payload.scope };
  }
}

export { WRITE_SCOPE };
