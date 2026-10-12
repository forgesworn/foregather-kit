use foregather_kit::{encode, spoken::*};
use sha2::{Digest, Sha256};

#[test]
fn frozen_wordlist_and_spoken_v2_reference_vectors() {
    let wordlist = include_str!("../src/en-v1.txt");
    assert_eq!(wordlist.lines().count(), 2048);
    assert_eq!(format!("{:x}", Sha256::digest(wordlist)), WORDLIST_SHA256);
    let mut secret = [0; 32];
    secret[31] = 1;
    let bytes = derive_bytes(&secret, "test", 0, None).unwrap();
    assert_eq!(
        encode(bytes.as_ref()),
        "7ALSTtNL8GtnlWS62KE8WZzLB9JYSMfHzuPTPgKMi_w"
    );
    assert_eq!(
        derive_words(&secret, "test", 0, None, 3).unwrap(),
        "jazz earth glacier"
    );
    assert_eq!(
        derive_words(&secret, "test", 1, None, 1).unwrap(),
        "involve"
    );
    assert_eq!(
        derive_words(&secret, "test", 0, Some("alice"), 1).unwrap(),
        "vicious"
    );
    assert_eq!(
        derive_words(&secret, "test", 0, Some("bob"), 1).unwrap(),
        "ripple"
    );
    assert_eq!(
        directional_words(&secret, "rideshare", ["driver", "rider"], 42, 1).unwrap(),
        ["shed", "rely"]
    );
}
#[test]
fn spoken_rejects_ambiguous_domains_and_bounds() {
    for context in ["", " ", "x\0y"] {
        assert!(derive_bytes(&[1; 32], context, 0, None).is_err());
    }
    assert!(derive_bytes(&[1; 15], "test", 0, None).is_err());
    assert!(derive_bytes(&[1; 32], "test", 0, Some(" ")).is_err());
    assert!(directional_words(&[1; 32], "test", ["same", "same"], 0, 3).is_err());
    for count in [0, 17, usize::MAX] {
        assert!(encode_words(&[0; 32], count).is_err());
    }
    assert!(encode_words(&[0], 1).is_err());
}
