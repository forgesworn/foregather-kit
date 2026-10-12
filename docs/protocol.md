# Foregather envelope v1

The envelope transfers opaque application input. It is not an admission protocol.
Namespaces are case-sensitive ASCII: `[a-z][a-z0-9._-]{0,63}`. Both endpoints
select the expected namespace out of band; it must never be taken on trust from
an unauthenticated response.

* Locator: 16 independent CSPRNG bytes, canonical unpadded base64url (22 chars).
* Key: 32 fresh CSPRNG bytes per sealing operation, canonical base64url (43 chars).
* Nonce: 12 fresh CSPRNG bytes. A key is generated afresh for every envelope.
* Cipher: AES-256-GCM, 128-bit tag appended to ciphertext.
* AAD: UTF-8 `foregather-envelope/v1:<namespace>:<id>:<expires>`.
* Expiry: whole Unix seconds, exclusive, positive remaining lifetime at most
  604,800 seconds, clock and expiry at most JavaScript's 9,007,199,254,740,991.
* Plaintext: compact UTF-8 JSON `{"v":1,"data":"<base64url payload>"}`.
  An empty binary payload is encoded as an empty data string.
* Envelope: JSON object with exactly `v`, `expires`, `nonce`, `ciphertext`.
  Version is integer 1. Duplicate fields, unknown fields, malformed UTF-8 and
  noncanonical base64url are rejected. Outer field ordering/JSON whitespace may
  vary. Decoder resource limits apply before parsing or base64 allocation.
* Serialized envelope limit: 32,768 UTF-8 bytes. Base64 overhead reduces usable
  payload size; 18,000 binary bytes fit the generic profile's current bounds.

An invitation address is `<configured canonical HTTPS base ending /><id>#<key>`.
Only that configured base is accepted. Credentials, query strings and URL
normalisation aliases are rejected. Explicit development opt-in permits HTTP
for `localhost`, `127.0.0.1`, or `[::1]`. The base is a caller trust decision,
not authenticated application identity. The HTTP resolver never receives the
fragment key. Client code served at the invitation origin can read it and is
part of the trust boundary.

Decrypting requires the expected profile, namespace, locator, expiry and key.
Successful decryption does not prove inviter identity: any holder of the full
bearer URL has the symmetric key. The application validates the recovered
payload, pinned authority and current state before requesting consent/admission.

## Existing KithMoot profile

The compatibility profile retains:

* AAD `kithmoot-short-invite/v1:<id>:<expires>`.
* Plaintext `{"v":1,"url":"<exact full invitation>"}`.
* Share URL `https://z1p.app/k/<id>#<key>` (84 characters).
* Canonical target `https://kithmoot.app/j/#...`, with no queries/credentials.

Fold remains the authority for supported v2/v3 invitation parsing. Browser
adapters require that validator before sealing and after opening. The portable
Rust profile performs URL-boundary checks only. New Fold formats require a
separate explicit compatibility decision; unsupported formats are not silently
accepted through this adapter.

Golden vectors live in `crates/foregather-kit/vectors/`. The generic vectors are
generated independently by Node crypto with synthetic keys and nonces; ordinary
tests verify them without regeneration. The KithMoot vectors are copied unchanged.

## Evolution

Do not change these derivations under v1. A new cipher, encoding, purpose or
payload schema requires a new profile/version and vectors. Never downgrade to
a legacy profile after an authentication failure. Live pairing will have its
own transcript and domain separation; this stored format provides no forward
secrecy and must not be presented as a low-entropy short-code protocol.
