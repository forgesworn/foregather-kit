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
