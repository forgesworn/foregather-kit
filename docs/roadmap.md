# Next protocol and adoption work

Stored invitations, spoken v2 words and experimental live bootstrap are locally
implemented with native/WASM and independent implementation tests. Stored v1
wire compatibility remains unchanged. Joystick's public pilot is integrated;
other existing apps retain their own planned adoption work.

1. Independently review v1's protocol, implementation and resolver configuration.
   Qualify actual mobile browsers, package loading and gateway deployments.
2. Integrate KithMoot's explicit review/upload/delete flow using its current Fold
   parser and authority model. Deployment and physical guest acceptance remain
   separate gates. Keep full-link fallback. Resolving must create no membership.
3. Independently review the implemented experimental live profile, including
   upstream SPAKE2, endpoint lifecycle budgets, memory custody and actual relay
   composition. The durable Rust relay and its HTTP adapter are implemented;
   real public gateway/load/phone qualification remains separate.
4. Qualify Joystick's deployed live-pairing pilot, with separate host authority
   and controller admission. Continuing session traffic also needs its own authenticated
   encryption; protecting bootstrap alone does not make the broker private.
5. Adopt the implemented Spoken Token v2 words profile where useful; keep
   application replay/attempt policy and named identity checks separate.
   Presentation does not increase entropy.
6. Qualify the implemented Swift/Kotlin packages on physical phones and add a
   ForgeSworn Link adapter. Preserve Link's frozen
   rendezvous derivations and Fold/Covey's separate membership models.

Covey's existing two-hop word invitation remains entropy-limited if an adversary
retains both ciphertexts: recovering the reference private key also enables
opening the retained gift wrap. Its comments must be corrected in its owning
repository before using that design as a security precedent. Do not silently
change its frozen v1 derivation or claim deletion prevents offline recovery.


The seven adoption additions are implemented in 0.4; see adoption-status.md for
current evidence. Joystick's optional SDK transfer/review adapters and a real
browser/broker journey and public pad/game pairing screens are present. Physical
acceptance and continuing-traffic encryption remain separate app-owned work.
