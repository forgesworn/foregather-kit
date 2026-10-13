const MAX_BYTES=32768;
const invalid=()=>{throw new Error('Invalid invitation');};
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
