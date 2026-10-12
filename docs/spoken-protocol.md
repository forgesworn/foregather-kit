# Spoken Token compatibility

`spoken` implements the words portion of Spoken Token v2: SPOKEN-DERIVE,
en-v1 SPOKEN-ENCODE and the v2 directional pair domain. It does not implement
PIN/hex presentation, time-window searching, candidate verification or replay
storage. Choose the exact counter and identity; applications own verification
windows, rate limits, consent and consumed-counter tracking.

The canonical wordlist is copied byte-for-byte as newline-separated entries
(no trailing newline) from `forgesworn/spoken-token` commit
`fbe6154cc74cf0ebf41f7edc03a9a584f3136e23`, `src/wordlist.ts`. MIT, Copyright
(c) 2026 TheCryptoDonkey. SHA256:
`0334930ebdfbc76e81ec914515d7567ca85738a6bf3069249d97df951d44661c`.
See the [source protocol](https://github.com/forgesworn/spoken-token/blob/fbe6154cc74cf0ebf41f7edc03a9a584f3136e23/PROTOCOL.md).

Secret inputs: 16–1024 bytes. Context/identity/namespace/roles: nonblank UTF-8,
no NUL, at most 1024 bytes each. Counter: exact unsigned 32-bit integer.
The limits are Foregather's resource bounds, not changes to accepted wire bytes.

```
without identity: HMAC-SHA256(secret, UTF8(context) || counter_be32)
with identity: HMAC-SHA256(secret, UTF8(context) || 0 || UTF8(identity) || counter_be32)
directional: HMAC-SHA256(secret, "pair" || 0 || UTF8(namespace) || 0 || UTF8(role) || counter_be32)
words[i] = en-v1[uint16_be(digest[2*i:2*i+2]) % 2048]
```

Word count is configurable 1–16. Each word extracts 11 bits; presentation adds
no entropy to the underlying secret. Shared/group secrets prove knowledge of
that secret, not a particular member's identity. A directional phrase uses a
separate domain; do not compare it against an identity-bound token.

Rust exposes derive_bytes, encode_words, derive_words and directional_words.
Browser exposes deriveSpokenWords and deriveDirectionalWords. Native vectors
check frozen source word/directional outputs. Node independently verifies HMAC
bytes and encoding, including Unicode identities. The source protocol's raw-hex
vector #1 has 63 hex characters; Foregather tests the full 32 bytes against Node
and preserves the source's correct word outputs instead of copying that typo.
