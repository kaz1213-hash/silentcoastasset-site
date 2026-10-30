#!/usr/bin/env python3
"""Pin v079 FairValue review assets into a deterministic, hashed tar.gz.

Input is the already-reviewed TanukiARK private preview (no network).
Output is a SOURCE release candidate only. This command does not deploy.
The SCA release gate will independently verify every tar member at build time.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import tarfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
DEFAULT=pathlib.Path(r"C:\TanukiFactory\Ops\FairValueQ2FinishPreview_v079_final")
TAR=ROOT/"release/fairvalue-v080.tar.gz"
MANIFEST=ROOT/"release/fairvalue-v080.json"
SOURCE_COMMIT="cd98d16732064b3e8b7e05356d25876f972c02c6"
FROZEN_SITE="4f1a24bc94690b0f1b17d3b086f116ed4a113d1c"
def sha(data):return hashlib.sha256(data).hexdigest()

def package(source: pathlib.Path):
    if TAR.exists() or MANIFEST.exists():
        raise RuntimeError("v080 release files already exist; do not overwrite")
    source=source.resolve()
    proof=pathlib.Path(str(source)+".receipt.json")
    if not proof.is_file():raise RuntimeError("No signed source receipt")
    doc=json.loads(proof.read_text(encoding="utf-8"))
    if (doc.get("schema")!="tanuki-q2-finished-private-preview-v079" or
        doc.get("newQuarterObservations")!=5763 or
        doc.get("baselineRows")!=167559 or
        doc.get("totalResearchCandidateRows")!=173322 or
        doc.get("additionalCoreQ2Observations")!=521 or
        doc.get("historicalBackfillsHeld")!=303 or
        doc.get("historicalRevisionPairsHeld")!=2 or
        doc.get("researchBetaCitiesUnchanged")!=21 or
        doc.get("siteDeployed") is not False or
        doc.get("scaSiteChanged") is not False or
        doc.get("modelChanged") is not False or
        doc.get("sourceAttributionToProcessedMLIT") is not True or
        doc.get("q1ModelVersusQ2ObservedExplicit") is not True):
        raise RuntimeError("Unapproved/unknown original FairValue research source")
    repo=pathlib.Path(r"C:\TanukiFactory\Repos\tanuki-fairvalue")
    git=subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()
    dirty=subprocess.check_output(["git","status","--porcelain"],cwd=repo,text=True).strip()
    if git!=SOURCE_COMMIT or dirty:
        raise RuntimeError("Unreviewed FairValue source commit or dirty source tree")
    existing=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    if existing!=FROZEN_SITE:
        raise RuntimeError("SCA origin base changed: rebase and re-review before packaging")
    source_files=doc["files"]
    if len(source_files)!=220:raise RuntimeError("Unexpected public file count")
    actual={p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
    if actual!=set(source_files):raise RuntimeError("Source inventory mismatch")
    if any(p.is_symlink() for p in source.rglob("*")):
        raise RuntimeError("Symlink not allowed")
    allowed=re.compile(r"^[A-Za-z0-9._/-]+$")
    total=0
    headers=b""
    for rel,digest in source_files.items():
        if (not allowed.fullmatch(rel) or
            rel.startswith((".","/")) or
            "//" in rel or ".." in rel or
            len(rel.encode("utf-8"))>100):
            raise RuntimeError("Unsafe static path: "+rel)
        f=source/rel
        if not f.is_file():raise RuntimeError("Source file missing: "+rel)
        raw=f.read_bytes()
        if sha(raw)!=digest:raise RuntimeError("Source digest mismatch: "+rel)
        total+=len(raw)
        if rel=="_headers":headers=raw
    if total>80_000_000 or total<50_000_000:
        raise RuntimeError("Unexpected FairValue package raw size")
    if b"X-Robots-Tag: noindex" not in headers:
        raise RuntimeError("Review-only source headers missing")
    html=(source/"index.html").read_text(encoding="utf-8")
    if ('<meta name="robots" content="noindex,nofollow">' not in html or
        '<link rel="canonical"' in html or
        '<script type="module" src="./q2_preview.mjs"></script>' not in html):
        raise RuntimeError("Cannot safely transform preview HTML into future public version")
    # No live objects are copied to an unprotected root. Tar stays in release/.
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode="w",format=tarfile.USTAR_FORMAT) as archive:
        for rel in sorted(source_files):
            raw=(source/rel).read_bytes()
            meta=tarfile.TarInfo(rel)
            meta.size=len(raw)
            meta.mode=0o644
            meta.uid=meta.gid=0
            meta.uname=meta.gname=""
            meta.mtime=0
            archive.addfile(meta,io.BytesIO(raw))
    TAR.parent.mkdir(parents=True,exist_ok=True)
    with TAR.open("wb") as destination:
        with gzip.GzipFile(fileobj=destination,mode="wb",mtime=0,compresslevel=6,filename="") as compressed:
            compressed.write(stream.getvalue())
    tar_sha=sha(TAR.read_bytes())
    # Persist exact per-file proof. Tar and json are SOURCE-ONLY build inputs
    # and never copied into the publicly served /fairvalue/ directory.
    manifest={
        "schema":"sca-fairvalue-source-v080",
        "status":"READY_FOR_REVIEW_NOT_PUBLISHED",
        "sourceCommit":SOURCE_COMMIT,
        "scaBaselineCommit":FROZEN_SITE,
        "originReceiptSHA256":sha(proof.read_bytes()),
        "archive":"release/fairvalue-v080.tar.gz",
        "archiveSha256":tar_sha,
        "archiveBytes":TAR.stat().st_size,
        "sourceBytes":total,
        "totalAssetFiles":220,
        "staticAssets":{name:{"sha256":hashcode,"bytes":(source/name).stat().st_size}
            for name,hashcode in sorted(source_files.items())},
        "reviewOnlyFilesToExclude":["_headers","robots.txt"],
        "publicAssetCount":218,
        "sourceNoindexRequiresRemoval":True,
        "futurePublicLanding":"/fairvalue/",
        "futurePublicApp":"/fairvalue/app/",
        "priorObservations":167559,
        "newQ2Observations":5763,
        "descriptiveCandidates":173322,
        "referencePriceBetaCities":21,
        "modelLatestQuarter":"2026Q1",
        "observedLatestQuarter":"2026Q2",
        "backfillsStillHeld":303,
        "historicalRevisionPairsStillHeld":2,
        "modelTrainingChanged":False,
        "generalPublicReleaseApproved":False,
        "liveSiteModified":False
    }
    MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("FAIRVALUE_V080_SOURCE_PACKAGED",json.dumps({
        "tarBytes":TAR.stat().st_size,"tarSha256":tar_sha,
        "assetFiles":220,"publicFiles":218,"uncompressedBytes":total,
        "Q2New":5763,"old":167559,"productionChanged":False
    },ensure_ascii=False))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=pathlib.Path,default=DEFAULT)
    args=parser.parse_args()
    try:package(args.source)
    except Exception as exc:
        print("FAIRVALUE_V080_PACKAGING_SAFE_STOP",str(exc),file=sys.stderr)
        sys.exit(2)
