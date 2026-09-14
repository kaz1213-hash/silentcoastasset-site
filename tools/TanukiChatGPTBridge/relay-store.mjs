import crypto from 'node:crypto';
import { validateRelayCommand } from '../../src/chatgpt-contract.mjs';

const RELAY_STATE_VERSION = 1;

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value)) throw new Error(`${field}_BAD_ID`);
  return value;
}

function queueKey(tenantId, projectId) {
  return `${safeId(tenantId, 'TENANT')}:${safeId(projectId, 'PROJECT')}`;
}

function parseQueueKey(value) {
  const text = String(value ?? '');
  const at = text.indexOf(':');
  if (at <= 0 || at === text.length - 1 || text.indexOf(':', at + 1) !== -1) throw new Error('RELAY_STATE_BAD_QUEUE_KEY');
  return { tenantId:safeId(text.slice(0,at),'TENANT'), projectId:safeId(text.slice(at+1),'PROJECT') };
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class RelayStore {
  constructor({ replayRetentionMs = 60 * 60 * 1000, maxCommandsPerProject = 50 } = {}) {
    this.replayRetentionMs = replayRetentionMs;
    this.maxCommandsPerProject = maxCommandsPerProject;
    this.projects = new Map();
    this.seen = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [key, rows] of this.projects) {
      const live = rows.filter(row => row.expiresMs > now && !row.acked);
      if (live.length) this.projects.set(key, live);
      else this.projects.delete(key);
    }
    for (const [key, item] of this.seen) {
      if (item.forgetAfterMs <= now) this.seen.delete(key);
    }
  }

  exportState({ now = Date.now() } = {}) {
    this.cleanup(now);
    return {
      version: RELAY_STATE_VERSION,
      projects: [...this.projects.entries()].map(([key, rows]) => [key, rows.map(row => ({
        command: row.command,
        digest: row.digest,
        expiresMs: row.expiresMs,
      }))]),
      seen: [...this.seen.entries()].map(([key, item]) => [key, { digest:item.digest, forgetAfterMs:item.forgetAfterMs }]),
    };
  }

  importState(input, { now = Date.now() } = {}) {
    if (!plainObject(input) || input.version !== RELAY_STATE_VERSION || !Array.isArray(input.projects) || !Array.isArray(input.seen)) {
      throw new Error('RELAY_STATE_INVALID');
    }
    const projects = new Map();
    const seen = new Map();

    for (const entry of input.projects) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) throw new Error('RELAY_STATE_BAD_PROJECTS');
      const key = String(entry[0]);
      const ids = parseQueueKey(key);
      const rows = [];
      for (const raw of entry[1].slice(0, this.maxCommandsPerProject)) {
        if (!plainObject(raw)) continue;
        let command;
        try { command = validateRelayCommand(raw.command, { now }); }
        catch { continue; }
        if (command.project_id !== ids.projectId) continue;
        const digest = hash(JSON.stringify(command));
        if (raw.digest !== digest) continue;
        const expiresMs = Date.parse(command.expires_at);
        if (!Number.isFinite(expiresMs) || expiresMs <= now) continue;
        rows.push({ command, digest, expiresMs, acked:false });
      }
      if (rows.length) projects.set(queueKey(ids.tenantId, ids.projectId), rows);
    }

    for (const entry of input.seen) {
      if (!Array.isArray(entry) || entry.length !== 2 || !plainObject(entry[1])) continue;
      const key = String(entry[0]);
      if (key.length < 20 || key.length > 320) continue;
      const digest = String(entry[1].digest ?? '');
      const forgetAfterMs = Number(entry[1].forgetAfterMs);
      if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isFinite(forgetAfterMs) || forgetAfterMs <= now) continue;
      seen.set(key, { digest, forgetAfterMs });
    }

    this.projects = projects;
    this.seen = seen;
    this.cleanup(now);
    return { restored_projects:this.projects.size, restored_seen:this.seen.size };
  }

  submit(raw, { tenantId, now = Date.now() } = {}) {
    this.cleanup(now);
    const command = validateRelayCommand(raw, { now });
    const tenant = safeId(tenantId, 'TENANT');
    const key = queueKey(tenant, command.project_id);
    const digest = hash(JSON.stringify(command));
    const replayKey = `${key}:${command.revision_id}`;
    const previous = this.seen.get(replayKey);
    if (previous) {
      if (previous.digest !== digest) throw new Error('REVISION_ID_CONFLICT');
      return { accepted: true, duplicate: true, revision_id: command.revision_id };
    }

    const rows = this.projects.get(key) ?? [];
    if (rows.length >= this.maxCommandsPerProject) throw new Error('PROJECT_QUEUE_FULL');
    const expiresMs = Date.parse(command.expires_at);
    rows.push({ command, digest, expiresMs, acked:false });
    this.projects.set(key, rows);
    this.seen.set(replayKey, {
      digest,
      forgetAfterMs: Math.max(expiresMs, now + this.replayRetentionMs),
    });
    return { accepted:true, duplicate:false, revision_id:command.revision_id };
  }

  pending(projectId, { tenantId, now = Date.now(), limit = 20 } = {}) {
    this.cleanup(now);
    const rows = this.projects.get(queueKey(tenantId, projectId)) ?? [];
    return rows.filter(row => !row.acked && row.expiresMs > now).slice(0, Math.max(1, Math.min(20, limit))).map(row => row.command);
  }

  ack(projectId, revisionId, { tenantId, now = Date.now() } = {}) {
    this.cleanup(now);
    safeId(revisionId, 'REVISION');
    const key = queueKey(tenantId, projectId);
    const rows = this.projects.get(key) ?? [];
    const row = rows.find(item => item.command.revision_id === revisionId);
    if (!row) return { acknowledged:false, missing:true };
    row.acked = true;
    const remaining = rows.filter(item => !item.acked);
    if (remaining.length) this.projects.set(key, remaining);
    else this.projects.delete(key);
    return { acknowledged:true, revision_id:revisionId };
  }
}
