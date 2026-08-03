use std::sync::atomic::{AtomicUsize, Ordering};

use git2::{
    build::CheckoutBuilder, AutotagOption, Cred, CredentialType, FetchOptions, PushOptions,
    RemoteCallbacks, Repository,
};

use crate::error::{AppError, AppResult};

use super::types::{OpOutcome, RemoteInfo};

/// Ask the real `git credential` stack (osxkeychain, manager, store, …) for
/// credentials, exactly like the git CLI would. This picks up whatever the
/// user's normal `git pull` already uses.
fn credentials_from_git_cli(url: &str, username: Option<&str>) -> Option<(String, String)> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut input = format!("url={url}\n");
    if let Some(user) = username {
        input.push_str(&format!("username={user}\n"));
    }
    input.push('\n');

    let mut child = Command::new("git")
        .args(["credential", "fill"])
        // Never block waiting for an interactive prompt.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.as_mut()?.write_all(input.as_bytes()).ok()?;
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut user = None;
    let mut pass = None;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("username=") {
            user = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("password=") {
            pass = Some(v.to_string());
        }
    }
    Some((user?, pass?))
}

/// Credential negotiation: SSH agent → ~/.ssh keys → `git credential fill`
/// (keychain/manager/store) → libgit2 helper → default. A retry guard
/// prevents libgit2 from looping forever on rejected credentials.
fn make_callbacks<'a>() -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let attempts = AtomicUsize::new(0);
    callbacks.credentials(move |url, username_from_url, allowed| {
        let attempt = attempts.fetch_add(1, Ordering::SeqCst);
        if attempt > 6 {
            return Err(git2::Error::from_str(&format!(
                "authentication rejected for {url} — the server refused the credentials \
                 offered by your SSH agent / git credential helper"
            )));
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
            // Fall back to conventional key files.
            if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
            {
                let home = std::path::PathBuf::from(home);
                for key in ["id_ed25519", "id_rsa"] {
                    let private = home.join(".ssh").join(key);
                    if private.exists() {
                        if let Ok(cred) = Cred::ssh_key(user, None, &private, None) {
                            return Ok(cred);
                        }
                    }
                }
            }
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some((user, pass)) = credentials_from_git_cli(url, username_from_url) {
                if let Ok(cred) = Cred::userpass_plaintext(&user, &pass) {
                    return Ok(cred);
                }
            }
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::DEFAULT) {
            if let Ok(cred) = Cred::default() {
                return Ok(cred);
            }
        }
        Err(git2::Error::from_str(&format!(
            "no usable authentication for {url} — tried SSH agent, ~/.ssh keys and git \
             credential helpers. Check `git credential fill` works for this remote, or add \
             your key to the SSH agent (ssh-add)"
        )))
    });
    callbacks
}

pub fn list(path: &str) -> AppResult<Vec<RemoteInfo>> {
    let repo = super::repo::open(path)?;
    let names = repo.remotes()?;
    let mut result = Vec::new();
    for name in names.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            result.push(RemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(result)
}

pub fn fetch(path: &str, remote_name: &str, tags: bool, prune: bool) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(make_callbacks());
    if tags {
        opts.download_tags(AutotagOption::All);
    }
    if prune {
        opts.prune(git2::FetchPrune::On);
    }
    remote.fetch(&[] as &[&str], Some(&mut opts), None)?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Fetched {remote_name}"),
    })
}

/// Pull = fetch + merge the upstream of the current branch (ff preferred).
pub fn pull(path: &str, remote_name: &str) -> AppResult<OpOutcome> {
    fetch(path, remote_name, false, false)?;

    let repo = super::repo::open(path)?;
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| AppError::other("HEAD is detached; cannot pull"))?
        .to_string();
    let branch = repo.find_branch(&branch_name, git2::BranchType::Local)?;
    let upstream = branch
        .upstream()
        .map_err(|_| AppError::other(format!("branch {branch_name} has no upstream")))?;
    let upstream_name = upstream
        .name()?
        .ok_or_else(|| AppError::other("invalid upstream name"))?
        .to_string();
    drop(upstream);
    drop(branch);
    drop(head);

    super::branch::merge(path, &upstream_name)
}

pub fn push(
    path: &str,
    remote_name: &str,
    force: bool,
    with_tags: bool,
    set_upstream: bool,
) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| AppError::other("HEAD is detached; cannot push"))?
        .to_string();

    let prefix = if force { "+" } else { "" };
    let mut refspecs = vec![format!(
        "{prefix}refs/heads/{branch_name}:refs/heads/{branch_name}"
    )];
    if with_tags {
        refspecs.push(format!("{prefix}refs/tags/*:refs/tags/*"));
    }

    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = PushOptions::new();
    opts.remote_callbacks(make_callbacks());
    let specs: Vec<&str> = refspecs.iter().map(String::as_str).collect();
    remote.push(&specs, Some(&mut opts))?;

    if set_upstream {
        let mut branch = repo.find_branch(&branch_name, git2::BranchType::Local)?;
        branch.set_upstream(Some(&format!("{remote_name}/{branch_name}")))?;
    }

    Ok(OpOutcome {
        status: "ok".into(),
        message: format!(
            "Pushed {branch_name} to {remote_name}{}",
            if force { " (forced)" } else { "" }
        ),
    })
}

pub fn push_tag(path: &str, remote_name: &str, tag: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = PushOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote.push(
        &[&format!("refs/tags/{tag}:refs/tags/{tag}")],
        Some(&mut opts),
    )?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Pushed tag {tag} to {remote_name}"),
    })
}

pub fn clone(url: &str, into: &str, on_progress: impl Fn(u32) + Send) -> AppResult<String> {
    let mut callbacks = make_callbacks();
    callbacks.transfer_progress(move |stats| {
        let total = stats.total_objects().max(1);
        let pct = (stats.received_objects() * 100 / total) as u32;
        on_progress(pct);
        true
    });
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(callbacks);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(opts);

    let repo = builder.clone(url, std::path::Path::new(into))?;
    let root = repo
        .workdir()
        .unwrap_or_else(|| repo.path())
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();
    Ok(root)
}

/// Hard-sync the working tree after history-changing remote ops when needed.
#[allow(dead_code)]
pub fn checkout_head_force(repo: &Repository) -> AppResult<()> {
    let mut builder = CheckoutBuilder::new();
    builder.force();
    repo.checkout_head(Some(&mut builder))?;
    Ok(())
}
