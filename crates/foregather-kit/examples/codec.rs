//! Machine-readable native interop helper. Only use synthetic input in test logs.
use foregather_kit::{Locator, Namespace, Profile, ResolverLocation, decode, encode, open, seal};
use rand_core::OsRng;
use serde::Deserialize;
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: String,
    profile: String,
    base: String,
    now: u64,
    id: Option<String>,
    payload: Option<String>,
    expires: Option<u64>,
    url: Option<String>,
    envelope: Option<String>,
}
fn run() -> Result<String, Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().take(96 * 1024).read_to_string(&mut input)?;
    let req: Request = serde_json::from_str(&input)?;
    let profile = if req.profile == "kithmoot/v1" {
        Profile::KithmootV1
    } else {
        Profile::V1(Namespace::parse(
            req.profile.strip_prefix("v1:").ok_or("profile")?,
        )?)
    };
    let location = ResolverLocation::parse(&req.base, true)?;
    match req.action.as_str() {
        "seal" => {
            let id = Locator::parse(req.id.as_deref().ok_or("id")?)?;
            let payload = req.payload.as_deref().ok_or("payload")?;
            let payload = if payload.is_empty() {
                Vec::new()
            } else {
                decode(payload)?
            };
            let (invitation, envelope) = seal(
                &profile,
                id,
                &payload,
                req.expires.ok_or("expires")?,
                req.now,
                &mut OsRng,
            )?;
            Ok(serde_json::to_string(
                &serde_json::json!({"url": invitation.to_url(&location), "envelope": envelope}),
            )?)
        }
        "open" => {
            let invitation = location.parse_invitation(req.url.as_deref().ok_or("url")?)?;
            let payload = open(
                &profile,
                &invitation,
                req.envelope.as_deref().ok_or("envelope")?,
                req.now,
            )?;
            Ok(serde_json::to_string(
                &serde_json::json!({"payload": encode(&payload)}),
            )?)
        }
        _ => Err("action".into()),
    }
}
fn main() {
    match run() {
        Ok(value) => println!("{value}"),
        Err(_) => {
            eprintln!("Invalid invitation");
            std::process::exit(1);
        }
    }
}
