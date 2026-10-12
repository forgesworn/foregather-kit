# Experimental live bootstrap profile

Profile: `foregather-live/spake2-ed25519/1`. Added in 0.2.0. Rust consumers must
explicitly enable `experimental-live`; the browser package includes this API.
No published independent review or RFC 9382 wire interoperability is claimed.
Do not migrate an application's admission or production short-code flow until
its protocol, custody and transport composition have been independently reviewed.

## Choice and source review

Live device introduction is a balanced, two-endpoint PAKE. An account-server
password registration protocol would impose a different authority model.
We pin RustCrypto `spake2` 0.4.0, Ed25519Group, asymmetric A/B mode; never use its
symmetric mode. This dependency uses the Python SPAKE2-compatible construction,
not RFC 9382's transcript or ciphersuites. Upstream states it has not had an
independent security audit:
[crate](https://docs.rs/spake2/0.4.0/spake2/),
[source](https://docs.rs/crate/spake2/0.4.0/source/src/lib.rs),
[group/transcript](https://docs.rs/crate/spake2/0.4.0/source/src/ed25519.rs).
[RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html) informed the requirements
for endpoint context and confirmation, rather than a wire-compatibility claim.

Local source review checked message role/length, scalar randomness, group
encoding, password blinding, transcript inputs and the one-use `finish(self)`
API. Foregather additionally requires canonical prime-subgroup, nonidentity
peer points, local expected namespace/purpose, bounded parsing, mandatory
confirmation and an endpoint attempt budget. This is an implementation review
by its author, not an independent cryptographic review. Upstream internal secret
copies are not fully zeroized. Those limitations remain acceptance gates.

## Public session and secret

A public session has exactly `profile`, `namespace`, `purpose`, `locator`,
`issued`, `expires`. Namespace/purpose use the existing namespace grammar.
Locator is a fresh random 16-byte unpadded base64url public identifier,
independent of the password. Timestamps are safe unsigned integer Unix seconds;
0 < expires - issued <= 600; issued <= now < expires. The recipient checks
namespace and purpose against local configuration, never an untrusted link's
suggestion. Use a trusted clock. Session fields are immutable during pairing.

Secret words are generated independently from the exact Spoken Token en-v1
2048-entry wordlist, using successive uniform u16 values modulo 2048. Word count
is configurable 2–16 (default 4), with 11 bits per independently generated word.
The parser normalises ASCII case/whitespace; it rejects unknown words and other
characters. Parsing cannot establish that a human-selected phrase has entropy.
Only CSPRNG generation supports the entropy calculation. A 2-word code offers
22 bits; the default offers 44. Neither this public locator nor a hash of the
secret is an authentication credential or password verifier at the relay.

Since 0.3, character access codes use the separately frozen
[base32-to-en-v1 presentation encoding](character-codes.md). The canonical
word-password and all PAKE transcript/packet bytes remain unchanged.

The public session/link and secret words or characters travel separately. The transport must
never receive the secret in lookup IDs, URLs, body fields or logs. The example
puts only public session JSON in its link fragment. Stronger words do not hide
metadata, protect a compromised browser origin or authenticate a named person.

## Transcript and confirmation

`F(parts)` concatenates `u32_be(length(part)) || part` for each byte string.
All textual fields below are UTF-8, roles are fixed ASCII `inviter`, `recipient`.

```
C = F(profile, namespace, purpose, locator, issued_be64, expires_be64)
idA = F(C, "inviter")
idB = F(C, "recipient")
```

Use the canonical secret's UTF-8 bytes as the SPAKE2 Password and these identities.
Inviter uses start_a, recipient start_b, with fresh CSPRNG ephemeral scalars. Foregather obtains the 64 scalar entropy
bytes fallibly before entering upstream’s infallible RNG interface; entropy
failure returns an error and still spends the attempt.
Each hello is exactly 33 bytes (`A` or `B` plus compressed Edwards point), encoded
as canonical unpadded base64url (44 characters). Consume each Exchange on its
first finish attempt, including failure. Validate the peer's opposite role,
canonical encoding, prime subgroup and nonidentity before calling SPAKE2.finish.
Do not implement an alternative curve or silently change the pinned profile.

Let `K` be the upstream 32-byte finish result, `helloA` and `helloB` the complete
role-prefixed bytes in that order:

```
T = SHA256(F(C, helloA, helloB))
PRK = HKDF-SHA256-Extract(salt=T, IKM=K)
D(label) = HKDF-SHA256-Expand(PRK, F(profile, label), 32)
send_key_A = D("inviter")
send_key_B = D("recipient")
verification_key = D("verification")
confirmation_key_role = D(F("confirmation", role))
proof_role = HMAC-SHA256(confirmation_key_role,
                        F(profile, "confirmation", T, role))
```

Send role-specific proof as canonical base64url (43 characters). Verify the peer's
opposite-role proof in constant-time, then consume PendingConfirmation exactly
once. Failure destroys that state. No channel, verification phrase or plaintext
transfer is exposed before verification. Both endpoints must independently finish
confirmation; receiving a packet is not a substitute. There is no downgrade,
role negotiation or key export API. Any suite change needs another profile.

## Attempts and lifecycle

Keep ONE PairingGate per secret for its complete lifetime. The endpoint budget
is 1 by default and configurable 1–5. Starting an exchange spends an attempt
before message processing; disposal, transport interruption, malformed messages
and wrong confirmation do not refund it. The endpoint does not let a relay
repeatedly reuse an ephemeral exchange or test multiple proofs against one state.
For n independent uniform words and b attempts, a simple online guessing bound
is b / 2048^n per endpoint's code lifetime (excluding endpoint compromise and
other application acceptance paths). An attacker can exhaust the budget: the
code must fail closed. It cannot guarantee availability against a malicious relay.

Do not reconstruct a gate for the same secret, reset budgets on reconnect,
automatically try variants, or reload/recover a plaintext secret from storage.
Dispose the gate after success. After exhaustion/restart/expiry, obtain explicit
user action and generate a fresh secret AND locator. The caller owns lifecycle;
the library cannot enforce policy across independently recreated processes.
Nondefault parallel attempts need application cancellation after the first
success and an independently assessed combined guessing/authority policy.

Native Exchange/PendingConfirmation are moved on use; WASM uses Option::take;
the JS wrapper also disposes consumed states on validation failures. Native
consumers drop state; browser consumers call dispose(), including on cancellation.
Owned Foregather keys use Zeroizing; no deterministic whole-process erasure claim.

## Encrypted bootstrap packets

Each confirmed Channel has separate send/receive keys and ordered counters,
initially 0. Do not clone, serialise, restore or reuse a channel/key. It supports
up to 65,536 messages in each direction and expires at the session deadline.
This is short-lived invitation/bootstrap transport, not a game/media channel.

```
nonce = 0x00000000 || seq_be64
AAD = F(profile, T, sender_role, seq_be64)
ciphertext = AES-256-GCM(direction_key, nonce, plaintext, AAD) || tag_16
packet = { "v": profile, "seq": seq, "ciphertext": base64url(ciphertext) }
```

Send spends seq before encryption, even on failure. Receive accepts only the
next expected seq, increments after successful authentication, and rejects
replays/out-of-order delivery. Invalid packets do not advance receive state.
Application transports may retry identical ciphertext for a lost packet; a
missing sequence must be delivered before a later one. Do not re-encrypt retries
or silently reset counters. Plaintext <= 16 KiB; packet JSON <= 24 KiB; exact
schema, canonical encoding and all expiry checks apply. Channel state changes
reject a supplied clock earlier than their last successful operation.

Verification words use Spoken Token v2 with verification_key, context
`foregather-live/verify/v1`, counter 0, no identity; default three en-v1 words.
They are distinct from the access secret. Comparing them checks this channel;
it does not prove someone's identity. Room admission still requires the
application's parser, authority, revocation checks and explicit consent.

## Transport and evidence

The core never opens sockets or reads a clock. Pass hellos/proofs/packets through
an application-owned transport. Bind the protected handoff to the confirmed
Channel; do not switch to an unauthenticated plaintext broker afterward.
A relay learns locator, traffic timing/size and addresses. It can modify, replay,
retain, reorder, block messages or exhaust budgets. Use trusted origins/TLS,
streaming response bounds, connection limits and an application-owned policy
against storage/connection abuse. Do not depend on relay limits for PAKE guesses.

`npm run demo:live` serves a loopback Node demonstration with 64 volatile slots,
120-second retention, six write-once message slots per session, 24-KiB bodies,
request deadlines, same-origin writes and no request logs. A separate bounded
public-alias directory holds at most 64 public sessions until their original
expiry, assigns collision-checked six-character aliases, and limits lookup to
120 requests per fixed minute. Secret words/codes are not directory fields.
The directory does not create rooms or admit members. It is not a production
relay or a remotely deployed service. `foregather-server` remains a stored-mode
resolver. The browser demo requires explicit comparison/send and only presents
recovered input for review; it never joins a room.

Frozen synthetic vectors cover both hellos, proofs, transcript, direction keys,
verification and a packet. Tests cover native/WASM pairing, independent Node
AES-GCM and Spoken Token derivation, wrong codes/context/roles, malformed points,
expiry, cancelled budgets, ordering, tampering and replay. The separate Python spake2 0.9 implementation reproduces the frozen hellos,
shared-key derivations, confirmations, verification words and bootstrap packet.
This is independent implementation agreement, not a cryptographic proof or audit.
Independent PAKE/composition review, physical phones and real app migrations
remain separate gates.

Reproduce the independent reference check with:

```sh
python3 -m venv target/pake-reference-venv
target/pake-reference-venv/bin/pip install -r scripts/reference-requirements.txt
target/pake-reference-venv/bin/python scripts/check-pake-reference.py
```

These pinned Python packages are test-only; the reference script uses only public
synthetic fixture material. It intentionally injects deterministic scalars in
its isolated test process. The production Rust/WASM APIs expose no such option.
