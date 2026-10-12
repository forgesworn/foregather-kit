# Local validation — 2026-10-12, v0.3.0

Environment: macOS ARM64, Rust 1.94.1, Node 24.21.0, Python 3.14,
wasm-bindgen 0.2.129, Playwright Chromium 151.0.7922.34.
All invitation, pairing and management material used by these checks is synthetic.

| Gate | Evidence |
| --- | --- |
| Rust format/lint/docs | Formatting; all workspace targets/features with Clippy warnings denied; Rustdoc warnings denied, all public core APIs documented, three executable examples |
| Default Rust consumer | Stored/spoken tests and stored Rustdoc example also run without experimental-live |
| Stored native core | 12 tests: independent vectors, profile/context tampering, expiry, canonical input, limits, entropy failure; 4,096 deterministic hostile mutations |
| Live native core | 13 tests: character encoding/generation and length separation, character/word interoperability, public-alias bounds and wrong-code budgets; frozen full transcript/keys, confirmation, wrong codes/context/roles, point validation, cancellation budget, fallible entropy, expiry/clock rollback, ordering/tampering/replay, configurable codes |
| Spoken native core | 2 tests: frozen en-v1 hash, v2 word/directional vectors and domain/input limits |
| Resolver | 8 tests: restart, durable quotas, expiry, management authority, write-once races, bounded HTTP, stored-capability hashes and cancellation/work budget |
| Node/WASM | 31 tests: grouped/raw character/native interoperability, all lengths and malformed grouping, exact guessing-odds fixtures, independent bit encoding and public-code canonicalisation; successful unused-body and error-body cancellation, native/WASM live pairing, stored and live Node AES interoperability, spoken HMAC agreement, wrong-code/lifecycle/bounds and existing resolver client cases |
| Independent PAKE implementation | Python spake2 0.9 reproduces both native hellos, shared-key derivations, confirmation proofs, verification words and encrypted bootstrap; separate pinned venv |
| Real Chromium codec | Stored frozen vectors opened and browser ciphertext authenticated by Node; zero external requests |
| Real resolver process | Native inviter to WASM recipient; restart persistence; independent deletion; durable creation budget |
| Stored two-client demo | Explicit create/share/review/delete, no fetch before review, no external requests, outside-origin creation rejected |
| Live two-client demo | Matching verification, explicit encrypted handoff for review; words and six-character secrets via public room-code lookup; public-code-only pairing fails; wrong code fails both endpoints; directory expiry/limits and no secret/plaintext at relay or directory; write-once race, oversized body and cross-origin write rejection; zero external requests |
| Existing Fold consumer | Read-only installed parser check for KithMoot v2/v3 invitation bytes; does not exercise live room admission |
| Browser distribution | Isolated tarball install exercises stored/live/spoken public exports; WASM, declarations, MIT and dependency licence texts included; zero external JS runtime dependencies |
| Rust distribution | Core packaged and compiled with all features, including opt-in live pairing |
| Dependency checks | RustSec and npm advisory scans; cargo-deny permissive licences/registry sources |

There are 67 Rust/Node tests (36 Rust, 31 Node), three Rustdoc examples, plus the separate
Chromium/service/package/reference journeys. The Python check establishes
independent implementation agreement, not a protocol proof or security audit.
The actual installed browser tarball is compiled with TypeScript 5.9.3 in strict
NodeNext mode. Positive cases cover all public exports; negative cases enforce
byte payloads, required time, fixed roles/profile and validator/tuple shapes.

The 0.3.0 local WASM measurement was 639,282 bytes (235,984 bytes gzipped); its browser tarball
with licence texts is 271,971 bytes. The last local Chromium initialization was
8.6 ms. These are single-machine diagnostics, not a phone performance or memory
guarantee. Live PAKE increases
the browser build versus stored-only v0.1. Native stored consumers leave the
experimental-live feature disabled and do not compile its curve/PAKE dependencies.

## Remaining gates

This record describes the local validation run. Current hosted CI evidence is
on [GitHub Actions](https://github.com/forgesworn/foregather-kit/actions); public
distribution status and asset checksums are on the
[release page](https://github.com/forgesworn/foregather-kit/releases). Registry
publication is a separate gate from tarball/package compilation. No production
resolver/domain/live relay has been deployed. Joystick, Covey and KithMoot have not been migrated; application
admission, host/controller authority and continuing traffic encryption remain
owned by their existing protocols.

Live pairing is experimental. RustCrypto spake2 0.4.0 is unaudited, uses its own
profile rather than RFC 9382 wire bytes, and does not erase all internal secret
copies. Foregather has no independent PAKE/composition/security review. The
bundled live relay is loopback demo infrastructure. Do not interpret the tests
or advisory scans as production security acceptance.

Swift/Kotlin FFI, physical phones, external networks, recovery/load testing,
coverage-guided fuzzing and production relay qualification remain open.
Stored mode has no forward-secrecy, anonymity or guaranteed-deletion claim.
No deterministic process-memory erasure is claimed for either mode.

Reproduce functional gates with `npm run check`, parser compatibility with
`node scripts/check-kithmoot.mjs ../kithmoot`, browser distribution with
`node scripts/check-package.mjs`, and Rust distribution with
`cargo package --locked -p foregather-kit --all-features --allow-dirty`.
The independent reference setup/command is in docs/live-protocol.md. The full
functional check stops its local services and removes its own temporary test DBs.


## Maintenance and discoverability

Main requires a pull request, the `native-wasm-browser` check against the latest
base, and resolved review conversations. Admins are subject to these rules;
force pushes and branch deletion are blocked. A second maintainer's approval is
not required. These rules protect delivery; they do not constitute independent
security review. Private vulnerability reporting is enabled.

CI runs weekly as well as on pushes, pull requests and manual dispatch, including
RustSec/npm advisory and dependency licence/source checks. Dependabot proposes
weekly Cargo, npm and Actions updates; updates need review and passing checks.
Frozen PAKE/profile dependencies must not be silently upgraded.

The documentation index, public Rustdoc (including live feature), browser guide,
GitHub topics and optional llms.txt improve navigation. llms.txt does not guarantee
AI indexing. CI builds the Rustdoc; docs.rs publication after registry release is
a separate gate. Rust crates and GitHub assets are distributed separately from
npm registry publication, which still requires publisher authentication.
