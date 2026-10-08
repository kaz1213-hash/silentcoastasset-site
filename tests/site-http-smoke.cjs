'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(__dirname,'../public-build');
const urls=['/','/media/','/media/story-0001/','/media/story-0002/','/media/story-0003/',
'/media/comics/surfing-company/','/media/comics/bots-447/','/media/comics/newsletter-2043/',
'/media/comics/aquarium-plants/','/blog/','/blog/447-visits-bots.html','/blog/got-it-x-spam-label.html',
'/blog/approval-gate.html','/blog/butler-vs-dots.html','/blog/fx-university-to-tanuki-lab.html',
'/blog/logs-to-content.html','/blog/mine-producer-publisher.html','/project-vault.html',
'/tanuki-store.html','/tanuki-chronicle.html','/tanuki-fortune.html','/fx-university.html',
'/media/assets/surfing-company.png','/media/assets/bots-447.png','/media/assets/newsletter-2043.png','/media/assets/aquarium-plants.png'];
const server=http.createServer((req,res)=>{let u=decodeURI(new URL(req.url,'http://localhost').pathname);
if(u.endsWith('/'))u+='index.html';
const f=path.resolve(root,'.'+u);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}
if(!fs.existsSync(f)){res.writeHead(404).end();return}
res.setHeader('content-type',f.endsWith('.png')?'image/png':'text/html; charset=utf-8');fs.createReadStream(f).pipe(res);
});
server.listen(0,'127.0.0.1',async()=>{
 let failures=0;const base='http://127.0.0.1:'+server.address().port;
 try{for(const u of urls){try{const r=await fetch(base+u),body=u.endsWith('.png')?'':await r.text();
 let ok=r.status===200;
 if(u==='/media/')ok&&=['サーフィンしたかっただけやのに','447人も来たと思ったら、ボットだった','ONE STORY, MANY EXPRESSIONS'].every(x=>body.includes(x))&&!body.includes('STORY MAP');
 if(u==='/')ok&&=body.includes('タヌキ研究所で最近起きたこと')&&body.includes('/media/');
 if(u==='/media/comics/surfing-company/')ok&&=body.includes('サーフィンしたかっただけやのに')&&!body.includes('447人も来たと思ったら');
 if(u==='/media/story-0003/')ok&&=body.includes('/media/assets/bots-447.png');
 console.log((ok?'PASS ':'FAIL ')+u);if(!ok)failures++;
 }catch(e){console.error('FAIL '+u+' '+e);failures++}}
 console.log('HTTP_SMOKE',failures?'FAIL':'PASS',(urls.length-failures)+'/'+urls.length);
 if(failures)process.exitCode=1;
 }finally{server.close()}
});
