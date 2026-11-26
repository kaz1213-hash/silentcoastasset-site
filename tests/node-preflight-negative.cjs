'use strict';
// Off-production negative tests: no GitHub writes, no Netlify calls, no public HTML edits.
const assert=require('assert/strict');
const cp=require('child_process');
const path=require('path');
const script=path.resolve(__dirname,'../scripts/site-release-preflight.cjs');
const denied=[
  ['--approval-batch','AB','--publish'],
  ['--approval-batch','Approved_20261012','--scope','Unknown'],
  ['--scope','BlogOnly'],
  ['--approval-batch','A'],
  ['--approval-batch','Approved_20261012','--scope','BlogOnly','--publish'],
];
for(const args of denied) {
 const r=cp.spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,1,'Expected preflight to reject '+args.join(' '));
 const message=(r.stdout||'')+(r.stderr||'');
 assert.match(message,/BLOCKED/,'Refusal must be visible');
 assert.doesNotMatch(message,/SITE_RELEASE_PREFLIGHT_PASS|DRY_RUN_ONLY/,'Invalid arguments must fail before any green release status');
}
console.log('NODE_PREFLIGHT_NEGATIVE_PASS '+denied.length+'/'+denied.length);
