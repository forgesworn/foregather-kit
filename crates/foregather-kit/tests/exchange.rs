#![cfg(feature = "experimental-live")]
use foregather_kit::Namespace;
use foregather_kit::exchange::{
    ExchangeChannel, MAX_MESSAGES, MAX_PAYLOAD, PROFILE, decode_message, encode_message,
};
use foregather_kit::live::{Channel, PairingGate, PairingSecret, Role, Session};
use foregather_kit::transfer::Transfer;
use rand_core::OsRng;

const NOW: u64 = 1_800_000_000;

fn bytes(value: &serde_json::Value) -> Vec<u8> {
    let text = value.as_str().unwrap();
    if text.is_empty() {
        Vec::new()
    } else {
        foregather_kit::decode(text).unwrap()
    }
}

fn channels(lifetime: u64) -> (Channel, Channel) {
    let session = Session::generate(
        Namespace::parse("example.rooms").unwrap(),
        Namespace::parse("exchange").unwrap(),
        lifetime,
        NOW,
        &mut OsRng,
    )
    .unwrap();
    let secret = PairingSecret::generate(4, &mut OsRng).unwrap();
    let theirs = PairingSecret::parse(secret.expose_words()).unwrap();
    let mut gate_a = PairingGate::new(session.clone(), secret, 1, NOW).unwrap();
    let mut gate_b = PairingGate::new(session, theirs, 1, NOW).unwrap();
    let ax = gate_a.start(Role::Inviter, NOW, &mut OsRng).unwrap();
    let bx = gate_b.start(Role::Recipient, NOW, &mut OsRng).unwrap();
    let (ah, bh) = (ax.hello(), bx.hello());
    let ap = ax.finish(&bh, NOW).unwrap();
    let bp = bx.finish(&ah, NOW).unwrap();
    let (aproof, bproof) = (ap.confirmation().unwrap(), bp.confirmation().unwrap());
    (
        ap.confirm(&bproof, NOW).unwrap(),
        bp.confirm(&aproof, NOW).unwrap(),
    )
}

fn exchanges(lifetime: u64) -> (ExchangeChannel, ExchangeChannel) {
    let (a, b) = channels(lifetime);
    (
        ExchangeChannel::new(a).unwrap(),
        ExchangeChannel::new(b).unwrap(),
    )
}

#[test]
fn independent_frame_vectors_and_tampering() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/exchange-v1.json")).unwrap();
    assert_eq!(fixture["profile"], PROFILE);
    for vector in fixture["frames"].as_array().unwrap() {
        let index = u8::try_from(vector["index"].as_u64().unwrap()).unwrap();
        let payload = bytes(&vector["payload"]);
        let frame = bytes(&vector["frame"]);
        assert_eq!(encode_message(index, &payload).unwrap().as_slice(), frame);
        assert_eq!(decode_message(index, &frame).unwrap().as_slice(), payload);
        // Type, version and index are all bound: any header change is refused.
        for position in 0..5 {
            let mut changed = frame.clone();
            changed[position] ^= 1;
            assert!(decode_message(index, &changed).is_err());
        }
        assert!(decode_message(index.wrapping_add(1), &frame).is_err());
        assert!(decode_message(index, &frame[..4]).is_err());
    }
}

#[test]
fn frames_refuse_other_profiles_and_out_of_range_input() {
    // Transfer v1 invitation and receipt frames are never exchange messages.
    let transfer = Transfer::create(b"synthetic", &mut OsRng).unwrap();
    assert!(decode_message(1, &transfer.encode()).is_err());
    assert!(decode_message(70, &transfer.encode()).is_err());
    assert!(decode_message(0, &transfer.receipt()).is_err());
    let reply = transfer.reply(b"").unwrap();
    assert!(decode_message(0, &reply).is_err());
    // Index bound and payload bound.
    assert!(encode_message(32, b"").is_err());
    assert!(decode_message(32, &[70, 71, 2, 1, 32]).is_err());
    assert!(encode_message(0, &vec![0; MAX_PAYLOAD + 1]).is_err());
    let max = encode_message(31, &vec![9; MAX_PAYLOAD]).unwrap();
    assert_eq!(max.len(), 16_384);
    assert_eq!(decode_message(31, &max).unwrap().len(), MAX_PAYLOAD);
    let mut long = max.to_vec();
    long.push(0);
    assert!(decode_message(31, &long).is_err());
}

#[test]
fn both_directions_carry_thirty_two_ordered_messages_and_no_more() {
    let (mut a, mut b) = exchanges(120);
    for round in 0..MAX_MESSAGES {
        let message = vec![round as u8; round * 500];
        let (index, packet) = a.seal(&message, NOW).unwrap();
        assert_eq!(usize::from(index), round);
        let value: serde_json::Value = serde_json::from_str(&packet).unwrap();
        assert_eq!(value["seq"].as_u64().unwrap(), u64::from(index));
        assert_eq!(b.open(&packet, NOW).unwrap().as_slice(), message);
        let (index, packet) = b.seal(&message, NOW).unwrap();
        assert_eq!(usize::from(index), round);
        assert_eq!(a.open(&packet, NOW).unwrap().as_slice(), message);
    }
    assert_eq!((a.sent(), a.received()), (MAX_MESSAGES, MAX_MESSAGES));
    assert!(a.seal(b"one too many", NOW).is_err());
    assert!(b.seal(b"one too many", NOW).is_err());
    let (mut c, mut d) = exchanges(120);
    assert!(c.seal(&vec![1; MAX_PAYLOAD + 1], NOW).is_err());
    let (_, largest) = c.seal(&vec![1; MAX_PAYLOAD], NOW).unwrap();
    assert!(largest.len() <= foregather_kit::live::MAX_PACKET_BYTES);
    assert_eq!(d.open(&largest, NOW).unwrap().len(), MAX_PAYLOAD);
}

#[test]
fn tampered_replayed_and_reordered_packets_are_refused_without_advancing() {
    let (mut a, mut b) = exchanges(120);
    let (_, first) = a.seal(b"first", NOW).unwrap();
    let (_, second) = a.seal(b"second", NOW).unwrap();
    // Out of order: the second packet cannot be opened first.
    assert!(b.open(&second, NOW).is_err());
    let mut value: serde_json::Value = serde_json::from_str(&first).unwrap();
    let ciphertext = value["ciphertext"].as_str().unwrap().to_string();
    let flipped = if ciphertext.starts_with('A') {
        "B"
    } else {
        "A"
    };
    value["ciphertext"] = format!("{flipped}{}", &ciphertext[1..]).into();
    assert!(b.open(&value.to_string(), NOW).is_err());
    assert_eq!(b.received(), 0);
    // A packet from the wrong direction does not authenticate either.
    let (_, own) = b.seal(b"own", NOW).unwrap();
    assert!(b.open(&own, NOW).is_err());
    assert_eq!(b.open(&first, NOW).unwrap().as_slice(), b"first");
    // Replay of the same packet is refused; the next one still opens.
    assert!(b.open(&first, NOW).is_err());
    assert_eq!(b.open(&second, NOW).unwrap().as_slice(), b"second");
    assert_eq!(b.received(), 2);
}

#[test]
fn the_session_deadline_ends_the_exchange() {
    let (mut a, mut b) = exchanges(2);
    let (_, packet) = a.seal(b"in time", NOW + 1).unwrap();
    assert!(b.open(&packet, NOW + 2).is_err());
    assert!(a.seal(b"late", NOW + 2).is_err());
    assert_eq!(b.open(&packet, NOW + 1).unwrap().as_slice(), b"in time");
    // A clock earlier than the last operation is refused.
    assert!(a.seal(b"rolled back", NOW).is_err());
}

#[test]
fn exchange_and_transfer_never_share_a_channel() {
    let (mut a, b) = channels(120);
    let transfer = Transfer::create(b"synthetic invitation", &mut OsRng).unwrap();
    let packet = a.seal(&transfer.encode(), NOW).unwrap();
    assert!(ExchangeChannel::new(a).is_err());
    let mut b = ExchangeChannel::new(b).unwrap();
    // The transfer frame authenticates at sequence zero and ends the exchange.
    assert!(b.open(&packet, NOW).is_err());
    assert!(b.seal(b"after a foreign frame", NOW).is_err());
}
