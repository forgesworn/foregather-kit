# Changelog

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
