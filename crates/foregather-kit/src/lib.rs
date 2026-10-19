//! Encrypted invitation transfer. Opening authenticates the envelope, not membership.
//! No network, wall clock, identity lookup or room admission lives here.
//!
//! # Stored invitation round trip
//!
//! ```
//! use foregather_kit::{Locator, Namespace, Profile, ResolverLocation, seal, open};
//! use rand_core::OsRng;
//!
//! let mut rng = OsRng;
//! // Supply trusted Unix seconds; this example uses a synthetic fixed time.
//! let now = 1_800_000_000;
//! let profile = Profile::V1(Namespace::parse("example.rooms")?);
//! let location = ResolverLocation::parse("https://invites.example/i/", false)?;
//! let id = Locator::generate(&mut rng)?;
//! let (invitation, envelope) = seal(&profile, id, b"application invitation", now + 120, now, &mut rng)?;
//! let url = invitation.to_url(&location); // Bearer secret: never log this URL.
//! let recovered = location.parse_invitation(&url)?;
//! let candidate = open(&profile, &recovered, &envelope.to_json()?, now)?;
//! assert_eq!(candidate.as_slice(), b"application invitation");
//! // Validate candidate and obtain consent in the application's admission layer.
//! # Ok::<(), foregather_kit::InvalidInvitation>(())
//! ```
//!
//! [`spoken`] implements frozen Spoken Token v2 words. Enable `experimental-live`
//! for the unaudited live bootstrap profile; it is not RFC 9382 wire compatible.
//! See the [documentation index](https://github.com/forgesworn/foregather-kit/blob/main/docs/README.md)
//! for protocol bytes, hosting, threat model and validation limits.
#![forbid(unsafe_code)]
#![deny(missing_docs)]

#[cfg(feature = "experimental-live")]
pub mod live;
pub mod spoken;

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
use std::fmt;
use url::Url;
use zeroize::{Zeroize, Zeroizing};
#[cfg(feature = "experimental-live")]
pub mod exchange;
#[cfg(feature = "experimental-live")]
pub mod handoff;
#[cfg(feature = "experimental-live")]
pub mod transfer;

/// Maximum accepted envelope, URL or encoded input size in bytes.
pub const MAX_ENVELOPE_BYTES: usize = 32 * 1024;
/// Maximum stored invitation lifetime: seven days.
pub const MAX_LIFETIME_SECONDS: u64 = 7 * 24 * 60 * 60;
/// Largest integer seconds value representable exactly by JavaScript.
pub const MAX_SAFE_SECONDS: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Uniform failure for malformed, expired or unauthenticated invitations.
pub struct InvalidInvitation;
impl fmt::Display for InvalidInvitation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Invalid invitation")
    }
}
impl std::error::Error for InvalidInvitation {}
/// Result with a deliberately non-diagnostic invitation error.
pub type Result<T> = std::result::Result<T, InvalidInvitation>;

/// Encode bytes as canonical unpadded base64url.
pub fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}
/// Decode bounded, nonempty canonical unpadded base64url; reject alternate spellings.
pub fn decode(value: &str) -> Result<Vec<u8>> {
    if value.is_empty() || value.len() > MAX_ENVELOPE_BYTES {
        return Err(InvalidInvitation);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| InvalidInvitation)?;
    if encode(&bytes) != value {
        return Err(InvalidInvitation);
    }
    Ok(bytes)
}
fn array<const N: usize>(value: &str) -> Result<[u8; N]> {
    let bytes = Zeroizing::new(decode(value)?);
    bytes.as_slice().try_into().map_err(|_| InvalidInvitation)
}

/// Public lookup address; never an authentication key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Locator([u8; 16]);
impl Locator {
    /// Parse the canonical representation; malformed or out-of-policy inputs fail.
    pub fn parse(value: &str) -> Result<Self> {
        Ok(Self(array(value)?))
    }
    /// Generate an independent 128-bit public locator using trusted fallible entropy.
    pub fn generate(rng: &mut (impl RngCore + CryptoRng)) -> Result<Self> {
        let mut bytes = [0; 16];
        rng.try_fill_bytes(&mut bytes)
            .map_err(|_| InvalidInvitation)?;
        Ok(Self(bytes))
    }
    /// Return the canonical public locator, without any bearer secret.
    pub fn encoded(self) -> String {
        encode(&self.0)
    }
}

/// Application domain separation. A namespace is not proof of application identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Namespace(String);
impl Namespace {
    /// Parse the canonical representation; malformed or out-of-policy inputs fail.
    pub fn parse(value: &str) -> Result<Self> {
        if value.is_empty()
            || value.len() > 64
            || !value.as_bytes()[0].is_ascii_lowercase()
            || !value
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
        {
            return Err(InvalidInvitation);
        }
        Ok(Self(value.into()))
    }
    /// Borrow the validated domain-separation label.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Explicit wire profiles. Compatibility does not validate Fold admission semantics.
#[derive(Clone, Debug)]
pub enum Profile {
    /// Generic stored v1 envelope, bound to this application namespace.
    V1(Namespace),
    /// Frozen KithMoot short-link format; caller still runs its Fold validator.
    KithmootV1,
}
impl Profile {
    fn aad(&self, id: Locator, expires: u64) -> String {
        match self {
            Self::V1(ns) => format!(
                "foregather-envelope/v1:{}:{}:{expires}",
                ns.as_str(),
                id.encoded()
            ),
            Self::KithmootV1 => format!("kithmoot-short-invite/v1:{}:{expires}", id.encoded()),
        }
    }
}

/// Caller-selected endpoint. HTTPS is required except explicit loopback development.
#[derive(Clone, Debug)]
pub struct ResolverLocation(Url);
impl ResolverLocation {
    /// Validate a canonical trailing-slash endpoint; HTTP is allowed only on explicit loopback.
    pub fn parse(base: &str, allow_loopback_http: bool) -> Result<Self> {
        let url = Url::parse(base).map_err(|_| InvalidInvitation)?;
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if url.as_str() != base
            || !url.path().ends_with('/')
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.host_str().is_none()
            || !(url.scheme() == "https"
                || allow_loopback_http && url.scheme() == "http" && loopback)
        {
            return Err(InvalidInvitation);
        }
        Ok(Self(url))
    }
    fn address(&self, id: Locator, key: &[u8; 32]) -> String {
        format!("{}{}#{}", self.0, id.encoded(), encode(key))
    }
    /// Parse a bearer URL bound to this endpoint, without making any request.
    pub fn parse_invitation(&self, value: &str) -> Result<Invitation> {
        if value.len() > MAX_ENVELOPE_BYTES {
            return Err(InvalidInvitation);
        }
        let url = Url::parse(value).map_err(|_| InvalidInvitation)?;
        if url.as_str() != value
            || url.query().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(InvalidInvitation);
        }
        let suffix = value
            .strip_prefix(self.0.as_str())
            .ok_or(InvalidInvitation)?;
        let (id, key) = suffix.split_once('#').ok_or(InvalidInvitation)?;
        let id = Locator::parse(id)?;
        let key = Zeroizing::new(array(key)?);
        if self.address(id, &key) != value {
            return Err(InvalidInvitation);
        }
        Ok(Invitation { id, key })
    }
}

/// A capability; Debug deliberately hides the decryption key.
pub struct Invitation {
    id: Locator,
    key: Zeroizing<[u8; 32]>,
}
impl fmt::Debug for Invitation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Invitation([REDACTED])")
    }
}
impl Invitation {
    /// Return only the public lookup address.
    pub fn locator(&self) -> Locator {
        self.id
    }
    /// Deliberate secret export. URL strings cannot be deterministically erased.
    pub fn to_url(&self, location: &ResolverLocation) -> String {
        location.address(self.id, &self.key)
    }
}

/// Versioned encrypted stored envelope. Parsing alone does not authenticate it.
#[derive(Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    v: u8,
    /// Expiry in Unix seconds, authenticated by `open`; structural parsing does not verify it.
    pub expires: u64,
    nonce: String,
    ciphertext: String,
}
impl Envelope {
    /// Serialize the envelope, enforcing the wire size bound.
    pub fn to_json(&self) -> Result<String> {
        let text = serde_json::to_string(self).map_err(|_| InvalidInvitation)?;
        if text.len() > MAX_ENVELOPE_BYTES {
            return Err(InvalidInvitation);
        }
        Ok(text)
    }
    /// Structural checks for an untrusted ciphertext store; no authenticity claim.
    pub fn parse(text: &str, now: u64) -> Result<Self> {
        if text.len() > MAX_ENVELOPE_BYTES {
            return Err(InvalidInvitation);
        }
        let value: Self = serde_json::from_str(text).map_err(|_| InvalidInvitation)?;
        lifetime(value.expires, now)?;
        if value.v != 1
            || decode(&value.nonce)?.len() != 12
            || decode(&value.ciphertext)?.len() < 17
        {
            return Err(InvalidInvitation);
        }
        Ok(value)
    }
}

/// Require future expiry within seven days and JavaScript-safe Unix seconds.
pub fn lifetime(expires: u64, now: u64) -> Result<()> {
    if now > MAX_SAFE_SECONDS
        || expires > MAX_SAFE_SECONDS
        || expires <= now
        || expires - now > MAX_LIFETIME_SECONDS
    {
        return Err(InvalidInvitation);
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
struct DataPayload {
    v: u8,
    data: String,
}
#[derive(Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
struct LinkPayload {
    v: u8,
    url: String,
}

fn kithmoot_url(value: &str) -> Result<()> {
    let url = Url::parse(value).map_err(|_| InvalidInvitation)?;
    if value.len() > MAX_ENVELOPE_BYTES
        || url.as_str() != value
        || url.origin().ascii_serialization() != "https://kithmoot.app"
        || url.path() != "/j/"
        || url.query().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_none_or(str::is_empty)
    {
        return Err(InvalidInvitation);
    }
    // The caller must additionally run the pinned Fold parser before admission.
    Ok(())
}

/// Seal with a fresh key and nonce. The caller owns the trusted CSPRNG and clock.
pub fn seal(
    profile: &Profile,
    id: Locator,
    payload: &[u8],
    expires: u64,
    now: u64,
    rng: &mut (impl RngCore + CryptoRng),
) -> Result<(Invitation, Envelope)> {
    lifetime(expires, now)?;
    if payload.len() > MAX_ENVELOPE_BYTES {
        return Err(InvalidInvitation);
    }
    let plaintext = Zeroizing::new(
        match profile {
            Profile::V1(_) => serde_json::to_vec(&*Zeroizing::new(DataPayload {
                v: 1,
                data: encode(payload),
            })),
            Profile::KithmootV1 => {
                let url = std::str::from_utf8(payload).map_err(|_| InvalidInvitation)?;
                kithmoot_url(url)?;
                serde_json::to_vec(&*Zeroizing::new(LinkPayload {
                    v: 1,
                    url: url.into(),
                }))
            }
        }
        .map_err(|_| InvalidInvitation)?,
    );
    if plaintext.len() > MAX_ENVELOPE_BYTES {
        return Err(InvalidInvitation);
    }
    let mut key = Zeroizing::new([0; 32]);
    let mut nonce = [0; 12];
    rng.try_fill_bytes(key.as_mut())
        .map_err(|_| InvalidInvitation)?;
    rng.try_fill_bytes(&mut nonce)
        .map_err(|_| InvalidInvitation)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| InvalidInvitation)?;
    let aad = profile.aad(id, expires);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| InvalidInvitation)?;
    let envelope = Envelope {
        v: 1,
        expires,
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
    };
    envelope.to_json()?;
    Ok((Invitation { id, key }, envelope))
}

/// Returns application input for review. The application must validate and admit.
pub fn open(
    profile: &Profile,
    invitation: &Invitation,
    text: &str,
    now: u64,
) -> Result<Zeroizing<Vec<u8>>> {
    let envelope = Envelope::parse(text, now)?;
    let nonce = array::<12>(&envelope.nonce)?;
    let ciphertext = decode(&envelope.ciphertext)?;
    let aad = profile.aad(invitation.id, envelope.expires);
    let cipher =
        Aes256Gcm::new_from_slice(invitation.key.as_ref()).map_err(|_| InvalidInvitation)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| InvalidInvitation)?,
    );
    match profile {
        Profile::V1(_) => {
            let data: Zeroizing<DataPayload> =
                Zeroizing::new(serde_json::from_slice(&plaintext).map_err(|_| InvalidInvitation)?);
            if data.v != 1 {
                return Err(InvalidInvitation);
            }
            if data.data.is_empty() {
                return Ok(Zeroizing::new(Vec::new()));
            }
            Ok(Zeroizing::new(decode(&data.data)?))
        }
        Profile::KithmootV1 => {
            let link: Zeroizing<LinkPayload> =
                Zeroizing::new(serde_json::from_slice(&plaintext).map_err(|_| InvalidInvitation)?);
            if link.v != 1 {
                return Err(InvalidInvitation);
            }
            kithmoot_url(&link.url)?;
            Ok(Zeroizing::new(link.url.as_bytes().to_vec()))
        }
    }
}
