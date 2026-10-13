# Third-party notices

Foregather source: MIT, Copyright (c) 2026 TheCryptoDonkey.

KithMoot compatibility vectors are copied unchanged from
`forgesworn/kithmoot`, checkout `0bae5b57d7850241038a0b33907ca6e47d7ae2ac`,
`vectors/short-invitation-envelope.json`. They are MIT, Copyright (c) 2026
TheCryptoDonkey. Their synthetic material is used only for interoperability tests.

The frozen Spoken Token en-v1 wordlist is copied from `forgesworn/spoken-token`
commit `fbe6154cc74cf0ebf41f7edc03a9a584f3136e23`, `src/wordlist.ts`.
MIT, Copyright (c) 2026 TheCryptoDonkey. See docs/spoken-protocol.md for its hash.
Live pairing uses RustCrypto spake2 0.4.0, curve25519-dalek, HKDF and HMAC.
Upstream notices are included; the PAKE implementation is not independently audited.

Rust dependencies are recorded in Cargo.lock. Cryptographic code comes from
RustCrypto AES-GCM and its dependency crates; URL parsing uses the Rust URL/ICU
crates; HTTP uses Axum/Tokio/Tower; persistence uses Rusqlite/bundled SQLite;
bindings use wasm-bindgen. Their own MIT, Apache-2.0, BSD, Unicode and Zlib notices
remain applicable. Foregather's MIT licence does not relicense dependency code.
`cargo deny check licenses sources` enforces the configured licence policy.
Distribution must include the generated dependency licence text.

Native Swift/Kotlin bindings use unmodified Mozilla UniFFI 0.32.2 components.
These retain MPL-2.0, with narrowly named exceptions in deny.toml; Foregather's
own source remains MIT. The full text is retained from
`https://github.com/mozilla/uniffi-rs/blob/v0.32.2/LICENSE` in
`packages/native/licenses/uniffi-MPL-2.0.txt`, including for published UniFFI
crates that omit their upstream licence file. Source remains available from
the tagged upstream repository and crates.io; no UniFFI source is modified.
Kotlin consumers use JNA 5.19.1 (Apache-2.0 OR LGPL-2.1-or-later; Apache-2.0 is
selected), pinned to the Maven Central artifact checksum by the native builder.

QR generation vendors Project Nayuki's MIT TypeScript source, commit
`3c6d0b3cefb4e049dc337e82237c9644399716a8`, preserving its copyright/licence
header. QR decoding bundles jsQR 1.4.0 (Apache-2.0), pinned in package-lock.json.
The package's optional `/qr` entry loads these local assets; it makes no external
runtime requests. Their licence texts are included in browser distributions.

Playwright is an Apache-2.0 development-only browser test dependency, recorded
in package-lock.json. It is not in the published runtime browser package.

The independent fixture check uses test-only `python-spake2` (MIT), Python
cryptography (Apache-2.0 OR BSD-3-Clause), cffi (MIT) and pycparser (BSD-3-Clause),
pinned in scripts/reference-requirements.txt. They are installed separately for
tests and are not bundled in the Rust or browser distributions.
