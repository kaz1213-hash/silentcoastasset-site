#!/usr/bin/env python3
"""Check Netlify file-level CSP route and preserve existing redirect."""
from pathlib import Path
import subprocess
import tomllib
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
data=tomllib.loads((root/"netlify.toml").read_text(encoding="utf-8"))
assert data["build"]["publish"]=="public-build"
assert data["build"]["command"]=="node scripts/site-release-gate.cjs build"
assert any(x["from"]=="/go/project-vault" for x in data.get("redirects",[]))
headers=[item for item in data.get("headers",[]) if item.get("for")=="/fairvalue/*"]
assert len(headers)==1
values=headers[0]["values"]
assert values["X-Content-Type-Options"]=="nosniff"
assert values["X-Frame-Options"]=="DENY"
assert "frame-ancestors 'none'" in values["Content-Security-Policy"]
assert "connect-src 'self' https://cyberjapandata.gsi.go.jp" in values["Content-Security-Policy"]
assert "X-Robots-Tag" not in values,"No permanent noindex header in approved production"
sitemap=ET.fromstring((root/"sitemap.xml").read_text(encoding="utf-8"))
urls=[el.text for el in sitemap.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
assert urls.count("https://silentcoastasset.com/fairvalue/")==1
assert urls.count("https://silentcoastasset.com/fairvalue/app/")==1
import json
original=json.loads(subprocess.check_output(
    ["git","show","4f1a24bc94690b0f1b17d3b086f116ed4a113d1c:release/protected-files.json"],
    cwd=root,text=True))
latest=json.loads((root/"release/protected-files.json").read_text(encoding="utf-8"))
assert set(original["protected"])==set(latest["protected"])
changes=[name for name in latest["protected"] if latest["protected"][name]!=original["protected"][name]]
assert changes==["index.html"],"Only intended SCA homepage link may change legacy protected hashes"
print("FAIRVALUE_NETLIFY_V080_CONFIG_PASS",json.dumps({
 "headerRules":len(headers),"sitemapRoutes":2,"legacyModifiedHashes":changes
}))
