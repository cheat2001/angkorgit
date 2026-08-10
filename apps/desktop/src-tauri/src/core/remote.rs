use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{OnceLock, RwLock};

use git2::{
    build::CheckoutBuilder, AutotagOption, Cred, CredentialType, FetchOptions, PushOptions,
    RemoteCallbacks, Repository,
};

use crate::error::{AppError, AppResult};

use super::types::{GeneratedKey, OpOutcome, RemoteInfo};

static CREDENTIAL_PREFS: OnceLock<RwLock<CredentialPrefs>> = OnceLock::new();

const DEFAULT_SSH_KEYS: [&str; 2] = ["id_ed25519", "id_rsa"];

#[derive(Clone)]
pub struct CredentialPrefs {
    pub ssh_key_path: Option<String>,
    pub use_agent: bool,
    pub use_credential_helper: bool,
}

impl Default for CredentialPrefs {
    fn default() -> Self {
        Self {
            ssh_key_path: None,
            use_agent: true,
            use_credential_helper: true,
        }
    }
}

fn credential_prefs() -> &'static RwLock<CredentialPrefs> {
    CREDENTIAL_PREFS.get_or_init(|| RwLock::new(CredentialPrefs::default()))
}

pub fn set_credential_prefs(
    ssh_key_path: Option<String>,
    use_agent: bool,
    use_credential_helper: bool,
) {
    let cleaned = ssh_key_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Ok(mut slot) = credential_prefs().write() {
        *slot = CredentialPrefs {
            ssh_key_path: cleaned,
            use_agent,
            use_credential_helper,
        };
    }
}

fn prefs_snapshot() -> CredentialPrefs {
    credential_prefs()
        .read()
        .map(|prefs| prefs.clone())
        .unwrap_or_default()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub(crate) fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

const MAX_SSH_KEYS: usize = 5;

pub(crate) fn ssh_key_candidates(
    configured: Option<&str>,
    home: Option<&Path>,
    discovered: &[PathBuf],
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let push = |path: PathBuf, candidates: &mut Vec<PathBuf>| {
        if !candidates.contains(&path) && candidates.len() < MAX_SSH_KEYS {
            candidates.push(path);
        }
    };
    if let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        push(expand_home(configured, home), &mut candidates);
    }
    if let Some(home) = home {
        for name in DEFAULT_SSH_KEYS {
            push(home.join(".ssh").join(name), &mut candidates);
        }
    }
    for path in discovered {
        push(path.clone(), &mut candidates);
    }
    candidates
}

fn discover_ssh_keys(home: Option<&Path>) -> Vec<PathBuf> {
    let Some(dir) = home.map(|home| home.join(".ssh")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "pub"))
        .map(|path| PathBuf::from(path.display().to_string().trim_end_matches(".pub")))
        .filter(|path| path.is_file())
        .collect();
    found.sort();
    found
}

fn resolved_key_path(path: &str) -> AppResult<PathBuf> {
    let resolved = expand_home(path, home_dir().as_deref());
    if resolved.as_os_str().is_empty() {
        return Err(AppError::other("choose a path for the key"));
    }
    Ok(resolved)
}

pub fn ssh_public_key(path: &str) -> AppResult<String> {
    let private = resolved_key_path(path)?;
    let public = PathBuf::from(format!("{}.pub", private.display()));
    if !public.exists() {
        return Err(AppError::other(format!(
            "no public key next to {} — expected {}",
            private.display(),
            public.display()
        )));
    }
    Ok(std::fs::read_to_string(public)?.trim().to_string())
}

pub(crate) fn free_key_path(base: &Path, taken: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let candidate = base.to_path_buf();
    if !taken(&candidate) {
        return Some(candidate);
    }
    (2..100).find_map(|suffix| {
        let candidate = PathBuf::from(format!("{}_{suffix}", base.display()));
        (!taken(&candidate)).then_some(candidate)
    })
}

fn path_in_use(path: &Path) -> bool {
    path.exists() || PathBuf::from(format!("{}.pub", path.display())).exists()
}

pub fn ssh_key_generate(base: &str, comment: &str) -> AppResult<GeneratedKey> {
    let requested = resolved_key_path(base)?;
    let private = free_key_path(&requested, path_in_use).ok_or_else(|| {
        AppError::other(format!(
            "could not find a free name next to {} — remove some old keys first",
            requested.display()
        ))
    })?;
    if let Some(parent) = private.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let output = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C", comment, "-f"])
        .arg(&private)
        .output()
        .map_err(|e| AppError::other(format!("could not run ssh-keygen: {e}")))?;
    if !output.status.success() {
        return Err(AppError::other(format!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let path = private.to_string_lossy().to_string();
    Ok(GeneratedKey {
        public_key: ssh_public_key(&path)?,
        path,
    })
}

pub fn credential_approve(host: &str, username: &str, password: &str) -> AppResult<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut child = Command::new("git")
        .args(["credential", "approve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let input =
        format!("protocol=https\nhost={host}\nusername={username}\npassword={password}\n\n");
    child
        .stdin
        .as_mut()
        .ok_or_else(|| AppError::other("could not write to git credential"))?
        .write_all(input.as_bytes())?;
    let status = child.wait()?;
    if !status.success() {
        return Err(AppError::other(
            "git credential approve failed — is a credential helper configured?",
        ));
    }
    Ok(())
}

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

pub(crate) fn make_callbacks<'a>() -> RemoteCallbacks<'a> {
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
        let prefs = prefs_snapshot();
        if allowed.contains(CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if attempt == 0 && prefs.use_agent {
                if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
            let home = home_dir();
            let discovered = discover_ssh_keys(home.as_deref());
            let usable: Vec<PathBuf> =
                ssh_key_candidates(prefs.ssh_key_path.as_deref(), home.as_deref(), &discovered)
                    .into_iter()
                    .filter(|path| path.exists())
                    .collect();
            let index = if prefs.use_agent {
                attempt.saturating_sub(1)
            } else {
                attempt
            };
            if let Some(private) = usable.get(index) {
                let pubkey = PathBuf::from(format!("{}.pub", private.display()));
                let pubkey = if pubkey.exists() { Some(pubkey) } else { None };
                if let Ok(cred) = Cred::ssh_key(user, pubkey.as_deref(), private, None) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if attempt == 0 {
                if let Some(host) = super::accounts::host_of_url(url) {
                    if let Some((user, token)) = super::accounts::lookup(&host) {
                        if let Ok(cred) = Cred::userpass_plaintext(&user, &token) {
                            return Ok(cred);
                        }
                    }
                }
            }
            if prefs.use_credential_helper {
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

pub fn edit(path: &str, name: &str, new_name: &str, url: &str) -> AppResult<()> {
    let new_name = new_name.trim();
    let url = url.trim();
    if new_name.is_empty() || url.is_empty() {
        return Err(crate::error::AppError::other(
            "remote name and URL are both required",
        ));
    }
    let repo = super::repo::open(path)?;
    let mut current = name.to_string();
    if new_name != name {
        let _ = repo.remote_rename(name, new_name)?;
        current = new_name.to_string();
    }
    repo.remote_set_url(&current, url)?;
    Ok(())
}

pub fn remove(path: &str, name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    repo.remote_delete(name)?;
    Ok(())
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
    branch: Option<&str>,
    force: bool,
    with_tags: bool,
    set_upstream: bool,
) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let branch_name = match branch {
        Some(name) => name.to_string(),
        None => repo
            .head()?
            .shorthand()
            .ok_or_else(|| AppError::other("HEAD is detached; cannot push"))?
            .to_string(),
    };

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

pub fn pull_branch(path: &str, branch_name: &str) -> AppResult<OpOutcome> {
    let (upstream_name, remote_name) = {
        let repo = super::repo::open(path)?;
        let branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
        let upstream = branch.upstream().map_err(|_| {
            AppError::other(format!("branch {branch_name} has no upstream to pull from"))
        })?;
        let upstream_name = upstream
            .name()?
            .ok_or_else(|| AppError::other("invalid upstream name"))?
            .to_string();
        let remote_name = upstream_name
            .split('/')
            .next()
            .unwrap_or("origin")
            .to_string();
        (upstream_name, remote_name)
    };

    fetch(path, &remote_name, false, false)?;

    let repo = super::repo::open(path)?;
    let is_head = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .as_deref()
        == Some(branch_name);
    if is_head {
        return super::branch::merge(path, &upstream_name);
    }

    let branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
    let upstream = branch.upstream()?;
    let local_oid = branch
        .get()
        .target()
        .ok_or_else(|| AppError::other("branch has no target"))?;
    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| AppError::other("upstream has no target"))?;

    if local_oid == upstream_oid {
        return Ok(OpOutcome {
            status: "up_to_date".into(),
            message: format!("{branch_name} is already up to date"),
        });
    }
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    if behind == 0 {
        return Ok(OpOutcome {
            status: "up_to_date".into(),
            message: format!("{branch_name} is ahead of {upstream_name} — nothing to pull"),
        });
    }
    if ahead > 0 {
        return Err(AppError::other(format!(
            "{branch_name} has diverged from {upstream_name} — check it out to merge"
        )));
    }
    let mut reference = repo.find_reference(&format!("refs/heads/{branch_name}"))?;
    reference.set_target(
        upstream_oid,
        &format!("pull: fast-forward to {upstream_name}"),
    )?;
    Ok(OpOutcome {
        status: "fast_forward".into(),
        message: format!("Fast-forwarded {branch_name} to {upstream_name}"),
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

#[allow(dead_code)]
pub fn checkout_head_force(repo: &Repository) -> AppResult<()> {
    let mut builder = CheckoutBuilder::new();
    builder.force();
    repo.checkout_head(Some(&mut builder))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/Users/tester")
    }

    #[test]
    fn generation_uses_the_base_name_when_it_is_free() {
        let base = PathBuf::from("/Users/tester/.ssh/angkorgit_rsa");
        assert_eq!(free_key_path(&base, |_| false), Some(base.clone()));
    }

    #[test]
    fn generation_never_targets_an_existing_key() {
        let base = PathBuf::from("/Users/tester/.ssh/angkorgit_rsa");
        let taken = |p: &Path| p == base || p.ends_with("angkorgit_rsa_2");
        assert_eq!(
            free_key_path(&base, taken),
            Some(PathBuf::from("/Users/tester/.ssh/angkorgit_rsa_3"))
        );
    }

    #[test]
    fn expands_a_leading_tilde() {
        assert_eq!(
            expand_home("~/.ssh/work_key", Some(&home())),
            PathBuf::from("/Users/tester/.ssh/work_key")
        );
    }

    #[test]
    fn leaves_absolute_paths_alone() {
        assert_eq!(
            expand_home("/etc/keys/deploy", Some(&home())),
            PathBuf::from("/etc/keys/deploy")
        );
    }

    #[test]
    fn configured_key_is_tried_before_the_defaults() {
        let candidates = ssh_key_candidates(Some("~/.ssh/id_ed25519_work"), Some(&home()), &[]);
        assert_eq!(
            candidates[0],
            PathBuf::from("/Users/tester/.ssh/id_ed25519_work")
        );
        assert_eq!(candidates.len(), 3);
    }

    #[test]
    fn defaults_are_used_when_nothing_is_configured() {
        let candidates = ssh_key_candidates(None, Some(&home()), &[]);
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Users/tester/.ssh/id_ed25519"),
                PathBuf::from("/Users/tester/.ssh/id_rsa"),
            ]
        );
    }

    #[test]
    fn a_configured_default_is_not_offered_twice() {
        let candidates = ssh_key_candidates(Some("~/.ssh/id_rsa"), Some(&home()), &[]);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0], PathBuf::from("/Users/tester/.ssh/id_rsa"));
        assert_eq!(
            candidates[1],
            PathBuf::from("/Users/tester/.ssh/id_ed25519")
        );
    }

    #[test]
    fn other_keys_in_dot_ssh_are_tried_after_the_defaults() {
        let discovered = vec![
            PathBuf::from("/Users/tester/.ssh/id_ed25519"),
            PathBuf::from("/Users/tester/.ssh/work_gitlab"),
        ];
        let candidates = ssh_key_candidates(None, Some(&home()), &discovered);
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Users/tester/.ssh/id_ed25519"),
                PathBuf::from("/Users/tester/.ssh/id_rsa"),
                PathBuf::from("/Users/tester/.ssh/work_gitlab"),
            ]
        );
    }

    #[test]
    fn the_candidate_list_is_capped() {
        let discovered: Vec<PathBuf> = (0..10)
            .map(|n| PathBuf::from(format!("/Users/tester/.ssh/key_{n}")))
            .collect();
        assert_eq!(
            ssh_key_candidates(Some("~/.ssh/chosen"), Some(&home()), &discovered).len(),
            5
        );
    }

    #[test]
    fn blank_configuration_is_ignored() {
        assert_eq!(ssh_key_candidates(Some("   "), Some(&home()), &[]).len(), 2);
    }
}
