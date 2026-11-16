//! Configuration from environment variables (optionally loaded from a .env file).

use crate::chain::{Network, keys::PrivateKey};
use crate::fulcrum::{CHIPNET_DEFAULT_SERVERS, MAINNET_DEFAULT_SERVERS};
use crate::service::Settings;

pub struct Config {
    pub settings: Settings,
    pub fulcrum_servers: Vec<String>,
    pub database_url: String,
    pub port: u16,
    pub cors_origin: Option<String>,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        // Mainnet only when explicitly requested; anything else (incl. unset) is chipnet or an error.
        let network: Network = match var("NETWORK").as_deref() {
            None => Network::Chipnet,
            Some("mainnet") => Network::Mainnet,
            Some(other) => other.parse()?,
        };
        let key = |name: &str| -> Result<PrivateKey, String> {
            let wif = var(name).ok_or_else(|| format!("{name} is required"))?;
            PrivateKey::from_wif(&wif, network).map_err(|e| format!("{name}: {e}"))
        };
        let oracle = key("ORACLE_WIF")?;
        let fee = key("FEE_WIF")?;
        if oracle.pkh() == fee.pkh() {
            return Err("ORACLE_WIF and FEE_WIF must be different keys".into());
        }
        let mut settings = Settings::new(network, oracle, fee);
        if let Some(ms) = var("LEASE_MS") {
            settings.lease_ms = ms.parse().map_err(|_| "LEASE_MS must be an integer")?;
        }

        let defaults = match network {
            Network::Chipnet => CHIPNET_DEFAULT_SERVERS,
            Network::Mainnet => MAINNET_DEFAULT_SERVERS,
        };
        // FULCRUM_URL: comma-separated, primary first; the network's defaults are appended as fallbacks.
        let mut fulcrum_servers: Vec<String> = var("FULCRUM_URL").map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
        for d in defaults {
            if !fulcrum_servers.iter().any(|s| s == d) {
                fulcrum_servers.push(d.to_string());
            }
        }

        Ok(Self {
            settings,
            fulcrum_servers,
            database_url: var("DATABASE_URL").unwrap_or_else(|| "sqlite://nova.db".into()),
            port: var("PORT").map(|p| p.parse().map_err(|_| "PORT must be a number")).transpose()?.unwrap_or(8080),
            cors_origin: var("CORS_ORIGIN"),
        })
    }
}
