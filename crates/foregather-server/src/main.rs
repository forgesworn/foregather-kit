use foregather_server::{Config, Store, router, router_with_live};
use std::{
    env,
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let raw =
        Zeroizing::new(env::var("FOREGATHER_CREATE_TOKEN").map_err(|_| "missing creation token")?);
    let bytes = Zeroizing::new(foregather_kit::decode(&raw)?);
    let create_token = Zeroizing::new(bytes.as_slice().try_into().map_err(|_| "invalid token")?);
    let limit = |name, default| -> Result<u32, Box<dyn std::error::Error>> {
        match env::var(name) {
            Ok(value) => Ok(value.parse()?),
            Err(_) => Ok(default),
        }
    };
    let config = Config {
        max_records: limit("FOREGATHER_MAX_RECORDS", 1024)?,
        creates_per_minute: limit("FOREGATHER_CREATES_PER_MINUTE", 60)?,
        create_token,
        clock: Arc::new(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs())
        }),
    };
    let db = env::var("FOREGATHER_DB").unwrap_or_else(|_| "data/foregather.sqlite".into());
    let address: SocketAddr = env::var("FOREGATHER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse()?;
    let store = Arc::new(Store::open(db, config)?);
    let listener = tokio::net::TcpListener::bind(address).await?;
    eprintln!(
        "Foregather resolver listening on {}",
        listener.local_addr()?
    );
    let app = match env::var("FOREGATHER_ENABLE_LIVE").as_deref() {
        Ok("1") => router_with_live(store),
        Ok("0") | Err(_) => router(store),
        _ => return Err("invalid live opt-in".into()),
    };
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
async fn shutdown() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
#[tokio::main]
async fn main() {
    if run().await.is_err() {
        eprintln!(
            "Foregather resolver could not start or stopped unexpectedly. Check configuration and storage."
        );
        std::process::exit(1);
    }
}
