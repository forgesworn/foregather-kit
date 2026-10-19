#![cfg(feature = "experimental-live")]
use foregather_kit::transfer::Transfer;
#[test]
fn independent_transfer_and_receipt_vectors_and_tampering() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/transfer-v1.json")).unwrap();
    for vector in fixture["vectors"].as_array().unwrap() {
        let frame = foregather_kit::decode(vector["frame"].as_str().unwrap()).unwrap();
        let receipt = foregather_kit::decode(vector["receipt"].as_str().unwrap()).unwrap();
        let encoded = vector["payload"].as_str().unwrap();
        let payload = if encoded.is_empty() {
            Vec::new()
        } else {
            foregather_kit::decode(encoded).unwrap()
        };
        let transfer = Transfer::parse(&frame).unwrap();
        assert_eq!(transfer.payload(), payload);
        assert_eq!(transfer.encode().as_slice(), frame);
        assert_eq!(transfer.receipt().as_slice(), receipt);
        transfer.acknowledged(&receipt).unwrap();
        for index in 0..receipt.len() {
            let mut changed = receipt.clone();
            changed[index] ^= 1;
            assert!(transfer.acknowledged(&changed).is_err());
        }
        let mut changed = frame.clone();
        changed[2] = 2;
        assert!(Transfer::parse(&changed).is_err());
        assert!(Transfer::parse(&frame[..19]).is_err());
    }
    assert!(Transfer::create(&vec![0; 16365], &mut rand_core::OsRng).is_err());
    let max = Transfer::create(&vec![255; 16364], &mut rand_core::OsRng).unwrap();
    assert_eq!(max.encode().len(), 16384);
}
#[test]
fn independent_reply_vectors_binding_and_bounds() {
    use foregather_kit::transfer::{MAX_REPLY, REPLY_PROFILE};
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/transfer-reply-v1.json")).unwrap();
    assert_eq!(fixture["profile"], REPLY_PROFILE);
    let decode = |value: &serde_json::Value| {
        let text = value.as_str().unwrap();
        if text.is_empty() {
            Vec::new()
        } else {
            foregather_kit::decode(text).unwrap()
        }
    };
    let mut seen = Vec::new();
    for vector in fixture["vectors"].as_array().unwrap() {
        let transfer = Transfer::parse(&decode(&vector["invitationFrame"])).unwrap();
        let message = decode(&vector["reply"]);
        let frame = decode(&vector["frame"]);
        assert_eq!(transfer.reply(&message).unwrap().as_slice(), frame);
        assert_eq!(transfer.read_reply(&frame).unwrap().as_slice(), message);
        for index in 0..52 {
            let mut changed = frame.clone();
            changed[index] ^= 1;
            assert!(transfer.read_reply(&changed).is_err());
        }
        assert!(transfer.read_reply(&frame[..51]).is_err());
        // A receipt is never a reply, and an empty reply is never a receipt.
        assert!(transfer.read_reply(&transfer.receipt()).is_err());
        if frame.len() == 52 {
            assert!(transfer.acknowledged(&frame).is_err());
        }
        seen.push((transfer, frame));
    }
    // Same identifier, different invitation bytes: replies stay with their own.
    assert!(seen[0].0.read_reply(&seen[1].1).is_err());
    let transfer = Transfer::create(b"synthetic", &mut rand_core::OsRng).unwrap();
    assert!(transfer.reply(&vec![0; MAX_REPLY + 1]).is_err());
    let max = transfer.reply(&vec![7; MAX_REPLY]).unwrap();
    assert_eq!(max.len(), 52 + MAX_REPLY);
    assert_eq!(transfer.read_reply(&max).unwrap().len(), MAX_REPLY);
    let mut long = max.to_vec();
    long.push(0);
    assert!(transfer.read_reply(&long).is_err());
}
