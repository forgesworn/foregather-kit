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
strings cannot be deterministically erased. This version implements stored
envelopes; live PAKE, mobile FFI and an independent security review remain open.
