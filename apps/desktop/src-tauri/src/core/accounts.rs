use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

const KEYRING_SERVICE: &str = "AngKorGit";

type TokenCache = Mutex<HashMap<String, Option<(String, String)>>>;
static TOKEN_CACHE: OnceLock<TokenCache> = OnceLock::new();

fn token_cache() -> &'static TokenCache {
    TOKEN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub host: String,
    pub username: String,
    pub provider: String,
    #[serde(default)]
    pub verified: bool,
}

fn meta_path() -> Option<PathBuf> {
    CONFIG_DIR.get().map(|dir| dir.join("accounts.json"))
}

fn normalize_host(host: &str) -> String {
    host.trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_lowercase()
}

pub fn list() -> Vec<AccountInfo> {
    let Some(path) = meta_path() else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_list(accounts: &[AccountInfo]) -> AppResult<()> {
    let path = meta_path().ok_or_else(|| AppError::other("config dir not initialized"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        path,
        serde_json::to_string_pretty(accounts).unwrap_or_default(),
    )?;
    Ok(())
}

pub fn add(
    host: &str,
    username: &str,
    provider: &str,
    token: &str,
    verified: bool,
) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    if host.is_empty() || username.trim().is_empty() || token.trim().is_empty() {
        return Err(AppError::other("host, username and token are all required"));
    }

    let entry = keyring::Entry::new(KEYRING_SERVICE, &host)
        .map_err(|e| AppError::other(format!("keychain unavailable: {e}")))?;
    entry
        .set_password(token.trim())
        .map_err(|e| AppError::other(format!("could not store token in keychain: {e}")))?;
    if let Ok(mut cache) = token_cache().lock() {
        cache.insert(
            host.clone(),
            Some((username.trim().to_string(), token.trim().to_string())),
        );
    }

    let mut accounts = list();
    accounts.retain(|a| a.host != host);
    accounts.push(AccountInfo {
        host,
        username: username.trim().to_string(),
        provider: provider.to_string(),
        verified,
    });
    accounts.sort_by(|a, b| a.host.cmp(&b.host));
    save_list(&accounts)?;
    Ok(accounts)
}

pub fn remove(host: &str) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &host) {
        let _ = entry.delete_credential();
    }
    if let Ok(mut cache) = token_cache().lock() {
        cache.remove(&host);
    }
    let mut accounts = list();
    accounts.retain(|a| a.host != host);
    save_list(&accounts)?;
    Ok(accounts)
}

pub fn lookup(host: &str) -> Option<(String, String)> {
    let host = normalize_host(host);
    let account = list().into_iter().find(|a| {
        a.host == host
            || a.host == host.split(':').next().unwrap_or(&host)
            || host == a.host.split(':').next().unwrap_or(&a.host)
    })?;
    let mut cache = token_cache().lock().ok()?;
    if let Some(hit) = cache.get(&account.host) {
        return hit.clone();
    }
    let result = keyring::Entry::new(KEYRING_SERVICE, &account.host)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(|token| (account.username.clone(), token));
    cache.insert(account.host.clone(), result.clone());
    result
}

pub fn host_of_url(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?; // http(s) URLs only
    let authority = rest.split('/').next()?;
    let host = authority.rsplit('@').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}
