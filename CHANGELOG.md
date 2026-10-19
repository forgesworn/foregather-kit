# Changelog

## 0.6.0 - 2026-10-19 (bounded message exchange)

* Add the separately versioned `foregather-exchange/1` profile: after both
  people accept the verification words, each endpoint may send up to 32 ordered
  messages of at most 16,379 bytes, framed `46 47 02 01 || index || payload`
  with the index equal to the channel sequence, until the session deadline. It
  fits the deployed relay's 32 packet slots per role; transfer v1, the reply
  profile, live packets and all frozen vectors are unchanged.
* Rust: `exchange::ExchangeChannel` (refuses a channel that carried any packet,
  ends on an authenticated foreign frame) and `encode_message`/`decode_message`.
  Browser: `flow.exchange()` returns `{sent, received, send, receive, close}`
  with one send and one receive in flight, and `exchanging`/`closed` progress.
* Add independent Python frame and packet vectors over the frozen live channel,
  checked by `scripts/check-pake-reference.py`; Rust vector, tamper, binding,
  bound and deadline tests; flow tests for round trips, limits, mixing with
  transfer v1, tampering, retries, expiry, cancellation and the HTTP relay; and
  TypeScript consumer coverage.
* Native Swift/Kotlin bindings do not expose the exchange yet.

## 0.5.0 - 2026-10-19 (optional transfer reply)

* Add the separately versioned `foregather-transfer-reply/1` profile: after the
  receipt, the recipient may return one application message of at most 1,024
  bytes, bound to the transfer identifier and the invitation's SHA-256, at
  packet sequence one before the session deadline. Transfer v1 bytes, receipts
  and frozen vectors are unchanged.
* Rust: `Transfer::reply` and `Transfer::read_reply`. Browser: `keepOpen` on
  `send`/`receive`, then `awaitReply()` or `reply()`, with `awaiting-reply`,
  `replying` and `replied` progress. A kept channel closes after the reply or at
  the deadline; the delivered transfer keeps its outcome.
* Add independent Python reply vectors, tamper/binding/bound tests, flow tests
  for retries, tampering and expiry, and TypeScript consumer coverage.
* Native Swift/Kotlin bindings do not expose the reply yet.

## Browser 0.4.1 - 2026-10-13

* Retry transient directory/poll reads at most twice without recreating pairing
  gates, changing capabilities/counters or extending the original deadline.
* Abort in-flight transport work and backoff on cancellation/disposal; validate
  peer message schema before returning it. Authentication and malformed replies
  remain terminal.
* Add end-to-end HTTP flow regressions for transient reads, persistent failures,
  cancellation, disposal, expiry and unchanged encrypted sequence zero.
* Refresh public Joystick adoption and distribution evidence. Rust, native
  bindings, relay binaries and frozen profiles remain at their 0.4.0 release.
  This patch contains only the browser package, licences and provenance.

## 0.4.0 - 2026-10-13 (experimental adoption APIs)

* Add a durable optional live relay with endpoint capabilities, fixed expiry,
  identical-byte retries, shared record/rate/byte quotas and bounded public lookup.
* Add expiring resource/use/lifetime-scoped creation grants and operator revocation.
* Add reusable pairing flows with progress, cancellation, expiry, explicit
  comparison acceptance and an encrypted exact-byte decryption receipt.
* Add separately versioned public handoff and transfer profiles with frozen
  independent vectors, preserving all existing stored/spoken/PAKE bytes.
* Add local public-only QR rendering/decoding and camera lifecycle cleanup.
* Add Swift/Kotlin native APIs, caller-validated KithMoot codec, Apple package
  and four-ABI Android AAR builders with real foreign/package consumers.
* Add a distinct smaller stored-only browser entry and strict installed consumer
  checks for all entries. Exercise Joystick's optional authority/review adapters
  with real browser/controller input without moving admission into Foregather.
* Add systemd/container layouts and native/container CI. Native UniFFI retains
  MPL-2.0 notices; Foregather remains MIT. Live remains experimental: physical
  devices, public gateway/load qualification and independent review are open.

## 0.3.1 - 2026-10-12 (human-readable codes)

* Display/copy character codes in triples (`DFV-SJX`); accept grouped or plain
  input consistently in Rust, WASM and browser lookup/pairing. Reject malformed
  grouping and preserve all canonical passwords and frozen protocol vectors.
* Add reusable `formatCharacterCode` and exact BigInt `accessSecretOdds` browser
  helpers, with a zeroizing native formatter and strict consumer coverage.
* Show per-guess odds for the selected secret and a comparison table. Document
  uniform generation, combined endpoint budgets, expiry and public-alias lookup.
* Include the responsive live-demo polish and keyboard/clipboard/restart checks.

## 0.3.0 - 2026-10-12 (experimental character codes)

* Add configurable 6–32 character access secrets using the separately frozen
  base32-to-en-v1 password encoding. Preserve the existing live PAKE profile
  and all original stored/spoken/live vectors.
* Add typed public rendezvous alias helpers, independent of access secrets.
* Extend the live demo with words/characters, length controls and six-character
  public room lookup through a bounded, expiring, collision-checked directory.
* Test native/WASM/word-presentation interoperability, frozen character vectors,
  public-code-only rejection, wrong secrets, directory limits and expiry.
* Live pairing and the example transport remain experimental and unaudited.

## 0.2.1 - 2026-10-12 (experimental hardening release)

* Cancel unused successful resolver response bodies immediately; cover success
  and failure cleanup with hostile stream regression cases.
* Document public core Rust APIs and executable stored/live examples; include
  the live feature in docs.rs builds and enforce Rustdoc/default-feature checks.
* Compile the installed browser tarball with a strict TypeScript consumer,
  including positive and negative public API cases.
* Add documentation/contribution/support indexes and optional AI navigation.
* Add weekly CI/advisory scans and dependency-update proposals. Main now
  requires delivery through a PR and passing CI; independent security
  review, device/load/fuzz qualification and app adoption remain open.
* Preserve existing stored, spoken and live protocol bytes.

## 0.2.0 - 2026-10-12 (experimental release)

* Add opt-in experimental endpoint PAKE with separate locator/secret, bound
  context and roles, one-use confirmation and a cancellation-safe attempt budget.
* Add ordered, direction-specific encrypted bootstrap packets and verification words.
* Add frozen Spoken Token v2 en-v1 word and directional compatibility.
* Add bounded WASM APIs, native/browser interoperability, frozen vectors and a
  two-client local handoff demonstration. Preserve stored v1 formats.
* Document the unaudited dependency, memory limitations and production review gate.

## 0.1.0 - 2026-10-12

* Add a Rust stored-invitation envelope core with authenticated application
  namespaces, bounded parsing, explicit time/entropy and typed secret ownership.
* Add WASM/TypeScript bindings and an explicit bounded HTTP client.
* Preserve KithMoot v1 encrypted envelope bytes behind required caller validation.
* Add a self-hosted SQLite resolver with independent upload/deletion authority,
  write-once ciphertext storage, expiry and durable creation/storage limits.
* Add independent vectors, native/WASM/Node interoperability, Chromium checks,
  resolver restart/race tests and documented security/adoption boundaries.

Live PAKE pairing, spoken tokens, native mobile FFI, production deployments and
application migrations are not implemented in this version.
