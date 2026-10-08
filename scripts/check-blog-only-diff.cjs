'use strict';
const cp=require('child_process');
const base=process.argv[2]||'HEAD~1',head=process.argv[3]||'HEAD';
const changes=cp.execFileSync('git',['diff','--name-only',base,head],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const blog=changes.filter(x=>x.startsWith('blog/'));
const foreign=changes.filter(x=>!(x.startsWith('blog/')||x==='sitemap.xml'));
if(blog.length&&foreign.length) {console.error('REJECT BLOG+OTHER: ',foreign.join(', '));process.exit(1)}
console.log('DIFF_PASS blog files='+blog.length+' other files='+foreign.length);
