from pathlib import Path
import base64,hashlib,json,re,sys
root=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2: raise SystemExit('Pass an authorized director-reviewed media-lab-review.html path')
review=Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(review).hexdigest()=='0a86e6bf5c0730f4596811428b03ba3c95a93e3cb42d89334621e1ced18e545c'
pages=json.loads(review.decode('utf-8').split('const pages=',1)[1].split(';function showPreview',1)[0])
assets={'surfing':'surfing-company.png','bots':'bots-447.png','newsletter':'newsletter-2043.png','aquarium':'aquarium-plants.png'}
for k,n in assets.items():
 src=re.findall(r'<img[^>]*src="data:image/png;base64,([^"]+)"',pages[k])
 assert len(src)==1
 blob=base64.b64decode(src[0])
 if k=='surfing':assert hashlib.sha256(blob).hexdigest()=='e6542842963c2fcd0cafa77da24ca4c6ae0585c28a71b92b8881842fc0958b63'
 if k=='bots':assert hashlib.sha256(blob).hexdigest()=='b540ce9627f4bf215750812ac52bfb3e15a8edac12cb5dadaacca6128730863e'
 dst=root/'media/assets'/n
 if k in ('newsletter','aquarium') and dst.exists():assert dst.read_bytes()==blob
 dst.write_bytes(blob)
 print('ASSET',k,n,len(blob))
def fix_reader(k,dest):
 html=pages[k]
 html=re.sub(r'src="data:image/png;base64,[^"]+"','src="/media/assets/'+assets[k]+'"',html)
 html=html.replace('href="#gallery" onclick="parent.showPreview(\'gallery\');return false"','href="/media/"')
 assert 'parent.showPreview' not in html and 'data:image/' not in html
 html=html.replace('</head>','<link rel="canonical" href="https://silentcoastasset.com/'+dest+'">\n</head>',1)
 fp=root/dest/'index.html';fp.parent.mkdir(parents=True,exist_ok=True)
 fp.write_text(html,encoding='utf-8')
fix_reader('surfing','media/comics/surfing-company')
fix_reader('bots','media/comics/bots-447')
gallery=pages['gallery']
assert len(re.findall(r'src="data:image/png;base64,[^"]+"',gallery))==4
for k in ['surfing','bots','newsletter','aquarium']:
 gallery=re.sub(r'src="data:image/png;base64,[^"]+"','src="/media/assets/'+assets[k]+'"',gallery,count=1)
urls={'surfing':'/media/comics/surfing-company/','bots':'/media/story-0003/','newsletter':'/media/story-0001/','aquarium':'/media/story-0002/'}
for k,url in urls.items():
 gallery=gallery.replace('href="#'+k+'" onclick="parent.showPreview(\''+k+'\');return false"','href="'+url+'"')
gallery=gallery.replace('href="#gallery" onclick="parent.showPreview(\'gallery\');return false"','href="/"')
gallery=gallery.replace('href="#" aria-disabled="true" onclick="return false" title="外部リンクは確認用ファイルでは開きません"','href="/blog/"',1)
gallery=gallery.replace('href="#" aria-disabled="true" onclick="return false" title="外部リンクは確認用ファイルでは開きません"','href="https://x.com/TanukiBySCA"',1)
gallery=gallery.replace('Comic 公開中','4コマで読む')
gallery=gallery.replace('期待 → 初売上 → ボット判明 → しょんぼり。','447アクセスに喜んだら、ボットらしい訪問だった。')
extra='''<section class="section"><div class="eyebrow">ONE STORY, MANY EXPRESSIONS</div>
<h2>同じ実話が、違う作品になる。</h2>
<p class="lead">最初にあるのは、ちょっと困った実話。Comicではオチを、Shortでは間を、Xでは一言を、Blogでは顛末を。Musicになることだってあるかもしれない。ここは実話をいくつもの表現で遊ぶ研究所です。</p>
<div class="formats">Comic ／ Short ／ X ／ Blog ／ Music</div>
<div class="actions"><a class="button" href="/blog/">ブログを読む</a><a class="button" href="https://x.com/TanukiBySCA">Xを見る</a></div></section>'''
assert '</div></main>' in gallery
gallery=gallery.replace('<section class="section"><div class="eyebrow">PUBLISHED STORIES</div>',extra+'<section class="section"><div class="eyebrow">PUBLISHED STORIES</div>',1)
gallery=gallery.replace('</head>','<link rel="canonical" href="https://silentcoastasset.com/media/">\n</head>',1)
assert 'parent.showPreview' not in gallery and 'data:image/' not in gallery and 'STORY MAP' not in gallery
(root/'media/index.html').write_text(gallery,encoding='utf-8')
for id,comic in [('0001','newsletter-2043'),('0002','aquarium-plants'),('0003','bots-447')]:
 f=root/'media'/('story-'+id)/'index.html'
 html=f.read_text(encoding='utf-8')
 if id=='0003':
  html=html.replace('/media/assets/surfing-company.png','/media/assets/bots-447.png')
  html=html.replace('/media/comics/surfing-company/','/media/comics/bots-447/')
 block='<div class="media-grid"><div class="media-card"><b>Comic</b><a class="button" href="/media/comics/'+comic+'/">4コマを読む</a></div>'
 if id=='0003':block+='<div class="media-card"><b>Blog</b><a class="button" href="/blog/447-visits-bots.html">実話を読む</a></div>'
 block+='</div>\n'
 html,num=re.subn(r'<div class="media-grid">.*?</div>\s*<h2>',block+'<h2>',html,count=1,flags=re.S)
 assert num==1
 html=html.replace('Story Packet','実話').replace('公開承認前の成果物はここでは内容を出しません。','媒体ごとに変わる読み味も楽しんでください。')
 assert '原稿あり・非公開' not in html and '制作済み・公開承認前' not in html
 f.write_text(html,encoding='utf-8')
print('REPAIRED media index + real 4 panels + readers + existing story pages')
