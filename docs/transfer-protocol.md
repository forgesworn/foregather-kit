# Invitation transfer and decrypted receipt v1

Inner profile: `foregather-transfer/1`. It uses the existing confirmed live v1
channel without changing any PAKE, cipher, stored or Spoken Token bytes. Both
endpoints opt into this application framing. It is not negotiated or silently
downgraded to unframed plaintext. The receiving application's validator and
admission authority remain separate.

An invitation plaintext is `46 47 01 01 || transfer_id_16 || invitation_bytes`.
The identifier contains 16 independent CSPRNG bytes. Invitation bytes are
uninterpreted, with a maximum of 16,364 bytes so the entire frame fits the live
channel's 16,384-byte limit.

After decrypting and parsing the invitation frame, the recipient returns
`46 47 01 02 || transfer_id_16 || SHA256(invitation_bytes)`. This is exactly 52
bytes, encrypted with the recipient's confirmed directional channel key. The
inviter authenticates/decrypts it and compares the full expected receipt in
constant time. Wrong type/version, identifier, digest, length, sender/channel,
packet sequence or expired channel cannot establish delivery.

This receipt means the recipient endpoint decrypted those exact bytes. It
does not establish application validity, human review, identity or membership.
Applications can choose when to show their separate review/admission UI.

The browser flow requires explicit verification-word acceptance on both
endpoints before transferring the invitation. It sends one invitation and one
receipt using packet sequence zero in the respective directions. Retries
retransmit identical encrypted bytes; they never re-encrypt, reconstruct a gate,
reset attempt budgets or restore counters. A failed, cancelled or expired flow
is terminal. Starting again requires a fresh offer, locator and secret.

The native core owns framing and receipt validation for browser and native
bindings. Independent Python byte/SHA-256 vectors are frozen in
`crates/foregather-kit/vectors/transfer-v1.json`. Their agreement and automated
composition checks are not an independent security review.

## Optional reply v1

Profile: `foregather-transfer-reply/1`. After a transfer-v1 receipt, the
recipient may return one bounded application message on the same confirmed
channel, for example to say that a delivered link was used. Both endpoints opt
in (`keepOpen` in the browser flow); a v1 endpoint never reads or sends it, and
nothing in transfer v1 changes.

A reply plaintext is
`46 47 01 03 || transfer_id_16 || SHA256(invitation_bytes) || reply_bytes`,
with at most 1,024 reply bytes (52 to 1,076 bytes in all). It is encrypted with
the recipient's confirmed directional channel key at packet sequence one, after
the receipt at sequence zero, and must arrive before the session deadline. The
inviter authenticates/decrypts it, compares the 52-byte prefix with the
expected type, identifier and invitation digest in constant time, and returns
the reply bytes to the application. A receipt is never a reply, and a reply is
bound to its own invitation.

A reply proves only that the recipient endpoint that decrypted the invitation
sent those bytes before the deadline. The relay can withhold it, so a missing
reply must not be read as anything; applications keep their fallback. Reply
bytes are uninterpreted and belong to the application's validator.

Retries retransmit identical encrypted bytes, as for the receipt. A kept channel
closes after the reply or at the deadline, whichever comes first; expiry or
cancellation then rejects a pending wait with `expired` or `cancelled` while the
delivered transfer keeps its outcome. Independent Python byte/SHA-256 vectors
over the transfer-v1 invitation vectors are frozen in
`crates/foregather-kit/vectors/transfer-reply-v1.json`. The browser flow and the
Rust core implement it; native Swift/Kotlin bindings do not expose it yet.
