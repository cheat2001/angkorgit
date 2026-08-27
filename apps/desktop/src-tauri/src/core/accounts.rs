use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

const KEYRING_SERVICE: &str = "AngKorGit";

type TokenCache = Mutex<HashMap<String, Option<String>>>;
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
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub verified_at: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub is_default: bool,
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

fn entry_name(host: &str, username: &str) -> String {
    format!("acct:{host}:{username}")
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn hosts_match(a: &str, b: &str) -> bool {
    a == b || a == b.split(':').next().unwrap_or(b) || b == a.split(':').next().unwrap_or(a)
}

fn ensure_defaults(accounts: &mut [AccountInfo]) {
    let hosts: Vec<String> = accounts.iter().map(|a| a.host.clone()).collect();
    for host in hosts {
        let mut seen_default = false;
        for account in accounts.iter_mut().filter(|a| a.host == host) {
            if account.is_default && !seen_default {
                seen_default = true;
            } else {
                account.is_default = false;
            }
        }
        if !seen_default {
            if let Some(first) = accounts.iter_mut().find(|a| a.host == host) {
                first.is_default = true;
            }
        }
    }
}

fn upsert(accounts: &mut Vec<AccountInfo>, mut account: AccountInfo) {
    let existing = accounts
        .iter()
        .position(|a| a.host == account.host && a.username == account.username);
    let had_default = existing
        .map(|i| accounts[i].is_default)
        .unwrap_or_else(|| !accounts.iter().any(|a| a.host == account.host));
    account.is_default = had_default;
    if let Some(index) = existing {
        accounts.remove(index);
    }
    accounts.push(account);
    accounts.sort_by(|a, b| (&a.host, &a.username).cmp(&(&b.host, &b.username)));
    ensure_defaults(accounts);
}

fn ordered_for_host<'a>(
    accounts: &'a [AccountInfo],
    host: &str,
    preferred: Option<&str>,
) -> Vec<&'a AccountInfo> {
    let mut matching: Vec<&AccountInfo> = accounts
        .iter()
        .filter(|a| hosts_match(&a.host, host))
        .collect();
    matching.sort_by_key(|a| {
        let is_preferred = preferred == Some(a.username.as_str());
        (!is_preferred, !a.is_default)
    });
    matching
}

pub fn list() -> Vec<AccountInfo> {
    let Some(path) = meta_path() else {
        return Vec::new();
    };
    let mut accounts: Vec<AccountInfo> = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    ensure_defaults(&mut accounts);
    accounts
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

pub fn find(host: &str, username: &str) -> Option<AccountInfo> {
    let host = normalize_host(host);
    list()
        .into_iter()
        .find(|a| a.host == host && a.username == username)
}

pub fn token_of(host: &str, username: &str) -> Option<String> {
    let host = normalize_host(host);
    let name = entry_name(&host, username);
    if let Ok(mut cache) = token_cache().lock() {
        if let Some(hit) = cache.get(&name) {
            return hit.clone();
        }
        let result = read_or_migrate_token(&host, username, &name);
        cache.insert(name, result.clone());
        return result;
    }
    read_or_migrate_token(&host, username, &name)
}

fn read_or_migrate_token(host: &str, username: &str, name: &str) -> Option<String> {
    if let Some(token) = keyring::Entry::new(KEYRING_SERVICE, name)
        .ok()
        .and_then(|entry| entry.get_password().ok())
    {
        return Some(token);
    }
    let legacy = keyring::Entry::new(KEYRING_SERVICE, host).ok()?;
    let token = legacy.get_password().ok()?;
    let owner_matches = list()
        .iter()
        .filter(|a| a.host == host)
        .all(|a| a.username == username);
    if !owner_matches {
        return None;
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, name) {
        if entry.set_password(&token).is_ok() {
            let _ = legacy.delete_credential();
        }
    }
    Some(token)
}

pub fn add(
    host: &str,
    username: &str,
    provider: &str,
    token: &str,
    verified: bool,
    email: Option<&str>,
) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    if host.is_empty() || username.trim().is_empty() || token.trim().is_empty() {
        return Err(AppError::other("host, username and token are all required"));
    }
    let username = username.trim().to_string();

    let name = entry_name(&host, &username);
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name)
        .map_err(|e| AppError::other(format!("keychain unavailable: {e}")))?;
    entry
        .set_password(token.trim())
        .map_err(|e| AppError::other(format!("could not store token in keychain: {e}")))?;
    if let Ok(mut cache) = token_cache().lock() {
        cache.insert(name, Some(token.trim().to_string()));
    }

    let mut accounts = list();
    let previous = accounts
        .iter()
        .find(|a| a.host == host && a.username == username)
        .cloned();
    upsert(
        &mut accounts,
        AccountInfo {
            host,
            username,
            provider: provider.to_string(),
            verified,
            email: email
                .map(|e| e.trim().to_string())
                .filter(|e| !e.is_empty())
                .or_else(|| previous.as_ref().and_then(|p| p.email.clone())),
            verified_at: verified.then(now_epoch),
            expires_at: None,
            is_default: false,
        },
    );
    save_list(&accounts)?;
    Ok(accounts)
}

pub fn remove(host: &str, username: &str) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    let name = entry_name(&host, username);
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &name) {
        let _ = entry.delete_credential();
    }
    if let Ok(mut cache) = token_cache().lock() {
        cache.remove(&name);
    }
    let mut accounts = list();
    accounts.retain(|a| !(a.host == host && a.username == username));
    if !accounts.iter().any(|a| a.host == host) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &host) {
            let _ = entry.delete_credential();
        }
    }
    ensure_defaults(&mut accounts);
    save_list(&accounts)?;
    Ok(accounts)
}

pub fn set_default(host: &str, username: &str) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    let mut accounts = list();
    for account in accounts.iter_mut() {
        if account.host == host {
            account.is_default = account.username == username;
        }
    }
    ensure_defaults(&mut accounts);
    save_list(&accounts)?;
    Ok(accounts)
}

pub fn account_with_token(host: &str, preferred: Option<&str>) -> Option<(AccountInfo, String)> {
    let host = normalize_host(host);
    let accounts = list();
    ordered_for_host(&accounts, &host, preferred)
        .into_iter()
        .find_map(|account| {
            token_of(&account.host, &account.username).map(|token| (account.clone(), token))
        })
}

pub fn candidates(host: &str, preferred: Option<&str>) -> Vec<(String, String)> {
    let host = normalize_host(host);
    let accounts = list();
    ordered_for_host(&accounts, &host, preferred)
        .into_iter()
        .filter_map(|account| {
            token_of(&account.host, &account.username)
                .map(|token| (account.username.clone(), token))
        })
        .collect()
}

pub fn mark_unverified(host: &str, username: &str) -> AppResult<()> {
    let host = normalize_host(host);
    let mut accounts = list();
    let mut changed = false;
    for account in accounts.iter_mut() {
        if hosts_match(&account.host, &host) && account.username == username && account.verified {
            account.verified = false;
            account.verified_at = Some(now_epoch());
            changed = true;
        }
    }
    if changed {
        save_list(&accounts)?;
    }
    Ok(())
}

pub fn update_check(
    host: &str,
    username: &str,
    ok: bool,
    expires_at: Option<String>,
) -> AppResult<Vec<AccountInfo>> {
    let host = normalize_host(host);
    let mut accounts = list();
    for account in accounts.iter_mut() {
        if account.host == host && account.username == username {
            account.verified = ok;
            account.verified_at = Some(now_epoch());
            if ok {
                account.expires_at = expires_at.clone();
            }
        }
    }
    save_list(&accounts)?;
    Ok(accounts)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn account(host: &str, username: &str, is_default: bool) -> AccountInfo {
        AccountInfo {
            host: host.to_string(),
            username: username.to_string(),
            provider: "github".to_string(),
            verified: true,
            email: None,
            verified_at: None,
            expires_at: None,
            is_default,
        }
    }

    #[test]
    fn upsert_keeps_both_accounts_on_the_same_host() {
        let mut accounts = vec![account("github.com", "work", true)];
        upsert(&mut accounts, account("github.com", "personal", false));
        assert_eq!(accounts.len(), 2);
        let default: Vec<&str> = accounts
            .iter()
            .filter(|a| a.is_default)
            .map(|a| a.username.as_str())
            .collect();
        assert_eq!(default, vec!["work"]);
    }

    #[test]
    fn upsert_replaces_the_same_account_and_keeps_its_default_flag() {
        let mut accounts = vec![
            account("github.com", "work", true),
            account("github.com", "personal", false),
        ];
        let mut refreshed = account("github.com", "work", false);
        refreshed.verified = false;
        upsert(&mut accounts, refreshed);
        assert_eq!(accounts.len(), 2);
        let work = accounts.iter().find(|a| a.username == "work").unwrap();
        assert!(work.is_default);
        assert!(!work.verified);
    }

    #[test]
    fn first_account_for_a_host_becomes_default() {
        let mut accounts = vec![account("gitlab.com", "solo", true)];
        upsert(&mut accounts, account("github.com", "first", false));
        let first = accounts.iter().find(|a| a.username == "first").unwrap();
        assert!(first.is_default);
    }

    #[test]
    fn ensure_defaults_promotes_exactly_one_per_host() {
        let mut accounts = vec![
            account("github.com", "a", false),
            account("github.com", "b", false),
            account("gitlab.com", "c", true),
        ];
        ensure_defaults(&mut accounts);
        assert_eq!(accounts.iter().filter(|a| a.is_default).count(), 2);
        assert!(accounts[0].is_default);
    }

    #[test]
    fn ordered_for_host_puts_preferred_before_default() {
        let accounts = vec![
            account("github.com", "work", true),
            account("github.com", "personal", false),
        ];
        let ordered: Vec<&str> = ordered_for_host(&accounts, "github.com", Some("personal"))
            .iter()
            .map(|a| a.username.as_str())
            .collect();
        assert_eq!(ordered, vec!["personal", "work"]);
        let fallback: Vec<&str> = ordered_for_host(&accounts, "github.com", None)
            .iter()
            .map(|a| a.username.as_str())
            .collect();
        assert_eq!(fallback, vec!["work", "personal"]);
    }

    #[test]
    fn ordered_for_host_matches_hosts_with_ports() {
        let accounts = vec![account("gitlab.example.com", "dara", true)];
        assert_eq!(
            ordered_for_host(&accounts, "gitlab.example.com:8443", None).len(),
            1
        );
    }

    #[test]
    fn host_of_url_ignores_ssh_remotes() {
        assert_eq!(
            host_of_url("https://github.com/a/b.git"),
            Some("github.com".to_string())
        );
        assert_eq!(host_of_url("git@github.com:a/b.git"), None);
    }
}
