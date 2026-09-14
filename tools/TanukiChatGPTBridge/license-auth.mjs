import crypto from 'node:crypto';

const LICENSE_API_BASE = 'https://api.lemonsqueezy.com/v1/licenses';
const DEFAULT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value), 'base64url');
}

function decodeB64urlJson(value) {
  try { return JSON.parse(fromB64url(value).toString('utf8')); }
  catch { throw new Error('SESSION_BAD_PAYLOAD'); }
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function opaqueId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value)) throw new Error(`${field}_BAD_ID`);
  return value;
}

function cleanDeviceName(value) {
  const text = String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Tanuki Site';
  return text.slice(0, 80);
}

function licenseKey(value) {
  const text = String(value ?? '').trim();
  if (text.length < 8 || text.length > 256 || /[\r\n\0]/.test(text)) throw new Error('LICENSE_KEY_BAD_FORMAT');
  return text;
}

function idSet(values) {
  const set = new Set();
  for (const value of values ?? []) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n > 0) set.add(n);
  }
  return set;
}

export function parseIdList(value) {
  if (!value) return [];
  return String(value).split(',').map(v => v.trim()).filter(Boolean).map(Number).filter(v => Number.isSafeInteger(v) && v > 0);
}

function verifyEntitlement(response, { allowedProductIds, allowedVariantIds }) {
  const key = response?.license_key;
  const meta = response?.meta;
  if (!key || !meta) throw new Error('LICENSE_RESPONSE_INCOMPLETE');
  if (!['active', 'inactive'].includes(key.status)) throw new Error(`LICENSE_STATUS_${String(key.status || 'UNKNOWN').toUpperCase()}`);

  const productId = Number(meta.product_id);
  const variantId = Number(meta.variant_id);
  if (allowedProductIds.size && !allowedProductIds.has(productId)) throw new Error('LICENSE_WRONG_PRODUCT');
  if (allowedVariantIds.size && !allowedVariantIds.has(variantId)) throw new Error('LICENSE_WRONG_VARIANT');

  return { productId, variantId };
}

async function postForm(fetchImpl, url, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value != null) body.set(key, String(value));
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Tanuki-Site-Relay/0.1',
    },
    body,
  });

  let data = null;
  try { data = await response.json(); }
  catch { throw new Error('LICENSE_PROVIDER_BAD_JSON'); }
  if (!response.ok) throw new Error('LICENSE_PROVIDER_REJECTED');
  return data;
}

export class LicenseAuth {
  constructor({
    secret,
    allowedProductIds = [],
    allowedVariantIds = [],
    fetchImpl = globalThis.fetch,
    tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
    refreshTtlMs = DEFAULT_REFRESH_TTL_MS,
  } = {}) {
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('SESSION_SECRET_TOO_SHORT');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
    if (!Number.isFinite(tokenTtlMs) || tokenTtlMs <= 0 || tokenTtlMs > MAX_TOKEN_TTL_MS) throw new Error('SESSION_TTL_INVALID');
    if (!Number.isFinite(refreshTtlMs) || refreshTtlMs <= tokenTtlMs || refreshTtlMs > MAX_REFRESH_TTL_MS) throw new Error('REFRESH_TTL_INVALID');
    this.secret = secret;
    this.refreshKey = crypto.createHash('sha256').update(`tanuki-refresh:${secret}`).digest();
    this.allowedProductIds = idSet(allowedProductIds);
    this.allowedVariantIds = idSet(allowedVariantIds);
    this.fetchImpl = fetchImpl;
    this.tokenTtlMs = tokenTtlMs;
    this.refreshTtlMs = refreshTtlMs;
  }

  tenantId(rawLicenseKey) {
    return crypto.createHmac('sha256', this.secret).update(`license:${licenseKey(rawLicenseKey)}`).digest('base64url').slice(0, 32);
  }

  issueSession({ rawLicenseKey, instanceId, deviceId, productId, variantId, now = Date.now() }) {
    const claims = {
      v: 1,
      sub: this.tenantId(rawLicenseKey),
      inst: opaqueId(instanceId, 'INSTANCE'),
      dev: opaqueId(deviceId, 'DEVICE'),
      product: Number(productId),
      variant: Number(variantId),
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + this.tokenTtlMs) / 1000),
    };
    const payload = b64url(JSON.stringify(claims));
    return `${payload}.${hmac(this.secret, payload)}`;
  }

  verifySession(token, { now = Date.now() } = {}) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 4096) throw new Error('SESSION_BAD_TOKEN');
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra != null || !safeEqual(signature, hmac(this.secret, payload))) throw new Error('SESSION_BAD_SIGNATURE');
    const claims = decodeB64urlJson(payload);
    if (claims?.v !== 1) throw new Error('SESSION_BAD_VERSION');
    opaqueId(claims.sub, 'TENANT');
    opaqueId(claims.inst, 'INSTANCE');
    opaqueId(claims.dev, 'DEVICE');
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) throw new Error('SESSION_BAD_TIME');
    const nowSec = Math.floor(now / 1000);
    if (claims.exp <= nowSec) throw new Error('SESSION_EXPIRED');
    if (claims.iat > nowSec + 300) throw new Error('SESSION_FROM_FUTURE');
    return Object.freeze({ ...claims });
  }

  issueRefreshCredential({ rawLicenseKey, instanceId, deviceId, now = Date.now() }) {
    const payload = Buffer.from(JSON.stringify({
      v:1,
      key:licenseKey(rawLicenseKey),
      inst:opaqueId(instanceId,'INSTANCE'),
      dev:opaqueId(deviceId,'DEVICE'),
      exp:Math.floor((now + this.refreshTtlMs) / 1000),
    }), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.refreshKey, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `r1.${b64url(iv)}.${b64url(encrypted)}.${b64url(tag)}`;
  }

  openRefreshCredential(token, { now = Date.now() } = {}) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 4096) throw new Error('REFRESH_BAD_TOKEN');
    const [version, ivRaw, ciphertextRaw, tagRaw, extra] = token.split('.');
    if (version !== 'r1' || !ivRaw || !ciphertextRaw || !tagRaw || extra != null) throw new Error('REFRESH_BAD_TOKEN');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.refreshKey, fromB64url(ivRaw));
      decipher.setAuthTag(fromB64url(tagRaw));
      const plaintext = Buffer.concat([decipher.update(fromB64url(ciphertextRaw)), decipher.final()]);
      const payload = JSON.parse(plaintext.toString('utf8'));
      if (payload?.v !== 1 || !Number.isSafeInteger(payload.exp)) throw new Error('REFRESH_BAD_PAYLOAD');
      if (payload.exp <= Math.floor(now / 1000)) throw new Error('REFRESH_EXPIRED');
      return Object.freeze({
        rawLicenseKey:licenseKey(payload.key),
        instanceId:opaqueId(payload.inst,'INSTANCE'),
        deviceId:opaqueId(payload.dev,'DEVICE'),
      });
    } catch (error) {
      if (['REFRESH_EXPIRED','REFRESH_BAD_PAYLOAD','LICENSE_KEY_BAD_FORMAT','INSTANCE_BAD_ID','DEVICE_BAD_ID'].includes(error?.message)) throw error;
      throw new Error('REFRESH_BAD_TOKEN');
    }
  }

  async activate({ license_key, device_id, device_name }, { now = Date.now() } = {}) {
    const key = licenseKey(license_key);
    const deviceId = opaqueId(device_id, 'DEVICE');
    const data = await postForm(this.fetchImpl, `${LICENSE_API_BASE}/activate`, {
      license_key: key,
      instance_name: `${cleanDeviceName(device_name)} · ${deviceId.slice(-8)}`,
    });
    if (data?.activated !== true || !data?.instance?.id) throw new Error('LICENSE_ACTIVATION_FAILED');
    const { productId, variantId } = verifyEntitlement(data, this);
    const instanceId = opaqueId(String(data.instance.id), 'INSTANCE');
    return {
      activated: true,
      instance_id: instanceId,
      session_token: this.issueSession({ rawLicenseKey:key, instanceId, deviceId, productId, variantId, now }),
      refresh_token: this.issueRefreshCredential({ rawLicenseKey:key, instanceId, deviceId, now }),
      expires_in: Math.floor(this.tokenTtlMs / 1000),
    };
  }

  async refresh({ refresh_token }, { now = Date.now() } = {}) {
    const refresh = this.openRefreshCredential(refresh_token, { now });
    const data = await postForm(this.fetchImpl, `${LICENSE_API_BASE}/validate`, {
      license_key: refresh.rawLicenseKey,
      instance_id: refresh.instanceId,
    });
    if (data?.valid !== true || String(data?.instance?.id ?? '') !== refresh.instanceId) throw new Error('LICENSE_VALIDATION_FAILED');
    const { productId, variantId } = verifyEntitlement(data, this);
    return {
      valid: true,
      instance_id: refresh.instanceId,
      session_token: this.issueSession({ rawLicenseKey:refresh.rawLicenseKey, instanceId:refresh.instanceId, deviceId:refresh.deviceId, productId, variantId, now }),
      refresh_token: this.issueRefreshCredential({ rawLicenseKey:refresh.rawLicenseKey, instanceId:refresh.instanceId, deviceId:refresh.deviceId, now }),
      expires_in: Math.floor(this.tokenTtlMs / 1000),
    };
  }
}
