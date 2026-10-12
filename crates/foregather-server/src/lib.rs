//! Ciphertext storage, not an admission authority. All capabilities travel in headers.
#![forbid(unsafe_code)]
use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use foregather_kit::{Envelope, Locator, MAX_ENVELOPE_BYTES, decode, encode, lifetime};
use rand_core::{OsRng, RngCore};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path as FilePath,
    sync::{Arc, Mutex},
    time::Duration,
};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

type ApiResult<T> = Result<T, StatusCode>;
pub struct Config {
    pub max_records: u32,
    pub creates_per_minute: u32,
    pub create_token: Zeroizing<[u8; 32]>,
    pub clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}
pub struct Store {
    db: Mutex<Connection>,
    jobs: Arc<tokio::sync::Semaphore>,
    config: Config,
    create_hash: [u8; 32],
}
#[derive(Serialize)]
pub struct Allocation {
    pub id: String,
    pub expires: u64,
    pub upload_token: String,
    pub delete_token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    expires: u64,
}

fn hash(purpose: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"foregather-resolver/v1\0");
    h.update(purpose);
    h.update([0]);
    h.update(bytes);
    h.finalize().into()
}
fn bearer(headers: &HeaderMap) -> Option<Zeroizing<Vec<u8>>> {
    let value = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;
    if value.len() != 43 {
        return None;
    }
    let bytes = Zeroizing::new(decode(value).ok()?);
    (bytes.len() == 32).then_some(bytes)
}
fn equal(expected: &[u8], supplied: &[u8]) -> bool {
    expected.ct_eq(supplied).into()
}
fn random_token() -> ApiResult<Zeroizing<[u8; 32]>> {
    let mut value = Zeroizing::new([0; 32]);
    OsRng
        .try_fill_bytes(value.as_mut())
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(value)
}

impl Store {
    pub fn open(
        path: impl AsRef<FilePath>,
        config: Config,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        if config.max_records == 0
            || config.max_records > 100_000
            || config.creates_per_minute == 0
            || config.creates_per_minute > 10_000
        {
            return Err("invalid resolver limits".into());
        }
        let path = path.as_ref();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty())
            && !parent.exists()
        {
            std::fs::create_dir_all(parent)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(path)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        let db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(2))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS invitations (
                id TEXT PRIMARY KEY, expires INTEGER NOT NULL, upload_deadline INTEGER NOT NULL,
                upload_hash BLOB NOT NULL, delete_hash BLOB NOT NULL, envelope TEXT);
            CREATE INDEX IF NOT EXISTS invitation_expiry ON invitations(expires);
            CREATE TABLE IF NOT EXISTS create_rate (singleton INTEGER PRIMARY KEY CHECK(singleton=1), started INTEGER NOT NULL, count INTEGER NOT NULL);")?;
        let create_hash = hash(b"create", config.create_token.as_ref());
        Ok(Self {
            db: Mutex::new(db),
            jobs: Arc::new(tokio::sync::Semaphore::new(32)),
            config,
            create_hash,
        })
    }
    pub fn create(&self, token: &[u8], expires: u64) -> ApiResult<Allocation> {
        if !equal(&self.create_hash, &hash(b"create", token)) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let now = (self.config.clock)();
        lifetime(expires, now).map_err(|_| StatusCode::BAD_REQUEST)?;
        let now = now as i64;
        let mut db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        tx.execute("DELETE FROM invitations WHERE expires<=?1 OR (envelope IS NULL AND upload_deadline<=?1)", [now]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let count: u32 = tx
            .query_row("SELECT COUNT(*) FROM invitations", [], |row| row.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if count >= self.config.max_records {
            return Err(StatusCode::INSUFFICIENT_STORAGE);
        }
        let rate: Option<(i64, u32)> = tx
            .query_row(
                "SELECT started,count FROM create_rate WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let (started, used) = match rate {
            Some((started, _)) if now < started => return Err(StatusCode::SERVICE_UNAVAILABLE),
            Some((started, count)) if now - started < 60 => (started, count),
            _ => (now, 0),
        };
        if used >= self.config.creates_per_minute {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        let upload = random_token()?;
        let delete = random_token()?;
        let mut id = None;
        for _ in 0..8 {
            let candidate = Locator::generate(&mut OsRng)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
                .encoded();
            let inserted = tx.execute("INSERT OR IGNORE INTO invitations(id,expires,upload_deadline,upload_hash,delete_hash) VALUES(?1,?2,?3,?4,?5)",
                params![candidate, expires as i64, (expires as i64).min(now+300), hash(b"upload", upload.as_ref()).as_slice(), hash(b"delete", delete.as_ref()).as_slice()]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            if inserted == 1 {
                id = Some(candidate);
                break;
            }
        }
        let id = id.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        tx.execute("INSERT INTO create_rate VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET started=excluded.started,count=excluded.count", params![started, used+1]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(Allocation {
            id,
            expires,
            upload_token: encode(upload.as_ref()),
            delete_token: encode(delete.as_ref()),
        })
    }
    pub fn upload(&self, id: &str, token: &[u8], text: &str) -> ApiResult<()> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let now = (self.config.clock)();
        let envelope = Envelope::parse(text, now).map_err(|_| StatusCode::BAD_REQUEST)?;
        let now = now as i64;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let record: Option<(i64,i64,Vec<u8>,bool)> = db.query_row("SELECT expires,upload_deadline,upload_hash,envelope IS NOT NULL FROM invitations WHERE id=?1", [id],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let (expires, deadline, expected, uploaded) = record.ok_or(StatusCode::NOT_FOUND)?;
        if !equal(&expected, &hash(b"upload", token)) || expires <= now || deadline <= now {
            return Err(StatusCode::NOT_FOUND);
        }
        if uploaded {
            return Err(StatusCode::CONFLICT);
        }
        if expires != envelope.expires as i64 {
            return Err(StatusCode::BAD_REQUEST);
        }
        // The local mutex serialises writers; the conditional statement also guards multiple processes.
        let changed = db.execute("UPDATE invitations SET envelope=?1 WHERE id=?2 AND envelope IS NULL AND expires>?3 AND upload_deadline>?3", params![text,id,now]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if changed != 1 {
            return Err(StatusCode::CONFLICT);
        }
        Ok(())
    }
    pub fn fetch(&self, id: &str) -> ApiResult<String> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let now = (self.config.clock)();
        if now > foregather_kit::MAX_SAFE_SECONDS {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        db.query_row(
            "SELECT envelope FROM invitations WHERE id=?1 AND expires>?2 AND envelope IS NOT NULL",
            params![id, now as i64],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)
    }
    pub fn delete(&self, id: &str, token: &[u8]) -> ApiResult<()> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let expected: Option<Vec<u8>> = db
            .query_row(
                "SELECT delete_hash FROM invitations WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if !expected.is_some_and(|expected| equal(&expected, &hash(b"delete", token))) {
            return Err(StatusCode::NOT_FOUND);
        }
        db.execute(
            "DELETE FROM invitations WHERE id=?1 AND delete_hash=?2",
            params![id, hash(b"delete", token).as_slice()],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(())
    }
}
use rusqlite::OptionalExtension;

// A timed-out HTTP future cannot release this permit while SQLite work continues.
async fn db_job<T: Send + 'static>(
    store: Arc<Store>,
    work: impl FnOnce(&Store) -> ApiResult<T> + Send + 'static,
) -> ApiResult<T> {
    let permit = store
        .jobs
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work(&store)
    })
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
}

async fn create(
    State(store): State<Arc<Store>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let request: Create = serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let result = db_job(store, move |store| store.create(&token, request.expires)).await?;
    Ok((StatusCode::CREATED, axum::Json(result)))
}
async fn upload(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::NOT_FOUND)?;
    let text = String::from_utf8(body.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;
    db_job(store, move |store| store.upload(&id, &token, &text)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn fetch(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> ApiResult<impl IntoResponse> {
    let text = db_job(store, move |store| store.fetch(&id)).await?;
    Ok(([(header::CONTENT_TYPE, "application/json")], text))
}
async fn delete(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::NOT_FOUND)?;
    db_job(store, move |store| store.delete(&id, &token)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn protections(request: axum::extract::Request, next: Next) -> Response {
    // Capability-bearing queries are never accepted. Fragments do not cross HTTP.
    let mut response = if request.uri().query().is_some() {
        StatusCode::BAD_REQUEST.into_response()
    } else {
        match tokio::time::timeout(Duration::from_secs(5), next.run(request)).await {
            Ok(response) => response,
            Err(_) => StatusCode::REQUEST_TIMEOUT.into_response(),
        }
    };
    let headers = response.headers_mut();
    for (name, value) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        (
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        ),
        ("x-frame-options", "DENY"),
    ] {
        headers.insert(
            axum::http::HeaderName::from_static(name),
            axum::http::HeaderValue::from_static(value),
        );
    }
    response
}
pub fn router(store: Arc<Store>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/invitations", post(create))
        .route(
            "/v1/invitations/{id}",
            get(fetch).put(upload).delete(delete),
        )
        .with_state(store)
        .layer(DefaultBodyLimit::max(MAX_ENVELOPE_BYTES))
        .layer(tower::limit::ConcurrencyLimitLayer::new(32))
        .layer(middleware::from_fn(protections))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancelled_http_work_retains_its_database_budget_until_completion() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            max_records: 10,
            creates_per_minute: 10,
            create_token: Zeroizing::new([1; 32]),
            clock: Arc::new(|| 1_800_000_000),
        };
        let mut store = Store::open(dir.path().join("db"), config).unwrap();
        store.jobs = Arc::new(tokio::sync::Semaphore::new(1));
        let store = Arc::new(store);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let client = tokio::spawn(db_job(store.clone(), move |_| {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(())
        }));
        started_rx.await.unwrap();
        client.abort();
        let _ = client.await;
        assert_eq!(store.jobs.available_permits(), 0);
        let second = tokio::spawn(db_job(store.clone(), move |_| Ok(42)));
        tokio::task::yield_now().await;
        assert!(!second.is_finished());
        release_tx.send(()).unwrap();
        assert_eq!(second.await.unwrap().unwrap(), 42);
        assert_eq!(store.jobs.available_permits(), 1);
    }
}
