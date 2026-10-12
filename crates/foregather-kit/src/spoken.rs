//! Frozen Spoken Token v2 words profile. Tokens prove shared-secret knowledge,
//! not personal identity. Applications own replay tracking and attempt limits.
use crate::{InvalidInvitation, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

pub const WORDLIST_SHA256: &str =
    "0334930ebdfbc76e81ec914515d7567ca85738a6bf3069249d97df951d44661c";
pub(crate) const WORDS: &str = include_str!("en-v1.txt");

fn label(value: &str) -> Result<()> {
    if value.len() > 1024 || value.trim().is_empty() || value.contains('\0') {
        return Err(InvalidInvitation);
    }
    Ok(())
}

/// Exact Spoken Token v2 SPOKEN-DERIVE. No implicit time window or identity fallback.
pub fn derive_bytes(
    secret: &[u8],
    context: &str,
    counter: u32,
    identity: Option<&str>,
) -> Result<Zeroizing<[u8; 32]>> {
    label(context)?;
    if secret.len() < 16 || secret.len() > 1024 {
        return Err(InvalidInvitation);
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| InvalidInvitation)?;
    mac.update(context.as_bytes());
    if let Some(identity) = identity {
        label(identity)?;
        mac.update(&[0]);
        mac.update(identity.as_bytes());
    }
    mac.update(&counter.to_be_bytes());
    Ok(Zeroizing::new(mac.finalize().into_bytes().into()))
}

/// Exact en-v1 SPOKEN-ENCODE: consecutive big-endian u16 values modulo 2048.
pub fn encode_words(bytes: &[u8], count: usize) -> Result<String> {
    if !(1..=16).contains(&count) || bytes.len() < count * 2 {
        return Err(InvalidInvitation);
    }
    let words: Vec<_> = WORDS.lines().collect();
    Ok(bytes
        .chunks_exact(2)
        .take(count)
        .map(|b| words[usize::from(u16::from_be_bytes([b[0], b[1]])) % 2048])
        .collect::<Vec<_>>()
        .join(" "))
}

pub fn derive_words(
    secret: &[u8],
    context: &str,
    counter: u32,
    identity: Option<&str>,
    count: usize,
) -> Result<String> {
    encode_words(
        derive_bytes(secret, context, counter, identity)?.as_ref(),
        count,
    )
}

/// Frozen v2 directional domain: pair NUL namespace NUL role, counter_be32.
pub fn directional_words(
    secret: &[u8],
    namespace: &str,
    roles: [&str; 2],
    counter: u32,
    count: usize,
) -> Result<[String; 2]> {
    label(namespace)?;
    label(roles[0])?;
    label(roles[1])?;
    if roles[0] == roles[1] || secret.len() < 16 || secret.len() > 1024 {
        return Err(InvalidInvitation);
    }
    let derive = |role: &str| -> Result<String> {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| InvalidInvitation)?;
        mac.update(b"pair\0");
        mac.update(namespace.as_bytes());
        mac.update(&[0]);
        mac.update(role.as_bytes());
        mac.update(&counter.to_be_bytes());
        let bytes: Zeroizing<[u8; 32]> = Zeroizing::new(mac.finalize().into_bytes().into());
        encode_words(bytes.as_ref(), count)
    };
    Ok([derive(roles[0])?, derive(roles[1])?])
}
