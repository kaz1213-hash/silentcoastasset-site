import crypto from 'node:crypto';
import { validateRelayCommand } from '../../src/chatgpt-contract.mjs';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_ENDPOINT_PATH = '/mcp';

const STYLE_ENUM = ['clean','minimal','refined','bright','natural','dark','warm'];
const SECTION_ENUM = ['concept','services','highlights','flow','faq','guide','gallery','contact_placeholder'];
const HERO_ENUM = ['keep','larger','smaller','remove','prominent','subtle'];
const ARG_FIELDS = new Set(['style','add_sections','remove_sections','hero_image']);
const CREATE_ARG_FIELDS = new Set(['brief']);

function errorResponse(id, code, message, data) {
  return { jsonrpc:'2.0', id, error:{ code, message, ...(data === undefined ? {} : { data }) } };
}

function resultResponse(id, result) {
  return { jsonrpc:'2.0', id, result };
}

function textResult(text, structuredContent) {
  return {
    content:[{ type:'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
    isError:false,
  };
}

function toolError(text, code = 'TANUKI_TOOL_ERROR') {
  return {
    content:[{ type:'text', text }],
    structuredContent:{ accepted:false, code },
    isError:true,
  };
}

function requireIdentity(identity) {
  const tenantId = String(identity?.tenantId ?? '');
  const projectId = String(identity?.projectId ?? '');
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(tenantId)) throw new Error('MCP_TENANT_REQUIRED');
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(projectId)) throw new Error('MCP_PROJECT_REQUIRED');
  return { tenantId, projectId };
}

function safeArray(value, allowed, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error(`${field}_INVALID`);
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.some(item => typeof item !== 'string' || !allowed.includes(item))) throw new Error(`${field}_INVALID`);
  return unique;
}

function createBrief(args) {
  const raw = args == null ? {} : args;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ARGUMENTS_INVALID');
  for (const key of Object.keys(raw)) if (!CREATE_ARG_FIELDS.has(key)) throw new Error(`ARGUMENT_UNKNOWN_${key}`);
  if (typeof raw.brief !== 'string') throw new Error('BRIEF_REQUIRED');
  const brief = raw.brief.replace(/\r/g,'').trim();
  if (!brief) throw new Error('BRIEF_REQUIRED');
  if (brief.length > 1200) throw new Error('BRIEF_TOO_LONG');
  return brief;
}

function revisePlan(args) {
  const raw = args == null ? {} : args;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ARGUMENTS_INVALID');
  for (const key of Object.keys(raw)) if (!ARG_FIELDS.has(key)) throw new Error(`ARGUMENT_UNKNOWN_${key}`);

  const style = raw.style == null ? null : raw.style;
  const hero = raw.hero_image == null ? null : raw.hero_image;
  if (style !== null && !STYLE_ENUM.includes(style)) throw new Error('STYLE_INVALID');
  if (hero !== null && !HERO_ENUM.includes(hero)) throw new Error('HERO_IMAGE_INVALID');

  const add = safeArray(raw.add_sections, SECTION_ENUM, 'ADD_SECTIONS');
  const remove = safeArray(raw.remove_sections, SECTION_ENUM, 'REMOVE_SECTIONS');
  if (add.some(item => remove.includes(item))) throw new Error('SECTION_CONFLICT');
  if (style === null && hero === null && add.length === 0 && remove.length === 0) throw new Error('NO_CHANGE_REQUESTED');

  return {
    version:'tanuki-plan-0.2',
    style,
    add_sections:add,
    remove_sections:remove,
    hero_image:hero,
    undo:false,
    preserve_existing:true,
  };
}

function undoPlan() {
  return {
    version:'tanuki-plan-0.2',
    style:null,
    add_sections:[],
    remove_sections:[],
    hero_image:null,
    undo:true,
    preserve_existing:true,
  };
}

function revisionId() {
  return `mcp_${crypto.randomBytes(16).toString('hex')}`;
}

function baseEnvelope(projectId, operation, now) {
  return {
    schema:'tanuki-relay-command-0.1',
    project_id:projectId,
    revision_id:revisionId(),
    created_at:new Date(now).toISOString(),
    expires_at:new Date(now + 10 * 60 * 1000).toISOString(),
    operation,
  };
}

function relayReviseCommand(projectId, plan, now = Date.now()) {
  return validateRelayCommand({ ...baseEnvelope(projectId,'revise_site',now), plan }, { now });
}

function relayCreateCommand(projectId, brief, now = Date.now()) {
  return validateRelayCommand({ ...baseEnvelope(projectId,'create_site',now), brief }, { now });
}

export function mcpToolDefinitions() {
  return [
    {
      name:'create_site',
      title:'Create the first Tanuki Site draft',
      description:'Create the first local Tanuki Site draft from the user-provided source brief. The brief must contain only facts and preferences the user explicitly supplied. Do not invent names, addresses, prices, hours, contact details, services, claims, HTML, CSS, or JavaScript. Missing facts must stay missing or provisional in Tanuki Site.',
      inputSchema:{
        type:'object',
        additionalProperties:false,
        required:['brief'],
        properties:{
          brief:{ type:'string', minLength:1, maxLength:1200, description:'The user-provided website brief and explicit design preferences only. No invented business facts and no code.' },
        },
      },
      outputSchema:{
        type:'object',
        additionalProperties:false,
        required:['accepted','status'],
        properties:{
          accepted:{ type:'boolean' },
          status:{ type:'string', enum:['queued_for_tanuki'] },
        },
      },
      annotations:{ readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:false },
      execution:{ taskSupport:'forbidden' },
    },
    {
      name:'revise_site',
      title:'Revise the current Tanuki Site',
      description:'Safely revise the currently paired Tanuki Site. Use only the supplied style, section, and hero-image controls. Never invent business facts, contact details, prices, addresses, hours, HTML, CSS, or JavaScript.',
      inputSchema:{
        type:'object',
        additionalProperties:false,
        properties:{
          style:{ type:'string', enum:STYLE_ENUM, description:'Overall visual direction. Omit to preserve the current style.' },
          add_sections:{ type:'array', uniqueItems:true, maxItems:8, items:{ type:'string', enum:SECTION_ENUM }, description:'Safe placeholder sections to add without inventing business facts.' },
          remove_sections:{ type:'array', uniqueItems:true, maxItems:8, items:{ type:'string', enum:SECTION_ENUM }, description:'Existing semantic sections to remove.' },
          hero_image:{ type:'string', enum:HERO_ENUM, description:'How prominent the existing hero image should be. This never uploads or invents an image.' },
        },
      },
      outputSchema:{
        type:'object',
        additionalProperties:false,
        required:['accepted','status'],
        properties:{
          accepted:{ type:'boolean' },
          status:{ type:'string', enum:['queued_for_tanuki'] },
        },
      },
      annotations:{ readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
      execution:{ taskSupport:'forbidden' },
    },
    {
      name:'undo_last_change',
      title:'Undo the last Tanuki Site change',
      description:'Ask the paired Tanuki Site to use its local Undo history. The change remains redoable in Tanuki Site. Use this when the user says to go back, undo, revert, or prefers the previous version.',
      inputSchema:{ type:'object', additionalProperties:false, properties:{} },
      outputSchema:{
        type:'object',
        additionalProperties:false,
        required:['accepted','status'],
        properties:{
          accepted:{ type:'boolean' },
          status:{ type:'string', enum:['queued_for_tanuki'] },
        },
      },
      annotations:{ readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:false },
      execution:{ taskSupport:'forbidden' },
    },
  ];
}

function queueToolCall(name, args, context) {
  const { tenantId, projectId } = requireIdentity(context.identity);
  const now = context.now?.() ?? Date.now();
  let command;
  if (name === 'create_site') command = relayCreateCommand(projectId, createBrief(args), now);
  else if (name === 'revise_site') command = relayReviseCommand(projectId, revisePlan(args), now);
  else if (name === 'undo_last_change') command = relayReviseCommand(projectId, undoPlan(), now);
  else return null;
  const accepted = context.store.submit(command, { tenantId, now });
  return { command, accepted };
}

export function handleMcpMessage(message, context = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { kind:'response', body:errorResponse(message?.id ?? null, -32600, 'Invalid Request') };
  }

  if (!Object.prototype.hasOwnProperty.call(message,'id')) return { kind:'notification' };

  const id = message.id;
  if (message.method === 'initialize') {
    const requested = String(message.params?.protocolVersion ?? '');
    const protocolVersion = requested === MCP_PROTOCOL_VERSION ? requested : MCP_PROTOCOL_VERSION;
    return { kind:'response', body:resultResponse(id,{
      protocolVersion,
      capabilities:{ tools:{ listChanged:false } },
      serverInfo:{
        name:'tanuki-site',
        title:'Tanuki Site',
        version:'0.3.0',
        description:'Safe deterministic website creation and revisions for a paired Tanuki Site installation.',
        websiteUrl:'https://silentcoastasset.com',
      },
      instructions:'Use create_site for the first draft from user-provided facts, revise_site for safe visual/section changes, and undo_last_change to revert. The paired Tanuki Site remains authoritative. Never ask the user for a purchase key, API key, project id, relay token, HTML, CSS, or JavaScript.',
    }) };
  }

  if (message.method === 'ping') return { kind:'response', body:resultResponse(id,{}) };
  if (message.method === 'tools/list') return { kind:'response', body:resultResponse(id,{ tools:mcpToolDefinitions() }) };

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (typeof name !== 'string') return { kind:'response', body:errorResponse(id,-32602,'Invalid tool call parameters') };
    if (!['create_site','revise_site','undo_last_change'].includes(name)) return { kind:'response', body:errorResponse(id,-32601,'Unknown tool') };
    try {
      const queued = queueToolCall(name, message.params?.arguments ?? {}, context);
      if (!queued) return { kind:'response', body:errorResponse(id,-32601,'Unknown tool') };
      const messageText = name === 'create_site'
        ? 'First site draft queued. Tanuki Site will build and validate it locally from the supplied brief.'
        : name === 'undo_last_change'
          ? 'Undo queued. Tanuki Site will apply it through local history.'
          : 'Revision queued. Tanuki Site will validate and apply it locally.';
      return { kind:'response', body:resultResponse(id,textResult(messageText,{ accepted:true, status:'queued_for_tanuki' })) };
    } catch (error) {
      const code = String(error?.message || 'TANUKI_TOOL_ERROR').slice(0,96);
      return { kind:'response', body:resultResponse(id,toolError('Tanuki Site could not safely queue that change.',code)) };
    }
  }

  return { kind:'response', body:errorResponse(id,-32601,'Method not found') };
}
