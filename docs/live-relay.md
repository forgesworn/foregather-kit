# Experimental self-hosted live relay

The Rust resolver provides an optional durable live relay. Enable it explicitly
with `FOREGATHER_ENABLE_LIVE=1`; the default router still exposes stored mode.
This is deployable experimental infrastructure, not independent PAKE/security
acceptance. Operate it behind an application-owned HTTPS gateway.

| Endpoint | Authority | Result |
| --- | --- | --- |
| `POST /v1/live-sessions` with `{session,secret_format}` | Operator or live creation grant | 201 `{room,room_code,inviter_token,delete_token}` |
| `GET /v1/live-sessions/rooms/<code>` | Public six-character alias | Public `{session,secret_format}` |
| `POST /v1/live-sessions/<locator>/claim` | Recipient's fresh 32-byte claim capability in Authorization | 204; one recipient capability per session |
| `PUT /v1/live-sessions/<locator>/messages/<role>/<kind>` | That role's session capability | 204; write-once, identical-byte retry accepted |
| `GET /v1/live-sessions/<locator>/messages/<role>/<kind>` | Either endpoint's session capability | Message or indistinguishable 404 |
| `DELETE /v1/live-sessions/<locator>` | Independent deletion capability | 204; removes messages and alias |

Capabilities use canonical unpadded base64url and `Authorization: Bearer`.
They are purpose-separated SHA-256 hashes in SQLite. No capability belongs in a
query, path, request log or public pairing link. Public aliases and locators
grant no decryption, identity or room membership.

Kinds are `hello`, `proof` and `packet-0` through `packet-31`. Each endpoint has
bounded write-once slots; the service accepts only the fixed public hello/proof
sizes and bounded live packet schema. A different replacement returns 409.
Retry the identical serialized body after an uncertain write; never re-encrypt
or reset a channel counter. The claim operation similarly accepts an identical
claim token on retry and cannot replace it with another recipient's token.

The optional `createLiveRelayClient({apiUrl:'https://example/v1/'})` supplies
explicit allocation, lookup, claim, deletion and role-specific send/receive
adapters. Its requests omit ambient credentials, reject redirects, bound streamed
responses and accept cancellation. Pairing flows bound the transport's polling
to their original session deadline. Constructing an adapter performs no requests.
Only public metadata enters the directory; never pass an offer's secret fields.

Public lookup and message polling retry a transient network error, request
timeout, or HTTP 408, 429, 502, 503 or 504 at most twice, after 100 ms and 200 ms.
Each request retains its ten-second timeout. A 404 message response is ordinary
polling and waits 200 ms; a successful read resets the transient failure streak.
Reads retain the same locator, role, capability and message sequence. They never
create a new gate, reseal a packet or extend the flow's original expiry.
Cancellation, expiry and transport disposal interrupt requests and retry waits.
Authentication errors, malformed messages and other HTTP errors fail immediately;
exhausting the retry budget leaves the pairing flow terminal.

Sessions, messages, aliases and quotas survive restart. Session expiry is fixed
at allocation and at most 600 seconds; reconnect, claims and writes cannot extend
it. Restarting transport does not authorise restoring endpoint secrets, gates
or counters. After endpoint failure/restart, create a fresh locator and secret.

Stored and live allocations share the existing durable creation window and
record capacity. Each live session holds at most 68 messages (two public messages
and 32 packets per endpoint), each at most 24 KiB. Expired rows are reclaimed
during allocation. Active stored/live payloads also share an atomic byte budget
of `FOREGATHER_MAX_RECORDS * 32 KiB` (32 MiB at the default), preventing large
live sessions from multiplying the stored resolver's payload budget. SQLite
metadata/WAL/backups are additional storage and logical expiry is not erasure.
Directory lookup has a durable global fixed-minute budget of
`max(120, 2 * FOREGATHER_CREATES_PER_MINUTE)`; unsuccessful valid-code lookups
also spend it. The original five-second HTTP deadline, body/concurrency limits
and database-job semaphore apply. Stop older resolver versions before upgrading
processes sharing a database so they all enforce the combined limits.

The relay can withhold, reorder or retain messages and exhaust pairing attempts.
Its quotas do not provide the PAKE guessing boundary. Endpoint gates, explicit
verification, app validators and consent remain necessary. Logical expiry or
deletion is not guaranteed erasure or revocation of a recovered invitation.

Run `npm run demo:pairing` after building. It starts a private temporary Rust
resolver and a loopback demonstration gateway; creation authority remains in
that gateway. Public deployment needs your own user/issuance policy rather than
publishing the demonstration gateway. `npm run test:relay` and
`npm run test:pairing` exercise a real service, restart and two Chromium clients.
