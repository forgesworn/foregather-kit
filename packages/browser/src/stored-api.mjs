export function createStoredApi(wasm) {
const {default:initWasm,seal_envelope,open_envelope,invitation_locator}=wasm;
const MAX_BYTES = 32768;
const invalid = () => { throw new Error('Invalid invitation'); };
async function init(options) { await initWasm(options); }
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

function createStoredCodec({ namespace, baseUrl, allowLoopbackHttp = false }) {
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(namespace)) invalid();
  return codec(`v1:${namespace}`, baseUrl, allowLoopbackHttp);
}

/** Supply the application's pinned Fold parser. This wrapper creates no membership. */
function createKithmootCodec({ validateInvitation }) {
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

return {init,createStoredCodec,createKithmootCodec};
}
