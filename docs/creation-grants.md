# Scoped creation grants

An operator can delegate a bounded amount of creation authority without handing
ordinary clients the operator-wide token. The embedding application owns the
decision to issue a grant; Foregather introduces no identity, login or account.

`POST /v1/creation-grants` requires operator Authorization and exact JSON:

```json
{"resource":"live","expires":1800000300,"max_uses":1,"max_invitation_lifetime":120}
```

The response is `{id,token,resource,expires,remaining,max_invitation_lifetime}`.
Use `token` as creation Authorization for stored or live allocation as selected
by the grant's resource. The public management `id` is independent of the token.
`DELETE /v1/creation-grants/<id>` requires the current operator token and revokes
future creation under that grant. Delegates cannot issue or revoke grants.

Resources are `stored` or `live`. Grant expiry is at most 24 hours after issuance;
uses are 1–1,000. Maximum invitation lifetime is 1–604,800 seconds for stored
mode and 1–600 for live mode. Remaining uses are spent atomically with successful
allocation under an immediate SQLite transaction. An invalid, over-capacity or
rate-limited allocation rolls back the spend. Concurrent processes cannot spend
the same last use, and restart does not restore it.

Grant count and issuance rate are bounded by the configured record and creation
limits. Expired grants are reclaimed during issuance. Scopes limit resource,
time and amount, not a named identity or encrypted application namespace.
The application must enforce any tenant/user/namespace policy at its issuer.
Stored namespaces remain authenticated inside client ciphertext and are opaque
to the resolver. Revocation does not retire already allocated upload/delete/live
capabilities or revoke a recovered application invitation.

The explicit `createCreationGrantClient` is exported by both the full and
stored-only browser entries. Keep operator authority in your backend or private
custody boundary. Public client assets receive only their scoped grant, never
the operator token. Disable Authorization/body logging at your gateway too.
