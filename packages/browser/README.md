# @forgesworn/foregather-kit

Foregather's Rust/WASM invitation envelope codec and explicit resolver client.
MIT. Copyright (c) 2026 TheCryptoDonkey.

```js
import { init, createStoredCodec } from '@forgesworn/foregather-kit';
await init();
const codec = createStoredCodec({ namespace: 'example.rooms', baseUrl: 'https://invites.example/i/' });
const candidate = codec.open({ url: receivedUrl, envelope: ciphertextJson, now: Math.floor(Date.now()/1000) });
// Validate candidate and ask for application consent before admission.
```

`seal({id, payload: Uint8Array, expires, now})` returns `{url, envelope}` with a
fresh key and nonce. `locator(url)` returns only its public 16-byte lookup ID.
`createResolverClient({apiUrl})` provides explicit `allocate`, `upload`, `fetch`
and `delete` operations with bounded responses and cancellation. No network
request is made by parsing or opening an envelope. Browser initialisation loads
the packaged WASM asset. In Node, initialise with
`init({module_or_path: wasmBytes})`.

The optional `createKithmootCodec({validateInvitation})` preserves the existing
KithMoot v1 envelope. Supply the application's pinned Fold parser; the callback
must return true for a supported invitation. Recovery creates no membership.

Namespaces and resolver URLs are explicit. HTTPS is required; local development
may opt into loopback HTTP. The resolver API receives no fragment keys and omits
ambient cookies. Production runtime dependencies are contained in the compiled
WASM; there are no external JavaScript runtime packages or required hosted services.

Stored bearer URLs can be copied and replayed. Expiry/deletion does not erase
captured ciphertext or revoke an invitation already recovered. JavaScript secret
strings cannot be deterministically erased. Version 0.2 also includes Spoken Token v2 words and experimental live PAKE.
Mobile FFI, app migrations and an independent security review remain open.

Live: createLiveOffer creates separate public session and secretWords;
createLivePairing takes locally chosen namespace/purpose and a fixed role.
Use gate.start, exchange.finish and pending.confirm exactly once, then encrypt
bootstrap data with channel.seal/open. Keep one gate for the code lifetime;
cancellation spends the default single attempt. Dispose abandoned states,
and obtain fresh words AND a fresh locator to retry. Never send secretWords
to a relay. The pinned SPAKE2 dependency has no independent audit and uses its
own profile, not RFC 9382 wire bytes. This feature requires independent review
before production adoption. See the root repository docs/live-protocol.md.

deriveSpokenWords and deriveDirectionalWords implement the frozen en-v1 words
profile. Counters, identities and application replay/attempt budgets are explicit.
