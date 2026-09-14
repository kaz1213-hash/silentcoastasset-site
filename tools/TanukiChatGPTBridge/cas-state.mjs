import { applyBridgeSnapshot, createBridgeSnapshot, normalizeBridgeSnapshot } from './durable-state.mjs';

export class CasBridgeState {
  constructor({ store, key='tanuki-site-relay/state-v1' }={}) {
    if (!store || typeof store.getWithMetadata!=='function' || typeof store.setJSON!=='function') throw new Error('CAS_STORE_REQUIRED');
    const clean=String(key??'').trim();
    if (!clean || clean.length>180 || /[\r\n\0]/.test(clean)) throw new Error('CAS_KEY_INVALID');
    this.store=store;
    this.key=clean;
  }

  async load() {
    const row=await this.store.getWithMetadata(this.key,{consistency:'strong',type:'json'});
    if (!row) return {snapshot:null,etag:null};
    if (!row.etag || typeof row.etag!=='string') throw new Error('CAS_ETAG_MISSING');
    return {snapshot:normalizeBridgeSnapshot(row.data),etag:row.etag};
  }

  async save(snapshot,{etag=null}={}) {
    const valid=normalizeBridgeSnapshot(snapshot);
    const options=etag?{onlyIfMatch:etag}:{onlyIfNew:true};
    const result=await this.store.setJSON(this.key,valid,options);
    if (!result?.modified || typeof result?.etag!=='string') throw new Error('STATE_CONFLICT');
    return {etag:result.etag};
  }
}

export async function restoreBridgeStateCAS({ persistence, relay, oauth, now=Date.now() }={}) {
  if (!persistence) return {restored:false,reason:'disabled',etag:null};
  const row=await persistence.load();
  if (!row.snapshot) return {restored:false,reason:'missing',etag:null};
  const restored=applyBridgeSnapshot({snapshot:row.snapshot,relay,oauth,now});
  return {...restored,etag:row.etag};
}

export async function persistBridgeStateCAS({ persistence, relay, oauth, etag=null, now=Date.now() }={}) {
  if (!persistence) return {persisted:false,etag:null};
  const snapshot=createBridgeSnapshot({relay,oauth,now});
  const saved=await persistence.save(snapshot,{etag});
  return {persisted:true,etag:saved.etag};
}
