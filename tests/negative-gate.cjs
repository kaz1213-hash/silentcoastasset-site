'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const repo=path.resolve(__dirname,'..'),base=path.join(repo,'public-build'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tanuki-guard-'));
const gate=path.join(repo,'scripts','site-release-gate.cjs');
function run(stage,success){const r=cp.spawnSync(process.execPath,[gate,'verify',stage],{encoding:'utf8'});if((r.status===0)!==success){console.error(r.stdout,r.stderr);throw Error('Expected '+success+' but got '+r.status)}}
try{
 fs.cpSync(base,tmp,{recursive:true});
 run(tmp,true);
 fs.appendFileSync(path.join(tmp,'blog','index.html'),'<!-- approved blog-only edit -->');run(tmp,true);
 fs.appendFileSync(path.join(tmp,'media','index.html'),'<!-- unauthorized edit -->');run(tmp,false);
 fs.copyFileSync(path.join(base,'media','index.html'),path.join(tmp,'media','index.html'));
 fs.rmSync(path.join(tmp,'media','assets','surfing-company.png'));run(tmp,false);
 console.log('NEGATIVE_GATE_PASS changed blog allowed, changed media and missing comic blocked');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
