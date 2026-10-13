use super::*;
use foregather_kit::{live as core, transfer::Transfer};
use std::sync::{Mutex, MutexGuard};
fn lock<T>(value: &Mutex<T>) -> Result<MutexGuard<'_, T>> {
    value.lock().map_err(|_| ForegatherError::InvalidInvitation)
}
#[derive(Clone, Copy, uniffi::Enum)]
pub enum AccessFormat {
    Words,
    Characters,
}
#[derive(Clone, Copy, uniffi::Enum)]
pub enum PairingRole {
    Inviter,
    Recipient,
}
impl PairingRole {
    fn core(self) -> core::Role {
        match self {
            Self::Inviter => core::Role::Inviter,
            Self::Recipient => core::Role::Recipient,
        }
    }
}
#[derive(uniffi::Record)]
pub struct LiveOffer {
    pub session_json: String,
    pub secret: String,
    pub format: AccessFormat,
}
#[uniffi::export]
pub fn create_live_offer(
    namespace: String,
    purpose: String,
    format: AccessFormat,
    count: u32,
    lifetime: u64,
    now: u64,
) -> Result<LiveOffer> {
    let session = core::Session::generate(
        Namespace::parse(&namespace)?,
        Namespace::parse(&purpose)?,
        lifetime,
        now,
        &mut OsRng,
    )?;
    let secret = match format {
        AccessFormat::Words => core::PairingSecret::generate(count as usize, &mut OsRng)?
            .expose_words()
            .to_owned(),
        AccessFormat::Characters => {
            core::PairingSecret::generate_characters(count as usize, &mut OsRng)?
                .1
                .to_string()
        }
    };
    Ok(LiveOffer {
        session_json: serde_json::to_string(&session)
            .map_err(|_| ForegatherError::InvalidInvitation)?,
        secret,
        format,
    })
}
#[derive(uniffi::Object)]
pub struct PairingGate {
    inner: Mutex<Option<core::PairingGate>>,
    role: core::Role,
}
#[uniffi::export]
impl PairingGate {
    #[uniffi::constructor]
    pub fn new(
        offer: LiveOffer,
        namespace: String,
        purpose: String,
        role: PairingRole,
        now: u64,
    ) -> Result<Arc<Self>> {
        let secret = Zeroizing::new(offer.secret);
        let session = core::Session::parse(&offer.session_json, now)?;
        if session.namespace != Namespace::parse(&namespace)?.as_str()
            || session.purpose != Namespace::parse(&purpose)?.as_str()
        {
            return Err(ForegatherError::InvalidInvitation);
        }
        let secret = match offer.format {
            AccessFormat::Words => core::PairingSecret::parse(&secret)?,
            AccessFormat::Characters => core::PairingSecret::from_characters(&secret)?,
        };
        Ok(Arc::new(Self {
            inner: Mutex::new(Some(core::PairingGate::new(session, secret, 1, now)?)),
            role: role.core(),
        }))
    }
    pub fn remaining(&self) -> Result<u8> {
        Ok(lock(&self.inner)?
            .as_ref()
            .ok_or(ForegatherError::InvalidInvitation)?
            .remaining())
    }
    pub fn start(&self, now: u64) -> Result<Arc<PairingExchange>> {
        let exchange = lock(&self.inner)?
            .as_mut()
            .ok_or(ForegatherError::InvalidInvitation)?
            .start(self.role, now, &mut OsRng)?;
        Ok(Arc::new(PairingExchange {
            inner: Mutex::new(Some(exchange)),
        }))
    }
    pub fn dispose(&self) -> Result<()> {
        lock(&self.inner)?.take();
        Ok(())
    }
}
#[derive(uniffi::Object)]
pub struct PairingExchange {
    inner: Mutex<Option<core::Exchange>>,
}
#[uniffi::export]
impl PairingExchange {
    pub fn hello(&self) -> Result<String> {
        Ok(lock(&self.inner)?
            .as_ref()
            .ok_or(ForegatherError::InvalidInvitation)?
            .hello())
    }
    pub fn finish(&self, peer_hello: String, now: u64) -> Result<Arc<PairingConfirmation>> {
        let exchange = lock(&self.inner)?
            .take()
            .ok_or(ForegatherError::InvalidInvitation)?;
        Ok(Arc::new(PairingConfirmation {
            inner: Mutex::new(Some(exchange.finish(&peer_hello, now)?)),
        }))
    }
    pub fn dispose(&self) -> Result<()> {
        lock(&self.inner)?.take();
        Ok(())
    }
}
#[derive(uniffi::Object)]
pub struct PairingConfirmation {
    inner: Mutex<Option<core::PendingConfirmation>>,
}
#[uniffi::export]
impl PairingConfirmation {
    pub fn proof(&self) -> Result<String> {
        Ok(lock(&self.inner)?
            .as_ref()
            .ok_or(ForegatherError::InvalidInvitation)?
            .confirmation()?)
    }
    pub fn confirm(&self, peer_proof: String, now: u64) -> Result<Arc<PairingChannel>> {
        let pending = lock(&self.inner)?
            .take()
            .ok_or(ForegatherError::InvalidInvitation)?;
        Ok(Arc::new(PairingChannel {
            inner: Mutex::new(Some(pending.confirm(&peer_proof, now)?)),
        }))
    }
    pub fn dispose(&self) -> Result<()> {
        lock(&self.inner)?.take();
        Ok(())
    }
}
#[derive(uniffi::Object)]
pub struct PairingChannel {
    inner: Mutex<Option<core::Channel>>,
}
#[uniffi::export]
impl PairingChannel {
    pub fn verification_words(&self, count: u32, now: u64) -> Result<String> {
        Ok(lock(&self.inner)?
            .as_ref()
            .ok_or(ForegatherError::InvalidInvitation)?
            .verification_words(count as usize, now)?)
    }
    pub fn seal(&self, payload: Vec<u8>, now: u64) -> Result<String> {
        let payload = Zeroizing::new(payload);
        Ok(lock(&self.inner)?
            .as_mut()
            .ok_or(ForegatherError::InvalidInvitation)?
            .seal(&payload, now)?)
    }
    pub fn open(&self, packet: String, now: u64) -> Result<Vec<u8>> {
        Ok(lock(&self.inner)?
            .as_mut()
            .ok_or(ForegatherError::InvalidInvitation)?
            .open(&packet, now)?
            .to_vec())
    }
    pub fn dispose(&self) -> Result<()> {
        lock(&self.inner)?.take();
        Ok(())
    }
}
#[uniffi::export]
pub fn create_invitation_transfer(payload: Vec<u8>) -> Result<Vec<u8>> {
    let payload = Zeroizing::new(payload);
    Ok(Transfer::create(&payload, &mut OsRng)?.encode().to_vec())
}
#[uniffi::export]
pub fn invitation_transfer_payload(frame: Vec<u8>) -> Result<Vec<u8>> {
    let frame = Zeroizing::new(frame);
    Ok(Transfer::parse(&frame)?.payload().to_vec())
}
#[uniffi::export]
pub fn invitation_transfer_receipt(frame: Vec<u8>) -> Result<Vec<u8>> {
    let frame = Zeroizing::new(frame);
    Ok(Transfer::parse(&frame)?.receipt().to_vec())
}
#[uniffi::export]
pub fn invitation_transfer_acknowledged(frame: Vec<u8>, receipt: Vec<u8>) -> Result<()> {
    let frame = Zeroizing::new(frame);
    let receipt = Zeroizing::new(receipt);
    Ok(Transfer::parse(&frame)?.acknowledged(&receipt)?)
}
#[derive(uniffi::Record)]
pub struct PublicPairing {
    pub session_json: String,
    pub format: AccessFormat,
}
fn public_room(value: PublicPairing, now: u64) -> Result<foregather_kit::handoff::PublicRoom> {
    Ok(foregather_kit::handoff::PublicRoom {
        session: core::Session::parse(&value.session_json, now)?,
        secret_format: match value.format {
            AccessFormat::Words => "words",
            AccessFormat::Characters => "characters",
        }
        .into(),
    })
}
#[uniffi::export]
pub fn create_public_pairing_link(
    base_url: String,
    pairing: PublicPairing,
    allow_loopback_http: bool,
    namespace: String,
    purpose: String,
    now: u64,
) -> Result<String> {
    Ok(public_room(pairing, now)?.link(
        &base_url,
        allow_loopback_http,
        &namespace,
        &purpose,
        now,
    )?)
}
#[uniffi::export]
pub fn parse_public_pairing_link(
    url: String,
    base_url: String,
    allow_loopback_http: bool,
    namespace: String,
    purpose: String,
    now: u64,
) -> Result<PublicPairing> {
    let room = foregather_kit::handoff::PublicRoom::parse_link(
        &url,
        &base_url,
        allow_loopback_http,
        &namespace,
        &purpose,
        now,
    )?;
    Ok(PublicPairing {
        session_json: serde_json::to_string(&room.session)
            .map_err(|_| ForegatherError::InvalidInvitation)?,
        format: if room.secret_format == "words" {
            AccessFormat::Words
        } else {
            AccessFormat::Characters
        },
    })
}
#[uniffi::export]
pub fn generate_public_code(length: u32) -> Result<String> {
    Ok(core::RendezvousCode::generate(length as usize, &mut OsRng)?
        .as_str()
        .to_owned())
}
#[uniffi::export]
pub fn canonical_public_code(code: String) -> Result<String> {
    Ok(core::RendezvousCode::parse(&code)?.as_str().to_owned())
}
#[uniffi::export]
pub fn format_character_code(code: String) -> Result<String> {
    let code = Zeroizing::new(code);
    Ok(core::format_character_code(&code)?.to_string())
}
