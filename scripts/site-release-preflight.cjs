#!/usr/bin/env node
'use strict';
// Read-only release preflight for hosts where PowerShell script execution is restricted.
// This file never publishes, creates a deploy, edits tracked pages or relaxes host policy.
// Usage: node scripts/site-release-preflight.cjs --approval-batch BATCH [--scope BlogOnly|MediaRepair]
const cp = require('child_process');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const SITE_ID = '6bc33721-1646-442c-9934-28ccbcc0a7c1';

function fail(message) { throw new Error('BLOCKED: ' + message); }
function options(args) {
  let batch = null;
  let scope = 'BlogOnly';
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--approval-batch' && batch === null) batch = args[++i];
    else if (flag === '--scope') scope = args[++i];
    else fail('Unknown or duplicate argument: ' + flag);
  }
  if (!batch || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/.test(batch))
    fail('Approval batch must be an explicit safe release identifier');
  if (!['BlogOnly', 'MediaRepair'].includes(scope)) fail('Unsupported scope');
  return { batch, scope };
}
function invoke(command, args, capture = false) {
  const r = cp.spawnSync(command, args, {
    cwd: repo, encoding: 'utf8', windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) fail(command + ' invocation failed: ' + r.error.message);
  if (r.status !== 0) fail(command + ' exited ' + r.status +
    (capture ? ': ' + (r.stderr || '').trim().slice(0, 400) : ''));
  return capture ? (r.stdout || '').trim() : '';
}
function preflight(argv) {
  const { batch, scope } = options(argv);
  const branch = invoke('git', ['branch', '--show-current'], true);
  if (branch !== 'main') fail('Canonical main only; current branch is ' + branch);
  if (invoke('git', ['status', '--porcelain', '--untracked-files=no'], true))
    fail('Tracked working tree is dirty');
  const head = invoke('git', ['rev-parse', 'HEAD'], true);
  const remote = invoke('git', ['ls-remote', 'origin', 'refs/heads/main'], true).split(/\s+/)[0];
  if (!remote || head !== remote) fail('Local main is stale or origin main unavailable');
  invoke(process.execPath, ['scripts/site-release-gate.cjs', 'build']);
  invoke(process.execPath, ['tests/site-http-smoke.cjs']);
  invoke(process.execPath, ['tests/negative-gate.cjs']);
  console.log('SITE_RELEASE_PREFLIGHT_PASS main=' + head + ' scope=' + scope +
    ' batch=' + batch + ' site=' + SITE_ID);
  console.log('DRY_RUN_ONLY; production deploy NOT performed; do not auto-retry any deploy');
}
try {
  preflight(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
