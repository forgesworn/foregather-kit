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
| Character secrets and public room lookup | [Character codes](character-codes.md) |
| Experimental PAKE transcript and lifecycle | [Live protocol](live-protocol.md) |
| Durable optional live service and role capabilities | [Live relay](live-relay.md) |
| Limited delegated creation authority | [Creation grants](creation-grants.md) |
| Public-only links, QR and camera cleanup | [Public handoff](public-handoff.md) |
| Encrypted recipient-decrypted receipts | [Transfer framing](transfer-protocol.md) |
| Bounded two-way messages on a verified channel | [Message exchange](exchange-protocol.md) |
| Swift package/XCFramework and Android AAR | [Native bindings](native.md) |
| Supported self-hosting layouts | [Deployment](../deploy/README.md) |
| Seven-feature implementation and qualification | [Adoption status](adoption-status.md) |
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
