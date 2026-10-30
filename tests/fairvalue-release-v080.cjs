#!/usr/bin/env node
'use strict';
/** Independent SCA release candidate safety tests, no public deployment. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {stageFairValue,checkManifest,parseTarGzip,verifyFairValueSite}=
 require('../scripts/stage-fairvalue-v080.cjs');
const root=path.resolve(__dirname,'..');
const published=path.join(root,'public-build');
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const stage=f=>fs.readFileSync(path.join(published,f),'utf8');
const m=checkManifest();
const tar=parseTarGzip(m);
assert.equal(tar.size,220);
assert.equal(m.manifest.newQ2Observations,5763);
assert.equal(m.manifest.priorObservations,167559);
assert.equal(m.manifest.generalPublicReleaseApproved,false);
assert.equal(m.manifest.status,'READY_FOR_REVIEW_NOT_PUBLISHED');
assert.equal(Object.keys(m.manifest.staticAssets).length,220);
assert.equal(read('sitemap.xml').includes('https://silentcoastasset.com/fairvalue/'),true);
assert.equal(read('sitemap.xml').includes('https://silentcoastasset.com/fairvalue/app/'),true);
assert.equal(read('index.html').includes('data-product="tanuki-fairvalue"'),true);
assert.equal(read('index.html').includes('href="/fairvalue/"'),true);
assert.equal(read('fairvalue/index.html').includes('href="/fairvalue/app/"'),true);
assert.equal(read('netlify.toml').includes('for = "/fairvalue/*"'),true);
assert.equal(read('netlify.toml').includes("frame-ancestors 'none'"),true);
assert.equal(read('netlify.toml').includes('X-Robots-Tag'),false,
 'Root netlify.toml must not permanently force FairValue noindex on approved production');
assert.equal(stage('fairvalue/index.html').includes('name="robots" content="noindex,nofollow"'),true);
assert.equal(stage('fairvalue/app/index.html').includes('name="robots" content="noindex,nofollow"'),true);
assert.equal(stage('fairvalue/app/index.html').includes('rel="canonical" href="https://silentcoastasset.com/fairvalue/app/"'),true);
assert.equal(stage('fairvalue/index.html').includes('rel="canonical" href="https://silentcoastasset.com/fairvalue/"'),true);
assert.equal(stage('fairvalue/index.html').includes('173,322件'),true);
assert.equal(stage('fairvalue/index.html').includes('参考価格'),true);
assert.equal(fs.existsSync(path.join(published,'release')),false,
 'ZIP/manifest/release docs must not be included in public site');
assert.equal(fs.existsSync(path.join(published,'fairvalue/app/_headers')),false);
assert.equal(fs.existsSync(path.join(published,'fairvalue/app/robots.txt')),false);
assert.equal(fs.existsSync(path.join(published,'fairvalue/app/data/transactions.json')),true);
assert.equal(fs.existsSync(path.join(published,'fairvalue/app/data/q2_transactions/index.json')),true);
const q2=JSON.parse(stage('fairvalue/app/data/q2_transactions/index.json'));
assert.equal(q2.newRows,5763);
assert.equal(Object.keys(q2.entries).length,47);
assert.equal(q2.publicReleaseAllowed,false,'Raw source remains observational research, not price-model launch approval');
const legacy=JSON.parse(stage('fairvalue/app/data/transactions.json'));
assert.equal(legacy.metadata.periodMax,'2026Q1');
assert.equal(legacy.metadata.count,17156);
const protectedFiles=JSON.parse(read('release/protected-files.json')).protected;
assert.equal(Object.keys(protectedFiles).length,37);
assert.equal(
 sha(Buffer.from(read('index.html').replace(/\r\n?/g,'\n'),'utf8')),
 protectedFiles['index.html'],'Homepage release-manifest hash mismatch');
verifyFairValueSite(published,{context:'deploy-preview'});
assert.throws(
 ()=>stageFairValue(published,{context:'production'}),
 /PRODUCTION_FORBIDDEN_UNTIL_OWNER_APPROVES_PUBLIC_RELEASE/,
 'Production branch must fail-closed until owner approval is recorded');
const altered=Buffer.from(m.packageBytes);
altered[Math.trunc(altered.length/2)]^=1;
assert.throws(()=>parseTarGzip({manifest:m.manifest,packageBytes:altered}),
 /.+/,'Tampering with sealed original source must stop');
console.log('FAIRVALUE_V080_SCA_PUBLIC_READY_TEST_PASS',JSON.stringify({
 branchPreviewOnly:true,appFiles:218,rawProofFiles:220,
 originalSCAProtected:37,oldCount:167559,Q2:5763,priceModelBetaCities:21,
 canonicalLanding:true,canonicalApp:true,internalLinks:true,
 sourceProtected:true,productionRefused:true,originSCAUnaffected:true
}));
