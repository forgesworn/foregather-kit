//! Experimental endpoint-to-endpoint PAKE bootstrap; see docs/live-protocol.md.
//! This profile is NOT RFC 9382 wire compatible or independently audited.
//!
//! # Synthetic two-endpoint bootstrap
//!
//! The application transports only public session, hellos, proofs and packets.
//! Access words travel out of band. Keep one gate per endpoint for the entire
//! code lifetime, validate expected namespace/purpose locally and obtain consent.
//!
//! ```
//! use foregather_kit::{Namespace, live::{Session, PairingSecret, PairingGate, Role}};
//! use rand_core::OsRng;
//! let mut rng = OsRng;
//! let now = 1_800_000_000;
//! let session = Session::generate(Namespace::parse("example.rooms")?, Namespace::parse("bootstrap")?, 120, now, &mut rng)?;
//! let secret = PairingSecret::generate(4, &mut rng)?;
//! let recipient_secret = PairingSecret::parse(secret.expose_words())?;
//! let mut a = PairingGate::new(session.clone(), secret, 1, now)?;
//! let mut b = PairingGate::new(session, recipient_secret, 1, now)?;
//! let ax = a.start(Role::Inviter, now, &mut rng)?;
//! let bx = b.start(Role::Recipient, now, &mut rng)?;
//! let ah = ax.hello();
//! let bh = bx.hello();
//! let ap = ax.finish(&bh, now)?;
//! let bp = bx.finish(&ah, now)?;
//! let aproof = ap.confirmation()?;
//! let bproof = bp.confirmation()?;
//! let mut ac = ap.confirm(&bproof, now)?;
//! let mut bc = bp.confirm(&aproof, now)?;
//! assert_eq!(ac.verification_words(3, now)?, bc.verification_words(3, now)?);
//! // Both people compare the words and consent before handing over app input.
//! let packet = ac.seal(b"candidate invitation", now)?;
//! let candidate = bc.open(&packet, now)?;
//! assert_eq!(candidate.as_slice(), b"candidate invitation");
//! // The receiving application still validates and admits the candidate.
//! # Ok::<(), foregather_kit::InvalidInvitation>(())
//! ```
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

/// Exact transcript and packet profile identifier; not RFC 9382 wire bytes.
pub const PROFILE: &str = "foregather-live/spake2-ed25519/1";
/// Maximum accepted serialized bootstrap packet size.
pub const MAX_PACKET_BYTES: usize = 24 * 1024;
/// Maximum plaintext bootstrap payload size.
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

/// Frozen access-code presentation encoding; the PAKE profile itself is unchanged.
pub const CHARACTER_ENCODING: &str = "foregather-access/base32-en-v1/1";
/// Exact 32-symbol alphabet. No ambiguous I, L, O or U, and no alias substitutions.
pub const CHARACTER_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn canonical_characters(value: &str) -> Result<Zeroizing<String>> {
    if value.len() > 64 || !value.is_ascii() {
        return Err(InvalidInvitation);
    }
    let value = Zeroizing::new(value.trim().to_ascii_uppercase());
    if value.contains('-') {
        let mut groups = value.split('-').peekable();
        while let Some(group) = groups.next() {
            if group.is_empty() || group.len() > 3 || (groups.peek().is_some() && group.len() != 3)
            {
                return Err(InvalidInvitation);
            }
        }
    }
    let value = Zeroizing::new(value.replace('-', ""));
    if !(6..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| CHARACTER_ALPHABET.as_bytes().contains(&b))
    {
        return Err(InvalidInvitation);
    }
    Ok(value)
}

/// Present a public or private character code in triples: `DFVSJX` becomes `DFV-SJX`.
/// Separators add no entropy and never enter the canonical PAKE password or public locator.
/// Private presentations must be shared deliberately and must never be logged.
pub fn format_character_code(value: &str) -> Result<Zeroizing<String>> {
    let value = canonical_characters(value)?;
    let mut formatted = Zeroizing::new(String::with_capacity(value.len() + (value.len() - 1) / 3));
    for (index, byte) in value.bytes().enumerate() {
        if index > 0 && index % 3 == 0 {
            formatted.push('-');
        }
        formatted.push(char::from(byte));
    }
    Ok(formatted)
}

fn random_characters(
    count: usize,
    rng: &mut (impl RngCore + CryptoRng),
) -> Result<Zeroizing<String>> {
    if !(6..=32).contains(&count) {
        return Err(InvalidInvitation);
    }
    let mut bytes = Zeroizing::new([0u8; 32]);
    rng.try_fill_bytes(&mut bytes[..count])
        .map_err(|_| InvalidInvitation)?;
    let mut value = Zeroizing::new(String::with_capacity(count));
    for &b in &bytes[..count] {
        value.push(CHARACTER_ALPHABET.as_bytes()[usize::from(b & 31)] as char);
    }
    Ok(value)
}

/// Public human-readable rendezvous alias. This is never an access credential.
/// The caller owns its expiring, collision-checked mapping to a full public session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RendezvousCode(String);
impl RendezvousCode {
    /// Generate 6–32 public characters independently of the secret and full locator.
    pub fn generate(count: usize, rng: &mut (impl RngCore + CryptoRng)) -> Result<Self> {
        Ok(Self(random_characters(count, rng)?.to_string()))
    }
    /// Canonicalise ASCII case, surrounding whitespace and optional hyphens between triples.
    /// Reject malformed grouping, internal whitespace and ambiguous-character substitutions.
    pub fn parse(value: &str) -> Result<Self> {
        Ok(Self(canonical_characters(value)?.to_string()))
    }
    /// Borrow the public alias. Possession grants no pairing or room authority.
    pub fn as_str(&self) -> &str {
        &self.0
    }
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
    /// Generate 2–16 secret words with trusted entropy; four words provide 44 bits.
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
    /// Parse access words; ASCII whitespace/case are normalised and every word must be in en-v1.
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
    /// Generate 6–32 private characters and their canonical word-password encoding.
    /// Return the code only for deliberate out-of-band presentation; six characters have 30 bits.
    ///
    /// ```
    /// use foregather_kit::live::PairingSecret;
    /// let (secret, code) = PairingSecret::generate_characters(6, &mut rand_core::OsRng)?;
    /// assert_eq!(code.len(), 6);
    /// let recipient_secret = PairingSecret::from_characters(&code)?;
    /// assert_eq!(secret.expose_words(), recipient_secret.expose_words());
    /// // Pass each secret to one lifetime PairingGate. Never log either representation.
    /// # Ok::<(), foregather_kit::InvalidInvitation>(())
    /// ```
    pub fn generate_characters(
        count: usize,
        rng: &mut (impl RngCore + CryptoRng),
    ) -> Result<(Self, Zeroizing<String>)> {
        let code = random_characters(count, rng)?;
        Ok((Self::from_characters(&code)?, code))
    }
    /// Encode a character secret as frozen en-v1 words without changing PAKE wire bytes.
    /// A length-tag word prevents different-length codes with trailing zeroes from colliding.
    /// Parsing cannot establish that a human-chosen code has CSPRNG entropy.
    /// Accept plain characters or hyphen-separated triples, with a final group of 1–3.
    pub fn from_characters(value: &str) -> Result<Self> {
        let code = canonical_characters(value)?;
        let dictionary: Vec<_> = spoken::WORDS.lines().collect();
        let mut words = Zeroizing::new(dictionary[1024 + code.len()].to_string());
        let mut accumulator = Zeroizing::new(0u32);
        let mut bits = 0u32;
        for c in code.bytes() {
            let index = CHARACTER_ALPHABET
                .as_bytes()
                .iter()
                .position(|&b| b == c)
                .ok_or(InvalidInvitation)? as u32;
            *accumulator = (*accumulator << 5) | index;
            bits += 5;
            if bits >= 11 {
                bits -= 11;
                words.push(' ');
                words.push_str(dictionary[((*accumulator >> bits) & 2047) as usize]);
                *accumulator &= (1 << bits) - 1;
            }
        }
        if bits > 0 {
            words.push(' ');
            words.push_str(dictionary[(*accumulator << (11 - bits)) as usize]);
        }
        Ok(Self(words))
    }
    /// Intentional secret export for human presentation only.
    pub fn expose_words(&self) -> &str {
        &self.0
    }
}

/// Public rendezvous context. Locally validate expected namespace and purpose before pairing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    /// Exact experimental wire profile.
    pub profile: String,
    /// Application-selected domain separation, not proof of application identity.
    pub namespace: String,
    /// Application-selected bootstrap purpose.
    pub purpose: String,
    /// Independent 128-bit public lookup address, never an authentication secret.
    pub locator: String,
    /// Issuance time in trusted Unix seconds.
    pub issued: u64,
    /// Expiry in Unix seconds, at most 600 seconds after issuance.
    pub expires: u64,
}
impl Session {
    /// Generate a public session with independent locator and lifetime of 1–600 seconds.
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
    /// Parse bounded public JSON and validate its profile, domains and lifetime.
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

/// Fixed complementary PAKE role, chosen locally by the application.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Party presenting the invitation and access words.
    Inviter,
    /// Party entering the access words.
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
    /// Create the single lifetime gate with 1–5 attempts; prefer one attempt.
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
    /// Return the unspent start budget.
    pub fn remaining(&self) -> u8 {
        self.remaining
    }
    /// Spend an attempt and create a fresh exchange with trusted entropy and time.
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
    /// Export the public PAKE hello for transport to the complementary peer.
    pub fn hello(&self) -> String {
        encode(&self.hello)
    }
    /// Consume this exchange, validate the peer point and derive pending confirmation.
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

/// One-use proof exchange; no application channel exists before peer confirmation.
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
    /// Export the role-bound confirmation proof, never raw channel keys.
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
    /// Next send and receive sequence numbers, for framing profiles that bind them.
    pub(crate) fn sequences(&self) -> (u64, u64) {
        (self.sent, self.received)
    }
    fn aad(&self, role: Role, seq: u64) -> Vec<u8> {
        framed(&[
            PROFILE.as_bytes(),
            &self.transcript,
            role.label(),
            &seq.to_be_bytes(),
        ])
    }
    /// Derive 1–16 post-pairing comparison words, distinct from the access secret.
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
    /// Encrypt the next ordered payload; spend its sequence number before encryption.
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
    /// Authenticate the next peer packet; reject tampering, reordering and replay.
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
pub(crate) mod vectors {
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
    /// Fresh inviter and recipient channels of the frozen live vector, at
    /// sequence zero both ways, for composition vectors over its keys.
    pub(crate) fn fixture_channels() -> (Channel, Channel) {
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
        let mut b = PairingGate::new(s, PairingSecret::parse(secret).unwrap(), 1, now).unwrap();
        let ax = a.start(Role::Inviter, now, &mut FixtureRng(1)).unwrap();
        let bx = b.start(Role::Recipient, now, &mut FixtureRng(65)).unwrap();
        let (ah, bh) = (ax.hello(), bx.hello());
        let ap = ax.finish(&bh, now).unwrap();
        let bp = bx.finish(&ah, now).unwrap();
        let (aproof, bproof) = (ap.confirmation().unwrap(), bp.confirmation().unwrap());
        (
            ap.confirm(&bproof, now).unwrap(),
            bp.confirm(&aproof, now).unwrap(),
        )
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
