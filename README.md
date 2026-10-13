# Foregather

Secure invitations and pairing, on your terms.

Foregather is a portable Rust library for transferring encrypted invitations,
with a WASM browser package and an optional self-hosted ciphertext resolver.
It works without a ForgeSworn account, hosted endpoint or third-party product.
Applications choose their infrastructure and retain control of admission.

Version 0.4 adds a **durable optional live relay**, **scoped creation grants**,
**pairing flows with encrypted decryption receipts**, **public QR handoff**,
**Swift/Kotlin packages** and a **stored-only browser entry** to stored invitations,
Spoken Token v2 words and experimental live PAKE bootstrap. Stored v1 bytes remain
unchanged. Live pairing is an explicit Rust feature (`experimental-live`), uses
a pinned, unaudited SPAKE2 implementation and needs independent review before
production adoption. Physical-device qualification and production app migrations
remain separate work. This project has not received an independent security review.

## Packages

| Package | Responsibility |
| --- | --- |
| `foregather-kit` | Pure Rust envelope, spoken and optional live operations, explicit clock and CSPRNG, typed public locator and secret invitation |
| `@forgesworn/foregather-kit` | WASM implementation, TypeScript declarations, optional explicit HTTP client |
| `foregather-server` | Bounded SQLite ciphertext storage, upload/delete capabilities and durable creation budget |
| `foregather-ffi` | Generated Swift/Kotlin stored/spoken and explicitly enabled live APIs |

Opening an envelope returns application input for review. It does not establish
identity, validate a room authority, create membership, enrol a device or rekey a
room. Fold, Covey and other application protocols retain those responsibilities.

## Distribution

Source and tagged experimental releases live at
[forgesworn/foregather-kit](https://github.com/forgesworn/foregather-kit).
[Release assets](https://github.com/forgesworn/foregather-kit/releases) include a
browser tarball, native Rust crate, Linux resolver binary, licence texts,
SHA-256 checksums and build provenance. Assets ship after hosted verification.
Registry publication is a separate gate; consult the release notes for npm and
crates.io availability. Install the release tarball directly when the npm
registry version is unavailable; its runtime assets are served by your own app.

The new 0.4 adoption APIs require this source build or a matching published 0.4
asset. The last published 0.3.1 commands below cover the earlier APIs. To install
the current checkout locally, run `npm pack ./packages/browser` and install the
resulting `forgesworn-foregather-kit-0.4.0.tgz` in your app.

```sh
npm install https://github.com/forgesworn/foregather-kit/releases/download/v0.3.1/forgesworn-foregather-kit-0.3.1.tgz
# Build the self-hosted resolver directly from the tagged source:
cargo install --git https://github.com/forgesworn/foregather-kit --tag v0.3.1 --locked foregather-server
```

Private security reports use
[GitHub private vulnerability reporting](https://github.com/forgesworn/foregather-kit/security/advisories/new).

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

`npm run check` runs formatting, Clippy, native tests with and without live,
Rustdoc checks and executable examples, WASM generation,
Node/native/WebCrypto interoperability, real Chromium and a real resolver
restart journey. `cargo audit` and `cargo deny check licenses sources` run the
dependency checks. Tests use synthetic invitations and keys.

```sh
# Optional read-only check against an existing KithMoot checkout's installed Fold.
node scripts/check-kithmoot.mjs ../kithmoot

# Install the browser tarball and compile its strict TypeScript consumer.
node scripts/check-package.mjs

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

## Live pairing and spoken words

For the reusable flow and real Rust relay, run `npm run demo:pairing`. It supports
public QR links, separate private words/characters, explicit verification and an
encrypted recipient-decrypted receipt. See [live relay](docs/live-relay.md),
[public handoff](docs/public-handoff.md) and [receipt framing](docs/transfer-protocol.md).
The lower-level demo below remains a compatible, loopback transport example.

Stored-only consumers can load a separate smaller WASM module:

```js
import { init, createStoredCodec } from '@forgesworn/foregather-kit/stored';
await init();
// Stored/spoken/live package entry selection does not change stored v1 bytes.
```

The `/stored` entry exports stored codecs, the explicit resolver client and
creation-grant client. It exposes no live or spoken functions. The optional
`/qr` entry bundles local generation/decoding; it loads no hosted runtime code.
The full entry exports `createPairingFlow`, `createLiveRelayClient`,
`createCreationGrantClient`, `createPairingLink` and `parsePairingLink`.

```js
const flow = createPairingFlow({ ...offer, namespace: 'example.rooms',
  purpose: 'invitation', role: 'inviter', now: currentTime, transport,
  onState: ({state}) => showPairingState(state) });
const words = await flow.pair({signal});
// Show/compare words. Only an explicit user acceptance reaches this step.
flow.verify({matches: true});
const receipt = await flow.send({payload: invitationBytes, signal});
// receipt.decrypted means exact-byte decryption, not review or admission.
flow.dispose();
```

Recipients call `receive()` after their own explicit verification. Application
validation, review, admission and continuing traffic encryption remain separate.
Failure/cancellation/expiry is terminal: start again with a fresh offer rather
than recreating a gate for the old secret. The checked optional Joystick SDK
adapters preserve its host authorisation, parser and explicit controller review;
run `npm run test:joystick -- /your/built/joystick` for the real two-browser journey.

Run `npm run demo:live` and open `http://127.0.0.1:8789`. Choose words or
characters and create a pairing. On another client, enter the public room code
or open the pairing link, then enter the separate private secret. Copy controls
keep the public code, link and private secret distinct. The share screen shows
time remaining; Start again creates a fresh local flow after a failure.
After pairing, compare verification words and explicitly send an invitation for
application review. The demo adapts to mobile, keyboard input and your system's
light/dark theme. `npm run test:live` automates both formats, wrong-code rejection,
clipboard denial, keyboard/mobile handoff and private relay contents. The demo
is loopback-only; it is not a production relay.

```js
import { createLiveOffer, createLivePairing } from '@forgesworn/foregather-kit';
const currentTime = () => Math.floor(Date.now() / 1000);
const now = currentTime();
const offer = createLiveOffer({ namespace: 'example.rooms', purpose: 'invitation', now });
// Share offer.session publicly; speak offer.secretWords separately.
const gate = createLivePairing({ ...offer, namespace: 'example.rooms',
  purpose: 'invitation', role: 'inviter', now });
const exchange = gate.start({ now }); // Spends the default single attempt.
const hello = exchange.hello(); // Pass through your own transport.
const pending = exchange.finish({ peerHello, now: currentTime() });
const proof = pending.proof(); // Exchange with the other endpoint.
const channel = pending.confirm({ peerProof, now: currentTime() });
gate.dispose();
const words = channel.verificationWords({ now: currentTime() });
// Compare words. Encrypt invitation bytes with channel.seal(), then transfer.
// Recipient uses channel.open(), validates bytes and obtains admission consent.
channel.dispose();
```

The demo also gives the inviter an independent six-character **public room code**.
The recipient can enter that code and click **Find pairing**, then enter the
separate secret. Choose **Words** or **Characters** and a length before creating
an offer. Six-character secrets use a 32-symbol alphabet and provide 30 bits
when CSPRNG-generated; four random words provide 44 bits. These are separate
from the post-pairing verification phrase. A public room code grants no access.
Character codes display as `DFV-SJX`, and both grouped and plain input work from
0.3.1. Six random characters have a per-guess chance of 1 in 1,073,741,824;
four random words have 1 in 17,592,186,044,416. The demo shows odds for the selected
length. See [grouping and guessing assumptions](docs/character-codes.md#what-are-the-guessing-odds)
for attempt budgets, public lookup and exact comparisons.

```js
import { createCharacterOffer, createCharacterPairing, createRendezvousCode } from '@forgesworn/foregather-kit';
const offer = createCharacterOffer({namespace:'example.rooms', purpose:'invitation', characterCount:6, now});
const gate = createCharacterPairing({...offer, namespace:'example.rooms', purpose:'invitation', role:'inviter', now});
// Use the same start/finish/confirm lifecycle as the word API.
const publicCode = createRendezvousCode({length:6});
// Your transport maps publicCode to offer.session with bounded allocation,
// collision checks and expiry. Never send offer.secretCode to that directory.
gate.dispose();
```

Character APIs use the unchanged live PAKE profile through the frozen
[base32-to-word password encoding](docs/character-codes.md). Original word APIs
and vectors remain compatible. Character lengths are 6–32; words are 2–16.
The public-code directory is an example-only volatile transport adapter; the
stored resolver does not provide room lookup or grant room membership.

Keep one gate for the code's entire lifetime. Cancellation and failure spend
attempts; generate a new locator AND code after exhaustion or restart. Dispose
all abandoned states. Locally select the expected namespace and purpose on both
endpoints. The library initiates no network activity. Defaults are four access
words (44 bits when randomly generated), a 120-second lifetime, one attempt and
three verification words. Counts/lifetime are configurable within documented
bounds; none is limited to six letters or six words.

Use `deriveSpokenWords({secret, context, counter, identity?, count?})` and
`deriveDirectionalWords({secret, namespace, roles, counter, count?})` for exact
Spoken Token v2 words. These verify shared-secret knowledge; applications own
replay and attempt policy. See [live protocol](docs/live-protocol.md) and
[spoken compatibility](docs/spoken-protocol.md).

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
FFI packages are built with `node scripts/build-native.mjs apple` or `android`.
See [native packaging and qualification](docs/native.md).

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
Limited [creation grants](docs/creation-grants.md) can delegate creation without
sharing operator authority. `FOREGATHER_ENABLE_LIVE=1` explicitly enables the
durable experimental relay; [deployment examples](deploy/README.md) cover systemd
and a prebuilt-Linux-binary container.

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
Dependencies retain their own licences and attribution; see
[third-party notices](THIRD_PARTY_NOTICES.md). Foregather requires libraries,
not external hosted products.

## Documentation and contributing

Use the [documentation index](docs/README.md) for protocols, self-hosting, APIs
and validation limits. [Contributing](CONTRIBUTING.md) lists the required checks;
[SUPPORT.md](SUPPORT.md) covers questions and [SECURITY.md](SECURITY.md) private reports.
An optional [llms.txt](llms.txt) provides navigation for AI tools.
