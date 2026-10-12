# Foregather

Secure invitations and pairing, on your terms.

Foregather is a portable Rust library for transferring encrypted invitations,
with a WASM browser package and an optional self-hosted ciphertext resolver.
It works without a ForgeSworn account, hosted endpoint or third-party product.
Applications choose their infrastructure and retain control of admission.

Version 0.1 implements **stored invitation transfer**. Its public API is early;
the v1 formats have frozen independent vectors. Live short-code PAKE pairing,
spoken verification, Swift/Kotlin bindings and application migrations are
subsequent work. This version has not received an independent security review.

## Packages

| Package | Responsibility |
| --- | --- |
| `foregather-kit` | Pure Rust envelope operations, explicit clock and CSPRNG, typed public locator and secret invitation |
| `@forgesworn/foregather-kit` | WASM implementation, TypeScript declarations, optional explicit HTTP client |
| `foregather-server` | Bounded SQLite ciphertext storage, upload/delete capabilities and durable creation budget |

Opening an envelope returns application input for review. It does not establish
identity, validate a room authority, create membership, enrol a device or rekey a
room. Fold, Covey and other application protocols retain those responsibilities.

## Build and verify

Requirements: Rust 1.94.1, Node 24, Python 3, `wasm32-unknown-unknown`, and
`wasm-bindgen-cli` 0.2.129. Builds use this repository's own `target/`.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm ci
npx playwright install chromium
npm run check
```

`npm run check` runs formatting, Clippy, native tests, WASM generation,
Node/native/WebCrypto interoperability, real Chromium and a real resolver
restart journey. `cargo audit` and `cargo deny check licenses sources` run the
dependency checks. Tests use synthetic invitations and keys.

```sh
# Optional read-only check against an existing KithMoot checkout's installed Fold.
node scripts/check-kithmoot.mjs ../kithmoot

# Build a distributable browser tarball without publishing it.
npm pack ./packages/browser
```

## Browser use

```js
import { init, createStoredCodec, createResolverClient } from '@forgesworn/foregather-kit';
await init();

const codec = createStoredCodec({
  namespace: 'example.rooms',
  baseUrl: 'https://invites.example/i/',
});
const resolver = createResolverClient({
  apiUrl: 'https://resolver.example/v1/invitations/',
});
const now = Math.floor(Date.now() / 1000);
// Obtain creation authority from your own operator/custody boundary.
// Do not bake an operator-wide token into public browser assets.
const allocation = await resolver.allocate({ expires: now + 3600, createToken });
const sealed = codec.seal({
  id: allocation.id,
  payload: new TextEncoder().encode(applicationInvitation),
  expires: allocation.expires,
  now,
});
await resolver.upload({
  id: allocation.id,
  uploadToken: allocation.upload_token,
  envelope: sealed.envelope,
});
// Share sealed.url. Keep allocation.delete_token with the inviter.

// After the recipient explicitly chooses to review the invitation:
const ciphertext = await resolver.fetch({ id: codec.locator(receivedUrl) });
const candidate = codec.open({ url: receivedUrl, envelope: ciphertext, now: Math.floor(Date.now() / 1000) });
// Validate candidate with your application's protocol, show its review UI,
// and run its normal admission flow after user consent.
```

Neither parsing a URL nor creating a codec fetches an invitation. The optional
HTTP client accepts public IDs, places management capabilities only in headers,
omits ambient cookies, rejects redirects, bounds streamed responses and supports
caller cancellation. The first resolver is permissioned: public anonymous
creation or per-user creation delegation needs an application-owned policy.

For Node, pass WASM bytes to `init({ module_or_path: bytes })`; browser default
initialisation loads the WASM asset beside the generated module. Serving those
assets requires `application/wasm` for the WASM file.

## Rust use

```rust
use foregather_kit::{Locator, Namespace, Profile, ResolverLocation, seal, open};
use rand_core::OsRng;

let now = 1_800_000_000; // Supply your trusted clock.
let profile = Profile::V1(Namespace::parse("example.rooms")?);
let location = ResolverLocation::parse("https://invites.example/i/", false)?;
let id = Locator::generate(&mut OsRng)?; // A resolver must collision-check allocation.
let (invitation, envelope) = seal(&profile, id, b"application invitation", now + 3600, now, &mut OsRng)?;
let shared_url = invitation.to_url(&location);
let parsed = location.parse_invitation(&shared_url)?;
let candidate = open(&profile, &parsed, &envelope.to_json()?, now)?;
// Validate candidate and obtain application consent before admission.
# Ok::<(), Box<dyn std::error::Error>>(())
```

The core does not read the wall clock or initiate I/O. Callers supply trusted
entropy and time. Native apps can use the Rust API directly; generated mobile
FFI packages are not present yet.

## KithMoot compatibility

```js
import { createKithmootCodec } from '@forgesworn/foregather-kit';
import { parseRoomLink } from '@forgesworn/fold-kit';
const codec = createKithmootCodec({
  validateInvitation: url => Boolean(parseRoomLink(url).invitation),
});
```

This profile preserves the `kithmoot-short-invite/v1` envelope and exact
`https://z1p.app/k/<id>#<key>` link format. The caller's pinned Fold parser must
accept the original invitation before sealing and after recovery. The Rust
compatibility profile checks the canonical KithMoot URL boundary but deliberately
does not reproduce Fold semantics. Native consumers must perform that same
application validation. This does not deploy a z1p.app service or change KithMoot.

## Self-hosting

Generate a private 32-byte creation token, encoded as unpadded base64url, and
supply it through `FOREGATHER_CREATE_TOKEN`. The server never prints it.

```sh
export FOREGATHER_CREATE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
cargo run --locked -p foregather-server
```

Defaults: `127.0.0.1:8787`, `data/foregather.sqlite`, 1,024 live/pending records,
60 creations per fixed 60-second window, 32 concurrent requests, 32 KiB request
bodies, five-second handler deadline and five-minute upload allocation deadline.
The creation budget survives restart and applies across processes sharing the DB.
No CORS origin is permitted by default; use an application-owned same-origin
gateway. The resolver serves no JavaScript, follows no payload URLs and logs no
request bodies, capabilities or invitation identifiers.

Configure `FOREGATHER_BIND`, `FOREGATHER_DB`, `FOREGATHER_MAX_RECORDS`, and
`FOREGATHER_CREATES_PER_MINUTE`. For public operation, put it behind your own
HTTPS gateway with connection/header limits and disable capability-bearing
request logs. Use a dedicated private storage directory. The server defaults
to loopback HTTP; client HTTP support requires explicit loopback opt-in.

For an interactive local example, run `npm run demo` in a second terminal with
the same creation token environment. Open `http://127.0.0.1:8788`, create a link,
then open it in another browser context and explicitly review it. The local
gateway holds creation authority; it never sends the operator token to browser
code. This demonstration gateway is loopback-only and must not be publicly
deployed. `npm run test:demo` automates that two-client journey.

See [resolver API](docs/resolver.md), [wire protocol](docs/protocol.md),
[security boundaries](SECURITY.md), [validation status](docs/validation.md) and
[planned next work](docs/roadmap.md).

## Licence

MIT. Copyright (c) 2026 TheCryptoDonkey.
Dependencies retain their own permissive licences and attribution; see
[third-party notices](THIRD_PARTY_NOTICES.md). Foregather requires libraries,
not external hosted products.
