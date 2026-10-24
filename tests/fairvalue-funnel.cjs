#!/usr/bin/env node
'use strict';
/**
 * Prelaunch static assurance: SCA + free FairValue candidate.
 * This is NOT a production authorization.
 */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const manifest=JSON.parse(read('fairvalue/PACKAGE_MANIFEST.json'));
const price=JSON.parse(read('fairvalue/app/data/transactions.json'));
const geo=JSON.parse(read('fairvalue/app/data/geography.json'));
const catalog=JSON.parse(read('fairvalue/app/data/national_catalog.json'));
assert.equal(manifest.status,'NONPRODUCTION_PRELAUNCH_REVIEW_REQUIRED');
assert.equal(manifest.hasPublicLaunchApproval,false);
assert.equal(manifest.originVersion,'0.4.7');
assert.equal(manifest.transactionCount,17156);
assert.equal(price.metadata.count,17156);
assert.equal(geo.metadata.priceSourceFingerprint,price.metadata.sourceFingerprint);
assert.equal(catalog.metadata.prefectures,47);
assert.equal(catalog.metadata.municipalities,1905);
const index=read('index.html'),landing=read('fairvalue/index.html'),app=read('fairvalue/app/index.html');
assert.ok(index.includes('href="/fairvalue/"'));
assert.ok(index.includes('Tanuki D-U-N-S'));
assert.ok(index.includes('Project Vault'));
assert.ok(index.includes('タヌキ研究所で最近起きたこと'));
assert.ok(landing.includes('href="/fairvalue/app/"'));
assert.ok(landing.includes('name="robots" content="noindex,nofollow"'));
assert.ok(app.includes('name="robots" content="noindex,nofollow"'));
assert.ok(!landing.toLowerCase().includes('入力された電話番号を送信'));
assert.ok(landing.includes('15市区'));
assert.ok(landing.includes('17,156件'));
assert.ok(landing.includes('全国47都道府県'));
assert.ok(landing.includes('売買・賃貸借の媒介、代理'));
assert.ok(landing.includes('OpenStreetMap contributors'));
assert.ok(read('fairvalue/app/DATA-AND-LICENSING.txt').includes('Open Database License'));
const routes=manifest.files.filter(entry=>entry.path!=='DATA-AND-LICENSING.txt');
for(const item of routes){
 const full=path.join(root,'fairvalue/app',item.path);
 assert.ok(fs.existsSync(full),'missing '+item.path);
 const actual=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
 assert.equal(actual,item.sha256,'integrity mismatch '+item.path);
}
const apiSource=read('fairvalue/app/app.mjs');
assert.ok(apiSource.includes('./data/transactions.json'));
const files=fs.readdirSync(path.join(root,'fairvalue/app/data/national_shapes')).filter(n=>n.endsWith('.json'));
assert.equal(files.length,47);
console.log('FREE_FUNNEL_STATIC_PASS',{
 priceRows:price.metadata.count,geoPrefectures:catalog.metadata.prefectures,
 indexable:false,sourceFilesVerified:manifest.files.length
});
