# Security boundaries

Foregather v0.1 is an early stored-invitation implementation. Automated tests and
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
contents in public issues. Coordinate sensitive reports privately with the
project maintainer, TheCryptoDonkey. Public vulnerability reports should use
synthetic reproductions. A dedicated private reporting endpoint is a publication
gate and has not been provisioned by this local build.
