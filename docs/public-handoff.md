# Public pairing links and QR

Presentation profile `foregather-public-handoff/1` encodes exact UTF-8 JSON
`{"v":"foregather-public-handoff/1","room":{"session":<live-v1-session>,"secret_format":"words"}}`
as canonical unpadded base64url in the fragment of an application-selected base
URL. `secret_format` may also be `characters`. No access secret, bearer invitation
key, management capability or verification phrase is a field of this schema.
Unknown fields, wrong version/context, malformed encoding and expired sessions
are rejected. Frozen independent JSON/base64 vectors cover both presentations.

Creators and parsers require the expected namespace/purpose, trusted time and
canonical HTTPS base URL from local application configuration. Only explicitly
enabled loopback HTTP is accepted for development. Parsing permits the exact
configured origin/path; it never fetches the link or infers identity/admission.
Links are at most 2,048 bytes and fragments at most 1,400 characters.

Use `createPairingLink` and `parsePairingLink` from the full browser entry.
Their parser/encoder and Swift/Kotlin counterparts use the same Rust core.
The optional `@forgesworn/foregather-kit/qr` entry adds local QR generation,
RGBA image decoding and an explicit camera scanner. It returns a public link,
SVG and pixels; neither rendering nor scanning sends data to an external service.
The SVG has a four-module quiet zone and normal black/white contrast.

Call `scanPairingCamera` only after an explicit Scan action. Browser camera
permission remains necessary. It stops its media tracks on successful scan,
cancellation, timeout or failure. Application callers can instead supply their
own image capture and call `decodePairingQr`. All decoded links still pass the
same local context/origin/expiry checks. Keep code entry as a camera-denial
fallback, and communicate the private secret separately.

Local Chromium checks paint the SVG, decode its pixels and exercise scanner
cleanup with a simulated canvas media stream. This is not physical-camera or
Safari/Android acceptance. The optional QR entry uses bundled Project Nayuki
and jsQR code with preserved licence texts; it performs no remote runtime fetches.
