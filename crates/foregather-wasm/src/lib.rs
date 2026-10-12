#![forbid(unsafe_code)]
use foregather_kit::{Locator, MAX_SAFE_SECONDS, Namespace, Profile, ResolverLocation};
use rand_core::OsRng;
use wasm_bindgen::prelude::*;

fn error(_: impl std::fmt::Display) -> JsValue {
    JsValue::from_str("Invalid invitation")
}
fn seconds(value: f64) -> Result<u64, JsValue> {
    if !value.is_finite() || value.fract() != 0.0 || value < 0.0 || value > MAX_SAFE_SECONDS as f64
    {
        return Err(error("clock"));
    }
    Ok(value as u64)
}
fn profile(value: &str) -> Result<Profile, JsValue> {
    if value == "kithmoot/v1" {
        return Ok(Profile::KithmootV1);
    }
    let namespace = value.strip_prefix("v1:").ok_or_else(|| error("profile"))?;
    Ok(Profile::V1(Namespace::parse(namespace).map_err(error)?))
}

#[wasm_bindgen]
pub fn seal_envelope(
    profile_name: &str,
    base: &str,
    allow_loopback_http: bool,
    id: &str,
    payload: &[u8],
    expires: f64,
    now: f64,
) -> Result<String, JsValue> {
    let profile = profile(profile_name)?;
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    let id = Locator::parse(id).map_err(error)?;
    let (invite, envelope) = foregather_kit::seal(
        &profile,
        id,
        payload,
        seconds(expires)?,
        seconds(now)?,
        &mut OsRng,
    )
    .map_err(error)?;
    serde_json::to_string(
        &serde_json::json!({"url": invite.to_url(&location), "envelope": envelope}),
    )
    .map_err(error)
}

#[wasm_bindgen]
pub fn open_envelope(
    profile_name: &str,
    base: &str,
    allow_loopback_http: bool,
    invitation_url: &str,
    response: &str,
    now: f64,
) -> Result<Vec<u8>, JsValue> {
    let profile = profile(profile_name)?;
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    let invitation = location.parse_invitation(invitation_url).map_err(error)?;
    Ok(
        foregather_kit::open(&profile, &invitation, response, seconds(now)?)
            .map_err(error)?
            .to_vec(),
    )
}

#[wasm_bindgen]
pub fn invitation_locator(
    base: &str,
    allow_loopback_http: bool,
    invitation_url: &str,
) -> Result<String, JsValue> {
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    Ok(location
        .parse_invitation(invitation_url)
        .map_err(error)?
        .locator()
        .encoded())
}

use foregather_kit::{live, spoken};

#[wasm_bindgen]
pub fn generate_live_offer(
    namespace: &str,
    purpose: &str,
    word_count: u32,
    lifetime: f64,
    now: f64,
) -> Result<String, JsValue> {
    let session = live::Session::generate(
        Namespace::parse(namespace).map_err(error)?,
        Namespace::parse(purpose).map_err(error)?,
        seconds(lifetime)?,
        seconds(now)?,
        &mut OsRng,
    )
    .map_err(error)?;
    let secret = live::PairingSecret::generate(word_count as usize, &mut OsRng).map_err(error)?;
    serde_json::to_string(
        &serde_json::json!({"session": session, "secretWords": secret.expose_words()}),
    )
    .map_err(error)
}

#[wasm_bindgen]
pub fn spoken_words(
    secret: &[u8],
    context: &str,
    counter: u32,
    identity: Option<String>,
    count: u32,
) -> Result<String, JsValue> {
    spoken::derive_words(
        secret,
        context,
        counter,
        identity.as_deref(),
        count as usize,
    )
    .map_err(error)
}
#[wasm_bindgen]
pub fn spoken_directional_words(
    secret: &[u8],
    namespace: &str,
    role_a: &str,
    role_b: &str,
    counter: u32,
    count: u32,
) -> Result<String, JsValue> {
    serde_json::to_string(
        &spoken::directional_words(secret, namespace, [role_a, role_b], counter, count as usize)
            .map_err(error)?,
    )
    .map_err(error)
}

#[wasm_bindgen]
pub struct LiveGate {
    inner: Option<live::PairingGate>,
    role: live::Role,
}
#[wasm_bindgen]
impl LiveGate {
    #[wasm_bindgen(constructor)]
    pub fn new(
        session: &str,
        secret_words: &str,
        role: &str,
        attempts: u8,
        now: f64,
        namespace: &str,
        purpose: &str,
    ) -> Result<LiveGate, JsValue> {
        let now = seconds(now)?;
        let session = live::Session::parse(session, now).map_err(error)?;
        if session.namespace != namespace || session.purpose != purpose {
            return Err(error("context"));
        }
        let role = match role {
            "inviter" => live::Role::Inviter,
            "recipient" => live::Role::Recipient,
            _ => return Err(error("role")),
        };
        Ok(Self {
            inner: Some(
                live::PairingGate::new(
                    session,
                    live::PairingSecret::parse(secret_words).map_err(error)?,
                    attempts,
                    now,
                )
                .map_err(error)?,
            ),
            role,
        })
    }
    pub fn remaining(&self) -> Result<u8, JsValue> {
        Ok(self
            .inner
            .as_ref()
            .ok_or_else(|| error("disposed"))?
            .remaining())
    }
    pub fn start(&mut self, now: f64) -> Result<LiveExchange, JsValue> {
        Ok(LiveExchange {
            inner: Some(
                self.inner
                    .as_mut()
                    .ok_or_else(|| error("disposed"))?
                    .start(self.role, seconds(now)?, &mut OsRng)
                    .map_err(error)?,
            ),
        })
    }
}
#[wasm_bindgen]
pub struct LiveExchange {
    inner: Option<live::Exchange>,
}
#[wasm_bindgen]
impl LiveExchange {
    pub fn hello(&self) -> Result<String, JsValue> {
        Ok(self
            .inner
            .as_ref()
            .ok_or_else(|| error("consumed"))?
            .hello())
    }
    pub fn finish(&mut self, peer_hello: &str, now: f64) -> Result<LiveConfirmation, JsValue> {
        let inner = self.inner.take().ok_or_else(|| error("consumed"))?;
        Ok(LiveConfirmation {
            inner: Some(inner.finish(peer_hello, seconds(now)?).map_err(error)?),
        })
    }
}
#[wasm_bindgen]
pub struct LiveConfirmation {
    inner: Option<live::PendingConfirmation>,
}
#[wasm_bindgen]
impl LiveConfirmation {
    pub fn proof(&self) -> Result<String, JsValue> {
        self.inner
            .as_ref()
            .ok_or_else(|| error("consumed"))?
            .confirmation()
            .map_err(error)
    }
    pub fn confirm(&mut self, peer_proof: &str, now: f64) -> Result<LiveChannel, JsValue> {
        let inner = self.inner.take().ok_or_else(|| error("consumed"))?;
        Ok(LiveChannel {
            inner: inner.confirm(peer_proof, seconds(now)?).map_err(error)?,
        })
    }
}
#[wasm_bindgen]
pub struct LiveChannel {
    inner: live::Channel,
}
#[wasm_bindgen]
impl LiveChannel {
    pub fn verification_words(&self, count: u32, now: f64) -> Result<String, JsValue> {
        self.inner
            .verification_words(count as usize, seconds(now)?)
            .map_err(error)
    }
    pub fn seal(&mut self, payload: &[u8], now: f64) -> Result<String, JsValue> {
        self.inner.seal(payload, seconds(now)?).map_err(error)
    }
    pub fn open(&mut self, packet: &str, now: f64) -> Result<Vec<u8>, JsValue> {
        Ok(self
            .inner
            .open(packet, seconds(now)?)
            .map_err(error)?
            .to_vec())
    }
}
