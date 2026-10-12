use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use foregather_kit::{Locator, Namespace, Profile, decode, seal};
use foregather_server::{Config, Store, router};
use rand_core::OsRng;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tower::ServiceExt;
use zeroize::Zeroizing;

const NOW: u64 = 1_800_000_000;
fn config(clock: Arc<AtomicU64>, records: u32, rate: u32) -> Config {
    Config {
        max_records: records,
        creates_per_minute: rate,
        create_token: Zeroizing::new([1; 32]),
        clock: Arc::new(move || clock.load(Ordering::SeqCst)),
    }
}
fn encrypted(id: &str, expires: u64) -> String {
    seal(
        &Profile::V1(Namespace::parse("test.rooms").unwrap()),
        Locator::parse(id).unwrap(),
        b"room invitation",
        expires,
        NOW,
        &mut OsRng,
    )
    .unwrap()
    .1
    .to_json()
    .unwrap()
}

#[test]
fn upload_and_delete_authority_are_separate_and_upload_is_write_once() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock, 10, 10)).unwrap();
    assert!(matches!(
        store.create(&[2; 32], NOW + 3600),
        Err(StatusCode::UNAUTHORIZED)
    ));
    let allocation = store.create(&[1; 32], NOW + 3600).unwrap();
    let text = encrypted(&allocation.id, allocation.expires);
    let upload = decode(&allocation.upload_token).unwrap();
    let delete = decode(&allocation.delete_token).unwrap();
    assert!(matches!(
        store.fetch(&allocation.id),
        Err(StatusCode::NOT_FOUND)
    ));
    assert_eq!(
        store.upload(&allocation.id, &delete, &text),
        Err(StatusCode::NOT_FOUND)
    );
    store.upload(&allocation.id, &upload, &text).unwrap();
    assert_eq!(store.fetch(&allocation.id).unwrap(), text);
    assert_eq!(
        store.upload(&allocation.id, &upload, &text),
        Err(StatusCode::CONFLICT)
    );
    assert_eq!(
        store.delete(&allocation.id, &upload),
        Err(StatusCode::NOT_FOUND)
    );
    store.delete(&allocation.id, &delete).unwrap();
    assert!(matches!(
        store.fetch(&allocation.id),
        Err(StatusCode::NOT_FOUND)
    ));
    assert_eq!(
        store.delete(&allocation.id, &delete),
        Err(StatusCode::NOT_FOUND)
    );
}

#[test]
fn ciphertext_expiry_and_creation_budget_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(&path, config(clock.clone(), 10, 1)).unwrap();
    let a = store.create(&[1; 32], NOW + 120).unwrap();
    let text = encrypted(&a.id, a.expires);
    store
        .upload(&a.id, &decode(&a.upload_token).unwrap(), &text)
        .unwrap();
    drop(store);
    let store = Store::open(&path, config(clock.clone(), 10, 1)).unwrap();
    assert_eq!(store.fetch(&a.id).unwrap(), text);
    assert!(matches!(
        store.create(&[1; 32], NOW + 120),
        Err(StatusCode::TOO_MANY_REQUESTS)
    ));
    clock.store(NOW + 120, Ordering::SeqCst);
    assert!(matches!(store.fetch(&a.id), Err(StatusCode::NOT_FOUND)));
    assert!(store.create(&[1; 32], NOW + 180).is_ok());
}

#[test]
fn capacity_is_bounded_and_abandoned_allocations_release_slots() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock.clone(), 1, 10)).unwrap();
    let a = store.create(&[1; 32], NOW + 3600).unwrap();
    assert!(matches!(
        store.create(&[1; 32], NOW + 3600),
        Err(StatusCode::INSUFFICIENT_STORAGE)
    ));
    clock.store(NOW + 300, Ordering::SeqCst);
    assert_eq!(
        store.upload(
            &a.id,
            &decode(&a.upload_token).unwrap(),
            &encrypted(&a.id, a.expires)
        ),
        Err(StatusCode::NOT_FOUND)
    );
    assert!(store.create(&[1; 32], NOW + 3600).is_ok());
}

#[test]
fn altered_expiry_and_hostile_envelopes_are_not_stored() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(dir.path().join("db"), config(clock, 10, 10)).unwrap();
    let a = store.create(&[1; 32], NOW + 3600).unwrap();
    let token = decode(&a.upload_token).unwrap();
    assert_eq!(
        store.upload(&a.id, &token, &encrypted(&a.id, NOW + 3599)),
        Err(StatusCode::BAD_REQUEST)
    );
    for text in ["null".into(), "{}".into(), " ".repeat(32769)] {
        assert_eq!(
            store.upload(&a.id, &token, &text),
            Err(StatusCode::BAD_REQUEST)
        );
    }
    assert!(matches!(store.fetch(&a.id), Err(StatusCode::NOT_FOUND)));
}

#[test]
fn simultaneous_writers_commit_at_most_one_upload() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let path = dir.path().join("db");
    let first = Arc::new(Store::open(&path, config(clock.clone(), 10, 10)).unwrap());
    let second = Arc::new(Store::open(&path, config(clock, 10, 10)).unwrap());
    let a = first.create(&[1; 32], NOW + 3600).unwrap();
    let text = encrypted(&a.id, a.expires);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = [first, second]
        .into_iter()
        .map(|store| {
            let id = a.id.clone();
            let token = decode(&a.upload_token).unwrap();
            let text = text.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.upload(&id, &token, &text)
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| **r == Err(StatusCode::CONFLICT))
            .count(),
        1
    );
}

#[tokio::test]
async fn http_limits_queries_auth_and_headers() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(NOW));
    let app = router(Arc::new(
        Store::open(dir.path().join("db"), config(clock, 10, 10)).unwrap(),
    ));
    for (uri, body, status) in [
        (
            "/v1/invitations?secret=leak",
            "{}".into(),
            StatusCode::BAD_REQUEST,
        ),
        ("/v1/invitations", "{}".into(), StatusCode::UNAUTHORIZED),
        (
            "/v1/invitations",
            " ".repeat(32769),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
    }
}

#[test]
fn database_stores_no_plaintext_management_capabilities() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let clock = Arc::new(AtomicU64::new(NOW));
    let store = Store::open(&path, config(clock, 10, 10)).unwrap();
    let a = store.create(&[1; 32], NOW + 3600).unwrap();
    drop(store);
    let bytes = std::fs::read(&path).unwrap();
    for token in [&a.upload_token, &a.delete_token] {
        assert!(!bytes.windows(token.len()).any(|b| b == token.as_bytes()));
        let raw = decode(token).unwrap();
        assert!(!bytes.windows(raw.len()).any(|b| b == raw));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
