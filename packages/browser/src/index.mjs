import { validate_live_session, generate_live_offer, generate_character_offer, generate_rendezvous_code, canonical_rendezvous_code, format_character_code, spoken_words, spoken_directional_words, LiveGate } from './foregather_wasm.js';

import * as storedWasm from './foregather_wasm.js';
import {createStoredApi} from './stored-api.mjs';
export const {init,createStoredCodec,createKithmootCodec}=createStoredApi(storedWasm);
export {createResolverClient} from './resolver.mjs';
const invalid=()=>{throw new Error('Invalid invitation');};
export {createPairingFlow} from './flow.mjs';
export {createLiveRelayClient,createCreationGrantClient,ForegatherTransportError} from './transport.mjs';
export {createPairingLink,parsePairingLink,validatePublicRoom} from './handoff.mjs';
export function parseLiveSession({session,namespace,purpose,now}) {
  if(!session||typeof session!=='object')invalid();
  return Object.freeze(JSON.parse(validate_live_session(text(JSON.stringify(session),1024),domain(namespace),domain(purpose),clock(now))));
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


/** Experimental character presentation; the public room code is a separate value. */
export function createCharacterOffer({ namespace, purpose, characterCount = 6, lifetime = 120, now }) {
  const offer = JSON.parse(generate_character_offer(domain(namespace), domain(purpose), integer(characterCount, 6, 32), integer(lifetime, 1, 600), clock(now)));
  return Object.freeze({session:Object.freeze(offer.session),secretCode:offer.secretCode});
}
/** Public alias only; applications own its bounded, expiring session directory. */
export function createRendezvousCode({length = 6} = {}) { return generate_rendezvous_code(integer(length, 6, 32)); }
export function canonicalRendezvousCode(code) { return canonical_rendezvous_code(text(code,64)); }
/** Presentation only. Private codes must never be sent to a directory or logged. */
export function formatCharacterCode(code) { return format_character_code(text(code,64)); }
/** Mathematical bound for uniformly generated secrets, not a security rating of arbitrary text. */
export function accessSecretOdds({format,count,attempts=1}) {
  if(!['words','characters'].includes(format))invalid();
  const bits=integer(count,format==='words'?2:6,format==='words'?16:32)*(format==='words'?11:5);
  const possibilities=1n<<BigInt(bits);
  return Object.freeze({bits,possibilities,guesses:integer(attempts,1,5)});
}
export function createCharacterPairing({ session, secretCode, namespace, purpose, role, attempts = 1, now }) {
  if (!session || typeof session !== 'object' || !['inviter','recipient'].includes(role)) invalid();
  for (const key of ['profile','namespace','purpose','locator']) text(session[key],128);
  clock(session.issued); clock(session.expires);
  const native = LiveGate.from_code(text(JSON.stringify(session),1024),text(secretCode,64),role,integer(attempts,1,5),clock(now),domain(namespace),domain(purpose));
  return managed(native, {
    remaining() { return native.remaining(); },
    start({now}) { return exchange(native.start(clock(now))); },
  });
}
