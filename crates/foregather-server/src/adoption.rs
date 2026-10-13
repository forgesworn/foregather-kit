//! Optional experimental live transport and operator-issued creation grants.
use super::*;
use foregather_kit::live::{RendezvousCode, Session};
use rusqlite::Transaction;

pub(crate) const SCHEMA: &str = "
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS creation_grants (
        id TEXT PRIMARY KEY, token_hash BLOB UNIQUE NOT NULL,
        resource TEXT NOT NULL, expires INTEGER NOT NULL,
        remaining INTEGER NOT NULL, max_lifetime INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resource_rate (
        name TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS live_sessions (
        locator TEXT PRIMARY KEY, alias TEXT UNIQUE NOT NULL,
        session TEXT NOT NULL, secret_format TEXT NOT NULL,
        expires INTEGER NOT NULL, inviter_hash BLOB NOT NULL,
        recipient_hash BLOB, delete_hash BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS live_expiry ON live_sessions(expires);
    CREATE TABLE IF NOT EXISTS live_messages (
        locator TEXT NOT NULL REFERENCES live_sessions(locator) ON DELETE CASCADE,
        role TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(locator,role,kind));";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GrantRequest {
    pub resource: String,
    pub expires: u64,
    pub max_uses: u32,
    pub max_invitation_lifetime: u64,
}
#[derive(Serialize)]
pub struct CreationGrant {
    pub id: String,
    pub token: String,
    pub resource: String,
    pub expires: u64,
    pub remaining: u32,
    pub max_invitation_lifetime: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LiveRoom {
    pub session: Session,
    pub secret_format: String,
}
#[derive(Serialize)]
pub struct LiveAllocation {
    pub room: LiveRoom,
    pub room_code: String,
    pub inviter_token: String,
    pub delete_token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtectedPacket {
    v: String,
    seq: u32,
    ciphertext: String,
}
fn db_error(_: rusqlite::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn trusted_now(store: &Store) -> ApiResult<u64> {
    let now = (store.config.clock)();
    if now > foregather_kit::MAX_SAFE_SECONDS {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(now)
}
fn operator(store: &Store, token: &[u8]) -> bool {
    token.len() == 32 && equal(&store.create_hash, &hash(b"create", token))
}
fn rate(tx: &Transaction<'_>, name: &str, limit: u32, now: u64) -> ApiResult<()> {
    let now = now as i64;
    let old: Option<(i64, u32)> = tx
        .query_row(
            "SELECT started,count FROM resource_rate WHERE name=?1",
            [name],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    let (start, used) = match old {
        Some((start, _)) if now < start => return Err(StatusCode::SERVICE_UNAVAILABLE),
        Some((start, count)) if now - start < 60 => (start, count),
        _ => (now, 0),
    };
    if used >= limit {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    tx.execute("INSERT INTO resource_rate VALUES(?1,?2,?3) ON CONFLICT(name) DO UPDATE SET started=excluded.started,count=excluded.count", params![name,start,used+1]).map_err(db_error)?;
    Ok(())
}
pub(crate) fn reserve_creation(
    store: &Store,
    tx: &Transaction<'_>,
    token: &[u8],
    resource: &str,
    expires: u64,
    now: u64,
) -> ApiResult<()> {
    let now = now as i64;
    let expires = expires as i64;
    if token.len() != 32 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !operator(store, token) {
        let changed = tx.execute("UPDATE creation_grants SET remaining=remaining-1 WHERE token_hash=?1 AND resource=?2 AND expires>?3 AND remaining>0 AND ?4>?3 AND ?4-?3<=max_lifetime", params![hash(b"grant",token).as_slice(),resource,now,expires]).map_err(db_error)?;
        if changed != 1 {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }
    tx.execute(
        "DELETE FROM invitations WHERE expires<=?1 OR (envelope IS NULL AND upload_deadline<=?1)",
        [now],
    )
    .map_err(db_error)?;
    tx.execute("DELETE FROM live_sessions WHERE expires<=?1", [now])
        .map_err(db_error)?;
    let count: u32 = tx
        .query_row(
            "SELECT (SELECT COUNT(*) FROM invitations)+(SELECT COUNT(*) FROM live_sessions)",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if count >= store.config.max_records {
        return Err(StatusCode::INSUFFICIENT_STORAGE);
    }
    // Preserve the original durable stored-mode creation window across upgrade.
    let old: Option<(i64, u32)> = tx
        .query_row(
            "SELECT started,count FROM create_rate WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    let (start, used) = match old {
        Some((start, _)) if now < start => return Err(StatusCode::SERVICE_UNAVAILABLE),
        Some((start, count)) if now - start < 60 => (start, count),
        _ => (now, 0),
    };
    if used >= store.config.creates_per_minute {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    tx.execute("INSERT INTO create_rate VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET started=excluded.started,count=excluded.count", params![start,used+1]).map_err(db_error)?;
    Ok(())
}
pub(crate) fn reserve_payload(
    store: &Store,
    tx: &Transaction<'_>,
    bytes: usize,
    now: u64,
) -> ApiResult<()> {
    let used:i64=tx.query_row("SELECT COALESCE((SELECT SUM(length(CAST(envelope AS BLOB))) FROM invitations WHERE expires>?1),0)+COALESCE((SELECT SUM(length(CAST(body AS BLOB))) FROM live_messages JOIN live_sessions USING(locator) WHERE live_sessions.expires>?1),0)",[now as i64],|row|row.get(0)).map_err(db_error)?;
    if used as u64 + bytes as u64 > store.config.max_records as u64 * MAX_ENVELOPE_BYTES as u64 {
        return Err(StatusCode::INSUFFICIENT_STORAGE);
    }
    Ok(())
}
impl Store {
    pub fn grant(&self, token: &[u8], request: GrantRequest) -> ApiResult<CreationGrant> {
        if !operator(self, token) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let now = trusted_now(self)?;
        if !["stored", "live"].contains(&request.resource.as_str())
            || request.max_uses == 0
            || request.max_uses > 1000
            || request.max_invitation_lifetime == 0
            || request.max_invitation_lifetime > foregather_kit::MAX_LIFETIME_SECONDS
            || request.expires <= now
            || request.expires > foregather_kit::MAX_SAFE_SECONDS
            || request.expires - now > 86400
            || request.resource == "live" && request.max_invitation_lifetime > 600
        {
            return Err(StatusCode::BAD_REQUEST);
        }
        let mut db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        tx.execute(
            "DELETE FROM creation_grants WHERE expires<=?1",
            [now as i64],
        )
        .map_err(db_error)?;
        let count: u32 = tx
            .query_row("SELECT COUNT(*) FROM creation_grants", [], |r| r.get(0))
            .map_err(db_error)?;
        if count >= self.config.max_records {
            return Err(StatusCode::INSUFFICIENT_STORAGE);
        }
        rate(&tx, "grant", self.config.creates_per_minute, now)?;
        let capability = random_token()?;
        let mut id = None;
        for _ in 0..8 {
            let candidate = Locator::generate(&mut OsRng)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
                .encoded();
            if tx
                .execute(
                    "INSERT OR IGNORE INTO creation_grants VALUES(?1,?2,?3,?4,?5,?6)",
                    params![
                        candidate,
                        hash(b"grant", capability.as_ref()).as_slice(),
                        request.resource,
                        request.expires as i64,
                        request.max_uses,
                        request.max_invitation_lifetime as i64
                    ],
                )
                .map_err(db_error)?
                == 1
            {
                id = Some(candidate);
                break;
            }
        }
        let id = id.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        tx.commit().map_err(db_error)?;
        Ok(CreationGrant {
            id,
            token: encode(capability.as_ref()),
            resource: request.resource,
            expires: request.expires,
            remaining: request.max_uses,
            max_invitation_lifetime: request.max_invitation_lifetime,
        })
    }
    pub fn revoke_grant(&self, token: &[u8], id: &str) -> ApiResult<()> {
        if !operator(self, token) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if db
            .execute("DELETE FROM creation_grants WHERE id=?1", [id])
            .map_err(db_error)?
            != 1
        {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(())
    }
    pub fn allocate_live(&self, token: &[u8], room: LiveRoom) -> ApiResult<LiveAllocation> {
        let now = trusted_now(self)?;
        if !["words", "characters"].contains(&room.secret_format.as_str()) {
            return Err(StatusCode::BAD_REQUEST);
        }
        let session = serde_json::to_string(&room.session).map_err(|_| StatusCode::BAD_REQUEST)?;
        Session::parse(&session, now).map_err(|_| StatusCode::BAD_REQUEST)?;
        let mut db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        reserve_creation(self, &tx, token, "live", room.session.expires, now)?;
        let inviter = random_token()?;
        let delete = random_token()?;
        let mut alias = None;
        for _ in 0..8 {
            let candidate = RendezvousCode::generate(6, &mut OsRng)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
            if tx
                .execute(
                    "INSERT OR IGNORE INTO live_sessions VALUES(?1,?2,?3,?4,?5,?6,NULL,?7)",
                    params![
                        room.session.locator,
                        candidate.as_str(),
                        session,
                        room.secret_format,
                        room.session.expires as i64,
                        hash(b"live-inviter", inviter.as_ref()).as_slice(),
                        hash(b"live-delete", delete.as_ref()).as_slice()
                    ],
                )
                .map_err(db_error)?
                == 1
            {
                alias = Some(candidate.as_str().to_owned());
                break;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM live_sessions WHERE locator=?1)",
                    [&room.session.locator],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if exists {
                return Err(StatusCode::CONFLICT);
            }
        }
        let room_code = alias.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        tx.commit().map_err(db_error)?;
        Ok(LiveAllocation {
            room,
            room_code,
            inviter_token: encode(inviter.as_ref()),
            delete_token: encode(delete.as_ref()),
        })
    }
    pub fn lookup_live(&self, code: &str) -> ApiResult<LiveRoom> {
        let code = RendezvousCode::parse(code).map_err(|_| StatusCode::BAD_REQUEST)?;
        if code.as_str().len() != 6 {
            return Err(StatusCode::BAD_REQUEST);
        }
        let now = trusted_now(self)?;
        let mut db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        rate(
            &tx,
            "live-lookup",
            self.config.creates_per_minute.saturating_mul(2).max(120),
            now,
        )?;
        let result: Option<(String, String)> = tx
            .query_row(
                "SELECT session,secret_format FROM live_sessions WHERE alias=?1 AND expires>?2",
                params![code.as_str(), now as i64],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        // Failed lookups also spend the durable directory budget.
        tx.commit().map_err(db_error)?;
        let (session, secret_format) = result.ok_or(StatusCode::NOT_FOUND)?;
        Ok(LiveRoom {
            session: Session::parse(&session, now).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?,
            secret_format,
        })
    }
    pub fn claim_live(&self, id: &str, token: &[u8]) -> ApiResult<()> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        if token.len() != 32 {
            return Err(StatusCode::BAD_REQUEST);
        }
        let now = trusted_now(self)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let digest = hash(b"live-recipient", token);
        let changed=db.execute("UPDATE live_sessions SET recipient_hash=?1 WHERE locator=?2 AND expires>?3 AND (recipient_hash IS NULL OR recipient_hash=?1)",params![digest.as_slice(),id,now as i64]).map_err(db_error)?;
        if changed != 1 {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(())
    }
    pub fn delete_live(&self, id: &str, token: &[u8]) -> ApiResult<()> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if db
            .execute(
                "DELETE FROM live_sessions WHERE locator=?1 AND delete_hash=?2",
                params![id, hash(b"live-delete", token).as_slice()],
            )
            .map_err(db_error)?
            != 1
        {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(())
    }
    fn live_authority(
        &self,
        db: &Connection,
        id: &str,
        token: &[u8],
        now: u64,
    ) -> ApiResult<&'static str> {
        Locator::parse(id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let record:Option<(Vec<u8>,Option<Vec<u8>>)>=db.query_row("SELECT inviter_hash,recipient_hash FROM live_sessions WHERE locator=?1 AND expires>?2",params![id,now as i64],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        let (inviter, recipient) = record.ok_or(StatusCode::NOT_FOUND)?;
        if equal(&inviter, &hash(b"live-inviter", token)) {
            return Ok("inviter");
        }
        if recipient.is_some_and(|value| equal(&value, &hash(b"live-recipient", token))) {
            return Ok("recipient");
        }
        Err(StatusCode::NOT_FOUND)
    }
    pub fn write_live(
        &self,
        id: &str,
        token: &[u8],
        role: &str,
        kind: &str,
        body: &str,
    ) -> ApiResult<()> {
        message_kind(role, kind)?;
        if body.len() > 24576 {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        let value: serde_json::Value =
            serde_json::from_str(body).map_err(|_| StatusCode::BAD_REQUEST)?;
        match kind {
            "hello" | "proof" => {
                let text = value.as_str().ok_or(StatusCode::BAD_REQUEST)?;
                let bytes = decode(text).map_err(|_| StatusCode::BAD_REQUEST)?;
                if bytes.len() != if kind == "hello" { 33 } else { 32 } {
                    return Err(StatusCode::BAD_REQUEST);
                }
            }
            _ => {
                let packet: ProtectedPacket =
                    serde_json::from_value(value).map_err(|_| StatusCode::BAD_REQUEST)?;
                let ciphertext = decode(&packet.ciphertext).map_err(|_| StatusCode::BAD_REQUEST)?;
                if packet.v != foregather_kit::live::PROFILE
                    || kind != format!("packet-{}", packet.seq)
                    || !(16..=16400).contains(&ciphertext.len())
                {
                    return Err(StatusCode::BAD_REQUEST);
                }
            }
        }
        let now = trusted_now(self)?;
        let mut db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        if self.live_authority(&tx, id, token, now)? != role {
            return Err(StatusCode::NOT_FOUND);
        }
        let old: Option<String> = tx
            .query_row(
                "SELECT body FROM live_messages WHERE locator=?1 AND role=?2 AND kind=?3",
                params![id, role, kind],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if let Some(old) = old {
            return if old == body {
                Ok(())
            } else {
                Err(StatusCode::CONFLICT)
            };
        }
        reserve_payload(self, &tx, body.len(), now)?;
        tx.execute(
            "INSERT INTO live_messages VALUES(?1,?2,?3,?4)",
            params![id, role, kind, body],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(())
    }
    pub fn read_live(&self, id: &str, token: &[u8], role: &str, kind: &str) -> ApiResult<String> {
        message_kind(role, kind)?;
        let now = trusted_now(self)?;
        let db = self
            .db
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        self.live_authority(&db, id, token, now)?;
        db.query_row(
            "SELECT body FROM live_messages WHERE locator=?1 AND role=?2 AND kind=?3",
            params![id, role, kind],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(StatusCode::NOT_FOUND)
    }
}
fn message_kind(role: &str, kind: &str) -> ApiResult<()> {
    if !["inviter", "recipient"].contains(&role) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if ["hello", "proof"].contains(&kind) {
        return Ok(());
    }
    let number = kind
        .strip_prefix("packet-")
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value < 32)
        .ok_or(StatusCode::BAD_REQUEST)?;
    if kind != format!("packet-{number}") {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}
async fn grant(
    State(store): State<Arc<Store>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let request: GrantRequest =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok((
        StatusCode::CREATED,
        axum::Json(db_job(store, move |store| store.grant(&token, request)).await?),
    ))
}
async fn revoke(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    db_job(store, move |store| store.revoke_grant(&token, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn allocate(
    State(store): State<Arc<Store>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let room: LiveRoom = serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok((
        StatusCode::CREATED,
        axum::Json(db_job(store, move |store| store.allocate_live(&token, room)).await?),
    ))
}
async fn lookup(
    State(store): State<Arc<Store>>,
    Path(code): Path<String>,
) -> ApiResult<impl IntoResponse> {
    Ok(axum::Json(
        db_job(store, move |store| store.lookup_live(&code)).await?,
    ))
}
async fn claim(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::BAD_REQUEST)?;
    db_job(store, move |store| store.claim_live(&id, &token)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn delete_session(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::NOT_FOUND)?;
    db_job(store, move |store| store.delete_live(&id, &token)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn write(
    State(store): State<Arc<Store>>,
    Path((id, role, kind)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let token = bearer(&headers).ok_or(StatusCode::NOT_FOUND)?;
    let body = String::from_utf8(body.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;
    db_job(store, move |store| {
        store.write_live(&id, &token, &role, &kind, &body)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn read(
    State(store): State<Arc<Store>>,
    Path((id, role, kind)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> ApiResult<impl IntoResponse> {
    let token = bearer(&headers).ok_or(StatusCode::NOT_FOUND)?;
    Ok((
        [(header::CONTENT_TYPE, "application/json")],
        db_job(store, move |store| {
            store.read_live(&id, &token, &role, &kind)
        })
        .await?,
    ))
}
pub(crate) fn grant_routes() -> Router<Arc<Store>> {
    Router::new()
        .route("/v1/creation-grants", post(grant))
        .route("/v1/creation-grants/{id}", axum::routing::delete(revoke))
}
/// Explicit opt-in to experimental live transport; the normal router stays stored-only.
pub fn router_with_live(store: Arc<Store>) -> Router {
    finish_router(
        routes()
            .route("/v1/live-sessions", post(allocate))
            .route("/v1/live-sessions/rooms/{code}", get(lookup))
            .route("/v1/live-sessions/{id}/claim", post(claim))
            .route(
                "/v1/live-sessions/{id}",
                axum::routing::delete(delete_session),
            )
            .route(
                "/v1/live-sessions/{id}/messages/{role}/{kind}",
                get(read).put(write),
            ),
        store,
    )
}
