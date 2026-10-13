# Foregather adoption work

Requested scope: implement all seven additions from the feature assessment,
then exercise the reusable pairing flow through Joystick. Preserve stored v1,
spoken v2 and live v1 vectors. Applications continue to own validation,
identity, admission, membership and continuing traffic encryption.

| Requirement | Implementation | Required evidence |
| --- | --- | --- |
| Deployable live relay and optional client transport | Implemented; real HTTP, restart, quota/byte-budget, role, expiry, concurrency tests pass; systemd/container layouts present | Container runtime CI and public operator deployment remain separate |
| Higher-level pairing API | Implemented; progress, cancellation, expiry, verification, fresh-code lifecycle and hostile transport checks pass | Installed strict TypeScript consumer passes |
| QR and public handoff helpers | Implemented; shared native/browser parser, independent vectors, painted QR and simulated-camera cancellation/late-permission cleanup pass | Physical camera/mobile-browser acceptance remains open |
| Swift/Kotlin bindings | Implemented; installed desktop consumers and actual archived packages pass on iOS 18.3 Simulator and Android 15/API 35 ARM64 emulator; Apple XCFramework and four-ABI Android AAR built | Physical phones and hosted native jobs remain separate |
| Encrypted delivery acknowledgement | Implemented; shared Rust framing, independent vectors, tamper/loss/retry and real relay receipt pass | Receipt means decryption, never review/admission |
| Scoped creation grants | Implemented; resource/use/lifetime/expiry/revocation and restart/concurrent last-use checks pass | Applications retain user/tenant issuance policy |
| Stored-only browser build | Implemented; isolated tarball, strict consumer, frozen vectors and browser-only loading pass; 460,134 bytes / 176,379 gzip versus 683,899 / 246,415 full | 28.4 percent smaller gzip; no live exports |
| Joystick integration | Implemented optional SDK transfer/review adapters; actual two-browser Rust-relay/broker/game-input journey passes; existing SDK/broker/pad regressions pass | Production UI migration/traffic encryption and physical acceptance remain app-owned |


Local automated checks, hosted CI, publication, physical devices and independent
security review are separate gates. A deployable experimental relay does not
constitute a security audit or production security acceptance. No independent
review or physical-phone acceptance has been obtained for this work yet.

## Local verification for 0.4.0

`npm run check`: 46 Rust and 46 Node tests, three Rustdoc examples, native/WASM
interop, Chromium codec/QR/camera cleanup, stored/live demos and real resolver
restart/receipt journeys passed. `node scripts/check-package.mjs` installed the
actual 0.4 tarball and compiled all entries under strict TypeScript NodeNext.
The independent Python SPAKE2 reference, cargo audit, cargo-deny licences/sources
and npm audit passed. Existing stored, character and PAKE vector files are unchanged.

Native package consumers were executed against the installed Apple Swift package
and the Android AAR's actual classes.jar. Android ELF architecture checks cover
ARM64, ARMv7, x86_64 and x86. Archives remain under target/native-packages:

- foregather-apple-0.4.0.zip: e0edb57a8d05c2a1fd2db07328651d5eb1f232ca104848432e955f3630aedfd8
- foregather-android-0.4.0.zip: 6516c343e740e9cb0b7726a88e1843dac37ea89be1d47093c75a1de76686c53b

These are local artifact hashes, not registry/publication or physical acceptance.
`node scripts/check-native-mobile.mjs ios` and `android` unpacked these archives
and executed the shared consumers in native smoke apps. Both passed stored
recovery, caller-validation callbacks, word/character pairing, public links,
encrypted transfer/receipt, consumed-state and replay rejection. Reports and
screenshots are retained in `target/native-mobile-evidence/{ios,android}.{json,png}`.
Builders/test fixtures remove owned temporary staging, databases and processes.
Existing worktree targets are reused. Owned simulators and Android AVDs were
stopped and deleted; the pre-existing KithMoot emulator was left untouched.
