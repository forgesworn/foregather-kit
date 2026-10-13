#![cfg(feature = "experimental-live")]
use foregather_kit::handoff::PublicRoom;
#[test]
fn independent_public_links_and_local_context_boundaries() {
    let fixtures: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/public-handoff-v1.json")).unwrap();
    for fixture in fixtures["vectors"].as_array().unwrap() {
        let base = fixture["base"].as_str().unwrap();
        let url = fixture["url"].as_str().unwrap();
        let room: PublicRoom = serde_json::from_value(fixture["room"].clone()).unwrap();
        assert_eq!(
            room.link(base, false, "example.rooms", "invitation", 1800000000)
                .unwrap(),
            url
        );
        let room =
            PublicRoom::parse_link(url, base, false, "example.rooms", "invitation", 1800000000)
                .unwrap();
        assert_eq!(room.session.locator, "BwcHBwcHBwcHBwcHBwcHBw");
        for (base, namespace, purpose, now) in [
            (
                "https://other.test/pair/",
                "example.rooms",
                "invitation",
                1800000000,
            ),
            (base, "other.app", "invitation", 1800000000),
            (base, "example.rooms", "other", 1800000000),
            (base, "example.rooms", "invitation", 1800000120),
        ] {
            assert!(PublicRoom::parse_link(url, base, false, namespace, purpose, now).is_err());
        }
        assert!(
            PublicRoom::parse_link(
                &(url.to_owned() + "="),
                base,
                false,
                "example.rooms",
                "invitation",
                1800000000
            )
            .is_err()
        );
        let mut value = fixture["room"].clone();
        value["secretWords"] = "never put a secret in a public link".into();
        assert!(serde_json::from_value::<PublicRoom>(value).is_err());
    }
}
