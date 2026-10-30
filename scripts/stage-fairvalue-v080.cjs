#!/usr/bin/env node
'use strict';
/**
 * Fail-closed SCA FairValue packaging for branch preview / approved release.
 * Only native Node.js APIs.  No network, shell extraction, secrets, or build deps.
 * The app in release/fairvalue-v080.tar.gz is deliberately noindex.
 * CONTEXT=production refuses publication until explicit approved-manifest flip.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const ROOT=path.resolve(__dirname,'..');
const manifestPath=path.join(ROOT,'release','fairvalue-v080.json');
const archivePath=path.join(ROOT,'release','fairvalue-v080.tar.gz');
const CANONICAL='https://silentcoastasset.com/fairvalue/app/';
const LANDING='https://silentcoastasset.com/fairvalue/';
const oldRobots='<meta name="robots" content="noindex,nofollow">';
const hex=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const requireThat=(ok,msg)=>{if(!ok)throw Error('FAIRVALUE_RELEASE_BLOCKED '+msg)};
const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const replaceOnce=(s,before,after,label)=>{
 requireThat(s.split(before).length===2,'Anchor missing/duplicated: '+label);
 return s.replace(before,after);
};
const readCstr=(h,from,len)=>h.subarray(from,from+len).toString('utf8').replace(/\0.*$/s,'');
const safeName=name=>typeof name==='string'&&
 /^[a-zA-Z0-9._/-]+$/.test(name)&&!name.startsWith('.')&&
 !name.startsWith('/')&&!name.includes('\\')&&!name.includes('..')&&!name.includes('//')&&name.length<=100;
const octal=h=>{
 const str=h.toString('ascii').replace(/\0/g,'').trim();
 requireThat(/^[0-7]+$/.test(str),'Unsafe tar integer encoding');
 return parseInt(str,8);
};
function checkManifest(){
 requireThat(fs.existsSync(manifestPath)&&fs.existsSync(archivePath),'Missing reviewed release package');
 const m=readJSON(manifestPath);
 requireThat(m.schema==='sca-fairvalue-source-v080' &&
  m.sourceCommit==='cd98d16732064b3e8b7e05356d25876f972c02c6' &&
  m.scaBaselineCommit==='4f1a24bc94690b0f1b17d3b086f116ed4a113d1c' &&
  m.totalAssetFiles===220 && m.publicAssetCount===218 &&
  m.priorObservations===167559 && m.newQ2Observations===5763 &&
  m.descriptiveCandidates===173322 && m.referencePriceBetaCities===21 &&
  m.modelLatestQuarter==='2026Q1' && m.observedLatestQuarter==='2026Q2' &&
  m.backfillsStillHeld===303 && m.historicalRevisionPairsStillHeld===2 &&
  m.modelTrainingChanged===false &&
  ((m.status==='READY_FOR_REVIEW_NOT_PUBLISHED'&&m.generalPublicReleaseApproved===false)||
   (m.status==='APPROVED_FOR_PRODUCTION'&&m.generalPublicReleaseApproved===true)) &&
  m.liveSiteModified===false &&
  m.sourceNoindexRequiresRemoval===true,
  'Unknown FairValue provenance, review status or baseline');
 const names=Object.keys(m.staticAssets||{});
 requireThat(names.length===220 &&
  m.reviewOnlyFilesToExclude?.join(',')==='_headers,robots.txt' &&
  names.includes('index.html') && names.includes('q2_preview.mjs') &&
  names.includes('data/q2_transactions/index.json') &&
  names.includes('data/transactions.json') &&
  names.every(safeName),'Unrecognized static asset allowlist');
 const landing=path.join(ROOT,'fairvalue','index.html');
 requireThat(fs.existsSync(landing) &&
  m.landingSourceBytes===fs.statSync(landing).size &&
  m.landingSourceSha256===hex(fs.readFileSync(landing)),
  'SCA launch landing source SHA changed after review');
 const packageBytes=fs.readFileSync(archivePath);
 requireThat(packageBytes.length===m.archiveBytes &&
  m.archiveSha256===hex(packageBytes) &&
  packageBytes.length>3_000_000 && packageBytes.length<5_000_000,
  'Corrupted or changed approved source archive');
 return {manifest:m,packageBytes};
}
function parseTarGzip({manifest,packageBytes}){
 const expanded=zlib.gunzipSync(packageBytes,{maxOutputLength:85_000_000});
 requireThat(expanded.length<85_000_000,'Expanded package exceeds memory cap');
 let pos=0,sum=0;
 const result=new Map();
 while(pos<expanded.length){
  requireThat(pos+512<=expanded.length,'Truncated tar header');
  const h=expanded.subarray(pos,pos+512);
  if(h.every(b=>b===0)){
   requireThat(expanded.subarray(pos).every(b=>b===0),'Trailing unsafe tar bytes');
   break;
  }
  const name=readCstr(h,0,100);
  const type=h[156];
  const size=octal(h.subarray(124,136));
  const checksum=octal(h.subarray(148,156));
  const headerForChecksum=Buffer.from(h);headerForChecksum.fill(32,148,156);
  const calculated=headerForChecksum.reduce((a,b)=>a+b,0);
  requireThat(calculated===checksum,'Tar entry header altered: '+name);
  requireThat(safeName(name)&&manifest.staticAssets[name] &&
   (type===0||type===48)&&size>=0&&size<24_000_000&&!result.has(name),
   'Unsafe/unknown tar entry: '+name);
  const start=pos+512,end=start+size;
  requireThat(end<=expanded.length,'Incomplete tar content: '+name);
  const raw=expanded.subarray(start,end);
  const expected=manifest.staticAssets[name];
  requireThat(expected.bytes===size&&expected.sha256===hex(raw),
   'Tar original-file SHA-256 mismatch: '+name);
  result.set(name,raw);
  sum+=size;
  pos=start+Math.ceil(size/512)*512;
 }
 requireThat(result.size===220 && sum===manifest.sourceBytes,
  'Tar missing/unexpected files or expanded size');
 for(const name of Object.keys(manifest.staticAssets))
  requireThat(result.has(name),'Missing source '+name);
 const index=result.get('index.html').toString('utf8');
 requireThat(index.includes(oldRobots) &&
  !index.includes('<link rel="canonical"') &&
  index.includes('Silent Coast Asset株式会社') &&
  index.includes('id="q2NationalCount"'),
  'Noindex and provider attribution from reviewed source missing');
 const q2=JSON.parse(result.get('data/q2_transactions/index.json').toString('utf8'));
 requireThat(q2.period==='2026Q2'&&q2.newRows===5763 &&
  q2.priorPublishedRows===167559 && q2.additionalCoreQ2Rows===521 &&
  q2.researchBetaUpgraded===false && q2.publicReleaseAllowed===false &&
  Object.keys(q2.entries).length===47,'Q2 city data/index provenance mismatch');
 requireThat(JSON.parse(result.get('data/transactions.json').toString('utf8')).metadata.periodMax==='2026Q1',
  'Frozen original research model period changed');
 requireThat(result.get('_headers').toString('utf8').includes('noindex') &&
  result.get('robots.txt').toString('utf8').includes('Disallow: /'),
  'Original review-only distribution gates missing');
 return result;
}
function checkLanding(landing,publicApproved,expectedDigest){
 requireThat(hex(landing)===expectedDigest,'SCA launch landing no longer signed');
 const html=landing.toString('utf8');
 requireThat(html.includes('href="/fairvalue/app/"') &&
  html.includes('Silent Coast Asset') &&
  html.includes('21市区') &&
  html.includes('5,763件') &&
  html.includes('現在の査定額ではありません') &&
  html.includes('国土交通省') &&
  html.includes(oldRobots),'SCA landing link, honesty or noindex prelaunch missing');
 const source=path.join(ROOT,'fairvalue','index.html');
 requireThat(hex(fs.readFileSync(source))===hex(landing),'Landing must derive from reviewed source');
 return publicApproved?replaceOnce(html,oldRobots,
  '<meta name="robots" content="index,follow">','public landing robots'):html;
}
function stageFairValue(out,{context=process.env.CONTEXT||'local'}={}){
 const {manifest,packageBytes}=checkManifest();
 const production=context==='production';
 // Deliberate "two keys": the owner must approve the manifest and then
 // explicitly merge that commit for production. This v080 package has neither.
 if(production)requireThat(manifest.generalPublicReleaseApproved===true,
  'PRODUCTION_FORBIDDEN_UNTIL_OWNER_APPROVES_PUBLIC_RELEASE');
 const members=parseTarGzip({manifest,packageBytes});
 const landingPath=path.join(out,'fairvalue','index.html');
 requireThat(fs.existsSync(landingPath),'Missing SCA landing in staged site');
 const landing=fs.readFileSync(landingPath);
 const landingOut=checkLanding(landing,production,manifest.landingSourceSha256);
 fs.writeFileSync(landingPath,landingOut,'utf8');
 const target=path.join(out,'fairvalue','app');
 requireThat(!fs.existsSync(target),'App subtree must be created only by verified release script');
 fs.mkdirSync(target,{recursive:true});
 let count=0;
 for(const [name,body] of members){
  if(['_headers','robots.txt'].includes(name))continue;
  const dest=path.resolve(target,...name.split('/'));
  requireThat(dest.startsWith(target+path.sep),'Path traversal blocked');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  let output=body;
  if(name==='index.html'){
   let html=body.toString('utf8');
   const indexPolicy=production?
    '<meta name="robots" content="index,follow">':
    oldRobots;
   html=replaceOnce(html,oldRobots,
     indexPolicy+'\n<link rel="canonical" href="'+CANONICAL+'">',
     'app robots/canonical');
   // In-app return path is not SSO URL. Never add tracking SDKs.
   requireThat(html.includes('href="https://silentcoastasset.com/"'),
     'SCA operator link missing');
   output=Buffer.from(html,'utf8');
  }
  fs.writeFileSync(dest,output);
  count++;
 }
 requireThat(count===218,'Unexpected public app file count');
 verifyFairValueSite(out,{context});
 console.log('FAIRVALUE_STAGED',JSON.stringify({
  site:LANDING,app:CANONICAL,approvedForIndexing:production,
  appFiles:218,observedCandidateRows:173322,
  noProviderNetwork:true,sourceSha256:manifest.archiveSha256
 }));
}
function verifyFairValueSite(base,{context=process.env.CONTEXT||'local'}={}){
 const {manifest,packageBytes}=checkManifest();
 const expected=parseTarGzip({manifest,packageBytes});
 const landing=fs.readFileSync(path.join(base,'fairvalue','index.html'),'utf8');
 const app=fs.readFileSync(path.join(base,'fairvalue','app','index.html'),'utf8');
 const production=context==='production';
 const fromSource=fs.readFileSync(path.join(ROOT,'fairvalue','index.html'),'utf8');
 const expectedLanding=production?replaceOnce(fromSource,oldRobots,
  '<meta name="robots" content="index,follow">','expected public landing'):fromSource;
 requireThat(hex(Buffer.from(landing,'utf8'))===hex(Buffer.from(expectedLanding,'utf8')),
  'SCA landing changed outside signed robots transformation');
 const policy=production?'content="index,follow"':'content="noindex,nofollow"';
 requireThat(landing.includes(policy)&&app.includes(policy),'Unexpected robots policy for build context');
 requireThat(landing.includes('href="/fairvalue/app/"') &&
  landing.includes('rel="canonical" href="'+LANDING+'"') &&
  app.includes('rel="canonical" href="'+CANONICAL+'"') &&
  app.includes('国土交通省') &&
  app.includes('Silent Coast Asset株式会社'),
  'Missing stable canonical or production provenance');
 const dir=path.join(base,'fairvalue','app');
 const scan=(r,p='')=>fs.readdirSync(r,{withFileTypes:true}).flatMap(item=>{
   const name=p?p+'/'+item.name:item.name,where=path.join(r,item.name);
   return item.isDirectory()?scan(where,name):[name];
 });
 const actual=scan(dir).sort();
 const names=[...expected.keys()].filter(n=>!['_headers','robots.txt'].includes(n)).sort();
 requireThat(actual.length===218&&JSON.stringify(actual)===JSON.stringify(names),
  'Extra/unapproved FairValue app file on public build');
 for(const name of names){
  const contents=fs.readFileSync(path.join(dir,name));
  if(name==='index.html'){
   const oldHtml=expected.get(name).toString('utf8');
   const transformed=replaceOnce(oldHtml,oldRobots,
     (production?'<meta name="robots" content="index,follow">':oldRobots)+
     '\n<link rel="canonical" href="'+CANONICAL+'">',
     'expected app public/preview canonical');
   requireThat(hex(contents)===hex(Buffer.from(transformed,'utf8')),
    'App HTML changed outside controlled provenance transform');
  }else{
   requireThat(hex(contents)===manifest.staticAssets[name].sha256,
    'Verified static app file changed '+name);
  }
 }
 console.log('FAIRVALUE_SITE_RELEASE_GATE_PASS',
  JSON.stringify({context,appFiles:218,approvedForIndexing:production,unchangedDataFiles:216}));
}
module.exports={stageFairValue,verifyFairValueSite,checkManifest,parseTarGzip};
