import { RelayStore } from './relay-store.mjs';
import { LicenseAuth, parseIdList } from './license-auth.mjs';
import { McpOAuthBroker, WRITE_SCOPE } from './mcp-oauth.mjs';
import { handleMcpMessage } from './mcp-adapter.mjs';
import { CasBridgeState, persistBridgeStateCAS, restoreBridgeStateCAS } from './cas-state.mjs';
import { FixedWindowRateLimiter } from './rate-limit.mjs';
import { assertProductionReady } from './production-config.mjs';

const CORS_HEADERS=Object.freeze({
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET, POST, OPTIONS',
  'access-control-allow-headers':'authorization, content-type, mcp-protocol-version',
  'access-control-max-age':'600',
});
const SECURITY_HEADERS=Object.freeze({
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
});

function response(body,status=200,{cors=true,headers={}}={}) {
  const h=new Headers({...SECURITY_HEADERS,...(cors?CORS_HEADERS:{}),...headers});
  if (body==null) return new Response(null,{status,headers:h});
  if (typeof body==='string') {
    if (!h.has('content-type')) h.set('content-type','text/html; charset=utf-8');
    return new Response(body,{status,headers:h});
  }
  if (!h.has('content-type')) h.set('content-type','application/json; charset=utf-8');
  return new Response(JSON.stringify(body),{status,headers:h});
}
function redirect(url) { return response(null,302,{cors:false,headers:{location:String(url)}}); }
function escapeHtml(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function bearer(req) { const m=String(req.headers.get('authorization')||'').match(/^Bearer ([^\s]+)$/); return m?m[1]:''; }
function cookie(req,name) {
  for (const row of String(req.headers.get('cookie')||'').split(';')) {
    const at=row.indexOf('='); if (at<0) continue;
    if (row.slice(0,at).trim()===name) return decodeURIComponent(row.slice(at+1).trim());
  }
  return '';
}
async function jsonBody(req) {
  const text=await req.text();
  if (text.length>32*1024) throw new Error('BODY_TOO_LARGE');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('BAD_JSON'); }
}
async function formBody(req) {
  const text=await req.text();
  if (text.length>32*1024) throw new Error('BODY_TOO_LARGE');
  return Object.fromEntries(new URLSearchParams(text).entries());
}
function pairingPage() {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tanuki Site</title><body style="font-family:system-ui;max-width:680px;margin:12vh auto;padding:24px;line-height:1.6"><h1>Tanuki Site is ready for ChatGPT</h1><p>This browser is temporarily paired with your purchased Tanuki Site. Return to ChatGPT and connect Tanuki Site. No purchase key, API key, project ID, or relay token needs to be copied.</p><p>このブラウザは購入済みのTanuki Siteと一時的に接続されました。ChatGPTへ戻ってTanuki Siteを接続してください。購入キーやAPIキーのコピーは不要です。</p></body></html>';
}
function approvalPage({approvalToken,clientName}) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Tanuki Site</title><body style="font-family:system-ui;max-width:680px;margin:12vh auto;padding:24px;line-height:1.6"><h1>Connect ChatGPT to Tanuki Site?</h1><p><strong>${escapeHtml(clientName)}</strong> will be allowed to request safe website revisions for the currently paired Tanuki Site. Tanuki Site still validates and applies every change locally.</p><p>Purchase keys, API keys, HTML, CSS and JavaScript are not shared with ChatGPT.</p><form method="post" action="/oauth/approve"><input type="hidden" name="approval_token" value="${escapeHtml(approvalToken)}"><button style="font:inherit;padding:12px 18px" type="submit">Connect ChatGPT / 接続する</button></form></body></html>`;
}
function route(pathname) {
  if (pathname==='/v1/auth/activate') return {kind:'activate'};
  if (pathname==='/v1/auth/refresh') return {kind:'refresh'};
  if (pathname==='/v1/pairing/start') return {kind:'pair_start'};
  let m=pathname.match(/^\/v1\/projects\/([A-Za-z0-9_-]{8,96})\/commands$/);
  if (m) return {kind:'commands',projectId:m[1]};
  m=pathname.match(/^\/v1\/projects\/([A-Za-z0-9_-]{8,96})\/commands\/pending$/);
  if (m) return {kind:'pending',projectId:m[1]};
  m=pathname.match(/^\/v1\/projects\/([A-Za-z0-9_-]{8,96})\/commands\/([A-Za-z0-9_-]{8,96})\/ack$/);
  if (m) return {kind:'ack',projectId:m[1],revisionId:m[2]};
  return null;
}
function requestIp(req,context) {
  const direct=String(context?.ip||'').trim();
  if (direct && direct.length<=96 && !/[\r\n\0]/.test(direct)) return direct;
  return 'unknown';
}

export function createServerlessBridge({ stateStore, env=process.env, fetchImpl=globalThis.fetch }={}) {
  const secret=String(env.TANUKI_RELAY_SESSION_SECRET||'');
  const publicUrl=String(env.TANUKI_RELAY_PUBLIC_URL||'');
  const productIds=parseIdList(env.TANUKI_SITE_PRODUCT_IDS);
  const variantIds=parseIdList(env.TANUKI_SITE_VARIANT_IDS);
  const allowedOrigins=new Set(String(env.TANUKI_MCP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
  const readiness=assertProductionReady({
    mode:'production',sessionSecret:secret,publicUrl,durableState:Boolean(stateStore),allowDevToken:false,
    productIds,variantIds,
  });
  const persistence=new CasBridgeState({store:stateStore,key:String(env.TANUKI_RELAY_STATE_KEY||'tanuki-site-relay/state-v1')});
  const limiter=new FixedWindowRateLimiter({windowMs:60_000,maxEntries:5000});
  const licenseAuth=new LicenseAuth({secret,allowedProductIds:productIds,allowedVariantIds:variantIds,fetchImpl});

  function newState() {
    return {
      relay:new RelayStore(),
      oauth:new McpOAuthBroker({secret,publicBaseUrl:publicUrl}),
    };
  }
  async function loadState() {
    const state=newState();
    const restored=await restoreBridgeStateCAS({persistence,relay:state.relay,oauth:state.oauth});
    return {...state,etag:restored.etag??null};
  }
  async function transaction(work,{write=false,retries=3}={}) {
    let lastError=null;
    for (let attempt=0;attempt<retries;attempt+=1) {
      const state=await loadState();
      const result=await work(state);
      if (!write) return result;
      try {
        await persistBridgeStateCAS({persistence,relay:state.relay,oauth:state.oauth,etag:state.etag});
        return result;
      } catch(error) {
        if (error?.message!=='STATE_CONFLICT') throw error;
        lastError=error;
      }
    }
    throw lastError || new Error('STATE_CONFLICT');
  }
  function authLocal(req) {
    const token=bearer(req);
    if (!token) throw new Error('UNAUTHORIZED');
    try { const claims=licenseAuth.verifySession(token); return {tenantId:claims.sub,claims}; }
    catch { throw new Error('UNAUTHORIZED'); }
  }
  function limited(ip,key,limit) {
    return limiter.hit(`${key}:${ip}`,{limit}).allowed===false;
  }
  function checkOrigin(req) {
    const origin=String(req.headers.get('origin')||'').trim();
    return !origin || allowedOrigins.has(origin);
  }

  return async function handle(req,context={}) {
    const url=new URL(req.url);
    const ip=requestIp(req,context);
    if (req.method==='OPTIONS') return response(null,204);
    if (url.pathname==='/healthz') return response({ok:true,service:'tanuki-site-relay',runtime:'serverless-cas',durable_state:'configured'});
    if (url.pathname==='/readyz') return response({ok:true,ready:readiness.ready,checks:readiness.checks});

    try {
      if (req.method==='GET' && (url.pathname==='/.well-known/oauth-protected-resource' || url.pathname==='/.well-known/oauth-protected-resource/mcp')) {
        const {oauth}=newState(); return response(oauth.protectedResourceMetadata(),200,{cors:false});
      }
      if (req.method==='GET' && url.pathname==='/.well-known/oauth-authorization-server') {
        const {oauth}=newState(); return response(oauth.authorizationServerMetadata(),200,{cors:false});
      }
      if (req.method==='POST' && url.pathname==='/oauth/register') {
        if (limited(ip,'oauth-register',20)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const {oauth}=newState(); return response(oauth.registerClient(await jsonBody(req)),201,{cors:false});
      }
      if (req.method==='GET' && url.pathname.startsWith('/pair/')) {
        if (limited(ip,'pair-consume',30)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const code=decodeURIComponent(url.pathname.slice('/pair/'.length));
        const pairCookie=await transaction(({oauth})=>oauth.consumePairingCode(code),{write:true});
        const secure=new URL(publicUrl).protocol==='https:'?'; Secure':'';
        return response(pairingPage(),200,{cors:false,headers:{'set-cookie':`tanuki_pair=${encodeURIComponent(pairCookie)}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600${secure}`}});
      }
      if (req.method==='GET' && url.pathname==='/oauth/authorize') {
        if (limited(ip,'oauth-authorize',60)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const begun=await transaction(({oauth})=>oauth.beginAuthorization(Object.fromEntries(url.searchParams.entries()),cookie(req,'tanuki_pair')));
        return response(approvalPage({approvalToken:begun.approval_token,clientName:begun.client_name}),200,{cors:false});
      }
      if (req.method==='POST' && url.pathname==='/oauth/approve') {
        if (limited(ip,'oauth-approve',30)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const form=await formBody(req);
        const approved=await transaction(({oauth})=>oauth.approveAuthorization(form.approval_token),{write:true});
        return redirect(approved.redirect_url);
      }
      if (req.method==='POST' && url.pathname==='/oauth/token') {
        if (limited(ip,'oauth-token',60)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const form=await formBody(req);
        const tokens=await transaction(({oauth})=>{
          if (form.grant_type==='authorization_code') return oauth.exchangeAuthorizationCode(form);
          if (form.grant_type==='refresh_token') return oauth.refresh(form);
          throw new Error('OAUTH_UNSUPPORTED_GRANT_TYPE');
        },{write:true});
        return response(tokens,200,{cors:false,headers:{pragma:'no-cache'}});
      }

      if (url.pathname==='/mcp') {
        if (!checkOrigin(req)) return response({error:'MCP_ORIGIN_FORBIDDEN'},403,{cors:false});
        if (limited(ip,'mcp-ip',180)) return response({error:'RATE_LIMITED'},429,{cors:false});
        const token=bearer(req);
        let identity;
        try { identity=newState().oauth.verifyAccessToken(token); }
        catch {
          return response({error:'UNAUTHORIZED'},401,{cors:false,headers:{'www-authenticate':`Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", scope="${WRITE_SCOPE}"`}});
        }
        if (req.method==='GET') return response(null,405,{cors:false,headers:{allow:'POST'}});
        if (req.method!=='POST') return response(null,405,{cors:false,headers:{allow:'POST'}});
        const message=await jsonBody(req);
        const write=message?.method==='tools/call';
        const handled=await transaction(({relay})=>handleMcpMessage(message,{identity,store:relay}),{write});
        if (handled.kind==='notification') return response(null,202,{cors:false});
        return response(handled.body,200,{cors:false,headers:{'mcp-protocol-version':'2025-11-25'}});
      }

      const r=route(url.pathname);
      if (!r) return response({error:'NOT_FOUND'},404);
      if (req.method==='POST' && (r.kind==='activate' || r.kind==='refresh')) {
        if (limited(ip,`license-${r.kind}`,r.kind==='activate'?6:30)) return response({error:'RATE_LIMITED'},429);
        const payload=await jsonBody(req);
        try {
          const result=r.kind==='activate'?await licenseAuth.activate(payload):await licenseAuth.refresh(payload);
          return response(result);
        } catch(error) {
          const message=String(error?.message||'LICENSE_REJECTED').slice(0,96);
          return response({error:message},message==='LICENSE_PROVIDER_REJECTED'?403:400);
        }
      }

      let local;
      try { local=authLocal(req); } catch { return response({error:'UNAUTHORIZED'},401); }
      if (limited(local.tenantId,'local-tenant',180)) return response({error:'RATE_LIMITED'},429);
      if (req.method==='POST' && r.kind==='pair_start') {
        const payload=await jsonBody(req);
        const result=await transaction(({oauth})=>oauth.startPairing({tenantId:local.tenantId,projectId:String(payload.project_id||'')}),{write:true});
        return response(result);
      }
      if (req.method==='POST' && r.kind==='commands') {
        const payload=await jsonBody(req);
        if (payload.project_id!==r.projectId) return response({error:'PROJECT_ID_MISMATCH'},400);
        const result=await transaction(({relay})=>relay.submit(payload,{tenantId:local.tenantId}),{write:true});
        return response(result,202);
      }
      if (req.method==='GET' && r.kind==='pending') {
        const commands=await transaction(({relay})=>relay.pending(r.projectId,{tenantId:local.tenantId}));
        return response({commands});
      }
      if (req.method==='POST' && r.kind==='ack') {
        const result=await transaction(({relay})=>relay.ack(r.projectId,r.revisionId,{tenantId:local.tenantId}),{write:true});
        return response(result);
      }
      return response({error:'METHOD_NOT_ALLOWED'},405);
    } catch(error) {
      const message=String(error?.message||'BAD_REQUEST').slice(0,160);
      if (message==='STATE_CONFLICT') return response({error:'STATE_CONFLICT_RETRY'},409,{cors:!url.pathname.startsWith('/oauth')&&!url.pathname.startsWith('/mcp')});
      const status=/STATE_|PRODUCTION_NOT_READY/.test(message)?503:400;
      return response({error:message},status,{cors:!url.pathname.startsWith('/oauth')&&!url.pathname.startsWith('/mcp')});
    }
  };
}
