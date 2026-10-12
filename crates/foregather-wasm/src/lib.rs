#![forbid(unsafe_code)]
use foregather_kit::{Locator, MAX_SAFE_SECONDS, Namespace, Profile, ResolverLocation};
use rand_core::OsRng;
use wasm_bindgen::prelude::*;

fn error(_: impl std::fmt::Display) -> JsValue {
    JsValue::from_str("Invalid invitation")
}
fn seconds(value: f64) -> Result<u64, JsValue> {
    if !value.is_finite() || value.fract() != 0.0 || value < 0.0 || value > MAX_SAFE_SECONDS as f64
    {
        return Err(error("clock"));
    }
    Ok(value as u64)
}
fn profile(value: &str) -> Result<Profile, JsValue> {
    if value == "kithmoot/v1" {
        return Ok(Profile::KithmootV1);
    }
    let namespace = value.strip_prefix("v1:").ok_or_else(|| error("profile"))?;
    Ok(Profile::V1(Namespace::parse(namespace).map_err(error)?))
}

#[wasm_bindgen]
pub fn seal_envelope(
    profile_name: &str,
    base: &str,
    allow_loopback_http: bool,
    id: &str,
    payload: &[u8],
    expires: f64,
    now: f64,
) -> Result<String, JsValue> {
    let profile = profile(profile_name)?;
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    let id = Locator::parse(id).map_err(error)?;
    let (invite, envelope) = foregather_kit::seal(
        &profile,
        id,
        payload,
        seconds(expires)?,
        seconds(now)?,
        &mut OsRng,
    )
    .map_err(error)?;
    serde_json::to_string(
        &serde_json::json!({"url": invite.to_url(&location), "envelope": envelope}),
    )
    .map_err(error)
}

#[wasm_bindgen]
pub fn open_envelope(
    profile_name: &str,
    base: &str,
    allow_loopback_http: bool,
    invitation_url: &str,
    response: &str,
    now: f64,
) -> Result<Vec<u8>, JsValue> {
    let profile = profile(profile_name)?;
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    let invitation = location.parse_invitation(invitation_url).map_err(error)?;
    Ok(
        foregather_kit::open(&profile, &invitation, response, seconds(now)?)
            .map_err(error)?
            .to_vec(),
    )
}

#[wasm_bindgen]
pub fn invitation_locator(
    base: &str,
    allow_loopback_http: bool,
    invitation_url: &str,
) -> Result<String, JsValue> {
    let location = ResolverLocation::parse(base, allow_loopback_http).map_err(error)?;
    Ok(location
        .parse_invitation(invitation_url)
        .map_err(error)?
        .locator()
        .encoded())
}
