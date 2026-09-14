function idList(value) {
  if (Array.isArray(value)) return value.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0);
  return String(value??'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isSafeInteger(x)&&x>0);
}

function validHttpsOrigin(value) {
  try {
    const url=new URL(String(value??''));
    return url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname.replace(/\/+$/,'')==='';
  } catch { return false; }
}

export function evaluateRelayReadiness({
  mode='development',
  sessionSecret='',
  publicUrl='',
  durableState=false,
  allowDevToken=false,
  productIds=[],
  variantIds=[],
}={}) {
  const production=String(mode).toLowerCase()==='production';
  const checks={
    secret:typeof sessionSecret==='string' && sessionSecret.length>=32,
    https_origin:validHttpsOrigin(publicUrl),
    durable_state:durableState===true,
    dev_token_disabled:allowDevToken!==true,
    entitlement_allowlist:idList(productIds).length>0 || idList(variantIds).length>0,
  };
  const blockers=production ? Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name) : [];
  return Object.freeze({mode:production?'production':'development',ready:blockers.length===0,checks:Object.freeze(checks),blockers:Object.freeze(blockers)});
}

export function assertProductionReady(input={}) {
  const result=evaluateRelayReadiness(input);
  if (result.mode==='production' && !result.ready) throw new Error(`PRODUCTION_NOT_READY:${result.blockers.join(',')}`);
  return result;
}
