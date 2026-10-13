# Swift and Kotlin packages

`foregather-ffi` generates Swift/Kotlin APIs from the same Rust core with Mozilla
UniFFI 0.32.2. Its default Rust feature set contains stored/spoken operations;
native builds explicitly opt into `experimental-live`. Every cryptographic
operation requires caller-supplied trusted Unix seconds; generation uses the
platform CSPRNG. No native operation opens a socket, fetches a URL or grants
application admission.

The bindings expose stored codecs, a KithMoot codec requiring the caller's Fold
validator, Spoken Token words, word/character offers, public handoff links,
public code formatting and the one-use pairing/exchange/confirmation/channel
lifecycle. Transfer and encrypted-receipt framing use the shared Rust profile.
Compare verification words and obtain application consent in your UI. Keep one
gate per offer, dispose abandoned states and generate a fresh offer on restart.
Objects share Rust state across foreign references; cloning a reference cannot
refund an attempt or duplicate an exchange/channel counter.

```sh
# Generate bindings and run actual Swift and Kotlin consumers on macOS.
# Linux runs the Kotlin consumer; install Kotlin and JDK 21 first.
node scripts/build-native.mjs check

# Build an ARM64 macOS/iOS/iOS Simulator XCFramework and Swift package (Xcode).
node scripts/build-native.mjs apple

# Build Android AAR for ARM64, ARMv7, x86_64 and x86; requires NDK 27.1.
ANDROID_NDK_HOME=/your/sdk/ndk/27.1.12297006 node scripts/build-native.mjs android

# Execute the archives on installed phone runtimes, one at a time.
# iOS needs XcodeGen and an iOS runtime; Android needs API 35/build tools 35,
# Kotlin/JDK and the installed google_apis ARM64 system image.
node scripts/check-native-mobile.mjs ios
node scripts/check-native-mobile.mjs android
```

Rust always reuses the checkout's `target/`. Builders remove their owned staging
on success/failure. Output archives and checksums are under `target/native-packages`.
The Apple package requires iOS 15/macOS 12 and contains ARM64 slices; Intel Apple
hosts/simulators are not included in this build. Android requires API 23 and
`implementation("net.java.dev.jna:jna:5.19.1@aar")` alongside the AAR. The builder
pins/verifies the JNA tooling jar checksum; consumers may mirror this dependency.
Generated artifacts include Foregather and dependency licence texts. Unmodified
UniFFI components retain MPL-2.0; Foregather source remains MIT.
The qualified Android archive was compiled with Kotlin 2.4.10. Its consumer uses
the pinned standalone D8/R8 9.1.29 with a verified SHA-256, as required by
[Android's Kotlin compatibility table](https://developer.android.com/build/kotlin-support).

Local consumers exercise stored recovery, caller validation before/after KithMoot
recovery, words/characters, public-only links, matching verification, encrypted
transfer/receipt, consumed-state rejection and packet replay. Cross-compilation,
desktop foreign consumers, actual phone execution and physical camera/user
acceptance are separate evidence. No physical-phone or independent security
acceptance is claimed by the package builder.

The phone checks unpack the actual archives and reuse the desktop consumers in
small native smoke apps. They exercise the packaged iOS static library and
Android JNI library, including callbacks, pairing, receipts and replay rejection.
Reports and screenshots are retained under `target/native-mobile-evidence`.
Each check stops/deletes its own simulator or AVD and removes its staging even
on failure. Existing devices and running emulators are left untouched. The
smoke apps establish native runtime behaviour, not a production application UI
or physical camera/network acceptance.

Local archive execution passed on iOS 18.3 Simulator and Android 15/API 35 ARM64
emulator on 2026-10-13. The four-ABI AAR's other architectures were cross-built
and their ELF headers checked; execution evidence covers ARM64 only.

Foreign strings, buffers and generated FFI copies remain in their caller/runtime
custody. Explicit disposal releases owned Rust state; it does not guarantee
whole-process memory erasure. Application validators, host/controller authority,
membership and continuing traffic encryption remain outside these bindings.
