import initWasm, { seal_envelope, open_envelope, invitation_locator, generate_live_offer, spoken_words, spoken_directional_words, LiveGate } from './foregather_wasm.js';

const MAX_BYTES = 32768;
const invalid = () => { throw new Error('Invalid invitation'); };
export async function init(options) { await initWasm(options); }
function boundedUrl(value) { if (typeof value !== 'string' || value.length > MAX_BYTES) invalid(); return value; }

function codec(profile, baseUrl, allowLoopbackHttp) {
  if (typeof baseUrl !== 'string' || typeof allowLoopbackHttp !== 'boolean') invalid();
  return Object.freeze({
    seal({ id, payload, expires, now }) {
      if (!(payload instanceof Uint8Array) || payload.byteLength > MAX_BYTES) invalid();
      return JSON.parse(seal_envelope(profile, baseUrl, allowLoopbackHttp, id, payload, expires, now));
    },
    open({ url, envelope, now }) {
      if (typeof envelope !== 'string' || envelope.length > MAX_BYTES || new TextEncoder().encode(envelope).byteLength > MAX_BYTES) invalid();
      return open_envelope(profile, baseUrl, allowLoopbackHttp, boundedUrl(url), envelope, now);
    },
    locator(url) { return invitation_locator(baseUrl, allowLoopbackHttp, boundedUrl(url)); },
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
      if (typeof body !== 'string' || body.length > MAX_BYTES || new TextEncoder().encode(body).byteLength > MAX_BYTES) invalid();
      const response = await request('PUT', publicId(id), body, uploadToken, signal);
      await response.body?.cancel();
    },
    async fetch({ id, signal }) { return boundedText(await request('GET', publicId(id), undefined, undefined, signal)); },
    async delete({ id, deleteToken, signal }) {
      const response = await request('DELETE', publicId(id), undefined, deleteToken, signal);
      await response.body?.cancel();
    },
  });
}

// Live pairing is experimental; transport callbacks belong to the application.
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) invalid(); return value; }
function text(value, max) { if (typeof value !== 'string' || value.length > max) invalid(); return value; }
function domain(value) { if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(value)) invalid(); return value; }
function clock(now) { return integer(now, 0, Number.MAX_SAFE_INTEGER); }
function secretBytes(secret) { if (!(secret instanceof Uint8Array) || secret.length < 16 || secret.length > 1024) invalid(); return secret; }
export function deriveSpokenWords({ secret, context, counter, identity, count = 3 }) {
  if (identity !== undefined) text(identity, 1024);
  return spoken_words(secretBytes(secret), text(context, 1024), integer(counter, 0, 0xffffffff), identity, integer(count, 1, 16));
}
export function deriveDirectionalWords({ secret, namespace, roles, counter, count = 3 }) {
  if (!Array.isArray(roles) || roles.length !== 2) invalid();
  return JSON.parse(spoken_directional_words(secretBytes(secret), text(namespace, 1024), text(roles[0], 1024), text(roles[1], 1024), integer(counter, 0, 0xffffffff), integer(count, 1, 16)));
}
export function createLiveOffer({ namespace, purpose, wordCount = 4, lifetime = 120, now }) {
  const offer = JSON.parse(generate_live_offer(domain(namespace), domain(purpose), integer(wordCount, 2, 16), integer(lifetime, 1, 600), clock(now)));
  return Object.freeze({session: Object.freeze(offer.session), secretWords: offer.secretWords});
}
function managed(native, methods) {
  let disposed = false;
  const requireAlive = () => { if (disposed) invalid(); };
  const result = { dispose() { if (!disposed) { disposed = true; native.free(); } } };
  for (const [name, method] of Object.entries(methods)) result[name] = (...args) => { requireAlive(); return method(...args); };
  return Object.freeze(result);
}
function channel(native) {
  return managed(native, {
    verificationWords({count = 3, now}) { return native.verification_words(integer(count, 1, 16), clock(now)); },
    seal({payload, now}) { if (!(payload instanceof Uint8Array) || payload.length > 16384) invalid(); return native.seal(payload, clock(now)); },
    open({packet, now}) { return native.open(text(packet, 24576), clock(now)); },
  });
}
function pending(native) {
  const result = managed(native, {
    proof() { return native.proof(); },
    confirm({peerProof, now}) { try { return channel(native.confirm(text(peerProof, 43), clock(now))); } finally { result.dispose(); } },
  });
  return result;
}
function exchange(native) {
  const result = managed(native, {
    hello() { return native.hello(); },
    finish({peerHello, now}) { try { return pending(native.finish(text(peerHello, 44), clock(now))); } finally { result.dispose(); } },
  });
  return result;
}
/** Keep this gate for the secret's complete lifetime. Cancelled starts spend attempts. */
export function createLivePairing({ session, secretWords, namespace, purpose, role, attempts = 1, now }) {
  if (!session || typeof session !== 'object' || !['inviter', 'recipient'].includes(role)) invalid();
  for (const key of ['profile', 'namespace', 'purpose', 'locator']) text(session[key], 128);
  clock(session.issued); clock(session.expires);
  const native = new LiveGate(text(JSON.stringify(session), 1024), text(secretWords, 256), role, integer(attempts, 1, 5), clock(now), domain(namespace), domain(purpose));
  return managed(native, {
    remaining() { return native.remaining(); },
    start({now}) { return exchange(native.start(clock(now))); },
  });
}
