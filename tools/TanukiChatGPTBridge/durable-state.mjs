import fs from 'node:fs';
import path from 'node:path';

export const BRIDGE_STATE_VERSION = 1;
const OAUTH_STATE_VERSION = 1;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function opaqueId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value);
}

export function normalizeBridgeSnapshot(input) {
  if (!plainObject(input)) throw new Error('STATE_NOT_OBJECT');
  if (input.version !== BRIDGE_STATE_VERSION) throw new Error('STATE_BAD_VERSION');
  if (!plainObject(input.relay) || !plainObject(input.oauth)) throw new Error('STATE_BAD_SHAPE');
  return input;
}

function oauthExport(oauth, now) {
  oauth.cleanup(now);
  return {
    version: OAUTH_STATE_VERSION,
    pairingCodes:[...oauth.pairingCodes.entries()],
    usedApprovals:[...oauth.usedApprovals.entries()],
    authorizationCodes:[...oauth.authorizationCodes.entries()],
    refreshFamilies:[...oauth.refreshFamilies.entries()],
  };
}

function oauthImport(oauth, input, now) {
  if (!plainObject(input) || input.version !== OAUTH_STATE_VERSION) throw new Error('OAUTH_STATE_INVALID');
  for (const field of ['pairingCodes','usedApprovals','authorizationCodes','refreshFamilies']) {
    if (!Array.isArray(input[field])) throw new Error(`OAUTH_STATE_BAD_${field.toUpperCase()}`);
  }

  const pairingCodes = new Map();
  for (const entry of input.pairingCodes.slice(0,500)) {
    if (!Array.isArray(entry) || entry.length !== 2 || !plainObject(entry[1])) continue;
    const [key,row] = entry;
    if (typeof key !== 'string' || !key.startsWith('pair_') || !opaqueId(row.tenantId) || !opaqueId(row.projectId)) continue;
    const exp = Number(row.exp);
    if (!Number.isFinite(exp) || exp <= now) continue;
    pairingCodes.set(key,{tenantId:row.tenantId,projectId:row.projectId,exp});
  }

  const usedApprovals = new Map();
  for (const entry of input.usedApprovals.slice(0,2000)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const key=String(entry[0]??''); const exp=Number(entry[1]);
    if (!key.startsWith('approval_') || !Number.isFinite(exp) || exp<=now) continue;
    usedApprovals.set(key,exp);
  }

  const authorizationCodes = new Map();
  for (const entry of input.authorizationCodes.slice(0,500)) {
    if (!Array.isArray(entry) || entry.length !== 2 || !plainObject(entry[1])) continue;
    const key=String(entry[0]??''); const row=entry[1]; const exp=Number(row.exp);
    if (!key.startsWith('code_') || !Number.isFinite(exp) || exp<=now) continue;
    if (!opaqueId(row.sub) || !opaqueId(row.prj) || typeof row.client!=='string' || !row.client.startsWith('c1.')) continue;
    if (typeof row.redirect!=='string' || row.redirect.length>4096 || typeof row.challenge!=='string' || !/^[A-Za-z0-9_-]{43,128}$/.test(row.challenge)) continue;
    if (row.scope!=='tanuki:site:write' || row.resource!==oauth.resource || typeof row.jti!=='string') continue;
    authorizationCodes.set(key,{...row,exp});
  }

  const refreshFamilies = new Map();
  for (const entry of input.refreshFamilies.slice(0,5000)) {
    if (!Array.isArray(entry) || entry.length !== 2 || !plainObject(entry[1])) continue;
    const key=String(entry[0]??''); const row=entry[1]; const exp=Number(row.exp);
    if (!key.startsWith('grant_') || typeof row.jti!=='string' || !row.jti.startsWith('rt_') || !Number.isFinite(exp) || exp<=now) continue;
    refreshFamilies.set(key,{jti:row.jti,exp});
  }

  oauth.pairingCodes=pairingCodes;
  oauth.usedApprovals=usedApprovals;
  oauth.authorizationCodes=authorizationCodes;
  oauth.refreshFamilies=refreshFamilies;
  oauth.cleanup(now);
  return {
    restored_pairing:pairingCodes.size,
    restored_approvals:usedApprovals.size,
    restored_codes:authorizationCodes.size,
    restored_refresh_families:refreshFamilies.size,
  };
}

export function createBridgeSnapshot({ relay, oauth, now = Date.now() } = {}) {
  return normalizeBridgeSnapshot({
    version: BRIDGE_STATE_VERSION,
    saved_at: new Date(now).toISOString(),
    relay: relay.exportState({ now }),
    oauth: oauthExport(oauth,now),
  });
}

export function applyBridgeSnapshot({ snapshot, relay, oauth, now = Date.now() } = {}) {
  const valid=normalizeBridgeSnapshot(snapshot);
  const relayResult=relay.importState(valid.relay,{now});
  const oauthResult=oauthImport(oauth,valid.oauth,now);
  return { restored:true, saved_at:valid.saved_at??null, relay:relayResult, oauth:oauthResult };
}

export class JsonFileState {
  constructor({ filePath } = {}) {
    const raw = String(filePath ?? '').trim();
    if (!raw) throw new Error('STATE_FILE_REQUIRED');
    this.filePath = path.resolve(raw);
  }

  load() {
    if (!fs.existsSync(this.filePath)) return null;
    const stat = fs.statSync(this.filePath);
    if (!stat.isFile()) throw new Error('STATE_PATH_NOT_FILE');
    if (stat.size > 2 * 1024 * 1024) throw new Error('STATE_FILE_TOO_LARGE');
    return normalizeBridgeSnapshot(JSON.parse(fs.readFileSync(this.filePath,'utf8')));
  }

  save(snapshot) {
    const valid=normalizeBridgeSnapshot(snapshot);
    const dir=path.dirname(this.filePath);
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const temp=`${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temp,`${JSON.stringify(valid)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
      fs.renameSync(temp,this.filePath);
      try { fs.chmodSync(this.filePath,0o600); } catch {}
    } finally {
      if (fs.existsSync(temp)) try { fs.unlinkSync(temp); } catch {}
    }
    return valid;
  }
}

export function restoreBridgeState({ persistence, relay, oauth, now = Date.now() } = {}) {
  if (!persistence) return {restored:false,reason:'disabled'};
  const snapshot=persistence.load();
  if (!snapshot) return {restored:false,reason:'missing'};
  return applyBridgeSnapshot({snapshot,relay,oauth,now});
}

export function persistBridgeState({ persistence, relay, oauth, now = Date.now() } = {}) {
  if (!persistence) return {persisted:false};
  persistence.save(createBridgeSnapshot({relay,oauth,now}));
  return {persisted:true};
}
