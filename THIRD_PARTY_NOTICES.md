# Third-party notices

Foregather source: MIT, Copyright (c) 2026 TheCryptoDonkey.

KithMoot compatibility vectors are copied unchanged from
`forgesworn/kithmoot`, checkout `0bae5b57d7850241038a0b33907ca6e47d7ae2ac`,
`vectors/short-invitation-envelope.json`. They are MIT, Copyright (c) 2026
TheCryptoDonkey. Their synthetic material is used only for interoperability tests.

Rust dependencies are recorded in Cargo.lock. Cryptographic code comes from
RustCrypto AES-GCM and its dependency crates; URL parsing uses the Rust URL/ICU
crates; HTTP uses Axum/Tokio/Tower; persistence uses Rusqlite/bundled SQLite;
bindings use wasm-bindgen. Their own MIT, Apache-2.0, BSD, Unicode and Zlib notices
remain applicable. Foregather's MIT licence does not relicense dependency code.
`cargo deny check licenses sources` enforces the configured permissive licence
policy. Distribution must include the generated dependency licence text.

Playwright is an Apache-2.0 development-only browser test dependency, recorded
in package-lock.json. It is not in the published runtime browser package.
