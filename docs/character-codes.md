# Character access secrets and public room codes

Added in experimental 0.3. MIT. Copyright (c) 2026 TheCryptoDonkey.

| Value | Purpose | Shared with a directory? |
| --- | --- | --- |
| Full 128-bit locator | Address the immutable PAKE session | Yes |
| Public room/rendezvous code | Human-readable alias for that public session | Yes |
| Secret words or characters | Authenticate the PAKE exchange | Never |
| Post-pairing verification words | Compare the confirmed channel | No; compare directly |

The library initiates no lookup, grants no membership and assumes no hosted
service. Applications retain admission, identity and explicit consent.

## Secret presentation and frozen encoding

Encoding identifier: `foregather-access/base32-en-v1/1`.
Alphabet, in value order 0–31: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
Counts: 6–32 characters, default six. Only ASCII case and surrounding ASCII
whitespace are normalised; internal spaces, hyphens, non-ASCII and I/L/O/U are
rejected. There are no ambiguous-character substitutions or alternate-password
attempts. CSPRNG generation takes one fresh byte per character and uses its low
five bits; all 32 symbols have equal probability.

The existing PAKE profile remains `foregather-live/spake2-ed25519/1`. Its input
password is still canonical lowercase en-v1 words. To encode N characters:

1. Emit the frozen en-v1 word at index `1024 + N` as a presentation/length tag.
2. Concatenate each character's five-bit value, most-significant bit first.
3. Divide this bitstring into 11-bit groups; pad the last group on the right
   with zero bits. Emit each corresponding en-v1 word after the tag, separated
   by one ASCII space.

The length tag prevents `000000` and `0000000` (or a prefix extended with zero)
from becoming the same password. The result has at most 16 words. It deliberately
interoperates with the original word API when explicitly supplied those exact
canonical words. PAKE hellos, context, confirmation, keys, verification derivation
and packets are unchanged. No fallback or profile negotiation occurs.

Frozen synthetic vectors in `crates/foregather-kit/vectors/access-base32-en-v1.json`
include `ABC234` -> `jewel ether recipe fruit`. These are public fixtures, never
production passwords. Rust, WASM, Node bit encoding and the pinned Python
reference check agreement. Original full PAKE vectors continue to pass.

Six uniform characters provide 30 bits, eight provide 40, and twelve provide 60.
The fixed tag and padding add no entropy. Although six characters encode to four
words, those words still represent only 30 bits; four independently random words
provide 44. A human-chosen six-digit value does not gain 30 bits through encoding.
The API supplies no digits-only generator. Under the documented PAKE assumptions,
b allowed online attempts have the same simple bound `b / 32^N` per code lifetime.
This is not a cryptographic proof or independent security acceptance.

Use one gate per endpoint for the complete secret lifetime, one attempt by default,
and a fresh secret plus full locator after cancellation, restart or expiry.
Default lifetime remains 120 seconds. Nothing here permits resetting counters,
automatically trying variants or continuing through failed confirmation.

## APIs

Rust: `PairingSecret::generate_characters(count, rng)` returns the secret and a
zeroizing presentation string; `PairingSecret::from_characters(code)` constructs
its canonical password. Continue with the existing `PairingGate` lifecycle.
`RendezvousCode::generate(count, rng)` and `RendezvousCode::parse(code)` operate on
public aliases only. Core time and randomness remain caller-supplied.

Browser: `createCharacterOffer({namespace, purpose, characterCount, lifetime, now})`
returns `{session, secretCode}`; `createCharacterPairing({...offer, namespace,
purpose, role, now})` returns the same managed gate as word pairing. Dispose
abandoned states. `createRendezvousCode({length:6})` and
`canonicalRendezvousCode(code)` make no network requests. Existing word APIs
remain available and default to four words.

## Public directory and interactive example

Run `npm run demo:live` and open `http://127.0.0.1:8789/`.
Select Words or Characters and a count, then Create pairing. On the other client,
enter the public six-character room code and explicitly select Find pairing.
Then enter the separate secret, compare verification words and send a synthetic
invitation for application review. A public link remains available as an alternative.
The demo also accepts the original word-mode public-session fragment links.

The loopback demo's `POST /rooms` accepts only `{session, secretFormat}`, with
exact public session fields and the demo's locally fixed namespace/purpose. It
assigns an independent random six-character alias, checks collisions before
committing, and stores at most 64 mappings. `GET /rooms/<code>` returns only that
public object. Aliases expire at the original session deadline, never refreshed
by lookup; requests are bounded to 1 KiB and lookup to 120 per fixed minute.
Same-origin creation and host checks, request deadlines and existing relay
packet limits apply. Codes and request bodies are not logged. Restart drops all
mappings. Duplicate session advertisements do not extend the original expiry.

These are public discovery hints, not admission capabilities. Aliases can be
enumerated; the directory provides no privacy guarantee for session metadata.
A malicious directory can substitute, withhold or correlate metadata and deny
pairing. PAKE confirmation and local expected context still protect the handoff
under the existing experimental assumptions. Never send or derive access secrets
through public lookup, and never use a public alias itself as the private code.

The directory is example transport, not a production relay or an endpoint in
`foregather-server`. Real room admission, device enrolment and continuing traffic
remain application-owned. Independent review, production transport qualification
and physical device tests remain required before adoption.
