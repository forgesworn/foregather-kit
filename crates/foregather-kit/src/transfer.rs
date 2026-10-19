//! Versioned invitation-transfer framing and a recipient-decrypted receipt.
//! These plaintext frames travel only inside a confirmed live channel. A receipt
//! establishes decryption, not application validation, review or admission.
//!
//! The separately versioned reply profile lets the recipient return one bounded
//! application message bound to the exact invitation, after the receipt.
use crate::{InvalidInvitation, Result};
use rand_core::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

/// Inner bootstrap framing profile; stored and live cipher wire formats are unchanged.
pub const PROFILE: &str = "foregather-transfer/1";
/// Largest invitation fitting the live channel's 16-KiB plaintext bound.
pub const MAX_PAYLOAD: usize = 16364;
/// Optional reply profile; both endpoints opt in, it is never inferred from v1.
pub const REPLY_PROFILE: &str = "foregather-transfer-reply/1";
/// Largest application reply.
pub const MAX_REPLY: usize = 1024;
const INVITATION: [u8; 4] = [70, 71, 1, 1];
const RECEIPT: [u8; 4] = [70, 71, 1, 2];
const REPLY: [u8; 4] = [70, 71, 1, 3];
const BOUND: usize = 52;

/// One invitation, a fresh transfer identifier and its expected receipt.
pub struct Transfer {
    id: [u8; 16],
    payload: Zeroizing<Vec<u8>>,
}
impl Transfer {
    /// Copy bounded invitation bytes and generate an independent transfer identifier.
    pub fn create(payload: &[u8], rng: &mut (impl RngCore + CryptoRng)) -> Result<Self> {
        if payload.len() > MAX_PAYLOAD {
            return Err(InvalidInvitation);
        }
        let mut id = [0; 16];
        rng.try_fill_bytes(&mut id).map_err(|_| InvalidInvitation)?;
        Ok(Self {
            id,
            payload: Zeroizing::new(payload.to_vec()),
        })
    }
    /// Parse an exact v1 invitation frame, without validating its application payload.
    pub fn parse(frame: &[u8]) -> Result<Self> {
        if !(20..=16384).contains(&frame.len()) || frame[..4] != INVITATION {
            return Err(InvalidInvitation);
        }
        Ok(Self {
            id: frame[4..20].try_into().map_err(|_| InvalidInvitation)?,
            payload: Zeroizing::new(frame[20..].to_vec()),
        })
    }
    /// Encode the version/type, 16-byte identifier and uninterpreted invitation bytes.
    pub fn encode(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(20 + self.payload.len()));
        bytes.extend_from_slice(&INVITATION);
        bytes.extend_from_slice(&self.id);
        bytes.extend_from_slice(&self.payload);
        bytes
    }
    /// Application bytes for the caller's normal validator, review and consent flow.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }
    /// Type, identifier and SHA-256 of this exact payload.
    fn bound(&self, kind: [u8; 4], extra: usize) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(BOUND + extra));
        bytes.extend_from_slice(&kind);
        bytes.extend_from_slice(&self.id);
        bytes.extend_from_slice(&Sha256::digest(&self.payload));
        bytes
    }
    /// Bind a decryption receipt to the identifier and SHA-256 of this exact payload.
    pub fn receipt(&self) -> Zeroizing<Vec<u8>> {
        self.bound(RECEIPT, 0)
    }
    /// Authenticate receipt framing/content after the live channel authenticates its sender.
    pub fn acknowledged(&self, receipt: &[u8]) -> Result<()> {
        if receipt.len() != BOUND || !bool::from(self.receipt().as_slice().ct_eq(receipt)) {
            return Err(InvalidInvitation);
        }
        Ok(())
    }
    /// Recipient, reply profile: frame one application reply of at most
    /// [`MAX_REPLY`] bytes, bound like the receipt to this exact invitation.
    pub fn reply(&self, message: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if message.len() > MAX_REPLY {
            return Err(InvalidInvitation);
        }
        let mut bytes = self.bound(REPLY, message.len());
        bytes.extend_from_slice(message);
        Ok(bytes)
    }
    /// Inviter, reply profile: authenticate the framing and binding after the
    /// live channel authenticates its sender, and return the application bytes.
    pub fn read_reply(&self, frame: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if !(BOUND..=BOUND + MAX_REPLY).contains(&frame.len())
            || !bool::from(self.bound(REPLY, 0).as_slice().ct_eq(&frame[..BOUND]))
        {
            return Err(InvalidInvitation);
        }
        Ok(Zeroizing::new(frame[BOUND..].to_vec()))
    }
}
