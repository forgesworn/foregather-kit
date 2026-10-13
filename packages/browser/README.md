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
Native Swift/Kotlin packages are available from the matching source build/release;
physical phones, production app migrations and independent security review remain
separate qualification gates.

Live: createLiveOffer creates separate public session and secretWords;
createLivePairing takes locally chosen namespace/purpose and a fixed role.
Use gate.start, exchange.finish and pending.confirm exactly once, then encrypt
bootstrap data with channel.seal/open. Keep one gate for the code lifetime;
cancellation spends the default single attempt. Dispose abandoned states,
and obtain fresh words AND a fresh locator to retry. Never send secretWords
to a relay. The pinned SPAKE2 dependency has no independent audit and uses its
own profile, not RFC 9382 wire bytes. This feature requires independent review
before production adoption. See the [live protocol](https://github.com/forgesworn/foregather-kit/blob/main/docs/live-protocol.md).

deriveSpokenWords and deriveDirectionalWords implement the frozen en-v1 words
profile. Counters, identities and application replay/attempt budgets are explicit.


```js
import { createLiveOffer, createLivePairing } from '@forgesworn/foregather-kit';
// After init(): the transport and complementary peer belong to your application.
const now = Math.floor(Date.now()/1000);
const offer = createLiveOffer({namespace:'example.rooms', purpose:'bootstrap', now});
// Send only offer.session to a relay. Present offer.secretWords out of band.
const gate = createLivePairing({...offer, namespace:'example.rooms', purpose:'bootstrap', role:'inviter', now});
const exchange = gate.start({now});
// Exchange exchange.hello() with the recipient's public hello.
// Then exchange.finish({peerHello, now}) produces pending confirmation.
// Exchange pending.proof(); pending.confirm({peerProof, now}) yields a channel.
// Compare channel.verificationWords({now}) and request explicit consent.
// Use channel.seal/open for bounded bootstrap, then dispose all surviving states.
exchange.dispose(); // This example cancels and spends the sole attempt.
gate.dispose();
```

The [documentation index](https://github.com/forgesworn/foregather-kit/blob/main/docs/README.md)
links the threat model, frozen wire formats, self-hosting and validation evidence.
The installed package is checked with a strict TypeScript consumer; it adds no
external JavaScript runtime dependencies.


Character access secrets use `createCharacterOffer({namespace, purpose,
characterCount:6, now})`, which returns `{session, secretCode}`. Pass that offer
to `createCharacterPairing({...offer, namespace, purpose, role, now})` and use
the same one-use gate/exchange/confirmation/channel lifecycle. Counts are 6–32;
the alphabet is `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Six uniformly generated
characters have 30 bits, less than the default four-word offer's 44 bits.

`createRendezvousCode({length:6})` generates an independent **public** lookup
alias. `canonicalRendezvousCode(code)` normalises ASCII case, outer whitespace
and optional ASCII hyphens between triples.
These helpers make no requests. Your transport owns bounded registration,
collision checking, lookup quotas and expiry, mapping an alias to a full public
session. Never reuse the alias as the secret or derive a secret from it.
The [character encoding and lookup guide](https://github.com/forgesworn/foregather-kit/blob/main/docs/character-codes.md)
explains compatibility and the loopback demo's directory. Live pairing remains
experimental; neither a public alias nor a confirmed handoff grants room access.

From 0.3.1, `formatCharacterCode('DFVSJX')` returns `DFV-SJX`. Generated values
stay unseparated for compatibility; both presentations work for lookup and
character pairing. Group separators add no entropy and never enter the PAKE
password. A final short group is allowed (`ABC-DEF-GH`); malformed grouping and
non-ASCII separators are rejected. Call `init()` before the WASM formatter.

`accessSecretOdds({format:'characters',count:6,attempts:1})` can run before
`init()`, returning `{bits:30,possibilities:1073741824n,guesses:1}`. For four words
the sample size is `17592186044416n` (44 bits). Under uniform random generation,
the online guessing bound is `guesses / possibilities`; count attempts across
all endpoints reusing a secret. Human-chosen values, expiry and display hyphens
do not establish or increase entropy. BigInt preserves exact counts; convert
it to a string before JSON serialization. See the guide for comparison tables,
public lookup probabilities and the experimental security assumptions.

## Adoption APIs (0.4)

`createPairingFlow` coordinates the one-use gate, exchange, confirmation,
explicit verification, encrypted handoff and decrypted receipt. Supply your
locally chosen namespace/purpose, trusted clock function and transport. `pair()`
returns comparison words; `verify({matches:true})` must follow an explicit user
comparison on both endpoints. The inviter calls `send({payload,signal})`; the
recipient calls `receive({signal})`. Receiving/decrypting creates no membership.
Cancelled, expired or failed flows are terminal and require fresh offers.

`createLiveRelayClient({apiUrl:'https://example/v1/'})` implements optional explicit
HTTP allocation/lookup/claim/delete and role-specific transport. Creation tokens
may be operator-issued limited grants from `createCreationGrantClient`.
Keep operator authority in your backend. Capabilities travel only in headers;
public lookup accepts only a public alias, never the access secret.

`createPairingLink` and `parsePairingLink` encode/validate public-only handoffs
with locally selected base URL/context/time. The optional `/qr` entry adds local
SVG/pixel generation, image decoding and explicit camera scanning with media
cleanup. Keep the private secret separate and retain manual entry fallback.

Import `/stored` for a distinct smaller WASM module with stored codecs, resolver
and grant client; it cannot expose the experimental PAKE API. All entries ship
inside the same self-contained tarball with declarations and licence texts.

See the repository's live-relay, creation-grants, public-handoff, transfer-protocol
and native guides for bounds, frozen profiles, packaging and remaining gates.
