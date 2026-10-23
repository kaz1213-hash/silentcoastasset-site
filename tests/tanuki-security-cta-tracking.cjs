'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const security=fs.readFileSync(path.join(root,'tanuki-security.html'),'utf8');
const shelf=fs.readFileSync(path.join(root,'tanuki-store.html'),'utf8');
const toml=fs.readFileSync(path.join(root,'netlify.toml'),'utf8');
const locked=JSON.parse(fs.readFileSync(path.join(root,'release','protected-files.json'),'utf8')).protected;
const store='https://apps.microsoft.com/detail/9NHDT5BNC31K';
const count=(s,v)=>s.split(v).length-1;
assert.equal(count(security,'href="/go/tanuki-security"'),4,'Both language CTAs, hero and footer');
assert.equal(count(shelf,'href="/go/tanuki-security"'),2,'Both language shelf CTAs');
assert.equal(count(security,'href="'+store+'"'),0,'No direct purchase CTA in Security page');
assert.equal(count(shelf,'href="'+store+'"'),0,'No direct purchase CTA in shelf');
assert.ok(security.includes('"downloadUrl":"'+store+'"'),'Schema.org software download stays official');
assert.ok(security.includes('"price":"500"') && security.includes('"price":"3.99"'),'Existing prices preserved');
const blocks=toml.split('[[redirects]]').slice(1).filter(s=>s.includes('from = "/go/tanuki-security"'));
assert.equal(blocks.length,1,'Unique first-party Security tracking route');
assert.ok(blocks[0].includes('to = "'+store+'"'),'Official Microsoft Store destination');
assert.ok(blocks[0].includes('status = 302'),'Temporary not permanent redirect');
assert.ok(blocks[0].includes('force = true'),'No static shadow');
for(const [name,html] of [['tanuki-security.html',security],['tanuki-store.html',shelf]]){
 const hash=crypto.createHash('sha256').update(html.replace(/\r\n?/g,'\n')).digest('hex');
 assert.equal(hash,locked[name],'Protected release content hash must match');
}
console.log('TANUKI_SECURITY_CTA_HOP_PASS 6/6 static CTAs; canonical Store, original prices, release seals, single 302');
