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
Counts: 6–32 characters, default six, excluding display separators. From 0.3.1,
display and copy characters in triples: `DFVSJX` becomes `DFV-SJX`, and eight
characters become `ABC-DEF-GH`. Parsing accepts unseparated text or ASCII hyphens
between triples, with a final group of 1–3 characters. ASCII case and surrounding
ASCII whitespace are normalised. Internal spaces, misplaced/repeated hyphens,
non-ASCII separators and I/L/O/U are rejected. There are no ambiguous-character substitutions or alternate-password
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

## What are the guessing odds?

The following are exact chances for **one blind random guess of an independently,
uniformly generated private secret**. Characters use 32 symbols; words use the
2,048-entry en-v1 dictionary. Repeated symbols are allowed. Display hyphens do
not count as symbols and add no entropy.

| Private secret | Random bits | Chance per guess |
| --- | ---: | ---: |
| 6 decimal digits (comparison only; no generator provided) | about 19.93 | 1 in 1,000,000 |
| 2 words | 22 | 1 in 4,194,304 |
| 6 characters, e.g. `DFV-SJX` | 30 | 1 in 1,073,741,824 |
| 3 words | 33 | 1 in 8,589,934,592 |
| 8 characters, e.g. `ABC-DEF-GH` | 40 | 1 in 1,099,511,627,776 |
| 4 words (default) | 44 | 1 in 17,592,186,044,416 |
| 12 characters | 60 | 1 in 1,152,921,504,606,846,976 |
| 6 words | 66 | 1 in 73,786,976,294,838,206,464 |

For N characters, the space is `32^N = 2^(5N)`; for W words it is
`2048^W = 2^(11W)`. Four random words have a per-guess chance 16,384 times
smaller than six random characters. They are not interchangeable simply because
the character encoding happens to produce four canonical words.

With b allowed guesses against the same secret, a simple online bound is
`min(1, b / possibilities)`, under the existing experimental PAKE assumptions.
Add attempts across **every endpoint/gate using that secret**. The demo allows
one attempt per endpoint, so two exposed endpoints can allow two total guesses;
it is not a guarantee of one guess per pairing. Cancellation and failed
confirmation spend attempts. Starting replacement gates for the same secret can
invalidate that budget. The two-minute lifetime does not increase entropy.

These figures do not rate the overall implementation, establish a human-chosen
secret's entropy, cover leaked/reused secrets or prove resistance to an offline
attack. Post-pairing verification words compare the confirmed channel; they are
not additional access passwords or a measured claim about MITM resistance.

A **public room code** has a different purpose. A blind guess of one specific
six-character alias hits with probability `1 / 32^6`; a guess hitting any of M
distinct active aliases has probability `M / 32^6`. At the demo's maximum 64
active aliases, that is 1 in 16,777,216 per uniform lookup. Known or shared public
codes are intentionally usable by anyone. Finding an alias reveals public
session metadata and grants no admission; the independent private secret is
still required. Directory limits and endpoint password budgets are separate.

Use one gate per endpoint for the complete secret lifetime, one attempt by default,
and a fresh secret plus full locator after cancellation, restart or expiry.
Default lifetime remains 120 seconds. Nothing here permits resetting counters,
automatically trying variants or continuing through failed confirmation.

## APIs

Rust: `PairingSecret::generate_characters(count, rng)` returns the secret and a
zeroizing presentation string; `PairingSecret::from_characters(code)` constructs
its canonical password. Continue with the existing `PairingGate` lifecycle.
`RendezvousCode::generate(count, rng)` and `RendezvousCode::parse(code)` operate on
public aliases only. `live::format_character_code(code)` returns a zeroizing
hyphenated presentation suitable for either public or private characters.
Core time and randomness remain caller-supplied.

Browser: `createCharacterOffer({namespace, purpose, characterCount, lifetime, now})`
returns `{session, secretCode}`; `createCharacterPairing({...offer, namespace,
purpose, role, now})` returns the same managed gate as word pairing. Dispose
abandoned states. `createRendezvousCode({length:6})` and
`canonicalRendezvousCode(code)` make no network requests. Existing word APIs
remain available and default to four words.

`formatCharacterCode(code)` returns the human presentation; generated values and
`canonicalRendezvousCode(code)` remain unseparated for compatibility. Both public
lookup parsing and `createCharacterPairing` accept grouped input. Consumers using
0.3.0 must upgrade to accept hyphens; the same canonical code still produces
exactly the original frozen password and PAKE bytes. No new profile is negotiated.

`accessSecretOdds({format:'characters', count:6, attempts:1})` returns
`{bits:30, possibilities:1073741824n, guesses:1}`. It is a pure calculation with
no network or randomness and can run before WASM initialisation. `guesses /
possibilities` represents the exact model's bound; the denominator is a BigInt
to retain precision for long secrets. This helper validates supported generation
formats/counts and endpoint attempt budgets of 1–5, and never estimates entropy
from user-entered text. Convert BigInt to decimal text before JSON serialisation.

## Public directory and interactive example

Run `npm run demo:live` and open `http://127.0.0.1:8789/`.
Select Words or Characters and a count, then Create pairing. On the other client,
enter the public six-character room code and explicitly select Find pairing.
Then enter the separate secret, compare verification words and send a synthetic
invitation for application review. A public link remains available as an alternative.
The demo also accepts the original word-mode public-session fragment links.
Display and copy controls use grouped character codes; both grouped and plain
input work. Guessing odds update with format and count, with a comparison table
and explicit random-generation/attempt assumptions.

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
