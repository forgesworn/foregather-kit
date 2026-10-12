# Foregather development

Foregather owns invitation transfer, not room admission, identity, enrolment,
membership, game messages or media transport. Keep application validators and
consent at their existing authority boundary.

* Core operations never initiate network requests or read the wall clock.
  Supply trusted time and CSPRNG explicitly. WASM uses platform crypto randomness.
* Preserve v1 wire bytes and golden vectors. Protocol changes require a distinct
  version/profile, vectors, interoperability tests and protocol documentation.
* Keep public locator, bearer secret and verification phrase conceptually and
  structurally separate. No low-entropy lookup/password protocol without its
  reviewed PAKE transcript and endpoint attempt budget.
* Never log real capabilities, raw evidence or invitations. Synthetic fixtures
  are public test material. Do not expose deterministic production randomness.
* KithMoot compatibility requires its caller-owned Fold parser before sealing
  and after opening. Do not copy membership rules into this core.
* Run `npm run check`, package checks and relevant dependency checks for changes.
  Distinguish local codec/browser tests, real app admission, physical devices,
  hosted CI, publication and security review in validation claims.
* Rust builds reuse this worktree's `target/`. Never allocate a new
  `CARGO_TARGET_DIR` for a task. Do not override `CARGO_INCREMENTAL=0`.
* MIT. Copyright (c) 2026 TheCryptoDonkey. Preserve dependency attribution.
