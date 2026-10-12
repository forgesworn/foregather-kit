//! Line-oriented local IPC example. Input and output are private application data;
//! never log real pairing secrets or decrypted invitations. No room admission.
#[cfg(not(feature = "experimental-live"))]
fn main() {
    eprintln!("Requires --features experimental-live");
    std::process::exit(1);
}
#[cfg(feature = "experimental-live")]
fn main() {
    use foregather_kit::{decode, encode, live::*};
    use rand_core::OsRng;
    use serde_json::{Value, json};
    use std::io::{BufRead, Read, Write};
    let mut gate: Option<PairingGate> = None;
    let mut started = false;
    let mut exchange: Option<Exchange> = None;
    let mut pending: Option<PendingConfirmation> = None;
    let mut channel: Option<Channel> = None;
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    loop {
        let mut line = String::new();
        match (&mut input).take(32769).read_line(&mut line) {
            Ok(0) => break,
            Ok(size) if size <= 32768 && line.ends_with('\n') => {}
            _ => {
                println!("{{\"error\":\"Invalid invitation\"}}");
                break;
            }
        }
        let result = (|| -> foregather_kit::Result<Value> {
            let v: Value =
                serde_json::from_str(&line).map_err(|_| foregather_kit::InvalidInvitation)?;
            let now = v["now"].as_u64().ok_or(foregather_kit::InvalidInvitation)?;
            let text = |key: &str| v[key].as_str().ok_or(foregather_kit::InvalidInvitation);
            match text("action")? {
                "start" => {
                    if started {
                        return Err(foregather_kit::InvalidInvitation);
                    }
                    let s = Session::parse(&v["session"].to_string(), now)?;
                    if s.namespace != text("namespace")? || s.purpose != text("purpose")? {
                        return Err(foregather_kit::InvalidInvitation);
                    }
                    started = true;
                    gate = Some(PairingGate::new(
                        s,
                        PairingSecret::parse(text("secretWords")?)?,
                        1,
                        now,
                    )?);
                    let role = match text("role")? {
                        "inviter" => Role::Inviter,
                        "recipient" => Role::Recipient,
                        _ => return Err(foregather_kit::InvalidInvitation),
                    };
                    exchange = Some(gate.as_mut().unwrap().start(role, now, &mut OsRng)?);
                    Ok(json!({"hello":exchange.as_ref().unwrap().hello()}))
                }
                "finish" => {
                    let e = exchange.take().ok_or(foregather_kit::InvalidInvitation)?;
                    pending = Some(e.finish(text("peerHello")?, now)?);
                    Ok(json!({"proof":pending.as_ref().unwrap().confirmation()?}))
                }
                "confirm" => {
                    let p = pending.take().ok_or(foregather_kit::InvalidInvitation)?;
                    channel = Some(p.confirm(text("peerProof")?, now)?);
                    gate.take();
                    Ok(json!({"words":channel.as_ref().unwrap().verification_words(3,now)?}))
                }
                "seal" => Ok(
                    json!({"packet":channel.as_mut().ok_or(foregather_kit::InvalidInvitation)?.seal(&decode(text("payload")?)?,now)?}),
                ),
                "open" => Ok(
                    json!({"payload":encode(&channel.as_mut().ok_or(foregather_kit::InvalidInvitation)?.open(text("packet")?,now)?)}),
                ),
                _ => Err(foregather_kit::InvalidInvitation),
            }
        })();
        let output = result.unwrap_or_else(|_| json!({"error":"Invalid invitation"}));
        println!("{output}");
        std::io::stdout().flush().unwrap();
    }
}
