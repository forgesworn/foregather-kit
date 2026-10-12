//! Experimental endpoint-to-endpoint PAKE bootstrap; see docs/live-protocol.md.
//! This profile is NOT RFC 9382 wire compatible or independently audited.
use crate::{
    InvalidInvitation, Locator, MAX_SAFE_SECONDS, Namespace, Result, array, decode, encode, spoken,
};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use curve25519_dalek::edwards::CompressedEdwardsY;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand_core::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use zeroize::Zeroizing;

pub const PROFILE: &str = "foregather-live/spake2-ed25519/1";
pub const MAX_PACKET_BYTES: usize = 24 * 1024;
pub const MAX_PAYLOAD_BYTES: usize = 16 * 1024;
const MAX_MESSAGES: u64 = 65_536;

// The pinned SPAKE2/dalek implementation samples one scalar from 64 bytes.
// Obtain those bytes fallibly before entering its infallible RNG interface.
struct ScalarEntropy {
    bytes: Zeroizing<[u8; 64]>,
    position: usize,
}
impl CryptoRng for ScalarEntropy {}
impl RngCore for ScalarEntropy {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }
    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }
    fn fill_bytes(&mut self, dest: &mut [u8]) {
        self.try_fill_bytes(dest)
            .expect("Pinned PAKE scalar entropy bound");
    }
    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> std::result::Result<(), rand_core::Error> {
        let source = self.bytes[self.position..]
            .get(..dest.len())
            .ok_or_else(|| {
                rand_core::Error::from(
                    std::num::NonZeroU32::new(rand_core::Error::CUSTOM_START)
                        .expect("Nonzero custom RNG error"),
                )
            })?;
        dest.copy_from_slice(source);
        self.position += dest.len();
        Ok(())
    }
}

fn framed(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for part in parts {
        out.extend_from_slice(&(part.len() as u32).to_be_bytes());
        out.extend_from_slice(part);
    }
    out
}

/// Short secret is separate from the public locator and post-pairing verification.
/// Never persist it or put it in relay requests, query strings or logs.
pub struct PairingSecret(Zeroizing<String>);
impl std::fmt::Debug for PairingSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PairingSecret([REDACTED])")
    }
}
impl PairingSecret {
    pub fn generate(count: usize, rng: &mut (impl RngCore + CryptoRng)) -> Result<Self> {
        if !(2..=16).contains(&count) {
            return Err(InvalidInvitation);
        }
        let mut bytes = Zeroizing::new([0u8; 32]);
        rng.try_fill_bytes(&mut bytes[..count * 2])
            .map_err(|_| InvalidInvitation)?;
        Ok(Self(Zeroizing::new(spoken::encode_words(
            bytes.as_ref(),
            count,
        )?)))
    }
    /// ASCII whitespace and case are normalised; every word must be in frozen en-v1.
    pub fn parse(value: &str) -> Result<Self> {
        if value.len() > 256 || !value.is_ascii() {
            return Err(InvalidInvitation);
        }
        let value = Zeroizing::new(value.to_ascii_lowercase());
        let words: Vec<_> = value.split_ascii_whitespace().collect();
        if !(2..=16).contains(&words.len())
            || words
                .iter()
                .any(|w| !spoken::WORDS.lines().any(|candidate| candidate == *w))
        {
            return Err(InvalidInvitation);
        }
        Ok(Self(Zeroizing::new(words.join(" "))))
    }
    /// Intentional secret export for human presentation only.
    pub fn expose_words(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub profile: String,
    pub namespace: String,
    pub purpose: String,
    pub locator: String,
    pub issued: u64,
    pub expires: u64,
}
impl Session {
    pub fn generate(
        namespace: Namespace,
        purpose: Namespace,
        lifetime: u64,
        now: u64,
        rng: &mut (impl RngCore + CryptoRng),
    ) -> Result<Self> {
        let session = Self {
            profile: PROFILE.into(),
            namespace: namespace.as_str().into(),
            purpose: purpose.as_str().into(),
            locator: Locator::generate(rng)?.encoded(),
            issued: now,
            expires: now.checked_add(lifetime).ok_or(InvalidInvitation)?,
        };
        session.check(now)?;
        Ok(session)
    }
    pub fn parse(value: &str, now: u64) -> Result<Self> {
        if value.len() > 1024 {
            return Err(InvalidInvitation);
        }
        let session: Self = serde_json::from_str(value).map_err(|_| InvalidInvitation)?;
        session.check(now)?;
        Ok(session)
    }
    fn check(&self, now: u64) -> Result<()> {
        Namespace::parse(&self.namespace)?;
        Namespace::parse(&self.purpose)?;
        Locator::parse(&self.locator)?;
        if self.profile != PROFILE
            || self.expires > MAX_SAFE_SECONDS
            || now < self.issued
            || now >= self.expires
            || self.expires <= self.issued
            || self.expires - self.issued > 600
        {
            return Err(InvalidInvitation);
        }
        Ok(())
    }
    fn context(&self) -> Vec<u8> {
        framed(&[
            PROFILE.as_bytes(),
            self.namespace.as_bytes(),
            self.purpose.as_bytes(),
            self.locator.as_bytes(),
            &self.issued.to_be_bytes(),
            &self.expires.to_be_bytes(),
        ])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Inviter,
    Recipient,
}
impl Role {
    fn label(self) -> &'static [u8] {
        match self {
            Self::Inviter => b"inviter",
            Self::Recipient => b"recipient",
        }
    }
    fn opposite(self) -> Self {
        match self {
            Self::Inviter => Self::Recipient,
            Self::Recipient => Self::Inviter,
        }
    }
}

/// Keep one gate for the complete code lifetime. Every start spends an attempt,
/// including cancellation, malformed peer messages and failed confirmation.
/// Never recreate this gate or replenish its budget for the same secret.
pub struct PairingGate {
    session: Session,
    secret: PairingSecret,
    remaining: u8,
    last_now: u64,
}
impl PairingGate {
    pub fn new(session: Session, secret: PairingSecret, attempts: u8, now: u64) -> Result<Self> {
        session.check(now)?;
        if !(1..=5).contains(&attempts) {
            return Err(InvalidInvitation);
        }
        Ok(Self {
            session,
            secret,
            remaining: attempts,
            last_now: now,
        })
    }
    pub fn remaining(&self) -> u8 {
        self.remaining
    }
    pub fn start(
        &mut self,
        role: Role,
        now: u64,
        rng: &mut (impl RngCore + CryptoRng),
    ) -> Result<Exchange> {
        self.session.check(now)?;
        if now < self.last_now || self.remaining == 0 {
            return Err(InvalidInvitation);
        }
        self.remaining -= 1;
        self.last_now = now;
        let mut entropy = ScalarEntropy {
            bytes: Zeroizing::new([0; 64]),
            position: 0,
        };
        rng.try_fill_bytes(entropy.bytes.as_mut())
            .map_err(|_| InvalidInvitation)?;
        let context = self.session.context();
        let a = Identity::new(&framed(&[&context, Role::Inviter.label()]));
        let b = Identity::new(&framed(&[&context, Role::Recipient.label()]));
        let password = Password::new(self.secret.expose_words().as_bytes());
        // Upstream Password and Spake2 state do not zeroize all internal copies.
        // The limitation is recorded in SECURITY.md; no memory-erasure claim.
        let (state, hello) = match role {
            Role::Inviter => Spake2::<Ed25519Group>::start_a_with_rng(&password, &a, &b, entropy),
            Role::Recipient => Spake2::<Ed25519Group>::start_b_with_rng(&password, &a, &b, entropy),
        };
        Ok(Exchange {
            session: self.session.clone(),
            role,
            state,
            hello,
            last_now: now,
        })
    }
}

/// Consumed by a single finish attempt. No key is exposed before confirmation.
pub struct Exchange {
    session: Session,
    role: Role,
    state: Spake2<Ed25519Group>,
    hello: Vec<u8>,
    last_now: u64,
}
impl Exchange {
    pub fn hello(&self) -> String {
        encode(&self.hello)
    }
    pub fn finish(self, peer_hello: &str, now: u64) -> Result<PendingConfirmation> {
        self.session.check(now)?;
        if now < self.last_now || peer_hello.len() != 44 {
            return Err(InvalidInvitation);
        }
        let peer = decode(peer_hello)?;
        if peer.len() != 33
            || peer[0]
                != match self.role {
                    Role::Inviter => b'B',
                    Role::Recipient => b'A',
                }
        {
            return Err(InvalidInvitation);
        }
        let compressed = CompressedEdwardsY(peer[1..].try_into().map_err(|_| InvalidInvitation)?);
        let point = compressed.decompress().ok_or(InvalidInvitation)?;
        // Reject noncanonical, non-prime-subgroup and identity inputs before SPAKE2.
        if point.compress() != compressed
            || !point.is_torsion_free()
            || point == curve25519_dalek::edwards::EdwardsPoint::default()
        {
            return Err(InvalidInvitation);
        }
        let context = self.session.context();
        let (a, b) = match self.role {
            Role::Inviter => (&self.hello, &peer),
            Role::Recipient => (&peer, &self.hello),
        };
        let transcript: [u8; 32] = Sha256::digest(framed(&[&context, a, b])).into();
        let shared = Zeroizing::new(self.state.finish(&peer).map_err(|_| InvalidInvitation)?);
        let kdf = Hkdf::<Sha256>::new(Some(&transcript), &shared);
        let derive = |label: &[u8]| -> Result<Zeroizing<[u8; 32]>> {
            let mut key = Zeroizing::new([0; 32]);
            kdf.expand(&framed(&[PROFILE.as_bytes(), label]), key.as_mut())
                .map_err(|_| InvalidInvitation)?;
            Ok(key)
        };
        Ok(PendingConfirmation {
            session: self.session,
            role: self.role,
            transcript,
            send: derive(self.role.label())?,
            receive: derive(self.role.opposite().label())?,
            verify: derive(b"verification")?,
            confirm_send: derive(&framed(&[b"confirmation", self.role.label()]))?,
            confirm_receive: derive(&framed(&[b"confirmation", self.role.opposite().label()]))?,
            last_now: now,
        })
    }
}

fn proof(key: &[u8], transcript: &[u8], role: Role) -> Result<[u8; 32]> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).map_err(|_| InvalidInvitation)?;
    mac.update(&framed(&[
        PROFILE.as_bytes(),
        b"confirmation",
        transcript,
        role.label(),
    ]));
    Ok(mac.finalize().into_bytes().into())
}

pub struct PendingConfirmation {
    session: Session,
    role: Role,
    transcript: [u8; 32],
    send: Zeroizing<[u8; 32]>,
    receive: Zeroizing<[u8; 32]>,
    verify: Zeroizing<[u8; 32]>,
    confirm_send: Zeroizing<[u8; 32]>,
    confirm_receive: Zeroizing<[u8; 32]>,
    last_now: u64,
}
impl PendingConfirmation {
    pub fn confirmation(&self) -> Result<String> {
        Ok(encode(&proof(
            self.confirm_send.as_ref(),
            &self.transcript,
            self.role,
        )?))
    }
    /// A failed confirmation destroys this attempt as well as a successful one.
    pub fn confirm(self, peer_proof: &str, now: u64) -> Result<Channel> {
        self.session.check(now)?;
        if now < self.last_now || peer_proof.len() != 43 {
            return Err(InvalidInvitation);
        }
        let peer: [u8; 32] = array(peer_proof)?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.confirm_receive.as_ref())
            .map_err(|_| InvalidInvitation)?;
        mac.update(&framed(&[
            PROFILE.as_bytes(),
            b"confirmation",
            &self.transcript,
            self.role.opposite().label(),
        ]));
        mac.verify_slice(&peer).map_err(|_| InvalidInvitation)?;
        Ok(Channel {
            session: self.session,
            role: self.role,
            transcript: self.transcript,
            send: self.send,
            receive: self.receive,
            verify: self.verify,
            sent: 0,
            received: 0,
            last_now: now,
        })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Packet {
    v: String,
    seq: u64,
    ciphertext: String,
}

/// Ordered, bounded encrypted bootstrap transport. Not general game/media transport.
/// Own both sequence counters until disposal; never clone, restore or reuse keys.
pub struct Channel {
    session: Session,
    role: Role,
    transcript: [u8; 32],
    send: Zeroizing<[u8; 32]>,
    receive: Zeroizing<[u8; 32]>,
    verify: Zeroizing<[u8; 32]>,
    sent: u64,
    received: u64,
    last_now: u64,
}
impl Channel {
    fn check(&self, now: u64) -> Result<()> {
        self.session.check(now)?;
        if now < self.last_now {
            return Err(InvalidInvitation);
        }
        Ok(())
    }
    fn aad(&self, role: Role, seq: u64) -> Vec<u8> {
        framed(&[
            PROFILE.as_bytes(),
            &self.transcript,
            role.label(),
            &seq.to_be_bytes(),
        ])
    }
    pub fn verification_words(&self, count: usize, now: u64) -> Result<String> {
        self.check(now)?;
        spoken::derive_words(
            self.verify.as_ref(),
            "foregather-live/verify/v1",
            0,
            None,
            count,
        )
    }
    pub fn seal(&mut self, payload: &[u8], now: u64) -> Result<String> {
        self.check(now)?;
        if payload.len() > MAX_PAYLOAD_BYTES || self.sent >= MAX_MESSAGES {
            return Err(InvalidInvitation);
        }
        let seq = self.sent;
        // Spend before encryption: errors cannot cause nonce reuse.
        self.sent += 1;
        self.last_now = now;
        let mut nonce = [0; 12];
        nonce[4..].copy_from_slice(&seq.to_be_bytes());
        let ciphertext = Aes256Gcm::new_from_slice(self.send.as_ref())
            .map_err(|_| InvalidInvitation)?
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: payload,
                    aad: &self.aad(self.role, seq),
                },
            )
            .map_err(|_| InvalidInvitation)?;
        serde_json::to_string(&Packet {
            v: PROFILE.into(),
            seq,
            ciphertext: encode(&ciphertext),
        })
        .map_err(|_| InvalidInvitation)
    }
    pub fn open(&mut self, packet: &str, now: u64) -> Result<Zeroizing<Vec<u8>>> {
        self.check(now)?;
        if packet.len() > MAX_PACKET_BYTES || self.received >= MAX_MESSAGES {
            return Err(InvalidInvitation);
        }
        let packet: Packet = serde_json::from_str(packet).map_err(|_| InvalidInvitation)?;
        if packet.v != PROFILE || packet.seq != self.received {
            return Err(InvalidInvitation);
        }
        let ciphertext = decode(&packet.ciphertext)?;
        if ciphertext.len() < 16 || ciphertext.len() > MAX_PAYLOAD_BYTES + 16 {
            return Err(InvalidInvitation);
        }
        let mut nonce = [0; 12];
        nonce[4..].copy_from_slice(&packet.seq.to_be_bytes());
        let payload = Zeroizing::new(
            Aes256Gcm::new_from_slice(self.receive.as_ref())
                .map_err(|_| InvalidInvitation)?
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: &self.aad(self.role.opposite(), packet.seq),
                    },
                )
                .map_err(|_| InvalidInvitation)?,
        );
        self.received += 1;
        self.last_now = now;
        Ok(payload)
    }
}

#[cfg(test)]
mod vectors {
    use super::*;
    struct FixtureRng(u8);
    impl CryptoRng for FixtureRng {}
    impl RngCore for FixtureRng {
        fn next_u32(&mut self) -> u32 {
            let mut b = [0; 4];
            self.fill_bytes(&mut b);
            u32::from_le_bytes(b)
        }
        fn next_u64(&mut self) -> u64 {
            let mut b = [0; 8];
            self.fill_bytes(&mut b);
            u64::from_le_bytes(b)
        }
        fn fill_bytes(&mut self, bytes: &mut [u8]) {
            for b in bytes {
                *b = self.0;
                self.0 = self.0.wrapping_add(1);
            }
        }
        fn try_fill_bytes(
            &mut self,
            bytes: &mut [u8],
        ) -> std::result::Result<(), rand_core::Error> {
            self.fill_bytes(bytes);
            Ok(())
        }
    }
    #[test]
    fn frozen_live_transcript_confirmation_and_bootstrap() {
        let now = 1_800_000_000;
        let s = Session {
            profile: PROFILE.into(),
            namespace: "example.rooms".into(),
            purpose: "bootstrap".into(),
            locator: encode(&[7; 16]),
            issued: now,
            expires: now + 120,
        };
        let secret = "jazz earth glacier";
        let mut a =
            PairingGate::new(s.clone(), PairingSecret::parse(secret).unwrap(), 1, now).unwrap();
        let mut b =
            PairingGate::new(s.clone(), PairingSecret::parse(secret).unwrap(), 1, now).unwrap();
        let ax = a.start(Role::Inviter, now, &mut FixtureRng(1)).unwrap();
        let bx = b.start(Role::Recipient, now, &mut FixtureRng(65)).unwrap();
        let ah = ax.hello();
        let bh = bx.hello();
        let ap = ax.finish(&bh, now).unwrap();
        let bp = bx.finish(&ah, now).unwrap();
        let aproof = ap.confirmation().unwrap();
        let bproof = bp.confirmation().unwrap();
        let mut ac = ap.confirm(&bproof, now).unwrap();
        let mut bc = bp.confirm(&aproof, now).unwrap();
        let packet = ac.seal(b"synthetic bootstrap", now).unwrap();
        assert_eq!(
            bc.open(&packet, now).unwrap().as_slice(),
            b"synthetic bootstrap"
        );
        let actual = serde_json::json!({"session":s,"secretWords":secret,"rngAStart":1,"rngBStart":65,"helloA":ah,"helloB":bh,"proofA":aproof,"proofB":bproof,"transcript":encode(&ac.transcript),"sendKeyA":encode(ac.send.as_ref()),"sendKeyB":encode(bc.send.as_ref()),"verificationWords":ac.verification_words(3,now).unwrap(),"packet":serde_json::from_str::<serde_json::Value>(&packet).unwrap(),"plaintext":"synthetic bootstrap"});
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/live-spake2-ed25519-v1.json")).unwrap();
        assert_eq!(actual, expected);
    }
}
