use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use git2::Repository;

use crate::ai_cli::{capture, search_path};
use crate::error::{AppError, AppResult};

pub const PRE_COMMIT: &str = "pre-commit";
pub const COMMIT_MSG: &str = "commit-msg";
const COMMIT_HOOKS: &[&str] = &[PRE_COMMIT, COMMIT_MSG];

const MIN_GIT_VERSION: (u32, u32) = (2, 36);
const HOOK_TIMEOUT: Duration = Duration::from_secs(600);
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_CAP: usize = 64 * 1024;

const REPO_ENV: &[&str] = &[
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
];

static HOOK_GIT: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn hooks_dir(repo: &Repository) -> AppResult<PathBuf> {
    let config = repo.config()?.snapshot()?;
    match config.get_path("core.hookspath") {
        Ok(configured) if !configured.as_os_str().is_empty() => {
            if configured.is_absolute() {
                return Ok(configured);
            }
            let base = repo.workdir().unwrap_or_else(|| repo.path());
            Ok(base.join(configured))
        }
        _ => Ok(repo.commondir().join("hooks")),
    }
}

pub fn present(repo: &Repository, name: &str) -> AppResult<bool> {
    let dir = hooks_dir(repo)?;
    if hook_candidates(&dir, name).iter().any(|p| is_executable(p)) {
        return Ok(true);
    }
    configured_for(repo, name)
}

fn hook_candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![dir.join(name), dir.join(format!("{name}.exe"))]
    } else {
        vec![dir.join(name)]
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn configured_for(repo: &Repository, name: &str) -> AppResult<bool> {
    let config = repo.config()?.snapshot()?;
    let mut entries = config.entries(Some(r"^hook\..*\.event$"))?;
    while let Some(entry) = entries.next() {
        if entry?.value() == Some(name) {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn commit_hooks(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    if repo.workdir().is_none() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for name in COMMIT_HOOKS {
        if present(&repo, name)? {
            found.push(name.to_string());
        }
    }
    Ok(found)
}

pub fn runner_available() -> bool {
    hook_git(&std::env::temp_dir()).is_ok()
}

fn hook_git(cwd: &Path) -> Result<PathBuf, String> {
    if let Some(git) = HOOK_GIT.lock().ok().and_then(|cached| cached.clone()) {
        return Ok(git);
    }
    let path_env = search_path(None);
    let Ok(git) = which::which_in("git", Some(&path_env), cwd) else {
        return Err(
            "Git hooks did not run because the git command line tool was not found. Install \
             Git 2.36 or newer to run them."
                .to_string(),
        );
    };
    match git_version(&git) {
        Some(version) if version >= MIN_GIT_VERSION => {
            if let Ok(mut cached) = HOOK_GIT.lock() {
                *cached = Some(git.clone());
            }
            Ok(git)
        }
        Some((major, minor)) => Err(format!(
            "Git hooks did not run because git {major}.{minor} is too old. Git 2.36 or newer is \
             needed to run them."
        )),
        None => Err(format!(
            "Git hooks did not run because {} did not report a version. Git 2.36 or newer is \
             needed to run them.",
            git.display()
        )),
    }
}

fn git_version(git: &Path) -> Option<(u32, u32)> {
    let mut command = crate::proc::hidden(git);
    command.arg("--version").env("PATH", search_path(None));
    let captured = capture(command, "", VERSION_TIMEOUT).ok()?;
    if captured.status != 0 {
        return None;
    }
    parse_git_version(&captured.stdout)
}

pub(crate) fn parse_git_version(text: &str) -> Option<(u32, u32)> {
    let version = text.trim().strip_prefix("git version ")?;
    let mut parts = version
        .split_whitespace()
        .next()?
        .split('.')
        .map(|part| part.parse::<u32>().ok());
    Some((parts.next()??, parts.next()??))
}

pub(crate) fn run(
    repo: &Repository,
    git: &Path,
    name: &str,
    args: &[&OsStr],
    env: &[(&str, &OsStr)],
) -> AppResult<()> {
    let cwd = repo.workdir().unwrap_or_else(|| repo.path());
    let mut command = crate::proc::hidden(git);
    command.args(["hook", "run", "--ignore-missing", name]);
    if !args.is_empty() {
        command.arg("--").args(args);
    }
    command.current_dir(cwd).env("PATH", search_path(None));
    for var in REPO_ENV {
        command.env_remove(var);
    }
    for (key, value) in env {
        command.env(key, value);
    }
    let captured = capture(command, "", HOOK_TIMEOUT)
        .map_err(|e| AppError::other(format!("The {name} hook could not run: {e}")))?;
    if captured.status == 0 {
        return Ok(());
    }
    let output = [captured.stdout.trim_end(), captured.stderr.trim_end()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Err(AppError::Hook {
        hook: name.to_string(),
        status: captured.status,
        output: output_tail(&output, OUTPUT_CAP),
    })
}

fn output_tail(output: &str, cap: usize) -> String {
    if output.len() <= cap {
        return output.to_string();
    }
    let mut start = output.len() - cap;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    format!("…\n{}", &output[start..])
}

pub(crate) struct CommitHooks {
    git: Option<PathBuf>,
    pre_commit: bool,
    commit_msg: bool,
    env: Vec<(&'static str, OsString)>,
    pub(crate) warning: Option<String>,
}

impl CommitHooks {
    pub(crate) fn prepare(
        repo: &Repository,
        author: &git2::Signature<'_>,
        no_verify: bool,
    ) -> AppResult<Self> {
        let mut hooks = CommitHooks {
            git: None,
            pre_commit: false,
            commit_msg: false,
            env: commit_env(repo, author),
            warning: None,
        };
        let Some(workdir) = repo.workdir() else {
            return Ok(hooks);
        };
        if no_verify {
            return Ok(hooks);
        }
        hooks.pre_commit = present(repo, PRE_COMMIT)?;
        hooks.commit_msg = present(repo, COMMIT_MSG)?;
        if hooks.pre_commit || hooks.commit_msg {
            match hook_git(workdir) {
                Ok(git) => hooks.git = Some(git),
                Err(warning) => hooks.warning = Some(warning),
            }
        }
        Ok(hooks)
    }

    fn env(&self) -> Vec<(&str, &OsStr)> {
        self.env
            .iter()
            .map(|(key, value)| (*key, value.as_os_str()))
            .collect()
    }

    pub(crate) fn pre_commit(&self, repo: &Repository) -> AppResult<bool> {
        let Some(git) = self.git.as_deref().filter(|_| self.pre_commit) else {
            return Ok(false);
        };
        run(repo, git, PRE_COMMIT, &[], &self.env())?;
        Ok(true)
    }

    pub(crate) fn commit_msg(&self, repo: &Repository, message: &str) -> AppResult<String> {
        let Some(git) = self.git.as_deref().filter(|_| self.commit_msg) else {
            return Ok(message.to_string());
        };
        let file = repo.path().join("COMMIT_EDITMSG");
        let written = if message.ends_with('\n') {
            message.to_string()
        } else {
            format!("{message}\n")
        };
        std::fs::write(&file, &written)?;
        run(repo, git, COMMIT_MSG, &[file.as_os_str()], &self.env())?;
        let edited = std::fs::read_to_string(&file)?;
        if edited == written {
            return Ok(message.to_string());
        }
        let cleaned = cleanup_message(&edited);
        if cleaned.is_empty() {
            return Err(AppError::other(
                "The commit-msg hook left an empty commit message.",
            ));
        }
        Ok(cleaned)
    }
}

fn commit_env(repo: &Repository, author: &git2::Signature<'_>) -> Vec<(&'static str, OsString)> {
    vec![
        ("GIT_INDEX_FILE", repo.path().join("index").into_os_string()),
        ("GIT_EDITOR", OsString::from(":")),
        (
            "GIT_AUTHOR_NAME",
            OsString::from(String::from_utf8_lossy(author.name_bytes()).into_owned()),
        ),
        (
            "GIT_AUTHOR_EMAIL",
            OsString::from(String::from_utf8_lossy(author.email_bytes()).into_owned()),
        ),
        ("GIT_AUTHOR_DATE", OsString::from(git_date(author.when()))),
    ]
}

pub(crate) fn git_date(time: git2::Time) -> String {
    let offset = time.offset_minutes().abs();
    format!(
        "@{} {}{:02}{:02}",
        time.seconds(),
        time.sign(),
        offset / 60,
        offset % 60
    )
}

fn cleanup_message(text: &str) -> String {
    text.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_git_versions_from_every_platform() {
        assert_eq!(parse_git_version("git version 2.56.0\n"), Some((2, 56)));
        assert_eq!(
            parse_git_version("git version 2.54.0 (Apple Git-157)"),
            Some((2, 54))
        );
        assert_eq!(
            parse_git_version("git version 2.45.1.windows.1"),
            Some((2, 45))
        );
        assert_eq!(parse_git_version("git version 2.36.0.rc2"), Some((2, 36)));
        assert_eq!(parse_git_version("hub version 2.14.2"), None);
        assert_eq!(parse_git_version(""), None);
    }

    #[test]
    fn author_dates_use_the_raw_format_git_exports_to_hooks() {
        assert_eq!(
            git_date(git2::Time::new(1_730_103_456, 60)),
            "@1730103456 +0100"
        );
        assert_eq!(
            git_date(git2::Time::new(1_730_103_456, -330)),
            "@1730103456 -0530"
        );
        assert_eq!(git_date(git2::Time::new(0, 0)), "@0 +0000");
    }

    #[test]
    fn edited_messages_get_git_whitespace_cleanup() {
        assert_eq!(
            cleanup_message("\nfix: thing  \r\n\r\nTicket: A-1\n\n"),
            "fix: thing\n\nTicket: A-1"
        );
        assert_eq!(cleanup_message("\n \n"), "");
    }

    #[test]
    fn long_output_keeps_its_tail_on_a_char_boundary() {
        assert_eq!(output_tail("short", 10), "short");
        let tail = output_tail("ääääää", 5);
        assert!(tail.starts_with("…\n"));
        assert!(tail.ends_with("ää"));
        assert!(tail.len() <= 5 + "…\n".len());
    }
}
