#!/usr/bin/env python3
"""Copy only approved public, secret-free FairValue static artifacts into SCA's release candidate.

Usage:
  python scripts/package_fairvalue_from_local.py --source C:\\...\\tanuki-fairvalue
The source is an explicitly-authorized local project. Does not copy repo metadata,
tests, raw government ZIP archives, private docs, credentials, or local paths.
Production deployment is NOT performed by this script.
"""
import argparse,hashlib,json,pathlib,shutil,subprocess,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEST=ROOT/"fairvalue"/"app"
SCRIPTS=[
"app.mjs","area_map_stats.mjs","area_map_ui.mjs","attribute_evidence.mjs",
"confidence_intervals.mjs","estimator.mjs","fairvalue.mjs","freshness.mjs",
"hedonic.mjs","nationwide.mjs","offer_compare.mjs","offer_ui.mjs",
"property_features.mjs","seller_proceeds.mjs","seller_ui.mjs","street_basemap.mjs"
]
ARTIFACTS=["index.html","style.css"]+SCRIPTS+[
"data/transactions.json","data/validation.json","data/interval_profiles.json",
"data/geography.json","data/national_catalog.json","data/street_context.json",
"data/freshness.json"
]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--source",type=pathlib.Path,required=True)
 args=p.parse_args()
 source=args.source.resolve()
 if not (source/"package.json").is_file():raise SystemExit("Not a source FairValue project")
 commit=subprocess.check_output(["git","-C",str(source),"rev-parse","HEAD"],text=True).strip()
 state=subprocess.check_output(["git","-C",str(source),"status","--porcelain"],text=True).strip()
 if state:raise SystemExit("FairValue has uncommitted changes; abort packaging")
 version=json.loads((source/"package.json").read_text(encoding="utf-8"))["version"]
 data=json.loads((source/"data/transactions.json").read_text(encoding="utf-8"))
 if data["metadata"]["count"]!=17156 or data["metadata"]["municipalities"]!=15:
  raise SystemExit("Unexpected public price data scope")
 shapes=sorted((source/"data/national_shapes").glob("??.json"))
 if len(shapes)!=47:raise SystemExit("National geography source incomplete")
 for item in ARTIFACTS:
  if not (source/item).is_file():raise SystemExit("Required static artifact missing: "+item)
 if DEST.exists():shutil.rmtree(DEST)
 DEST.mkdir(parents=True)
 files=ARTIFACTS+["data/national_shapes/"+f.name for f in shapes]
 manifest=[]
 for item in files:
  original=source/item
  out=DEST/item
  out.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(original,out)
  manifest.append({"path":item,"bytes":out.stat().st_size,"sha256":sha(out)})
 # Prelaunch noindex is deliberate. Paid-free funnel must pass a later public release gate.
 homepage=DEST/"index.html"
 html=homepage.read_text(encoding="utf-8")
 if '<meta name="robots" content="noindex,nofollow">' not in html:
  raise SystemExit("Public-ready robot policy unexpectedly changed; review required")
 old='        <span class="beta">PUBLIC DATA / BETA</span>'
 new='        <span class="beta">FREE / RESEARCH BETA</span>\n        <a href="/fairvalue/" aria-label="Silent Coast Assetの無料ツール紹介へ">← Silent Coast Asset</a>'
 if old not in html:raise SystemExit("Expected header marker absent")
 html=html.replace(old,new,1)
 if "</head>" in html:
  html=html.replace("</head>",
   '<link rel="canonical" href="https://silentcoastasset.com/fairvalue/app/">\n</head>',1)
 homepage.write_text(html,encoding="utf-8")
 # Data terms and ODbL. This is not a copyright assignment to SCA.
 notice=DEST/"DATA-AND-LICENSING.txt"
 notice.write_text(
  "TANUKI FairValue (research beta) - static distribution candidate.\n"
  "Public transaction price data source: Ministry of Land, Infrastructure, Transport and Tourism,\n"
  "'Real Estate Information Library' (不動産情報ライブラリ, 不動産取引価格情報).\n"
  "Edited and restructured by Silent Coast Asset株式会社 / Project Tanuki.\n"
  "https://www.reinfolib.mlit.go.jp/help/termsOfUse/\n"
  "MLIT National Land Numerical Information (N03 administrative boundaries), 2026,\n"
  "simplified via a third-party GeoJSON distribution; use original conditions for map data.\n"
  "https://nlftp.mlit.go.jp/ksj/other/agreement.html\n"
  "Digital Agency Address Base Registry town reference positions: source and terms\n"
  "https://dataset.address-br.digital.go.jp/\n"
  "Offline OpenStreetMap street extracts (data/street_context.json):\n"
  "(c) OpenStreetMap contributors; Open Database License (ODbL) 1.0.\n"
  "https://www.openstreetmap.org/copyright\n"
  "https://opendatacommons.org/licenses/odbl/1-0/\n"
  "Online GSI tile imagery is fetched ONLY after a deliberate user action;\n"
  "it is not bundled with this package. GSI data terms apply.\n"
  "https://maps.gsi.go.jp/development/ichiran.html\n"
  "The pricing model is NOT a formal appraisal or a guarantee of sale value.\n",
  encoding="utf-8"
 )
 manifest=[item for item in manifest if item["path"]!="index.html"]
 manifest.append({"path":"index.html","bytes":homepage.stat().st_size,"sha256":sha(homepage)})
 manifest.append({"path":"DATA-AND-LICENSING.txt","bytes":notice.stat().st_size,"sha256":sha(notice)})
 output=ROOT/"fairvalue"/"PACKAGE_MANIFEST.json"
 output.write_text(json.dumps({
  "status":"NONPRODUCTION_PRELAUNCH_REVIEW_REQUIRED",
  "originVersion":version,"originCommit":commit,
  "transactionCount":data["metadata"]["count"],
  "priceCityCount":data["metadata"]["municipalities"],
  "containsSecrets":False,"hasPublicLaunchApproval":False,
  "files":manifest
 },ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("PACKAGE_STAGED",json.dumps({
  "sourceVersion":version,"sourceCommit":commit[:9],
  "fileCount":len(files)+2,
  "totalBytes":sum((DEST/item).stat().st_size for item in files),
  "target":str(DEST),
 },ensure_ascii=False))
if __name__=="__main__":main()
