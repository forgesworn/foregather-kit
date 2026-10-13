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
