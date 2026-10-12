# Foregather documentation

Portable invitation transfer, spoken verification and experimental live pairing
in Rust/WASM. MIT. Copyright (c) 2026 TheCryptoDonkey. No required hosted service.

| Need | Read |
| --- | --- |
| Install, choose stored/spoken/live mode, integrate | [README](../README.md) |
| Browser exports and initialisation | [Browser package](../packages/browser/README.md) |
| Native API and feature flags | [Rust API](https://docs.rs/foregather-kit/latest/foregather_kit/) |
| Stored v1 bytes, limits and compatibility | [Stored protocol](protocol.md) |
| Self-host the ciphertext resolver | [Resolver configuration and API](resolver.md) |
| Frozen Spoken Token v2 words | [Spoken protocol](spoken-protocol.md) |
| Experimental PAKE transcript and lifecycle | [Live protocol](live-protocol.md) |
| Threat model, privacy limits, private reports | [Security](../SECURITY.md) |
| Tested evidence and unqualified gates | [Validation](validation.md) |
| Planned adoption and independent review | [Roadmap](roadmap.md) |
| Development checks and contribution rules | [Contributing](../CONTRIBUTING.md), [agent instructions](../AGENTS.md) |
| Questions and bugs | [Support](../SUPPORT.md) |

Foregather returns application input for review. It does not grant room access,
enrol members, verify personal identity or encrypt continuing game/media traffic.
Keep public locators, bearer secrets and comparison phrases separate. Namespaces
provide domain separation, not cross-project authority or proof of identity.

Live PAKE is opt-in for Rust through `experimental-live`; browser APIs require
explicit invocation. The pinned SPAKE2 implementation and composition have no
independent security audit and are not RFC 9382 wire compatible. Automated test
success and advisory scans do not establish production security acceptance.
