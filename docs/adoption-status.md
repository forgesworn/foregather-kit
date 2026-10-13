# Foregather adoption work

Requested scope: implement all seven additions from the feature assessment,
then exercise the reusable pairing flow through Joystick. Preserve stored v1,
spoken v2 and live v1 vectors. Applications continue to own validation,
identity, admission, membership and continuing traffic encryption.

| Requirement | Implementation | Required evidence |
| --- | --- | --- |
| Deployable live relay and optional client transport | Implemented; real HTTP, restart, quota/byte-budget, role, expiry, concurrency tests pass; systemd/container layouts and hosted container runtime pass; Joystick pilot gateway deployed | Sustained public load and independent qualification remain open |
| Higher-level pairing API | Implemented; progress, cancellation, expiry, verification, fresh-code lifecycle and hostile transport checks pass | Installed strict TypeScript consumer passes |
| QR and public handoff helpers | Implemented; shared native/browser parser, independent vectors, painted QR and simulated-camera cancellation/late-permission cleanup pass | Physical camera/mobile-browser acceptance remains open |
| Swift/Kotlin bindings | Implemented; hosted Linux/macOS foreign consumers and archived packages on iOS 18.3 Simulator and Android 15/API 35 ARM64 emulator pass; Apple XCFramework and four-ABI Android AAR built | Physical phones remain separate |
| Encrypted delivery acknowledgement | Implemented; shared Rust framing, independent vectors, tamper/loss/retry and real relay receipt pass | Receipt means decryption, never review/admission |
| Scoped creation grants | Implemented; resource/use/lifetime/expiry/revocation and restart/concurrent last-use checks pass | Applications retain user/tenant issuance policy |
| Stored-only browser build | Implemented; isolated tarball, strict consumer, frozen vectors and browser-only loading pass; 460,134 bytes / 176,379 gzip versus 683,899 / 246,415 full | 28.4 percent smaller gzip; no live exports |
| Joystick integration | SDK adapters and public Tank/Quiz/Tilt/Pad pairing UI deployed; explicit review, actual broker input, reconnect and refresh journeys pass | Continuing traffic encryption and physical acceptance remain app-owned |


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

## Distribution and hosted evidence

[Foregather #17](https://github.com/forgesworn/foregather-kit/pull/17) and
[Joystick #3](https://github.com/forgesworn/joystick/pull/3) merge the implementation.
[Hosted functional/container/package checks](https://github.com/forgesworn/foregather-kit/actions/runs/38375938895),
[Linux/macOS foreign consumers](https://github.com/forgesworn/foregather-kit/actions/runs/38375939299)
and [Joystick CI](https://github.com/forgesworn/joystick/actions/runs/38375798123)
passed against their implementation heads. Main and public asset verification
are recorded in the release receipt.

The [0.4.0 release](https://github.com/forgesworn/foregather-kit/releases/tag/v0.4.0)
is the distribution destination for the browser tarball, Rust crate, resolver
binaries, native archives, deployment layouts, licences, checksums and receipts.
The GitHub tarball is installable without npm publisher authentication; registry
availability is stated separately in the release notes. The browser 0.4.0 npm
publication has been verified against the exact released tarball. Joystick
operates an explicit experimental gateway at
`https://controller.pallasite.app/foregather/`; installing Foregather selects and
deploys no relay automatically. Browser 0.4.1 adds transport read recovery while
Rust/native/relay 0.4.0 and frozen profiles remain unchanged. The
[0.4.1 release receipt](https://github.com/forgesworn/foregather-kit/releases/download/v0.4.1/release-verification.json)
records merged-head CI, anonymous npm readback, matching archive bytes and an
isolated installation of the downloaded registry package.
