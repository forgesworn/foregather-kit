#![cfg(feature = "experimental-live")]
use foregather_kit::{Namespace, encode, live::*};
use rand_core::OsRng;
const NOW: u64 = 1_800_000_000;
fn session() -> Session {
    Session::generate(
        Namespace::parse("example.rooms").unwrap(),
        Namespace::parse("bootstrap").unwrap(),
        120,
        NOW,
        &mut OsRng,
    )
    .unwrap()
}
fn gate(session: Session, secret: &str, attempts: u8) -> PairingGate {
    PairingGate::new(
        session,
        PairingSecret::parse(secret).unwrap(),
        attempts,
        NOW,
    )
    .unwrap()
}
fn pending(
    session_a: Session,
    session_b: Session,
    secret_a: &str,
    secret_b: &str,
) -> (PendingConfirmation, PendingConfirmation) {
    let a = gate(session_a, secret_a, 1)
        .start(Role::Inviter, NOW, &mut OsRng)
        .unwrap();
    let b = gate(session_b, secret_b, 1)
        .start(Role::Recipient, NOW, &mut OsRng)
        .unwrap();
    let ah = a.hello();
    let bh = b.hello();
    (a.finish(&bh, NOW).unwrap(), b.finish(&ah, NOW).unwrap())
}
fn channels() -> (Channel, Channel) {
    let s = session();
    let (a, b) = pending(s.clone(), s, "jazz earth glacier", "jazz earth glacier");
    let ap = a.confirmation().unwrap();
    let bp = b.confirmation().unwrap();
    (a.confirm(&bp, NOW).unwrap(), b.confirm(&ap, NOW).unwrap())
}
#[test]
fn confirmed_channel_has_equal_verification_and_directional_replay_safe_packets() {
    let (mut a, mut b) = channels();
    assert_eq!(
        a.verification_words(3, NOW).unwrap(),
        b.verification_words(3, NOW).unwrap()
    );
    let packet = a.seal(b"opaque invitation", NOW).unwrap();
    assert!(a.open(&packet, NOW).is_err());
    assert_eq!(
        b.open(&packet, NOW).unwrap().as_slice(),
        b"opaque invitation"
    );
    assert!(b.open(&packet, NOW).is_err());
    let reply = b.seal(b"review required", NOW).unwrap();
    assert_eq!(a.open(&reply, NOW).unwrap().as_slice(), b"review required");
}
#[test]
fn wrong_secret_and_each_context_field_fail_confirmation() {
    let s = session();
    let (a, b) = pending(
        s.clone(),
        s.clone(),
        "jazz earth glacier",
        "jazz earth ability",
    );
    let ap = a.confirmation().unwrap();
    let bp = b.confirmation().unwrap();
    assert!(a.confirm(&bp, NOW).is_err());
    assert!(b.confirm(&ap, NOW).is_err());
    for field in ["namespace", "purpose", "locator", "issued", "expires"] {
        let mut changed = s.clone();
        match field {
            "namespace" => changed.namespace = "other.app".into(),
            "purpose" => changed.purpose = "other".into(),
            "locator" => changed.locator = encode(&[2; 16]),
            "issued" => changed.issued -= 1,
            _ => changed.expires -= 1,
        }
        let (a, b) = pending(
            s.clone(),
            changed,
            "jazz earth glacier",
            "jazz earth glacier",
        );
        assert!(a.confirm(&b.confirmation().unwrap(), NOW).is_err());
    }
}
#[test]
fn endpoint_budget_counts_cancelled_and_invalid_attempts() {
    let mut g = gate(session(), "jazz earth", 2);
    let a = g.start(Role::Inviter, NOW, &mut OsRng).unwrap();
    drop(a);
    assert_eq!(g.remaining(), 1);
    let a = g.start(Role::Inviter, NOW, &mut OsRng).unwrap();
    assert!(a.finish("junk", NOW).is_err());
    assert_eq!(g.remaining(), 0);
    assert!(g.start(Role::Inviter, NOW, &mut OsRng).is_err());
}
#[test]
fn reflection_noncanonical_and_small_order_points_are_rejected() {
    let s = session();
    let a = gate(s.clone(), "jazz earth", 1)
        .start(Role::Inviter, NOW, &mut OsRng)
        .unwrap();
    let hello = a.hello();
    assert!(a.finish(&hello, NOW).is_err());
    for point in [[0; 32], [0xff; 32], {
        let mut p = [0; 32];
        p[0] = 1;
        p
    }] {
        let a = gate(s.clone(), "jazz earth", 1)
            .start(Role::Inviter, NOW, &mut OsRng)
            .unwrap();
        let mut bytes = vec![b'B'];
        bytes.extend_from_slice(&point);
        assert!(a.finish(&encode(&bytes), NOW).is_err());
    }
}
#[test]
fn expiry_clock_rollback_and_message_bounds_fail_closed() {
    let mut g = gate(session(), "jazz earth", 2);
    assert!(g.start(Role::Inviter, NOW - 1, &mut OsRng).is_err());
    assert!(g.start(Role::Inviter, NOW + 120, &mut OsRng).is_err());
    let (mut a, mut b) = channels();
    assert!(a.seal(&vec![0; MAX_PAYLOAD_BYTES + 1], NOW).is_err());
    assert!(b.open(&"x".repeat(MAX_PACKET_BYTES + 1), NOW).is_err());
    let p = a.seal(&vec![0; MAX_PAYLOAD_BYTES], NOW + 1).unwrap();
    assert_eq!(b.open(&p, NOW + 1).unwrap().len(), MAX_PAYLOAD_BYTES);
    assert!(a.seal(b"clock rollback", NOW).is_err());
    assert!(a.verification_words(3, NOW + 120).is_err());
}
#[test]
fn tampering_ordering_and_cross_session_replay_are_rejected_without_advancing_receive() {
    let (mut a, mut b) = channels();
    let (mut c, mut d) = channels();
    let first = a.seal(b"first", NOW).unwrap();
    let second = a.seal(b"second", NOW).unwrap();
    assert!(b.open(&second, NOW).is_err());
    assert!(d.open(&first, NOW).is_err());
    for field in ["v", "seq", "ciphertext", "unknown"] {
        let mut p: serde_json::Value = serde_json::from_str(&first).unwrap();
        match field {
            "seq" => p[field] = 1.into(),
            "unknown" => p[field] = true.into(),
            _ => p[field] = "junk".into(),
        }
        assert!(b.open(&p.to_string(), NOW).is_err());
    }
    assert_eq!(b.open(&first, NOW).unwrap().as_slice(), b"first");
    assert_eq!(b.open(&second, NOW).unwrap().as_slice(), b"second");
    let p = c.seal(b"other", NOW).unwrap();
    assert!(a.open(&p, NOW).is_err());
}
#[test]
fn codes_are_configurable_canonical_and_secret_debug_is_redacted() {
    for count in [2, 3, 4, 6, 16] {
        let p = PairingSecret::generate(count, &mut OsRng).unwrap();
        assert_eq!(p.expose_words().split(' ').count(), count);
        assert!(!format!("{p:?}").contains(p.expose_words()));
    }
    assert_eq!(
        PairingSecret::parse(" JAZZ\tEARTH\n")
            .unwrap()
            .expose_words(),
        "jazz earth"
    );
    for p in ["jazz", "unknownwords earth", "jazz éarth"] {
        assert!(PairingSecret::parse(p).is_err());
    }
    assert!(PairingSecret::generate(1, &mut OsRng).is_err());
    for lifetime in [0, 601, u64::MAX] {
        assert!(
            Session::generate(
                Namespace::parse("test").unwrap(),
                Namespace::parse("bootstrap").unwrap(),
                lifetime,
                NOW,
                &mut OsRng
            )
            .is_err()
        );
    }
}

#[test]
fn entropy_failure_spends_an_attempt_without_panicking_or_producing_a_hello() {
    use rand_core::{CryptoRng, RngCore};
    struct FailedEntropy;
    impl CryptoRng for FailedEntropy {}
    impl RngCore for FailedEntropy {
        fn next_u32(&mut self) -> u32 {
            panic!("Use fallible entropy")
        }
        fn next_u64(&mut self) -> u64 {
            panic!("Use fallible entropy")
        }
        fn fill_bytes(&mut self, _: &mut [u8]) {
            panic!("Use fallible entropy")
        }
        fn try_fill_bytes(&mut self, _: &mut [u8]) -> std::result::Result<(), rand_core::Error> {
            Err(rand_core::Error::from(
                std::num::NonZeroU32::new(rand_core::Error::CUSTOM_START).unwrap(),
            ))
        }
    }
    let mut g = gate(session(), "jazz earth", 1);
    assert!(g.start(Role::Inviter, NOW, &mut FailedEntropy).is_err());
    assert_eq!(g.remaining(), 0);
    assert!(PairingSecret::generate(4, &mut FailedEntropy).is_err());
    assert!(PairingSecret::generate_characters(6, &mut FailedEntropy).is_err());
    assert!(RendezvousCode::generate(6, &mut FailedEntropy).is_err());
}

#[test]
fn character_encoding_is_frozen_canonical_length_bound_and_redacted() {
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/access-base32-en-v1.json")).unwrap();
    assert_eq!(v["encoding"], CHARACTER_ENCODING);
    assert_eq!(v["alphabet"], CHARACTER_ALPHABET);
    assert_eq!(v["wordlistSha256"], foregather_kit::spoken::WORDLIST_SHA256);
    for case in v["vectors"].as_array().unwrap() {
        let code = case["code"].as_str().unwrap();
        let secret = PairingSecret::from_characters(code).unwrap();
        assert_eq!(
            secret.expose_words(),
            case["canonicalWords"].as_str().unwrap()
        );
        assert_eq!(
            PairingSecret::from_characters(&format!(" {} ", code.to_ascii_lowercase()))
                .unwrap()
                .expose_words(),
            secret.expose_words()
        );
        assert!(!format!("{secret:?}").contains(code));
        assert!(!format!("{secret:?}").contains(secret.expose_words()));
    }
    for code in [
        "ABCDE", "ABC234I", "ABC234O", "ABC234L", "ABC234U", "AB-C234", "ABC 234", "ABC23é",
    ] {
        assert!(PairingSecret::from_characters(code).is_err());
        assert!(RendezvousCode::parse(code).is_err());
    }
    assert!(PairingSecret::from_characters(&"A".repeat(33)).is_err());
    assert_ne!(
        PairingSecret::from_characters("000000")
            .unwrap()
            .expose_words(),
        PairingSecret::from_characters("0000000")
            .unwrap()
            .expose_words()
    );
}

#[test]
fn grouped_codes_preserve_passwords_and_aliases_and_reject_malformed_separators() {
    assert_eq!(format_character_code("dfvsjx").unwrap().as_str(), "DFV-SJX");
    for length in 6..=32 {
        let raw = &CHARACTER_ALPHABET[..length];
        let formatted = format_character_code(raw).unwrap();
        let expected = raw
            .as_bytes()
            .chunks(3)
            .map(|v| std::str::from_utf8(v).unwrap())
            .collect::<Vec<_>>()
            .join("-");
        assert_eq!(formatted.as_str(), expected);
        assert_eq!(format_character_code(&formatted).unwrap(), formatted);
        assert_eq!(
            PairingSecret::from_characters(&formatted)
                .unwrap()
                .expose_words(),
            PairingSecret::from_characters(raw).unwrap().expose_words()
        );
        assert_eq!(
            RendezvousCode::parse(&format!(" {}\n", formatted.to_ascii_lowercase()))
                .unwrap()
                .as_str(),
            raw
        );
    }
    for value in [
        "-ABC-234",
        "ABC-234-",
        "ABC--234",
        "AB-C234",
        "ABC2-34",
        "ABC234-",
        "ABC 234",
        "ABC_234",
        "ABC–234",
        "ABC-23I",
        "ABC-23U",
    ] {
        assert!(format_character_code(value).is_err());
        assert!(PairingSecret::from_characters(value).is_err());
        assert!(RendezvousCode::parse(value).is_err());
    }
    assert!(format_character_code(&"A-".repeat(33)).is_err());
}

#[test]
fn character_secrets_pair_with_their_canonical_word_password_without_wire_changes() {
    for length in [6, 7, 8, 12, 32] {
        let (secret, code) = PairingSecret::generate_characters(length, &mut OsRng).unwrap();
        assert_eq!(code.len(), length);
        assert!(
            code.bytes()
                .all(|b| CHARACTER_ALPHABET.as_bytes().contains(&b))
        );
        let s = session();
        let a = PairingGate::new(s.clone(), secret, 1, NOW)
            .unwrap()
            .start(Role::Inviter, NOW, &mut OsRng)
            .unwrap();
        let grouped = format_character_code(&code).unwrap();
        let b = PairingGate::new(s, PairingSecret::from_characters(&grouped).unwrap(), 1, NOW)
            .unwrap()
            .start(Role::Recipient, NOW, &mut OsRng)
            .unwrap();
        let ah = a.hello();
        let bh = b.hello();
        let ap = a.finish(&bh, NOW).unwrap();
        let bp = b.finish(&ah, NOW).unwrap();
        let proof_a = ap.confirmation().unwrap();
        let proof_b = bp.confirmation().unwrap();
        let mut ac = ap.confirm(&proof_b, NOW).unwrap();
        let mut bc = bp.confirm(&proof_a, NOW).unwrap();
        assert_eq!(
            ac.verification_words(3, NOW).unwrap(),
            bc.verification_words(3, NOW).unwrap()
        );
        assert_eq!(
            bc.open(&ac.seal(b"synthetic character transfer", NOW).unwrap(), NOW)
                .unwrap()
                .as_slice(),
            b"synthetic character transfer"
        );
    }
    let s = session();
    let secret = PairingSecret::from_characters("ABC234").unwrap();
    let (a, b) = pending(s.clone(), s, secret.expose_words(), secret.expose_words());
    assert!(a.confirm(&b.confirmation().unwrap(), NOW).is_ok());
}

#[test]
fn wrong_character_code_and_public_alias_do_not_confirm_and_spend_budget() {
    let s = session();
    let mut a = PairingGate::new(
        s.clone(),
        PairingSecret::from_characters("ABC234").unwrap(),
        1,
        NOW,
    )
    .unwrap();
    let public_alias = RendezvousCode::parse("XYZ789").unwrap();
    let mut b = PairingGate::new(
        s,
        PairingSecret::from_characters(public_alias.as_str()).unwrap(),
        1,
        NOW,
    )
    .unwrap();
    let ax = a.start(Role::Inviter, NOW, &mut OsRng).unwrap();
    let bx = b.start(Role::Recipient, NOW, &mut OsRng).unwrap();
    let ah = ax.hello();
    let bh = bx.hello();
    let ap = ax.finish(&bh, NOW).unwrap();
    let bp = bx.finish(&ah, NOW).unwrap();
    let aproof = ap.confirmation().unwrap();
    let bproof = bp.confirmation().unwrap();
    assert!(ap.confirm(&bproof, NOW).is_err());
    assert!(bp.confirm(&aproof, NOW).is_err());
    assert_eq!(a.remaining(), 0);
    assert_eq!(b.remaining(), 0);
    assert!(a.start(Role::Inviter, NOW, &mut OsRng).is_err());
}

#[test]
fn public_rendezvous_aliases_are_bounded_canonical_and_independent_credentials() {
    for length in [6, 8, 12, 32] {
        let code = RendezvousCode::generate(length, &mut OsRng).unwrap();
        assert_eq!(code.as_str().len(), length);
        assert_eq!(
            RendezvousCode::parse(&code.as_str().to_ascii_lowercase()).unwrap(),
            code
        );
    }
    for length in [0, 5, 33, usize::MAX] {
        assert!(RendezvousCode::generate(length, &mut OsRng).is_err());
        assert!(PairingSecret::generate_characters(length, &mut OsRng).is_err());
    }
}
