const STYLES = new Set(['clean','minimal','refined','bright','natural','dark','warm']);
const SECTIONS = new Set(['concept','services','highlights','flow','faq','guide','gallery','contact_placeholder']);
const HERO = new Set(['keep','larger','smaller','remove','prominent','subtle']);
const PLAN_KEYS = new Set(['version','style','add_sections','remove_sections','hero_image','undo','preserve_existing']);
const ENVELOPE_KEYS = new Set(['schema','project_id','revision_id','created_at','expires_at','operation','plan','brief']);

export const TANUKI_PLAN_VERSION = 'tanuki-plan-0.2';
export const TANUKI_RELAY_SCHEMA = 'tanuki-relay-command-0.1';

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknown(obj, allowed, prefix) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new Error(`${prefix}_UNKNOWN_FIELD:${key}`);
  }
}

function uniqueAllowedList(value, allowed, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field.toUpperCase()}_NOT_ARRAY`);
  if (value.length > 8) throw new Error(`${field.toUpperCase()}_TOO_MANY`);
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !allowed.has(raw)) throw new Error(`${field.toUpperCase()}_BAD_VALUE:${String(raw)}`);
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

export function validateTanukiPlan(input) {
  if (!plainObject(input)) throw new Error('PLAN_NOT_OBJECT');
  rejectUnknown(input, PLAN_KEYS, 'PLAN');
  if (input.version !== TANUKI_PLAN_VERSION) throw new Error(`PLAN_BAD_VERSION:${String(input.version)}`);
  if (input.preserve_existing !== true) throw new Error('PLAN_PRESERVE_EXISTING_REQUIRED');
  if (input.style != null && !STYLES.has(input.style)) throw new Error(`PLAN_BAD_STYLE:${String(input.style)}`);
  if (input.hero_image != null && !HERO.has(input.hero_image)) throw new Error(`PLAN_BAD_HERO:${String(input.hero_image)}`);
  if (input.undo != null && typeof input.undo !== 'boolean') throw new Error('PLAN_UNDO_NOT_BOOLEAN');

  const add = uniqueAllowedList(input.add_sections, SECTIONS, 'add_sections');
  const remove = uniqueAllowedList(input.remove_sections, SECTIONS, 'remove_sections');
  const conflict = add.find(x => remove.includes(x));
  if (conflict) throw new Error(`PLAN_SECTION_CONFLICT:${conflict}`);

  const undo = Boolean(input.undo);
  const hasEdit = Boolean(input.style || input.hero_image || add.length || remove.length);
  if (undo && hasEdit) throw new Error('PLAN_UNDO_EXCLUSIVE');
  if (!undo && !hasEdit) throw new Error('PLAN_EMPTY');

  return Object.freeze({
    version: TANUKI_PLAN_VERSION,
    style: input.style ?? null,
    add_sections: Object.freeze(add),
    remove_sections: Object.freeze(remove),
    hero_image: input.hero_image ?? null,
    undo,
    preserve_existing: true,
  });
}

function safeOpaqueId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value)) throw new Error(`${field}_BAD_ID`);
  return value;
}

function isoDate(value, field) {
  if (typeof value !== 'string') throw new Error(`${field}_NOT_STRING`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${field}_BAD_DATE`);
  return { value, ms };
}

function safeCreateBrief(value) {
  if (typeof value !== 'string') throw new Error('BRIEF_NOT_STRING');
  const brief = value.replace(/\r/g, '').trim();
  if (!brief) throw new Error('BRIEF_EMPTY');
  if (brief.length > 1200) throw new Error('BRIEF_TOO_LONG');
  if (/\0/.test(brief)) throw new Error('BRIEF_BAD_CONTROL');
  if (/```|<\/?\s*(?:script|style|iframe|object|embed|link|meta)\b|javascript\s*:/i.test(brief)) throw new Error('BRIEF_CODE_NOT_ALLOWED');
  return brief;
}

export function validateRelayCommand(input, { now = Date.now(), maxFutureMs = 15 * 60 * 1000 } = {}) {
  if (!plainObject(input)) throw new Error('RELAY_NOT_OBJECT');
  rejectUnknown(input, ENVELOPE_KEYS, 'RELAY');
  if (input.schema !== TANUKI_RELAY_SCHEMA) throw new Error(`RELAY_BAD_SCHEMA:${String(input.schema)}`);
  if (!['revise_site','create_site'].includes(input.operation)) throw new Error(`RELAY_BAD_OPERATION:${String(input.operation)}`);
  const projectId = safeOpaqueId(input.project_id, 'PROJECT');
  const revisionId = safeOpaqueId(input.revision_id, 'REVISION');
  const created = isoDate(input.created_at, 'CREATED_AT');
  const expires = isoDate(input.expires_at, 'EXPIRES_AT');
  if (expires.ms <= created.ms) throw new Error('RELAY_EXPIRY_ORDER');
  if (expires.ms <= now) throw new Error('RELAY_EXPIRED');
  if (expires.ms - created.ms > maxFutureMs) throw new Error('RELAY_EXPIRY_TOO_LONG');
  if (created.ms > now + 5 * 60 * 1000) throw new Error('RELAY_CREATED_IN_FUTURE');

  if (input.operation === 'create_site') {
    if (input.plan != null) throw new Error('RELAY_CREATE_PLAN_FORBIDDEN');
    const brief = safeCreateBrief(input.brief);
    return Object.freeze({
      schema: TANUKI_RELAY_SCHEMA,
      project_id: projectId,
      revision_id: revisionId,
      created_at: created.value,
      expires_at: expires.value,
      operation: 'create_site',
      brief,
    });
  }

  if (input.brief != null) throw new Error('RELAY_REVISE_BRIEF_FORBIDDEN');
  const plan = validateTanukiPlan(input.plan);
  return Object.freeze({
    schema: TANUKI_RELAY_SCHEMA,
    project_id: projectId,
    revision_id: revisionId,
    created_at: created.value,
    expires_at: expires.value,
    operation: 'revise_site',
    plan,
  });
}

export function canonicalRelayCommand(command) {
  const valid = validateRelayCommand(command);
  return JSON.stringify(valid);
}
