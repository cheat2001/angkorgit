//! App-managed hosting accounts (GitHub, GitLab, Bitbucket, self-hosted…).
//!
//! Tokens live in the OS keychain under the "AngKorGit" service — never on
//! disk. Non-secret metadata (host, username, provider) lives in a JSON file
//! in the app config dir so accounts can be listed. The remote-auth callback
//! matches a remote's host against these accounts before falling back to the
//! system git credential stack.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Set once at startup from Tauri's app config dir.
pub static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

const KEYRING_SERVICE: &str = "AngKorGit";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub host: String,
    pub username: String,
    pub provider: String,
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

pub fn add(host: &str, username: &str, provider: &str, token: &str) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    if host.is_empty() || username.trim().is_empty() || token.trim().is_empty() {
        return Err(AppError::other("host, username and token are all required"));
    }

    let entry = keyring::Entry::new(KEYRING_SERVICE, &host)
        .map_err(|e| AppError::other(format!("keychain unavailable: {e}")))?;
    entry
        .set_password(token.trim())
        .map_err(|e| AppError::other(format!("could not store token in keychain: {e}")))?;

    let mut accounts = list();
    accounts.retain(|a| a.host != host);
    accounts.push(AccountInfo {
        host,
        username: username.trim().to_string(),
        provider: provider.to_string(),
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
    let mut accounts = list();
    accounts.retain(|a| a.host != host);
    save_list(&accounts)?;
    Ok(accounts)
}

/// Credentials for a host, if an account is configured for it.
pub fn lookup(host: &str) -> Option<(String, String)> {
    let host = normalize_host(host);
    let account = list().into_iter().find(|a| {
        a.host == host
            // stored without port, remote with port (or vice versa)
            || a.host == host.split(':').next().unwrap_or(&host)
            || host == a.host.split(':').next().unwrap_or(&a.host)
    })?;
    let token = keyring::Entry::new(KEYRING_SERVICE, &account.host)
        .ok()?
        .get_password()
        .ok()?;
    Some((account.username, token))
}

/// Extract the host (with port, if any) from a git remote URL.
pub fn host_of_url(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?; // http(s) URLs only
    let authority = rest.split('/').next()?;
    // strip user[:pass]@ prefix
    let host = authority.rsplit('@').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}
