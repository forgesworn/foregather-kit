//! Versioned invitation-transfer framing and a recipient-decrypted receipt.
//! These plaintext frames travel only inside a confirmed live channel. A receipt
//! establishes decryption, not application validation, review or admission.
use crate::{InvalidInvitation, Result};
use rand_core::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

/// Inner bootstrap framing profile; stored and live cipher wire formats are unchanged.
pub const PROFILE: &str = "foregather-transfer/1";
/// Largest invitation fitting the live channel's 16-KiB plaintext bound.
pub const MAX_PAYLOAD: usize = 16364;
const INVITATION: [u8; 4] = [70, 71, 1, 1];
const RECEIPT: [u8; 4] = [70, 71, 1, 2];

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
    /// Bind a decryption receipt to the identifier and SHA-256 of this exact payload.
    pub fn receipt(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(52));
        bytes.extend_from_slice(&RECEIPT);
        bytes.extend_from_slice(&self.id);
        bytes.extend_from_slice(&Sha256::digest(&self.payload));
        bytes
    }
    /// Authenticate receipt framing/content after the live channel authenticates its sender.
    pub fn acknowledged(&self, receipt: &[u8]) -> Result<()> {
        if receipt.len() != 52 || !bool::from(self.receipt().as_slice().ct_eq(receipt)) {
            return Err(InvalidInvitation);
        }
        Ok(())
    }
}
