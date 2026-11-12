# SCA Netlify production source reconciliation — 2026-11-12

- Site ID: 6bc33721-1646-442c-9934-28ccbcc0a7c1
- Baseline production deploy ID: 6af093cdcb48b5f35e2ff77e
- 273 deployed paths from authenticated Netlify API file inventory.
- 268 baseline files byte-matched SHA-1, including exact SHA-1 recovery of Netlify _headers and _redirects.
- Five Netlify-transformed HTML files recovered from immutable deploy output with Netlify-added scripts stripped: index.html, tanuki-store.html, tanuki-site-support.html, fairvalue/index.html, fairvalue/app/index.html. These are semantic reproductions, not original-SHA exact source files.
- Applied Project Vault product page and backup guide from PR #36; retained live sitemap including FairValue while refreshing Project Vault lastmod.
- After the three planned SEO replacements, 265 of 273 production paths have exact original SHA-1 in local staged build, with five semantically recovered HTML pages and three explicitly edited SEO files.
- FairValue has 47 prefecture shards; all underlying data assets matched original SHA-1 in recovery.
- Netlify _headers/_redirects contents were reconstructed and exact SHA-1 verified against deployment metadata.
- Build gate now includes fairvalue/, both Netlify config files, and tests additional FairValue/current-book routes.
- Production build inventory: original 273 paths plus existing .nojekyll used for GitHub Pages.
- No credentials, user data, traffic logs, customer information or browser requests are stored here.

**Publishing requires a fresh non-production Netlify deploy preview, verification of FairValue and current product URLs, and a single atomic production deployment. This repository change alone is not a Netlify publication.**
