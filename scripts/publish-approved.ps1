param(
  [Parameter(Mandatory=$true)][string]$ApprovalBatch,
  [ValidateSet('BlogOnly','MediaRepair')][string]$Scope='BlogOnly',
  [switch]$Publish,
  [string]$NetlifyCliPath=''
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$site='6bc33721-1646-442c-9934-28ccbcc0a7c1'
if ([string]::IsNullOrWhiteSpace($ApprovalBatch)) { throw 'Director approval batch is required' }
$branch=(& git -C $repo branch --show-current).Trim()
if ($branch -ne 'main') { throw "Refuse production from $branch (must be canonical main)" }
$dirty=(& git -C $repo status --porcelain --untracked-files=no)
if ($dirty) { throw 'Refuse deploy from dirty canonical working tree' }
$head=(& git -C $repo rev-parse HEAD).Trim()
$remote=((& git -C $repo ls-remote origin refs/heads/main) -split '\s+')[0]
if ($head -ne $remote) { throw "Refuse stale local checkout: $head vs $remote" }
Push-Location $repo
try {
  & node scripts/site-release-gate.cjs build
  if ($LASTEXITCODE -ne 0) { throw 'Static/media lock failed' }
  & node tests/site-http-smoke.cjs
  if ($LASTEXITCODE -ne 0) { throw 'HTTP regression failed' }
  & node tests/negative-gate.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Negative guard tests failed' }
  Write-Host "PUBLISH_GATES_PASS main=$head scope=$Scope batch=$ApprovalBatch"
  if (!$Publish) { Write-Host 'DRY RUN ONLY: no production deploy'; return }
  if (!$NetlifyCliPath) { throw 'Provide authorized Netlify CLI absolute path' }
  if (!(Test-Path $NetlifyCliPath)) { throw 'Netlify CLI path not found' }
  # One attempt. On timeout, inspect deploy history; NEVER rerun blindly.
  & $NetlifyCliPath deploy --prod --dir (Join-Path $repo 'public-build') --site $site --message "Approved $Scope $ApprovalBatch @$head"
  if ($LASTEXITCODE -ne 0) { throw 'Check Netlify deploy history BEFORE attempting again' }
} finally { Pop-Location }
