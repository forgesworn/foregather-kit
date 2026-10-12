# Resolver API v1

The service stores opaque bounded ciphertext. It has no decryption or room
authority. Capability tokens are 32 CSPRNG bytes encoded as canonical base64url.
All management capabilities use `Authorization: Bearer <token>`; never queries.
Responses have `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
There is no default CORS allowance, request logging, URL fetching or telemetry.

| Request | Authority | Result |
| --- | --- | --- |
| `POST /v1/invitations`, JSON `{"expires":<seconds>}` | Operator creation token | 201 `{id,expires,upload_token,delete_token}` |
| `PUT /v1/invitations/<id>`, envelope JSON | Allocation's upload token | 204; first successful upload wins |
| `GET /v1/invitations/<id>` | Public locator | 200 envelope JSON, or 404 |
| `DELETE /v1/invitations/<id>` | Allocation's independent delete token | 204, or 404 |
| `GET /health` | None | `ok` |

Allocation reserves a collision-checked locator and exact expiry. Upload must
finish before `min(expiry, allocation time + 300 seconds)` and match that expiry.
Unknown/unuploaded/deleted/expired records return 404. Invalid upload/delete
authority returns 404. A repeated valid upload within its deadline returns 409.
The resolver validates envelope structure and length; it cannot authenticate
encrypted content. It accepts either wire profile without seeing a namespace.

Creation is intentionally permissioned in v0.1. The operator token is suitable
for a trusted backend or local operator, not embedding in a public app bundle.
An app wishing to permit ordinary users to create invitations needs its own
scoped issuance/proxy policy. Operator rotation changes creation authority;
existing per-allocation upload/delete capabilities remain valid.

SQLite uses WAL and FULL synchronous commits. Immediate allocation transactions
enforce the global slot budget and durable fixed 60-second creation window. Capabilities
are stored only as purpose-separated SHA-256 hashes. Conditional write-once
updates and deletion statements guard other processes sharing the same DB.
Concurrent uploads produce at most one successful write. HTTP timeouts can
leave a commit's outcome unknown; retrying PUT cannot replace the first payload.
Fetch to reconcile it, or delete the allocation using retained authority.

Expiry is enforced on fetch and upload. Old/abandoned rows are reclaimed during
allocation. This is logical expiry, not guaranteed disk erasure. Backups, WAL
pages and a malicious operator may retain ciphertext and metadata. Captured
ciphertext remains decryptable with the key. Removing a resolver entry does
not revoke a room invitation already recovered; the actual admission authority
owns retirement, revocation and durable single-use semantics.

Default limits are documented in README. Public deployment requires a trusted
HTTPS gateway and connection/header limits. The five-second HTTP deadline
includes body extraction; SQLite jobs run on bounded request concurrency with
a two-second busy timeout. Use trusted, monotonic-in-practice wall time: the
durable creation window fails closed if the clock moves behind its start.
GET expiry checks rely on the operator clock.

A separate 32-job semaphore follows actual SQLite job lifetime. Cancelling or
timing out an HTTP request cannot free that database budget while its blocking
job continues, so timed-out traffic cannot grow an unbounded SQLite worker queue.
