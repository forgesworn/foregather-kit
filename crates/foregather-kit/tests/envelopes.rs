use foregather_kit::*;
use rand_core::{OsRng, RngCore};
use serde_json::{Value, json};

const NOW: u64 = 1_800_000_000;
fn profile() -> Profile {
    Profile::V1(Namespace::parse("example.rooms").unwrap())
}

#[test]
fn opens_frozen_foregather_vectors_from_independent_node_implementation() {
    let vectors: Value =
        serde_json::from_str(include_str!("../vectors/foregather-v1.json")).unwrap();
    for vector in vectors["vectors"].as_array().unwrap() {
        let profile = Profile::V1(Namespace::parse(vector["namespace"].as_str().unwrap()).unwrap());
        let location = ResolverLocation::parse(vector["base"].as_str().unwrap(), false).unwrap();
        let invitation = location
            .parse_invitation(vector["url"].as_str().unwrap())
            .unwrap();
        let recovered = open(
            &profile,
            &invitation,
            &vector["envelope"].to_string(),
            vector["now"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(encode(&recovered), vector["payload"].as_str().unwrap());
    }
}
fn location() -> ResolverLocation {
    ResolverLocation::parse("https://resolver.example/i/", false).unwrap()
}
fn sample() -> (Invitation, Envelope) {
    seal(
        &profile(),
        Locator::parse(&encode(&[7; 16])).unwrap(),
        b"opaque room invitation",
        NOW + 3600,
        NOW,
        &mut OsRng,
    )
    .unwrap()
}

#[test]
fn opens_independent_kithmoot_vectors_without_changing_invitation_bytes() {
    let vectors: Value =
        serde_json::from_str(include_str!("../vectors/kithmoot-short-invitation-v1.json")).unwrap();
    let location = ResolverLocation::parse("https://z1p.app/k/", false).unwrap();
    for vector in vectors["vectors"].as_array().unwrap() {
        let invite = location
            .parse_invitation(vector["url"].as_str().unwrap())
            .unwrap();
        let plaintext = open(
            &Profile::KithmootV1,
            &invite,
            &vector["envelope"].to_string(),
            vector["now"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(
            plaintext.as_slice(),
            vector["fullInvitation"].as_str().unwrap().as_bytes()
        );
    }
}

#[test]
fn namespace_is_authenticated_and_profiles_cannot_be_substituted() {
    let (invitation, envelope) = sample();
    assert!(
        open(
            &Profile::V1(Namespace::parse("different.app").unwrap()),
            &invitation,
            &envelope.to_json().unwrap(),
            NOW
        )
        .is_err()
    );
    assert!(
        open(
            &Profile::KithmootV1,
            &invitation,
            &envelope.to_json().unwrap(),
            NOW
        )
        .is_err()
    );
}

#[test]
fn every_authenticated_field_and_capability_is_bound() {
    let (invitation, envelope) = sample();
    let original: Value = serde_json::from_str(&envelope.to_json().unwrap()).unwrap();
    for field in ["nonce", "ciphertext", "expires"] {
        let mut changed = original.clone();
        if field == "expires" {
            changed[field] = json!(NOW + 3599);
        } else {
            let mut bytes = decode(changed[field].as_str().unwrap()).unwrap();
            bytes[0] ^= 1;
            changed[field] = json!(encode(&bytes));
        }
        assert!(
            open(&profile(), &invitation, &changed.to_string(), NOW).is_err(),
            "{field}"
        );
    }
    for url in [
        format!(
            "https://resolver.example/i/{}#{}",
            encode(&[8; 16]),
            encode(&[9; 32])
        ),
        format!(
            "https://resolver.example/i/{}#{}",
            invitation.locator().encoded(),
            encode(&[9; 32])
        ),
    ] {
        assert!(
            open(
                &profile(),
                &location().parse_invitation(&url).unwrap(),
                &envelope.to_json().unwrap(),
                NOW
            )
            .is_err()
        );
    }
}

#[test]
fn expiry_is_exclusive_and_safe_integer_limits_are_enforced() {
    let (invitation, envelope) = sample();
    let text = envelope.to_json().unwrap();
    assert!(open(&profile(), &invitation, &text, NOW + 3599).is_ok());
    assert!(open(&profile(), &invitation, &text, NOW + 3600).is_err());
    for (expires, now) in [
        (NOW, NOW),
        (NOW + MAX_LIFETIME_SECONDS + 1, NOW),
        (MAX_SAFE_SECONDS + 1, MAX_SAFE_SECONDS),
        (u64::MAX, 0),
        (1, u64::MAX),
    ] {
        assert!(lifetime(expires, now).is_err());
    }
    assert!(lifetime(NOW + MAX_LIFETIME_SECONDS, NOW).is_ok());
}

#[test]
fn canonical_encodings_and_exact_schemas_are_required() {
    for value in ["", "AQ==", "AR", "AA/", "AA+", "A", " AA"] {
        assert!(decode(value).is_err(), "{value}");
    }
    let (_, env) = sample();
    let value: Value = serde_json::from_str(&env.to_json().unwrap()).unwrap();
    let mut extra = value.clone();
    extra["unexpected"] = json!(true);
    let mut bad_version = value.clone();
    bad_version["v"] = json!(2);
    let mut bad_nonce = value.clone();
    bad_nonce["nonce"] = json!("AA");
    let duplicate = env.to_json().unwrap().replacen("{", "{\"v\":1,", 1);
    for text in [
        extra.to_string(),
        bad_version.to_string(),
        bad_nonce.to_string(),
        duplicate,
        "null".into(),
        "[]".into(),
    ] {
        assert!(Envelope::parse(&text, NOW).is_err());
    }
}

#[test]
fn endpoint_selection_fails_closed_and_local_http_requires_opt_in() {
    for base in [
        "http://resolver.example/i/",
        "https://user@resolver.example/i/",
        "https://resolver.example/i/?x=1",
        "https://resolver.example/i/#x",
        "https://resolver.example/i",
        "https://RESOLVER.example/i/",
    ] {
        assert!(ResolverLocation::parse(base, false).is_err(), "{base}");
    }
    assert!(ResolverLocation::parse("http://127.0.0.1:8787/i/", false).is_err());
    assert!(ResolverLocation::parse("http://127.0.0.1:8787/i/", true).is_ok());
    assert!(ResolverLocation::parse("http://[::1]:8787/i/", true).is_ok());
    assert!(ResolverLocation::parse("http://127.0.0.2:8787/i/", true).is_err());
    let (invitation, _) = sample();
    let url = invitation.to_url(&location());
    for malformed in [
        url.replace("resolver.example", "evil.example"),
        url.replace("#", "?secret=1#"),
        url.clone() + "=",
        url.replace("/i/", "/other/"),
    ] {
        assert!(location().parse_invitation(&malformed).is_err());
    }
}

#[test]
fn fresh_sealing_does_not_reuse_key_or_nonce_and_debug_is_redacted() {
    let (a, ea) = sample();
    let (b, eb) = sample();
    assert_ne!(a.to_url(&location()), b.to_url(&location()));
    let ea: Value = serde_json::from_str(&ea.to_json().unwrap()).unwrap();
    let eb: Value = serde_json::from_str(&eb.to_json().unwrap()).unwrap();
    assert_ne!(ea["nonce"], eb["nonce"]);
    assert_eq!(format!("{a:?}"), "Invitation([REDACTED])");
}

#[test]
fn bounded_binary_payloads_round_trip_and_oversized_ciphertexts_are_refused() {
    for length in [0, 1, 255, 4096, 18000] {
        let payload: Vec<u8> = (0..length).map(|n| (n % 256) as u8).collect();
        let (invitation, envelope) = seal(
            &profile(),
            Locator::generate(&mut OsRng).unwrap(),
            &payload,
            NOW + 1,
            NOW,
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(
            open(&profile(), &invitation, &envelope.to_json().unwrap(), NOW)
                .unwrap()
                .as_slice(),
            payload
        );
    }
    let (invitation, _) = sample();
    assert!(
        open(
            &profile(),
            &invitation,
            &" ".repeat(MAX_ENVELOPE_BYTES + 1),
            NOW
        )
        .is_err()
    );
    assert!(
        seal(
            &profile(),
            invitation.locator(),
            &vec![0; MAX_ENVELOPE_BYTES],
            NOW + 1,
            NOW,
            &mut OsRng
        )
        .is_err()
    );
}

#[test]
fn namespace_validation_has_no_case_or_separator_aliases() {
    for name in [
        "",
        "Uppercase",
        "1example",
        "a:b",
        "a\0b",
        "app/name",
        "é",
        " space",
    ] {
        assert!(Namespace::parse(name).is_err());
    }
    assert!(Namespace::parse(&"a".repeat(65)).is_err());
    assert!(Namespace::parse("example.rooms-v1").is_ok());
}

#[test]
fn seeded_hostile_input_exercises_parsers_without_panics() {
    // Deterministic mutation corpus; this is not a substitute for coverage-guided fuzzing.
    let (invitation, env) = sample();
    let original = env.to_json().unwrap();
    let mut state = 0x12345678u32;
    for i in 0..4096 {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        let mut bytes = original.as_bytes().to_vec();
        bytes[(state as usize) % original.len()] = (i % 256) as u8;
        let text = String::from_utf8_lossy(&bytes);
        let _ = Envelope::parse(&text, NOW);
        let _ = open(&profile(), &invitation, &text, NOW);
        let _ = location().parse_invitation(&text);
        let _ = decode(&text);
    }
}

#[test]
fn csprng_failure_does_not_produce_an_invitation() {
    struct Broken;
    impl rand_core::CryptoRng for Broken {}
    impl RngCore for Broken {
        fn next_u32(&mut self) -> u32 {
            panic!("must use fallible entropy")
        }
        fn next_u64(&mut self) -> u64 {
            panic!("must use fallible entropy")
        }
        fn fill_bytes(&mut self, _: &mut [u8]) {
            panic!("must use fallible entropy")
        }
        fn try_fill_bytes(&mut self, _: &mut [u8]) -> std::result::Result<(), rand_core::Error> {
            Err(std::num::NonZeroU32::new(rand_core::Error::CUSTOM_START)
                .unwrap()
                .into())
        }
    }
    assert!(Locator::generate(&mut Broken).is_err());
    assert!(
        seal(
            &profile(),
            Locator::parse(&encode(&[0; 16])).unwrap(),
            b"test",
            NOW + 1,
            NOW,
            &mut Broken
        )
        .is_err()
    );
}
