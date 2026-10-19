# Bounded message exchange v1

Profile: `foregather-exchange/1`. Added in 0.6.0. It carries a short,
bounded conversation in both directions over one confirmed live channel, for
example connection setup that is too large for the transfer reply. It changes no
PAKE, cipher, live packet, stored, Spoken Token, transfer-v1 or reply bytes, and
the deployed relay needs no change. It is not continuing game, media or file
transport.

## Opt-in and binding

Both endpoints opt in, after both people have accepted the verification words.
The profile is never negotiated, inferred or mixed with transfer v1: a channel
carries either one transfer (with its optional reply) or one exchange. The
exchange starts on a channel that has sealed and opened nothing, so its first
message in each direction is at packet sequence zero.

A message plaintext is

```text
46 47 02 01 || index_u8 || payload
```

with 0 to 16,379 payload bytes, so the frame fits the live channel's
16,384-byte plaintext limit. The index is the live channel sequence of the
packet that carries it, in that sender's direction. Each endpoint sends at most
32 messages, indexes 0 to 31, matching the relay's `packet-0` to `packet-31`
slots for its role.

Each message is encrypted with the sender's confirmed directional key at its own
sequence, as the [live protocol](live-protocol.md) describes. The receiver
authenticates the next packet, then checks the type, version and that the index
equals the sequence it just authenticated. The AEAD already binds the
transcript, sender role and sequence, so a relay cannot reorder, replay, move or
cross-deliver a message, or carry one into another session. The type and
version bytes make a transfer-v1 frame (`46 47 01 ..`) or other plaintext fail
as an exchange message, and the index check catches an endpoint whose counter
disagrees with its channel. An authenticated packet with the wrong framing is a
peer protocol violation and ends the exchange. In the Rust core a packet that
fails authentication changes no state; the browser flow ends on any failure.

Each direction is strictly ordered. The two directions are independent: the
application protocol decides which message answers which. Payload bytes are
uninterpreted and belong to the application's validator.

## Lifetime, retries and closing

The exchange ends at the session deadline (at most 600 seconds after issue),
when either endpoint closes it, or on any failure. After the deadline neither
endpoint can send or read a message. Anything that must outlive the deadline
belongs to the application's own channel, set up during the exchange.

Retries resend the identical encrypted packet to the same slot; an endpoint
never re-encrypts a message, reuses a sequence or restores a counter. There is
no close message: an application that needs one sends its own. Closing is
local, and the relay can withhold any message, so a missing message must never
be read as anything. Delete the relay session when the exchange is no longer
needed.

## Limits and storage

| Bound | Value |
| --- | --- |
| Messages per endpoint | 32 (indexes 0 to 31) |
| Payload per message | 16,379 bytes |
| Serialised packet | 21,932 bytes at most, under the relay's 24 KiB |
| Session lifetime | the live session's, at most 600 seconds |

A full session holds up to 64 packets on the relay, about 1.34 MiB at the
largest size, inside the relay's shared `FOREGATHER_MAX_RECORDS * 32 KiB` byte budget.
Applications should keep messages as small as their purpose allows.

## APIs

Rust (`experimental-live`): `exchange::ExchangeChannel::new(channel)` takes a
fresh confirmed `live::Channel` and refuses one that has carried a packet.
`seal(payload, now)` returns the index (the relay slot) and the packet;
`open(packet, now)` returns the next message. `sent()` and `received()` count
messages. `encode_message` and `decode_message` expose the framing alone.

Browser: after `verify({matches:true})`, either role calls `flow.exchange()`
instead of `send`/`receive`. It returns `{sent, received, send, receive,
close}`. One send and one receive may be in flight together; a second
concurrent call of the same kind, a 33rd message or an oversized payload is
refused without ending the exchange. The flow reports `exchanging`, then
`closed` after `close()`. Failure, cancellation and expiry end the exchange as
`failed`, `cancelled` or `expired`, and pending calls reject with a
`ForegatherTransportError` of that kind (`closed` after `close()`).

Native Swift/Kotlin bindings do not expose the exchange yet.

## What it proves

A message proves that the endpoint that completed this PAKE, whose verification
words the people compared, sent those bytes in that order before the deadline.
It does not prove delivery, identity or consent, and it exports no key: an
application that needs a key for later traffic sends a fresh random one in a
message. The relay learns message count, sizes and timing per direction.

## Vectors

`crates/foregather-kit/vectors/exchange-v1.json` holds independent Python frame
vectors and five packets sealed over the frozen `live-spake2-ed25519-v1` channel
keys. `scripts/check-pake-reference.py` recomputes the frames and packets from
keys it derives with its own SPAKE2 implementation; the Rust core reproduces the
packets from the same fixture channel, and the WASM framing matches the frame
vectors. This is implementation agreement, not an independent security review.
