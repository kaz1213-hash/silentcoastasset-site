#!/usr/bin/env node
'use strict';
// Protect published pages from stale snapshot deploys.
// Usage: node scripts/site-release-gate.cjs seal|build|verify [STAGE_PATH]
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),manifestFile=path.join(root,'release','protected-files.json');
const allowedDirs=['assets','blog','commerce','core-proof','media','fairvalue'];
const rootFiles=new Set(['.nojekyll','index.html','robots.txt','sitemap.xml','pages-health.txt']);
function publicName(s){return rootFiles.has(s)||allowedDirs.includes(s)||/\.(html|txt|xml|webmanifest)$/.test(s)&&!s.startsWith('WORK_');}
function fileHash(buf){return crypto.createHash('sha256').update(buf).digest('hex')}
function normalized(rel,buf){return (/\.(html|txt|xml|js|css|json|md|webmanifest)$/i.test(rel)||rel==='.nojekyll')?Buffer.from(buf.toString('utf8').replace(/\r\n?/g,'\n'),'utf8'):buf}
function files(base,rel=''){
 let out=[];
 for(const item of fs.readdirSync(path.join(base,rel),{withFileTypes:true})){
  const name=rel?rel+'/'+item.name:item.name;
  if(!rel&&!publicName(item.name))continue;
  if(item.isDirectory())out=out.concat(files(base,name));
  else if(item.isFile())out.push(name.replace(/\\/g,'/'));
 }
 return out.sort();
}
function protect(p){return !(p==='sitemap.xml'||p.startsWith('blog/'))}
function hashes(base){const result={};for(const f of files(base).filter(protect))result[f]=fileHash(normalized(f,fs.readFileSync(path.join(base,f))));return result}
function fail(msg){console.error('BLOCKED: '+msg);process.exitCode=1;throw Error(msg)}
function validate(base){
 const required=['index.html','media/index.html','media/story-0001/index.html','media/story-0002/index.html','media/story-0003/index.html',
 'media/comics/surfing-company/index.html','media/comics/bots-447/index.html','media/comics/newsletter-2043/index.html',
 'media/comics/aquarium-plants/index.html','media/assets/surfing-company.png','media/assets/bots-447.png',
 'blog/447-visits-bots.html','blog/got-it-x-spam-label.html','project-vault.html','tanuki-store.html'];
 for(const r of required)if(!fs.existsSync(path.join(base,r)))fail('Missing '+r);
 for(const r of ['fairvalue/index.html','fairvalue/app/index.html',
   'fairvalue/app/app.mjs','fairvalue/app/seller_proceeds.mjs','fairvalue/app/area_map_ui.mjs',
   'fairvalue/app/data/transactions.json','fairvalue/app/data/validation.json',
   'fairvalue/app/data/geography.json','fairvalue/app/data/national_catalog.json',
   'fairvalue/app/DATA-AND-LICENSING.txt','fairvalue/PACKAGE_MANIFEST.json'])
   if(!fs.existsSync(path.join(base,r)))fail('Missing FairValue integration '+r);
 const fairLanding=fs.readFileSync(path.join(base,'fairvalue/index.html'),'utf8');
 const fairApp=fs.readFileSync(path.join(base,'fairvalue/app/index.html'),'utf8');
 const fairManifest=JSON.parse(fs.readFileSync(path.join(base,'fairvalue/PACKAGE_MANIFEST.json'),'utf8'));
 if(!fairLanding.includes('name="robots" content="noindex,nofollow"')||
    !fairApp.includes('name="robots" content="noindex,nofollow"'))
   fail('Prelaunch FairValue must not accidentally be indexed');
 if(fairManifest.status!=='NONPRODUCTION_PRELAUNCH_REVIEW_REQUIRED'||
    fairManifest.hasPublicLaunchApproval!==false)
   fail('Release candidate status was changed without launch approval');
 if(fairManifest.transactionCount!==17156||fairManifest.priceCityCount!==15)
   fail('FairValue price scope changed; re-review required');
 if(!fs.readFileSync(path.join(base,'index.html'),'utf8').includes('href="/fairvalue/"'))
   fail('SCA homepage has no entry to free FairValue research tool');

 const read=r=>fs.readFileSync(path.join(base,r),'utf8');
 const home=read('index.html'),media=read('media/index.html'),surf=read('media/comics/surfing-company/index.html');
 const bot=read('media/comics/bots-447/index.html'),story=read('media/story-0003/index.html');
 if(!home.includes('タヌキ研究所で最近起きたこと')||!home.includes('/media/'))fail('Homepage entry regressed');
 for(const s of ['ONE STORY, MANY EXPRESSIONS','サーフィンしたかっただけやのに','447人も来たと思ったら、ボットだった','Comic','Short','X','Blog','Music'])
  if(!media.includes(s))fail('Media Lab identity/story missing '+s);
 if(media.includes('STORY MAP')||media.includes('制作済み・非公開')||media.includes('原稿あり・非公開'))fail('Internal production table leaked to readers');
 if(!surf.includes('/media/assets/surfing-company.png')||!bot.includes('/media/assets/bots-447.png')||!story.includes('/media/assets/bots-447.png'))fail('Comic linked to wrong story');
 if(fileHash(fs.readFileSync(path.join(base,'media/assets/surfing-company.png')))==fileHash(fs.readFileSync(path.join(base,'media/assets/bots-447.png'))))fail('Bot and surf comics are identical');
 for(const r of ['media/story-0001/index.html','media/story-0002/index.html','media/story-0003/index.html']) {
  const h=read(r);if(h.includes('原稿あり・非公開')||h.includes('制作済み・公開承認前'))fail('Internal production status leak: '+r);
 }
 console.log('IDENTITY_PASS four real comics, clean media pages, homepage/legacy pages preserved');
}
function verify(base){
 if(!fs.existsSync(manifestFile))fail('Missing protected manifest; never deploy');
 const saved=JSON.parse(fs.readFileSync(manifestFile,'utf8'));const actual=hashes(base);
 const union=new Set([...Object.keys(saved.protected),...Object.keys(actual)]);
 for(const key of [...union].sort())if(saved.protected[key]!==actual[key])fail('Protected file mismatch: '+key);
 validate(base);console.log('SCOPE_PASS protected='+Object.keys(actual).length+' blog/sitemap only may change');
}
function stage(){
 const out=path.join(root,'public-build');
 fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
 for(const f of files(root)){
  const target=path.join(out,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f),target);
 }
 return out;
}
try{
 const cmd=process.argv[2]||'verify';
 if(cmd==='seal'){
  validate(root);fs.mkdirSync(path.dirname(manifestFile),{recursive:true});
  const lock={policy:'blog-only cannot modify protected files',protected:hashes(root)};
  fs.writeFileSync(manifestFile,JSON.stringify(lock,null,2)+'\n');console.log('SEALED',Object.keys(lock.protected).length,'protected files');
 }else if(cmd==='verify'){
  verify(process.argv[3]?path.resolve(process.argv[3]):root);
 }else if(cmd==='build'){
  verify(root);const out=stage();verify(out);console.log('BUILD_PASS',out);
 }else fail('Unknown command '+cmd);
}catch(e){if(!process.exitCode){console.error(e);process.exitCode=1}}
