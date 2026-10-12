import initWasm, { seal_envelope, open_envelope, invitation_locator } from './foregather_wasm.js';

const MAX_BYTES = 32768;
const invalid = () => { throw new Error('Invalid invitation'); };
export async function init(options) { await initWasm(options); }

function codec(profile, baseUrl, allowLoopbackHttp) {
  if (typeof baseUrl !== 'string' || typeof allowLoopbackHttp !== 'boolean') invalid();
  return Object.freeze({
    seal({ id, payload, expires, now }) {
      if (!(payload instanceof Uint8Array) || payload.byteLength > MAX_BYTES) invalid();
      return JSON.parse(seal_envelope(profile, baseUrl, allowLoopbackHttp, id, payload, expires, now));
    },
    open({ url, envelope, now }) {
      if (typeof envelope !== 'string' || new TextEncoder().encode(envelope).byteLength > MAX_BYTES) invalid();
      return open_envelope(profile, baseUrl, allowLoopbackHttp, url, envelope, now);
    },
    locator(url) { return invitation_locator(baseUrl, allowLoopbackHttp, url); },
  });
}

export function createStoredCodec({ namespace, baseUrl, allowLoopbackHttp = false }) {
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(namespace)) invalid();
  return codec(`v1:${namespace}`, baseUrl, allowLoopbackHttp);
}

/** Supply the application's pinned Fold parser. This wrapper creates no membership. */
export function createKithmootCodec({ validateInvitation }) {
  if (typeof validateInvitation !== 'function') invalid();
  const inner = codec('kithmoot/v1', 'https://z1p.app/k/', false);
  const validate = value => {
    try { if (validateInvitation(value) !== true) invalid(); } catch { invalid(); }
    return value;
  };
  return Object.freeze({
    seal({ id, invitation, expires, now }) {
      return inner.seal({ id, payload: new TextEncoder().encode(validate(invitation)), expires, now });
    },
    open({ url, envelope, now }) {
      return validate(new TextDecoder('utf-8', { fatal: true }).decode(inner.open({ url, envelope, now })));
    },
    locator: inner.locator,
  });
}

const idPattern = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const tokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
function publicId(id) { if (typeof id !== 'string' || !idPattern.test(id)) invalid(); return id; }
function token(value) { if (typeof value !== 'string' || !tokenPattern.test(value)) invalid(); return value; }
async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) invalid();
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Explicit network adapter. Never pass an invitation URL to this API. */
export function createResolverClient({ apiUrl, allowLoopbackHttp = false, fetch: fetcher = globalThis.fetch }) {
  const endpoint = new URL(apiUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.href !== apiUrl || !endpoint.pathname.endsWith('/') || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
    || !(endpoint.protocol === 'https:' || allowLoopbackHttp && endpoint.protocol === 'http:' && loopback) || typeof fetcher !== 'function') invalid();
  async function request(method, suffix, body, capability, signal) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (capability !== undefined) headers.Authorization = `Bearer ${token(capability)}`;
    const requestUrl = new URL(suffix, endpoint);
    if (method === 'POST') requestUrl.pathname = endpoint.pathname.slice(0, -1);
    const response = await fetcher(requestUrl, {
      method, headers, body, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Resolver request failed (${response.status})`); }
    return response;
  }
  return Object.freeze({
    async allocate({ expires, createToken, signal }) {
      if (!Number.isSafeInteger(expires) || expires < 0) invalid();
      // Remove the final slash for POST while preserving a configured deployment prefix.
      const response = await request('POST', '', JSON.stringify({ expires }), createToken, signal);
      const allocation = JSON.parse(await boundedText(response));
      if (!allocation || Object.keys(allocation).sort().join(',') !== 'delete_token,expires,id,upload_token' || allocation.expires !== expires) invalid();
      publicId(allocation.id); token(allocation.upload_token); token(allocation.delete_token);
      return allocation;
    },
    async upload({ id, uploadToken, envelope, signal }) {
      const body = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
      if (typeof body !== 'string' || new TextEncoder().encode(body).byteLength > MAX_BYTES) invalid();
      await request('PUT', publicId(id), body, uploadToken, signal);
    },
    async fetch({ id, signal }) { return boundedText(await request('GET', publicId(id), undefined, undefined, signal)); },
    async delete({ id, deleteToken, signal }) { await request('DELETE', publicId(id), undefined, deleteToken, signal); },
  });
}
