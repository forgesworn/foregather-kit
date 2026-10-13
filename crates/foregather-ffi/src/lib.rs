//! Native adapters use the platform CSPRNG and require caller-supplied time.
//! Foreign-language buffers/strings remain in their caller's custody. Generated
//! FFI scaffolding is the native boundary; the cryptographic core forbids unsafe code.
use foregather_kit::{Locator, Namespace, Profile, ResolverLocation};
use rand_core::OsRng;
use std::sync::Arc;
use zeroize::Zeroizing;
uniffi::setup_scaffolding!();
#[cfg(feature = "experimental-live")]
mod live;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum ForegatherError {
    #[error("Invalid invitation")]
    InvalidInvitation,
}
impl From<foregather_kit::InvalidInvitation> for ForegatherError {
    fn from(_: foregather_kit::InvalidInvitation) -> Self {
        Self::InvalidInvitation
    }
}
type Result<T> = std::result::Result<T, ForegatherError>;
#[derive(uniffi::Record)]
pub struct SealedInvitation {
    pub url: String,
    pub envelope_json: String,
}
#[derive(uniffi::Object)]
pub struct StoredCodec {
    profile: Profile,
    location: ResolverLocation,
}
#[uniffi::export]
impl StoredCodec {
    #[uniffi::constructor]
    pub fn new(
        namespace: String,
        base_url: String,
        allow_loopback_http: bool,
    ) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            profile: Profile::V1(Namespace::parse(&namespace)?),
            location: ResolverLocation::parse(&base_url, allow_loopback_http)?,
        }))
    }
    pub fn seal(
        &self,
        id: String,
        payload: Vec<u8>,
        expires: u64,
        now: u64,
    ) -> Result<SealedInvitation> {
        let payload = Zeroizing::new(payload);
        let (invitation, envelope) = foregather_kit::seal(
            &self.profile,
            Locator::parse(&id)?,
            &payload,
            expires,
            now,
            &mut OsRng,
        )?;
        Ok(SealedInvitation {
            url: invitation.to_url(&self.location),
            envelope_json: envelope.to_json()?,
        })
    }
    pub fn open(&self, url: String, envelope_json: String, now: u64) -> Result<Vec<u8>> {
        let url = Zeroizing::new(url);
        let envelope_json = Zeroizing::new(envelope_json);
        Ok(foregather_kit::open(
            &self.profile,
            &self.location.parse_invitation(&url)?,
            &envelope_json,
            now,
        )?
        .to_vec())
    }
    pub fn locator(&self, url: String) -> Result<String> {
        let url = Zeroizing::new(url);
        Ok(self.location.parse_invitation(&url)?.locator().encoded())
    }
}
#[uniffi::export]
pub fn generate_locator() -> Result<String> {
    Ok(Locator::generate(&mut OsRng)?.encoded())
}

/// The embedding application supplies its pinned Fold parser, never room policy here.
#[uniffi::export(with_foreign)]
pub trait InvitationValidator: Send + Sync {
    fn validate(&self, invitation: String) -> bool;
}
#[derive(uniffi::Object)]
pub struct KithmootCodec {
    codec: StoredCodec,
    validator: Arc<dyn InvitationValidator>,
}
#[uniffi::export]
impl KithmootCodec {
    #[uniffi::constructor]
    pub fn new(validator: Arc<dyn InvitationValidator>) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            codec: StoredCodec {
                profile: Profile::KithmootV1,
                location: ResolverLocation::parse("https://z1p.app/k/", false)?,
            },
            validator,
        }))
    }
    pub fn seal(
        &self,
        id: String,
        invitation: String,
        expires: u64,
        now: u64,
    ) -> Result<SealedInvitation> {
        let invitation = Zeroizing::new(invitation);
        if invitation.len() > foregather_kit::MAX_ENVELOPE_BYTES
            || !self.validator.validate(invitation.to_string())
        {
            return Err(ForegatherError::InvalidInvitation);
        }
        self.codec
            .seal(id, invitation.as_bytes().to_vec(), expires, now)
    }
    pub fn open(&self, url: String, envelope_json: String, now: u64) -> Result<String> {
        let payload = Zeroizing::new(self.codec.open(url, envelope_json, now)?);
        let invitation =
            std::str::from_utf8(&payload).map_err(|_| ForegatherError::InvalidInvitation)?;
        if !self.validator.validate(invitation.to_owned()) {
            return Err(ForegatherError::InvalidInvitation);
        }
        Ok(invitation.to_owned())
    }
    pub fn locator(&self, url: String) -> Result<String> {
        self.codec.locator(url)
    }
}
#[uniffi::export]
pub fn derive_spoken_words(
    secret: Vec<u8>,
    context: String,
    counter: u32,
    identity: Option<String>,
    count: u32,
) -> Result<String> {
    let secret = Zeroizing::new(secret);
    Ok(foregather_kit::spoken::derive_words(
        &secret,
        &context,
        counter,
        identity.as_deref(),
        count as usize,
    )?)
}
#[uniffi::export]
pub fn derive_directional_words(
    secret: Vec<u8>,
    namespace: String,
    roles: Vec<String>,
    counter: u32,
    count: u32,
) -> Result<Vec<String>> {
    if roles.len() != 2 {
        return Err(ForegatherError::InvalidInvitation);
    }
    let secret = Zeroizing::new(secret);
    let words = foregather_kit::spoken::directional_words(
        &secret,
        &namespace,
        [&roles[0], &roles[1]],
        counter,
        count as usize,
    )?;
    Ok(words.to_vec())
}
