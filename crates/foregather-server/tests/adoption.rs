use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use foregather_kit::{decode, encode, live::Session};
use foregather_server::{Config, GrantRequest, LiveRoom, Store, router, router_with_live};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tower::ServiceExt;
use zeroize::Zeroizing;

const NOW: u64 = 1_800_000_000;
#[test]
fn concurrent_live_payloads_cannot_exceed_the_shared_byte_budget() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let first = Arc::new(Store::open(&path, config(clock.clone(), 2, 60)).unwrap());
    let second = Arc::new(Store::open(&path, config(clock, 2, 60)).unwrap());
    let a = first.allocate_live(&[1; 32], room()).unwrap();
    let b = first.allocate_live(&[1; 32], room()).unwrap();
    let body = |sequence| {
        serde_json::json!({"v":foregather_kit::live::PROFILE,"seq":sequence,"ciphertext":encode(&vec![1;16400])}).to_string()
    };
    first
        .write_live(
            &a.room.session.locator,
            &decode(&a.inviter_token).unwrap(),
            "inviter",
            "packet-0",
            &body(0),
        )
        .unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = [
        (
            first,
            a.room.session.locator.clone(),
            a.inviter_token.clone(),
            1,
        ),
        (
            second,
            b.room.session.locator.clone(),
            b.inviter_token.clone(),
            0,
        ),
    ]
    .into_iter()
    .map(|(store, id, token, sequence)| {
        let barrier = barrier.clone();
        let body = body(sequence);
        std::thread::spawn(move || {
            barrier.wait();
            store.write_live(
                &id,
                &decode(&token).unwrap(),
                "inviter",
                &format!("packet-{sequence}"),
                &body,
            )
        })
    })
    .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(StatusCode::INSUFFICIENT_STORAGE)))
            .count(),
        1
    );
}
fn config(clock: Arc<AtomicU64>, records: u32, rate: u32) -> Config {
    Config {
        max_records: records,
        creates_per_minute: rate,
        create_token: Zeroizing::new([1; 32]),
        clock: Arc::new(move || clock.load(Ordering::SeqCst)),
    }
}
fn request(resource: &str, uses: u32) -> GrantRequest {
    GrantRequest {
        resource: resource.into(),
        expires: NOW + 300,
        max_uses: uses,
        max_invitation_lifetime: 120,
    }
}
fn room() -> LiveRoom {
    LiveRoom {
        session: Session::generate(
            foregather_kit::Namespace::parse("test.rooms").unwrap(),
            foregather_kit::Namespace::parse("invitation").unwrap(),
            120,
            NOW,
            &mut rand_core::OsRng,
        )
        .unwrap(),
        secret_format: "words".into(),
    }
}
#[test]
fn grant_authority_is_scoped_expiring_revocable_and_cannot_delegate() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock.clone(), 10, 60)).unwrap();
    assert!(matches!(
        store.grant(&[2; 32], request("stored", 2)),
        Err(StatusCode::UNAUTHORIZED)
    ));
    let grant = store.grant(&[1; 32], request("stored", 2)).unwrap();
    let token = decode(&grant.token).unwrap();
    assert!(matches!(
        store.grant(&token, request("stored", 2)),
        Err(StatusCode::UNAUTHORIZED)
    ));
    assert!(matches!(
        store.allocate_live(&token, room()),
        Err(StatusCode::UNAUTHORIZED)
    ));
    assert!(matches!(
        store.create(&token, NOW + 121),
        Err(StatusCode::UNAUTHORIZED)
    ));
    assert!(store.create(&token, NOW + 120).is_ok());
    assert_eq!(
        store.revoke_grant(&token, &grant.id),
        Err(StatusCode::UNAUTHORIZED)
    );
    store.revoke_grant(&[1; 32], &grant.id).unwrap();
    assert!(matches!(
        store.create(&token, NOW + 120),
        Err(StatusCode::UNAUTHORIZED)
    ));
    let grant = store.grant(&[1; 32], request("stored", 2)).unwrap();
    clock.store(NOW + 300, Ordering::SeqCst);
    assert!(matches!(
        store.create(&decode(&grant.token).unwrap(), NOW + 400),
        Err(StatusCode::UNAUTHORIZED)
    ));
}
#[test]
fn grant_last_use_is_atomic_across_connections_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let first = Arc::new(Store::open(&path, config(clock.clone(), 10, 60)).unwrap());
    let grant = first.grant(&[1; 32], request("stored", 1)).unwrap();
    let second = Arc::new(Store::open(&path, config(clock.clone(), 10, 60)).unwrap());
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = [first, second]
        .into_iter()
        .map(|store| {
            let token = decode(&grant.token).unwrap();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.create(&token, NOW + 120)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(StatusCode::UNAUTHORIZED)))
            .count(),
        1
    );
    let store = Store::open(path, config(clock, 10, 60)).unwrap();
    assert!(matches!(
        store.create(&decode(&grant.token).unwrap(), NOW + 120),
        Err(StatusCode::UNAUTHORIZED)
    ));
}
#[test]
fn failed_allocation_does_not_spend_a_grant_and_total_storage_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock, 1, 60)).unwrap();
    let grant = store.grant(&[1; 32], request("live", 1)).unwrap();
    let token = decode(&grant.token).unwrap();
    let stored = store.create(&[1; 32], NOW + 120).unwrap();
    assert!(matches!(
        store.allocate_live(&token, room()),
        Err(StatusCode::INSUFFICIENT_STORAGE)
    ));
    store
        .delete(&stored.id, &decode(&stored.delete_token).unwrap())
        .unwrap();
    let live = store.allocate_live(&token, room()).unwrap();
    assert!(matches!(
        store.create(&[1; 32], NOW + 120),
        Err(StatusCode::INSUFFICIENT_STORAGE)
    ));
    store
        .delete_live(
            &live.room.session.locator,
            &decode(&live.delete_token).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        store.allocate_live(&token, room()),
        Err(StatusCode::UNAUTHORIZED)
    ));
}
#[test]
fn live_roles_claim_retry_message_retry_and_delete_are_separate_authorities() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock, 10, 60)).unwrap();
    let a = store.allocate_live(&[1; 32], room()).unwrap();
    let id = &a.room.session.locator;
    assert_eq!(
        store
            .lookup_live(&a.room_code.to_lowercase())
            .unwrap()
            .session
            .locator,
        *id
    );
    let host = decode(&a.inviter_token).unwrap();
    let delete = decode(&a.delete_token).unwrap();
    let guest = [3; 32];
    store.claim_live(id, &guest).unwrap();
    store.claim_live(id, &guest).unwrap();
    assert_eq!(store.claim_live(id, &[4; 32]), Err(StatusCode::NOT_FOUND));
    let hello = serde_json::to_string(&encode(&[7; 33])).unwrap();
    assert_eq!(
        store.write_live(id, &guest, "inviter", "hello", &hello),
        Err(StatusCode::NOT_FOUND)
    );
    assert_eq!(
        store.write_live(id, &delete, "inviter", "hello", &hello),
        Err(StatusCode::NOT_FOUND)
    );
    store
        .write_live(id, &host, "inviter", "hello", &hello)
        .unwrap();
    store
        .write_live(id, &host, "inviter", "hello", &hello)
        .unwrap();
    assert_eq!(
        store.write_live(
            id,
            &host,
            "inviter",
            "hello",
            &serde_json::to_string(&encode(&[8; 33])).unwrap()
        ),
        Err(StatusCode::CONFLICT)
    );
    assert_eq!(
        store.read_live(id, &guest, "inviter", "hello").unwrap(),
        hello
    );
    assert_eq!(
        store.read_live(id, &[4; 32], "inviter", "hello"),
        Err(StatusCode::NOT_FOUND)
    );
    assert_eq!(store.delete_live(id, &host), Err(StatusCode::NOT_FOUND));
    store.delete_live(id, &delete).unwrap();
    assert!(matches!(
        store.lookup_live(&a.room_code),
        Err(StatusCode::NOT_FOUND)
    ));
    assert_eq!(
        store.read_live(id, &guest, "inviter", "hello"),
        Err(StatusCode::NOT_FOUND)
    );
    let db = rusqlite::Connection::open(dir.path().join("db")).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM live_messages", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
}
#[test]
fn live_messages_and_aliases_survive_restart_but_expire_without_extending_lifetime() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(&path, config(clock.clone(), 10, 60)).unwrap();
    let a = store.allocate_live(&[1; 32], room()).unwrap();
    let host = decode(&a.inviter_token).unwrap();
    let id = &a.room.session.locator;
    let proof = serde_json::to_string(&encode(&[6; 32])).unwrap();
    store
        .write_live(id, &host, "inviter", "proof", &proof)
        .unwrap();
    drop(store);
    let store = Store::open(&path, config(clock.clone(), 10, 60)).unwrap();
    assert_eq!(
        store.read_live(id, &host, "inviter", "proof").unwrap(),
        proof
    );
    assert!(store.lookup_live(&a.room_code).is_ok());
    for kind in ["packet-32", "packet-000", "packet--1", "secret"] {
        assert_eq!(
            store.write_live(id, &host, "inviter", kind, "{}"),
            Err(StatusCode::BAD_REQUEST)
        );
    }
    assert_eq!(
        store.write_live(id, &host, "inviter", "packet-0", &" ".repeat(24577)),
        Err(StatusCode::PAYLOAD_TOO_LARGE)
    );
    clock.store(NOW + 120, Ordering::SeqCst);
    assert_eq!(
        store.read_live(id, &host, "inviter", "proof"),
        Err(StatusCode::NOT_FOUND)
    );
    assert!(matches!(
        store.lookup_live(&a.room_code),
        Err(StatusCode::NOT_FOUND)
    ));
    assert_eq!(store.claim_live(id, &[3; 32]), Err(StatusCode::NOT_FOUND));
}
#[test]
fn unsuccessful_directory_lookups_spend_a_durable_budget_and_rollback_fails_closed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(&path, config(clock.clone(), 10, 1)).unwrap();
    for _ in 0..120 {
        assert!(matches!(
            store.lookup_live("ABC234"),
            Err(StatusCode::NOT_FOUND)
        ));
    }
    drop(store);
    let store = Store::open(&path, config(clock.clone(), 10, 1)).unwrap();
    assert!(matches!(
        store.lookup_live("ABC234"),
        Err(StatusCode::TOO_MANY_REQUESTS)
    ));
    clock.store(NOW - 1, Ordering::SeqCst);
    assert!(matches!(
        store.lookup_live("ABC234"),
        Err(StatusCode::SERVICE_UNAVAILABLE)
    ));
}
#[tokio::test]
async fn live_routes_are_opt_in_and_never_accept_query_capabilities() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Arc::new(Store::open(dir.path().join("db"), config(clock, 10, 60)).unwrap());
    let response = router(store.clone())
        .oneshot(
            Request::builder()
                .uri("/v1/live-sessions/rooms/ABC234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = router_with_live(store)
        .oneshot(
            Request::builder()
                .uri("/v1/live-sessions/rooms/ABC234?token=synthetic")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers()["cache-control"], "no-store");
}
