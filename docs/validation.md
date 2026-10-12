# Local validation — 2026-10-12

Environment: macOS ARM64, Rust 1.94.1, Node 24.21.0,
wasm-bindgen 0.2.129, Playwright Chromium 151.0.7922.34.
All invitation and management material used by these checks is synthetic.

| Gate | Evidence |
| --- | --- |
| Rust format and lint | `cargo fmt --all --check`; Clippy with warnings denied, all workspace targets |
| Native core | 12 passing tests: independent vectors, namespace/profile substitution, tampering, expiry, canonical input, limits, entropy failure; 4,096 deterministic hostile mutations |
| Resolver | 8 passing tests: restart, durable quotas, expiry, independent management authority, write-once races, bounded HTTP, stored-capability hashes, cancellation retains database work budget |
| Node/WASM | 16 passing tests: native/WASM/independent Node AES interoperability, KithMoot vectors, streaming/allocation limits, cancellation, safe endpoints, caller validation |
| Real Chromium codec | Independent KithMoot vectors opened, generated ciphertext authenticated by Node, tampering rejected; zero external requests |
| Real resolver process | Native inviter to WASM recipient; ciphertext survives process restart; wrong deletion authority refused; deletion observed; creation budget survives restart |
| Two browser clients | Create/share/review/delete through the local example; no invitation fetch before explicit review; no external requests; outside-origin creation rejected |
| Existing Fold consumer | Read-only check against KithMoot's installed `fold-kit#eaa3495127e55242cf8a09e4c57963c570d68e8d`; both v2/v3 invitations preserved, legacy traffic-secret invitation rejected |
| Browser distribution | Tarball installed into a separate temporary project and used through its published package entry; WASM, declarations, MIT and dependency licence texts included; zero external JS runtime dependencies |
| Rust distribution | Core crate packaged and compiled from the packaged sources |
| Dependency checks | RustSec scan: zero vulnerabilities/warnings; npm audit: zero reported vulnerabilities; cargo-deny permissive licences and registry sources pass |

The generated WASM is 459,910 bytes, or 176,367 bytes gzipped. A local Chromium
run measured 14.7 ms for WASM initialization; this is a single-machine diagnostic,
not a supported-device performance or memory budget. The browser package tarball
including licences was about 200 KiB during its isolated install check.

## Remaining gates

Hosted CI has been defined but not run. This local repository has not been
published to GitHub, npm or crates.io. No production resolver/domain was deployed.
The current Joystick, Covey and KithMoot apps have not been migrated. The Fold
check exercises its parser and invitation bytes, not live room admission.

Live PAKE pairing, spoken encoding/verification and native Swift/Kotlin FFI are
not implemented. There is no physical phone, external network, recovery/load,
full coverage-guided fuzzing or independent security-review acceptance. The
stored mode has no forward-secrecy, anonymity or guaranteed deletion claim.

Reproduce functional gates with `npm run check`, the optional existing-consumer
check with `node scripts/check-kithmoot.mjs ../kithmoot`, and distribution with
`node scripts/check-package.mjs` and `cargo package -p foregather-kit --allow-dirty`.
The full check includes local services and temporary databases; it stops them
and removes its own test directories on completion.
