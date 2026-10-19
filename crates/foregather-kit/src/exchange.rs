//! Separately versioned bounded message exchange on a confirmed live channel.
//!
//! After both people accept the verification words, each endpoint may send up
//! to [`MAX_MESSAGES`] ordered application messages to the other, at packet
//! sequences 0 to 31, until the session deadline. Every message is framed with
//! its own index, which must equal the channel sequence that carries it. This
//! profile is opt-in at both ends and never shares a channel with transfer v1.
//!
//! ```
//! use foregather_kit::{Namespace, exchange::ExchangeChannel, live::{Session, PairingSecret, PairingGate, Role}};
//! use rand_core::OsRng;
//! let mut rng = OsRng;
//! let now = 1_800_000_000;
//! let session = Session::generate(Namespace::parse("example.rooms")?, Namespace::parse("bootstrap")?, 120, now, &mut rng)?;
//! let secret = PairingSecret::generate(4, &mut rng)?;
//! let recipient_secret = PairingSecret::parse(secret.expose_words())?;
//! let mut gate_a = PairingGate::new(session.clone(), secret, 1, now)?;
//! let mut gate_b = PairingGate::new(session, recipient_secret, 1, now)?;
//! let ax = gate_a.start(Role::Inviter, now, &mut rng)?;
//! let bx = gate_b.start(Role::Recipient, now, &mut rng)?;
//! let (ah, bh) = (ax.hello(), bx.hello());
//! let (ap, bp) = (ax.finish(&bh, now)?, bx.finish(&ah, now)?);
//! let (aproof, bproof) = (ap.confirmation()?, bp.confirmation()?);
//! let (ac, bc) = (ap.confirm(&bproof, now)?, bp.confirm(&aproof, now)?);
//! assert_eq!(ac.verification_words(3, now)?, bc.verification_words(3, now)?);
//! // Only after both people confirm the words:
//! let (mut a, mut b) = (ExchangeChannel::new(ac)?, ExchangeChannel::new(bc)?);
//! let (index, packet) = a.seal(b"first message", now)?; // relay slot packet-{index}
//! assert_eq!(index, 0);
//! assert_eq!(b.open(&packet, now)?.as_slice(), b"first message");
//! let (index, reply) = b.seal(b"reply", now)?;
//! assert_eq!((index, a.open(&reply, now)?.as_slice()), (0, &b"reply"[..]));
//! # Ok::<(), foregather_kit::InvalidInvitation>(())
//! ```
use crate::live::{Channel, MAX_PAYLOAD_BYTES};
use crate::{InvalidInvitation, Result};
use zeroize::Zeroizing;

/// Exchange profile; both endpoints opt in, it is never inferred from transfer v1.
pub const PROFILE: &str = "foregather-exchange/1";
/// Messages each endpoint may send: one per relay packet slot, indexes 0 to 31.
pub const MAX_MESSAGES: usize = 32;
/// Largest application message: the frame fills the live channel's 16-KiB bound.
pub const MAX_PAYLOAD: usize = MAX_PAYLOAD_BYTES - HEADER;
const MESSAGE: [u8; 4] = [70, 71, 2, 1];
const HEADER: usize = 5;

/// Frame one message: `46 47 02 01 || index_u8 || payload`.
/// The index must be below [`MAX_MESSAGES`] and the payload at most [`MAX_PAYLOAD`] bytes.
pub fn encode_message(index: u8, payload: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if usize::from(index) >= MAX_MESSAGES || payload.len() > MAX_PAYLOAD {
        return Err(InvalidInvitation);
    }
    let mut frame = Zeroizing::new(Vec::with_capacity(HEADER + payload.len()));
    frame.extend_from_slice(&MESSAGE);
    frame.push(index);
    frame.extend_from_slice(payload);
    Ok(frame)
}

/// Check the type, version and expected index of an authenticated frame and
/// return its application bytes. Any other profile's frame is refused.
pub fn decode_message(index: u8, frame: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if usize::from(index) >= MAX_MESSAGES
        || !(HEADER..=HEADER + MAX_PAYLOAD).contains(&frame.len())
        || frame[..4] != MESSAGE
        || frame[4] != index
    {
        return Err(InvalidInvitation);
    }
    Ok(Zeroizing::new(frame[HEADER..].to_vec()))
}

/// A confirmed live channel dedicated to this profile. Each message's index is
/// its channel sequence, so it cannot be replayed, reordered or moved to
/// another slot. Construct it only after both people confirm the verification
/// words, from a channel that has sealed and opened nothing.
pub struct ExchangeChannel {
    channel: Channel,
    failed: bool,
}
impl ExchangeChannel {
    /// Take a fresh confirmed channel; one that carried any packet is refused,
    /// so a transfer and an exchange never share a channel.
    pub fn new(channel: Channel) -> Result<Self> {
        if channel.sequences() != (0, 0) {
            return Err(InvalidInvitation);
        }
        Ok(Self {
            channel,
            failed: false,
        })
    }
    /// Number of messages sealed so far: the index of the next one.
    pub fn sent(&self) -> usize {
        self.channel.sequences().0 as usize
    }
    /// Number of messages opened so far: the index expected next.
    pub fn received(&self) -> usize {
        self.channel.sequences().1 as usize
    }
    fn index(&self, sequence: u64) -> Result<u8> {
        match u8::try_from(sequence) {
            Ok(index) if !self.failed && usize::from(index) < MAX_MESSAGES => Ok(index),
            _ => Err(InvalidInvitation),
        }
    }
    /// Frame and encrypt the next message. Returns its index, which names the
    /// relay slot `packet-{index}`, and the packet. Retry an uncertain upload
    /// with these identical bytes; never seal the same message again.
    pub fn seal(&mut self, payload: &[u8], now: u64) -> Result<(u8, String)> {
        let index = self.index(self.channel.sequences().0)?;
        let frame = encode_message(index, payload)?;
        Ok((index, self.channel.seal(&frame, now)?))
    }
    /// Authenticate the peer's next packet and return its message. A packet
    /// that fails authentication changes nothing. An authenticated packet with
    /// any other framing ends this exchange: every later call fails.
    pub fn open(&mut self, packet: &str, now: u64) -> Result<Zeroizing<Vec<u8>>> {
        let index = self.index(self.channel.sequences().1)?;
        let frame = self.channel.open(packet, now)?;
        decode_message(index, &frame).inspect_err(|_| self.failed = true)
    }
}

#[cfg(test)]
mod frozen {
    use super::*;
    use crate::live::vectors::fixture_channels;

    #[test]
    fn independent_packets_over_the_frozen_live_channel() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/exchange-v1.json")).unwrap();
        assert_eq!(fixture["profile"], PROFILE);
        let bytes = |value: &serde_json::Value| {
            let text = value.as_str().unwrap();
            if text.is_empty() {
                Vec::new()
            } else {
                crate::decode(text).unwrap()
            }
        };
        let (ac, bc) = fixture_channels();
        let (mut a, mut b) = (
            ExchangeChannel::new(ac).unwrap(),
            ExchangeChannel::new(bc).unwrap(),
        );
        let now = 1_800_000_000;
        let packets = fixture["packets"].as_array().unwrap();
        assert!(packets.len() >= 4);
        for vector in packets {
            let payload = bytes(&vector["payload"]);
            let (from, to) = match vector["role"].as_str().unwrap() {
                "inviter" => (&mut a, &mut b),
                "recipient" => (&mut b, &mut a),
                _ => unreachable!(),
            };
            let (index, packet) = from.seal(&payload, now).unwrap();
            assert_eq!(u64::from(index), vector["index"].as_u64().unwrap());
            let expected = &vector["packet"];
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&packet).unwrap(),
                *expected
            );
            assert_eq!(expected["seq"], vector["index"]);
            assert_eq!(
                to.open(&expected.to_string(), now).unwrap().as_slice(),
                payload
            );
        }
    }

    #[test]
    fn a_transfer_frame_ends_the_exchange_and_used_channels_are_refused() {
        let now = 1_800_000_000;
        let (mut ac, bc) = fixture_channels();
        let mut b = ExchangeChannel::new(bc).unwrap();
        // The peer runs transfer v1 on the same session: its invitation frame
        // authenticates at sequence zero but is not an exchange message.
        let invitation = [
            70, 71, 1, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        ];
        let packet = ac.seal(&invitation, now).unwrap();
        assert!(b.open(&packet, now).is_err());
        assert_eq!(b.received(), 1);
        let next = ac.seal(&encode_message(1, b"later").unwrap(), now).unwrap();
        assert!(b.open(&next, now).is_err());
        assert!(b.seal(b"after failure", now).is_err());
        // A channel that already carried a packet cannot become an exchange.
        assert!(ExchangeChannel::new(ac).is_err());
        let (ac, mut bc) = fixture_channels();
        let mut a = ExchangeChannel::new(ac).unwrap();
        let (_, packet) = a.seal(b"x", now).unwrap();
        bc.open(&packet, now).unwrap();
        assert!(ExchangeChannel::new(bc).is_err());
    }
}
