# Next protocol and adoption work

The first deliverable is a standalone stored-invitation core plus WASM and
self-hosted storage. Its wire compatibility is tested without changing apps.

1. Independently review v1's protocol, implementation and resolver configuration.
   Qualify actual mobile browsers, package loading and gateway deployments.
2. Integrate KithMoot's explicit review/upload/delete flow using its current Fold
   parser and authority model. Deployment and physical guest acceptance remain
   separate gates. Keep full-link fallback. Resolving must create no membership.
3. Specify live pairing with a reviewed PAKE implementation, separate public
   rendezvous locator and secret, full transcript binding and key confirmation.
   Endpoint-owned attempt budgets must survive transport manipulation. Do not
   use a hash of a short password as a public verifier/lookup identifier.
4. Adopt live pairing in Joystick with separate host authority and controller
   admission. Continuing session traffic also needs its own authenticated
   encryption; protecting bootstrap alone does not make the broker private.
5. Add versioned spoken encoding/verification with Spoken Token compatibility
   vectors. Presentation does not increase entropy. Keep verification phrases,
   public locators and access secrets distinct types.
6. Qualify native mobile FFI and a ForgeSworn Link adapter. Preserve Link's frozen
   rendezvous derivations and Fold/Covey's separate membership models.

Covey's existing two-hop word invitation remains entropy-limited if an adversary
retains both ciphertexts: recovering the reference private key also enables
opening the retained gift wrap. Its comments must be corrected in its owning
repository before using that design as a security precedent. Do not silently
change its frozen v1 derivation or claim deletion prevents offline recovery.
