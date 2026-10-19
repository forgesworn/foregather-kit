# Security boundaries

Foregather v0.2 adds spoken compatibility and experimental live pairing to stored invitations. Automated tests and
dependency advisory checks are evidence, not an independent protocol/security
audit. Use your application's current authority and consent checks after
recovery. Do not replace working admission merely because an envelope opens.

## Threat model

An honest but curious resolver sees locator, expiry, timing, traffic volume,
ciphertext sizes and client/network addresses. It should not receive the key,
plaintext invitation or upload/delete token in request URLs. A malicious
resolver can withhold, delete, replay, correlate or retain ciphertext. Namespace,
locator, expiry and payload integrity are authenticated by the client cipher.
There is no anonymity, delivery, forward secrecy or guaranteed erasure claim.

The shared URL is a bearer capability. Anyone receiving it, including a messenger
or compromised client, receives the key. Browser JavaScript from the invitation
origin can read its fragment, so self-hosting the resolver alone does not remove
trust in the application code. Keep fragment keys out of logs, analytics,
clipboard history where practicable, and third-party preview/signalling APIs.
Never send the full URL to the resolver API; use `codec.locator(url)`.

Core temporaries and owned key/payload buffers use zeroization; AES uses its
zeroization feature. JavaScript strings, WebAssembly/JS transfer copies,
returned payloads and caller-owned input may remain in memory. Deterministic
whole-process erasure is not promised. `Invitation` Debug output is redacted.
Native callers must supply a genuine CSPRNG; browser bindings use platform
cryptographic randomness. Tests' fixed material must never become production
entropy options.

Application namespaces prevent cross-application ciphertext substitution when
the expected namespace is selected independently. They are not application
identity proof or access control at the storage service. Symmetric encryption
authenticates possession of the bearer key, not a person or room authority.

The resolver requires creation authority, bounds live/pending slots and rate,
hashes independent management capabilities, enforces write-once upload, and
does not accept capability queries. Operate it in a private directory with a
trusted TLS gateway; disable gateway authorization/body logs and protect backups.
Creation authority is not distributed to public browser assets by this library.
Resource limits do not establish resistance to every distributed denial of
service attack. Actual room admission must enforce its own revocation, consent,
replay and concurrency rules.

## Experimental live pairing

The opt-in live profile uses pinned RustCrypto spake2 0.4.0, not an independently
audited or RFC 9382-compatible implementation. See [the full transcript and
local source review](docs/live-protocol.md) before enabling it. The public locator
is independent of secret words; explicit key confirmation precedes any protected
handoff. Endpoints spend attempts on start, including cancellations. Keep one
gate per code, dispose it after success and never recreate it for the same code.
Relay quotas are not the password guessing boundary. A malicious relay can
exhaust budgets and deny delivery. App-owned transport must bound streams and
must not log codes, capabilities or plaintext. Version 0.4 adds an optional durable Rust relay and explicit HTTP transport.
Its composition and public deployment still require independent qualification.
Bundled demonstration gateways remain loopback-only.

Owned Foregather secrets/keys are zeroized, but upstream SPAKE2 Password, scalar
and internal state copies do not all zeroize on drop. JavaScript strings and
transfer copies may remain too. Do not claim deterministic erasure or protection
from an endpoint/process memory compromise. Dispose abandoned browser states;
never persist code/key/channel state or resume counters after restart.

Confirmed channels use distinct direction keys and ordered authenticated packet
counters. They expire with the pairing session and are for bootstrap only.
Joystick's continuing traffic needs its own authenticated encryption and host
admission; this library does not secure its existing plaintext broker. Spoken
verification phrases prove channel/shared-secret knowledge, not personal identity
or room authority. Independent PAKE and composition review remain required
before production adoption. Dependency scans do not replace that review.

## Character secrets and public aliases

Grouped input added in 0.3.1 strips only correctly placed ASCII hyphens between
triples, before the existing frozen character-to-word encoding. It adds no
entropy or extra password attempts. Generated/canonical values stay unseparated.
See [exact guessing odds and combined endpoint budgets](docs/character-codes.md#what-are-the-guessing-odds).

The six-character access presentation added in 0.3 provides 30 bits only when
uniformly generated from the documented 32-symbol alphabet. Default four-word
secrets provide 44 bits. Human-chosen numeric codes or words do not inherit these
entropy claims. Character parsing never establishes entropy. The one-use PAKE
budget and expiry apply unchanged; see [the encoding](docs/character-codes.md).

A public rendezvous/room code is an independent directory alias, not a password.
Knowing it reveals the public session/metadata and grants no admission. Do not
reuse it as an access secret or derive a secret from it. The transport must bound
allocations/lookups, handle collisions and expire aliases with their session.
The example directory is loopback-only, volatile and not a production service.
Its quotas do not replace the endpoint password-attempt budget. Six-character
aliases are enumerable; make no confidentiality or anonymity claim for them.

## Dependencies and portability

The stored profile uses RustCrypto AES-GCM 0.10.3 with fresh 256-bit keys,
96-bit nonces and 128-bit tags. See the upstream
[security notes](https://docs.rs/aes-gcm/0.10.3/aes_gcm/#security-notes) for CPU
timing limitations. WASM and native use this same implementation. Unsupported
processors must be qualified before shipping; this initial version was tested
on macOS ARM64 and Chromium, not physical phones or microcontrollers.

Commit lockfiles; run `cargo audit`, `cargo deny check licenses sources` and
`npm audit`. Runtime crates retain their own licences. No dependency requires a
hosted account or external product. An advisory-free dependency graph does not
establish that Foregather's composition has been independently audited.

## Reporting

Do not put live keys, invitation URLs, management capabilities or private-room
contents in public issues. Use [GitHub private vulnerability reporting](https://github.com/forgesworn/foregather-kit/security/advisories/new)
to coordinate sensitive reports with the project maintainer, TheCryptoDonkey. Public vulnerability reports should use
synthetic reproductions. Private vulnerability reporting is enabled on the public repository.


## Adoption adapters and native bindings (0.4)

Public handoff links use a distinct versioned public-only schema and check the
application-selected origin/path/context/time before returning metadata. QR
rendering/decoding occurs locally. Explicit camera operations release tracks on
success/cancellation/failure; physical browser/device acceptance is separate.

Pairing flows require explicit verification acceptance before their versioned
invitation frame/receipt. A receipt authenticates recipient decryption of exact
bytes through the confirmed channel, not human consent, named identity or room
admission. App validators and review remain mandatory. Transport retries reuse
identical ciphertext or claim capabilities; they never reconstruct gates or
reset counters/budgets. Failed or expired flows cannot restart. The 0.6
message exchange uses the same verified channel instead of a transfer: it
proves sender and order within the deadline, not delivery, and exports no key.

The durable relay stores public messages/ciphertext and purpose-separated
capability hashes. Role-specific write authority, fixed expiry, write-once retry,
shared storage/creation/byte limits and lookup budgets do not provide anonymity,
guaranteed delivery/deletion or independent security acceptance. Creation grants
scope future allocation, not a person or encrypted application namespace.

UniFFI native adapters use platform CSPRNG and caller time. Foreign references
share one Rust state; disposal releases owned state but foreign/generated string
and buffer copies may remain. Unmodified UniFFI runtime retains MPL-2.0 and its
notices/source attribution are bundled. No native deterministic erasure claim is
made. Physical phones, public gateway/load qualification and independent review
remain open before production security claims.
