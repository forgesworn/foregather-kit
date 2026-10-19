use super::*;
use foregather_kit::{live as pake, spoken};
#[wasm_bindgen]
pub fn create_public_handoff(
    base: &str,
    room: &str,
    allow_loopback_http: bool,
    namespace: &str,
    purpose: &str,
    now: f64,
) -> Result<String, JsValue> {
    if room.len() > 1200 {
        return Err(error("room"));
    }
    let room: foregather_kit::handoff::PublicRoom = serde_json::from_str(room).map_err(error)?;
    room.link(base, allow_loopback_http, namespace, purpose, seconds(now)?)
        .map_err(error)
}
#[wasm_bindgen]
pub fn parse_public_handoff(
    value: &str,
    base: &str,
    allow_loopback_http: bool,
    namespace: &str,
    purpose: &str,
    now: f64,
) -> Result<String, JsValue> {
    let room = foregather_kit::handoff::PublicRoom::parse_link(
        value,
        base,
        allow_loopback_http,
        namespace,
        purpose,
        seconds(now)?,
    )
    .map_err(error)?;
    serde_json::to_string(&room).map_err(error)
}
#[wasm_bindgen]
pub fn create_transfer(payload: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(
        foregather_kit::transfer::Transfer::create(payload, &mut OsRng)
            .map_err(error)?
            .encode()
            .to_vec(),
    )
}
#[wasm_bindgen]
pub fn transfer_payload(frame: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(foregather_kit::transfer::Transfer::parse(frame)
        .map_err(error)?
        .payload()
        .to_vec())
}
#[wasm_bindgen]
pub fn transfer_receipt(frame: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(foregather_kit::transfer::Transfer::parse(frame)
        .map_err(error)?
        .receipt()
        .to_vec())
}
#[wasm_bindgen]
pub fn transfer_acknowledged(frame: &[u8], receipt: &[u8]) -> Result<(), JsValue> {
    foregather_kit::transfer::Transfer::parse(frame)
        .map_err(error)?
        .acknowledged(receipt)
        .map_err(error)
}
#[wasm_bindgen]
pub fn transfer_reply(frame: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(foregather_kit::transfer::Transfer::parse(frame)
        .map_err(error)?
        .reply(message)
        .map_err(error)?
        .to_vec())
}
#[wasm_bindgen]
pub fn transfer_read_reply(frame: &[u8], reply: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(foregather_kit::transfer::Transfer::parse(frame)
        .map_err(error)?
        .read_reply(reply)
        .map_err(error)?
        .to_vec())
}
#[wasm_bindgen]
pub fn validate_live_session(
    value: &str,
    namespace: &str,
    purpose: &str,
    now: f64,
) -> Result<String, JsValue> {
    let session = pake::Session::parse(value, seconds(now)?).map_err(error)?;
    if session.namespace != Namespace::parse(namespace).map_err(error)?.as_str()
        || session.purpose != Namespace::parse(purpose).map_err(error)?.as_str()
    {
        return Err(error("context"));
    }
    serde_json::to_string(&session).map_err(error)
}
#[wasm_bindgen]
pub fn generate_live_offer(
    namespace: &str,
    purpose: &str,
    word_count: u32,
    lifetime: f64,
    now: f64,
) -> Result<String, JsValue> {
    let session = pake::Session::generate(
        Namespace::parse(namespace).map_err(error)?,
        Namespace::parse(purpose).map_err(error)?,
        seconds(lifetime)?,
        seconds(now)?,
        &mut OsRng,
    )
    .map_err(error)?;
    let secret = pake::PairingSecret::generate(word_count as usize, &mut OsRng).map_err(error)?;
    serde_json::to_string(
        &serde_json::json!({"session": session, "secretWords": secret.expose_words()}),
    )
    .map_err(error)
}

#[wasm_bindgen]
pub fn generate_character_offer(
    namespace: &str,
    purpose: &str,
    count: u32,
    lifetime: f64,
    now: f64,
) -> Result<String, JsValue> {
    let session = pake::Session::generate(
        Namespace::parse(namespace).map_err(error)?,
        Namespace::parse(purpose).map_err(error)?,
        seconds(lifetime)?,
        seconds(now)?,
        &mut OsRng,
    )
    .map_err(error)?;
    let (_, code) =
        pake::PairingSecret::generate_characters(count as usize, &mut OsRng).map_err(error)?;
    serde_json::to_string(&serde_json::json!({"session":session,"secretCode":code.as_str()}))
        .map_err(error)
}
#[wasm_bindgen]
pub fn generate_rendezvous_code(count: u32) -> Result<String, JsValue> {
    Ok(pake::RendezvousCode::generate(count as usize, &mut OsRng)
        .map_err(error)?
        .as_str()
        .to_string())
}
#[wasm_bindgen]
pub fn canonical_rendezvous_code(value: &str) -> Result<String, JsValue> {
    Ok(pake::RendezvousCode::parse(value)
        .map_err(error)?
        .as_str()
        .to_string())
}

#[wasm_bindgen]
pub fn format_character_code(value: &str) -> Result<String, JsValue> {
    Ok(pake::format_character_code(value)
        .map_err(error)?
        .to_string())
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
    inner: Option<pake::PairingGate>,
    role: pake::Role,
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
        let session = pake::Session::parse(session, now).map_err(error)?;
        if session.namespace != namespace || session.purpose != purpose {
            return Err(error("context"));
        }
        let role = match role {
            "inviter" => pake::Role::Inviter,
            "recipient" => pake::Role::Recipient,
            _ => return Err(error("role")),
        };
        Ok(Self {
            inner: Some(
                pake::PairingGate::new(
                    session,
                    pake::PairingSecret::parse(secret_words).map_err(error)?,
                    attempts,
                    now,
                )
                .map_err(error)?,
            ),
            role,
        })
    }
    pub fn from_code(
        session: &str,
        secret_code: &str,
        role: &str,
        attempts: u8,
        now: f64,
        namespace: &str,
        purpose: &str,
    ) -> Result<LiveGate, JsValue> {
        let now = seconds(now)?;
        let session = pake::Session::parse(session, now).map_err(error)?;
        if session.namespace != namespace || session.purpose != purpose {
            return Err(error("context"));
        }
        let role = match role {
            "inviter" => pake::Role::Inviter,
            "recipient" => pake::Role::Recipient,
            _ => return Err(error("role")),
        };
        Ok(Self {
            inner: Some(
                pake::PairingGate::new(
                    session,
                    pake::PairingSecret::from_characters(secret_code).map_err(error)?,
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
    inner: Option<pake::Exchange>,
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
    inner: Option<pake::PendingConfirmation>,
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
    inner: pake::Channel,
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
