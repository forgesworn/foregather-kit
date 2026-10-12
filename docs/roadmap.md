# Next protocol and adoption work

Stored invitations, spoken v2 words and experimental live bootstrap are locally
implemented with native/WASM and independent implementation tests. Stored v1
wire compatibility remains unchanged; the existing apps are not yet migrated.

1. Independently review v1's protocol, implementation and resolver configuration.
   Qualify actual mobile browsers, package loading and gateway deployments.
2. Integrate KithMoot's explicit review/upload/delete flow using its current Fold
   parser and authority model. Deployment and physical guest acceptance remain
   separate gates. Keep full-link fallback. Resolving must create no membership.
3. Independently review the implemented experimental live profile, including
   upstream SPAKE2, endpoint lifecycle budgets, memory custody and actual relay
   composition. The bundled relay remains a loopback demonstration.
4. Adopt live pairing in Joystick with separate host authority and controller
   admission. Continuing session traffic also needs its own authenticated
   encryption; protecting bootstrap alone does not make the broker private.
5. Adopt the implemented Spoken Token v2 words profile where useful; keep
   application replay/attempt policy and named identity checks separate.
   Presentation does not increase entropy.
6. Qualify native mobile FFI and a ForgeSworn Link adapter. Preserve Link's frozen
   rendezvous derivations and Fold/Covey's separate membership models.

Covey's existing two-hop word invitation remains entropy-limited if an adversary
retains both ciphertexts: recovering the reference private key also enables
opening the retained gift wrap. Its comments must be corrected in its owning
repository before using that design as a security precedent. Do not silently
change its frozen v1 derivation or claim deletion prevents offline recovery.
