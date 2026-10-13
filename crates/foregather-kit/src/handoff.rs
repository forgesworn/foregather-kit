//! Public pairing links contain no access secret and initiate no I/O.
use crate::{
    InvalidInvitation, Namespace, ResolverLocation, Result, decode, encode, live::Session,
};
use serde::{Deserialize, Serialize};

/// Versioned public-link presentation, independent of live cryptographic wire bytes.
pub const PROFILE: &str = "foregather-public-handoff/1";
/// Public pairing metadata; access secrets and verification words are separate.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicRoom {
    /// Frozen live session, locally checked against namespace/purpose/time.
    pub session: Session,
    /// Presentation only: `words` or `characters`.
    pub secret_format: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Link {
    v: String,
    room: PublicRoom,
}
impl PublicRoom {
    /// Check public metadata using caller-owned expected context and trusted time.
    pub fn check(&self, namespace: &str, purpose: &str, now: u64) -> Result<()> {
        let value = serde_json::to_string(&self.session).map_err(|_| InvalidInvitation)?;
        let session = Session::parse(&value, now)?;
        if !["words", "characters"].contains(&self.secret_format.as_str())
            || session.namespace != Namespace::parse(namespace)?.as_str()
            || session.purpose != Namespace::parse(purpose)?.as_str()
        {
            return Err(InvalidInvitation);
        }
        Ok(())
    }
    /// Encode public metadata under a caller-selected canonical HTTPS base URL.
    pub fn link(
        self,
        base: &str,
        allow_loopback_http: bool,
        namespace: &str,
        purpose: &str,
        now: u64,
    ) -> Result<String> {
        ResolverLocation::parse(base, allow_loopback_http)?;
        self.check(namespace, purpose, now)?;
        let bytes = serde_json::to_vec(&Link {
            v: PROFILE.into(),
            room: self,
        })
        .map_err(|_| InvalidInvitation)?;
        let fragment = encode(&bytes);
        let value = format!("{base}#{fragment}");
        if fragment.len() > 1400 || value.len() > 2048 {
            return Err(InvalidInvitation);
        }
        Ok(value)
    }
    /// Parse only the caller-selected origin/path, profile and public-only schema.
    pub fn parse_link(
        value: &str,
        base: &str,
        allow_loopback_http: bool,
        namespace: &str,
        purpose: &str,
        now: u64,
    ) -> Result<Self> {
        ResolverLocation::parse(base, allow_loopback_http)?;
        if value.len() > 2048 {
            return Err(InvalidInvitation);
        }
        let fragment = value
            .strip_prefix(base)
            .and_then(|value| value.strip_prefix('#'))
            .filter(|value| value.len() <= 1400)
            .ok_or(InvalidInvitation)?;
        let link: Link =
            serde_json::from_slice(&decode(fragment)?).map_err(|_| InvalidInvitation)?;
        if link.v != PROFILE {
            return Err(InvalidInvitation);
        }
        link.room.check(namespace, purpose, now)?;
        Ok(link.room)
    }
}
