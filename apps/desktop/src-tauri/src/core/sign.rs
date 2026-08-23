use std::path::PathBuf;
use std::time::Duration;

use git2::Repository;

use crate::ai_cli::{capture, search_path};
use crate::error::{AppError, AppResult};

const SIGN_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub(crate) enum SigningFormat {
    OpenPgp,
    Ssh,
}

#[derive(Debug)]
pub(crate) struct SigningConfig {
    pub(crate) format: SigningFormat,
    pub(crate) key: String,
    pub(crate) program: String,
}

pub(crate) fn signing_config(repo: &Repository) -> AppResult<Option<SigningConfig>> {
    let config = repo.config()?.snapshot()?;
    if !config.get_bool("commit.gpgsign").unwrap_or(false) {
        return Ok(None);
    }
    let format = match config
        .get_string("gpg.format")
        .ok()
        .filter(|f| !f.trim().is_empty())
        .as_deref()
    {
        None | Some("openpgp") => SigningFormat::OpenPgp,
        Some("ssh") => SigningFormat::Ssh,
        Some(other) => {
            return Err(AppError::other(format!(
                "commit signing with gpg.format={other} is not supported — use ssh or openpgp"
            )))
        }
    };
    let key = config.get_string("user.signingkey").unwrap_or_default();
    let (key, program) = match format {
        SigningFormat::Ssh => {
            if key.trim().is_empty() {
                return Err(AppError::other(
                    "commit.gpgSign is on with gpg.format=ssh, but user.signingKey is not set. \
                     Point it at your SSH key (for example ~/.ssh/id_ed25519.pub).",
                ));
            }
            let program = program_from(&config, "gpg.ssh.program", "ssh-keygen");
            (key, program)
        }
        SigningFormat::OpenPgp => {
            let key = if key.trim().is_empty() {
                let sig = repo.signature().map_err(|_| {
                    AppError::other(
                        "commit signing needs user.signingKey or a configured git identity",
                    )
                })?;
                format!(
                    "{} <{}>",
                    sig.name().unwrap_or(""),
                    sig.email().unwrap_or("")
                )
            } else {
                key
            };
            let program = program_from(&config, "gpg.program", "gpg");
            (key, program)
        }
    };
    Ok(Some(SigningConfig {
        format,
        key,
        program,
    }))
}

fn program_from(config: &git2::Config, name: &str, default: &str) -> String {
    config
        .get_string(name)
        .ok()
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

pub(crate) fn create_commit(
    repo: &Repository,
    update_ref: Option<&str>,
    author: &git2::Signature<'_>,
    committer: &git2::Signature<'_>,
    message: &str,
    tree: &git2::Tree<'_>,
    parents: &[&git2::Commit<'_>],
) -> AppResult<git2::Oid> {
    let Some(config) = signing_config(repo)? else {
        return Ok(repo.commit(update_ref, author, committer, message, tree, parents)?);
    };
    let buffer = repo.commit_create_buffer(author, committer, message, tree, parents)?;
    let content = buffer
        .as_str()
        .ok_or_else(|| AppError::other("commit content is not valid UTF-8"))?
        .to_string();
    let signature = sign_buffer(&config, &content)?;
    let oid = repo.commit_signed(&content, signature.trim_end(), None)?;
    if let Some(refname) = update_ref {
        update_reference(repo, refname, oid, message)?;
    }
    Ok(oid)
}

fn update_reference(
    repo: &Repository,
    refname: &str,
    oid: git2::Oid,
    message: &str,
) -> AppResult<()> {
    let log = format!("commit: {}", message.lines().next().unwrap_or(""));
    if refname == "HEAD" {
        let head = repo.find_reference("HEAD")?;
        match head.symbolic_target().map(str::to_string) {
            Some(branch) => {
                repo.reference(&branch, oid, true, &log)?;
            }
            None => repo.set_head_detached(oid)?,
        }
    } else {
        repo.reference(refname, oid, true, &log)?;
    }
    Ok(())
}

pub(crate) fn sign_buffer(config: &SigningConfig, content: &str) -> AppResult<String> {
    match config.format {
        SigningFormat::Ssh => sign_with_ssh(config, content),
        SigningFormat::OpenPgp => sign_with_gpg(config, content),
    }
}

struct TempFiles(Vec<PathBuf>);

impl Drop for TempFiles {
    fn drop(&mut self) {
        for file in &self.0 {
            let _ = std::fs::remove_file(file);
        }
    }
}

fn temp_file(suffix: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!(
        "angkorgit-sign-{}-{nanos}{suffix}",
        std::process::id()
    ))
}

fn is_literal_ssh_key(key: &str) -> bool {
    key.starts_with("key::")
        || key.starts_with("ssh-")
        || key.starts_with("ecdsa-")
        || key.starts_with("sk-")
}

fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => crate::ai_cli::home_dir()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| PathBuf::from(path)),
        None => PathBuf::from(path),
    }
}

const SSH_AGENT_HINT: &str =
    "If the key has a passphrase, load it into ssh-agent (ssh-add) first — the app cannot prompt for it.";

fn sign_with_ssh(config: &SigningConfig, content: &str) -> AppResult<String> {
    let mut cleanup = TempFiles(Vec::new());
    let key_file = if is_literal_ssh_key(&config.key) {
        let file = temp_file(".pub");
        let literal = config.key.strip_prefix("key::").unwrap_or(&config.key);
        std::fs::write(&file, format!("{literal}\n"))?;
        cleanup.0.push(file.clone());
        file
    } else {
        let file = expand_home(&config.key);
        if !file.exists() {
            return Err(AppError::other(format!(
                "the signing key {} does not exist — check user.signingKey",
                file.display()
            )));
        }
        file
    };

    let buffer_file = temp_file(".buf");
    std::fs::write(&buffer_file, content)?;
    let mut sig_name = buffer_file.clone().into_os_string();
    sig_name.push(".sig");
    let sig_file = PathBuf::from(sig_name);
    cleanup.0.push(buffer_file.clone());
    cleanup.0.push(sig_file.clone());

    let mut command = crate::proc::hidden(&config.program);
    command
        .args(["-Y", "sign", "-n", "git", "-f"])
        .arg(&key_file)
        .arg(&buffer_file)
        .current_dir(std::env::temp_dir())
        .env("PATH", search_path(None));
    let captured = capture(command, "", SIGN_TIMEOUT).map_err(|e| {
        AppError::other(format!(
            "{} could not sign the commit ({e}). {SSH_AGENT_HINT}",
            config.program
        ))
    })?;
    if captured.status != 0 {
        return Err(AppError::other(format!(
            "{} refused to sign the commit: {}. {SSH_AGENT_HINT}",
            config.program,
            captured.stderr.trim()
        )));
    }
    std::fs::read_to_string(&sig_file)
        .map_err(|_| AppError::other("ssh-keygen produced no signature"))
}

fn sign_with_gpg(config: &SigningConfig, content: &str) -> AppResult<String> {
    let mut command = crate::proc::hidden(&config.program);
    command
        .args([
            "--status-fd=2",
            "--detach-sign",
            "--armor",
            "--local-user",
            &config.key,
        ])
        .current_dir(std::env::temp_dir())
        .env("PATH", search_path(None));
    let captured = capture(command, content, SIGN_TIMEOUT).map_err(|e| {
        AppError::other(format!(
            "{} could not sign the commit ({e}). If the key has a passphrase, gpg needs a \
             graphical pinentry (for example pinentry-mac) — the app has no terminal to ask on.",
            config.program
        ))
    })?;
    if captured.status != 0 || !captured.stderr.contains("[GNUPG:] SIG_CREATED") {
        let detail = captured
            .stderr
            .lines()
            .filter(|line| !line.starts_with("[GNUPG:]"))
            .collect::<Vec<_>>()
            .join(" ");
        return Err(AppError::other(format!(
            "{} refused to sign the commit: {}. Check user.signingKey and that a graphical \
             pinentry is configured.",
            config.program,
            detail.trim()
        )));
    }
    Ok(captured.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo() -> (PathBuf, Repository) {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-sign-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        (dir, repo)
    }

    fn set(repo: &Repository, name: &str, value: &str) {
        repo.config().unwrap().set_str(name, value).unwrap();
    }

    #[test]
    fn signing_is_off_unless_config_enables_it() {
        let (dir, repo) = temp_repo();
        assert!(signing_config(&repo).unwrap().is_none());
        set(&repo, "commit.gpgsign", "false");
        assert!(signing_config(&repo).unwrap().is_none());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reads_ssh_signing_setup_from_git_config() {
        let (dir, repo) = temp_repo();
        set(&repo, "commit.gpgsign", "true");
        set(&repo, "gpg.format", "ssh");
        set(&repo, "user.signingkey", "~/.ssh/id_ed25519.pub");
        let config = signing_config(&repo).unwrap().unwrap();
        assert!(matches!(config.format, SigningFormat::Ssh));
        assert_eq!(config.key, "~/.ssh/id_ed25519.pub");
        assert_eq!(config.program, "ssh-keygen");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ssh_format_without_a_key_is_a_clear_error() {
        let (dir, repo) = temp_repo();
        set(&repo, "commit.gpgsign", "true");
        set(&repo, "gpg.format", "ssh");
        let err = signing_config(&repo).unwrap_err();
        assert!(err.to_string().contains("user.signingKey"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn openpgp_falls_back_to_the_committer_identity() {
        let (dir, repo) = temp_repo();
        set(&repo, "user.name", "Test User");
        set(&repo, "user.email", "test@angkorgit.dev");
        set(&repo, "commit.gpgsign", "true");
        let config = signing_config(&repo).unwrap().unwrap();
        assert!(matches!(config.format, SigningFormat::OpenPgp));
        assert_eq!(config.key, "Test User <test@angkorgit.dev>");
        assert_eq!(config.program, "gpg");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn x509_format_is_rejected() {
        let (dir, repo) = temp_repo();
        set(&repo, "commit.gpgsign", "true");
        set(&repo, "gpg.format", "x509");
        let err = signing_config(&repo).unwrap_err();
        assert!(err.to_string().contains("x509"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn literal_ssh_keys_are_recognized() {
        assert!(is_literal_ssh_key("ssh-ed25519 AAAAC3Nza test"));
        assert!(is_literal_ssh_key("key::ssh-rsa AAAAB3Nza test"));
        assert!(is_literal_ssh_key("ecdsa-sha2-nistp256 AAAA test"));
        assert!(!is_literal_ssh_key("~/.ssh/id_ed25519.pub"));
        assert!(!is_literal_ssh_key("/home/user/.ssh/key"));
    }

    #[test]
    fn tilde_paths_expand_to_the_home_directory() {
        let expanded = expand_home("~/.ssh/id_ed25519.pub");
        assert!(!expanded.to_string_lossy().starts_with('~'));
        assert!(expanded.to_string_lossy().ends_with(".ssh/id_ed25519.pub"));
        assert_eq!(expand_home("/abs/path"), PathBuf::from("/abs/path"));
    }
}
