use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use git2::{Oid, Repository};

use crate::ai_cli::{capture, capture_child, search_path, spawn_piped};
use crate::error::{AppError, AppResult};

pub const PRE_COMMIT: &str = "pre-commit";
pub const COMMIT_MSG: &str = "commit-msg";
pub const PRE_PUSH: &str = "pre-push";
const REPO_HOOKS: &[&str] = &[PRE_COMMIT, COMMIT_MSG, PRE_PUSH];

const MIN_GIT_VERSION: (u32, u32) = (2, 36);
const TO_STDIN_VERSION: (u32, u32) = (2, 40);
const HOOK_TIMEOUT: Duration = Duration::from_secs(600);
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_CAP: usize = 64 * 1024;
const SHELL_PATH: &str = "/bin/sh";

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

static HOOK_GIT: Mutex<Option<GitCli>> = Mutex::new(None);

#[derive(Clone)]
struct GitCli {
    path: PathBuf,
    version: (u32, u32),
}

pub(crate) enum Runner {
    Git(PathBuf),
    Direct(PathBuf),
}

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
    if hook_file(repo, name)?.is_some() {
        return Ok(true);
    }
    configured_for(repo, name)
}

fn hook_file(repo: &Repository, name: &str) -> AppResult<Option<PathBuf>> {
    let dir = hooks_dir(repo)?;
    Ok(hook_candidates(&dir, name)
        .into_iter()
        .find(|p| is_executable(p)))
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

pub fn repo_hooks(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    if repo.workdir().is_none() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for name in REPO_HOOKS {
        if present(&repo, name)? {
            found.push(name.to_string());
        }
    }
    Ok(found)
}

pub fn runner_available() -> bool {
    hook_git(&std::env::temp_dir()).is_ok()
}

fn hook_git(cwd: &Path) -> Result<GitCli, String> {
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
            let git = GitCli { path: git, version };
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

fn runner(
    repo: &Repository,
    workdir: &Path,
    name: &str,
    with_input: bool,
) -> Result<Runner, String> {
    let git = hook_git(workdir)?;
    let file = if with_input && git.version < TO_STDIN_VERSION {
        hook_file(repo, name).ok().flatten()
    } else {
        None
    };
    pick_runner(git, name, with_input, file)
}

fn pick_runner(
    git: GitCli,
    name: &str,
    with_input: bool,
    file: Option<PathBuf>,
) -> Result<Runner, String> {
    if !with_input || git.version >= TO_STDIN_VERSION {
        return Ok(Runner::Git(git.path));
    }
    if let Some(file) = file.filter(|_| cfg!(unix)) {
        return Ok(Runner::Direct(file));
    }
    let (major, minor) = git.version;
    Err(format!(
        "The {name} hook did not run because git {major}.{minor} cannot hand it the refs being \
         pushed. Git 2.40 or newer is needed to run it."
    ))
}

struct InputFile(PathBuf);

impl InputFile {
    fn write(text: &str) -> AppResult<Self> {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "angkorgit-hook-{}-{nanos}-{}",
            std::process::id(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&path, text)?;
        Ok(InputFile(path))
    }
}

impl Drop for InputFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) fn run(
    repo: &Repository,
    runner: &Runner,
    name: &str,
    args: &[&OsStr],
    env: &[(&str, &OsStr)],
    input: Option<&str>,
) -> AppResult<()> {
    let cwd = repo.workdir().unwrap_or_else(|| repo.path());
    let input_file = match (runner, input) {
        (Runner::Git(_), Some(text)) => Some(InputFile::write(text)?),
        _ => None,
    };
    let configure = |command: &mut std::process::Command| {
        command.current_dir(cwd).env("PATH", search_path(None));
        for var in REPO_ENV {
            command.env_remove(var);
        }
        for (key, value) in env {
            command.env(key, value);
        }
    };
    let spawned = match runner {
        Runner::Git(git) => {
            let mut command = crate::proc::hidden(git);
            command.args(["hook", "run", "--ignore-missing"]);
            if let Some(file) = &input_file {
                let mut flag = OsString::from("--to-stdin=");
                flag.push(file.0.as_os_str());
                command.arg(flag);
            }
            command.arg(name);
            if !args.is_empty() {
                command.arg("--").args(args);
            }
            configure(&mut command);
            spawn_piped(command)
        }
        Runner::Direct(hook) => {
            let mut command = crate::proc::hidden(hook);
            command.args(args);
            configure(&mut command);
            match spawn_piped(command) {
                Err(error) if is_exec_format_error(&error) => {
                    let mut command = crate::proc::hidden(SHELL_PATH);
                    command.arg(hook).args(args);
                    configure(&mut command);
                    spawn_piped(command)
                }
                spawned => spawned,
            }
        }
    };
    let child = spawned.map_err(|e| {
        AppError::other(format!(
            "The {name} hook could not run: failed to launch: {e}"
        ))
    })?;
    let piped = match runner {
        Runner::Direct(_) => input.unwrap_or(""),
        Runner::Git(_) => "",
    };
    let captured = capture_child(child, piped, HOOK_TIMEOUT)
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

#[cfg(unix)]
fn is_exec_format_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ENOEXEC)
}

#[cfg(not(unix))]
fn is_exec_format_error(_error: &std::io::Error) -> bool {
    false
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
    runner: Option<Runner>,
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
            runner: None,
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
            match runner(repo, workdir, PRE_COMMIT, false) {
                Ok(runner) => hooks.runner = Some(runner),
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
        let Some(runner) = self.runner.as_ref().filter(|_| self.pre_commit) else {
            return Ok(false);
        };
        run(repo, runner, PRE_COMMIT, &[], &self.env(), None)?;
        Ok(true)
    }

    pub(crate) fn commit_msg(&self, repo: &Repository, message: &str) -> AppResult<String> {
        let Some(runner) = self.runner.as_ref().filter(|_| self.commit_msg) else {
            return Ok(message.to_string());
        };
        let file = repo.path().join("COMMIT_EDITMSG");
        let written = if message.ends_with('\n') {
            message.to_string()
        } else {
            format!("{message}\n")
        };
        std::fs::write(&file, &written)?;
        run(
            repo,
            runner,
            COMMIT_MSG,
            &[file.as_os_str()],
            &self.env(),
            None,
        )?;
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

pub(crate) struct PushedRef {
    pub(crate) local_ref: String,
    pub(crate) local: Oid,
    pub(crate) remote_ref: String,
    pub(crate) remote: Oid,
    pub(crate) force: bool,
}

pub(crate) struct PrePush {
    runner: Option<Runner>,
    args: [OsString; 2],
    pub(crate) warning: Option<String>,
}

impl PrePush {
    pub(crate) fn prepare(
        repo: &Repository,
        remote: &git2::Remote<'_>,
        no_verify: bool,
    ) -> AppResult<Self> {
        let url = String::from_utf8_lossy(remote.pushurl_bytes().unwrap_or(remote.url_bytes()))
            .into_owned();
        let name = remote
            .name()
            .map(str::to_string)
            .unwrap_or_else(|| url.clone());
        let mut hook = PrePush {
            runner: None,
            args: [OsString::from(name), OsString::from(url)],
            warning: None,
        };
        let Some(workdir) = repo.workdir() else {
            return Ok(hook);
        };
        if no_verify || !present(repo, PRE_PUSH)? {
            return Ok(hook);
        }
        match runner(repo, workdir, PRE_PUSH, true) {
            Ok(runner) => hook.runner = Some(runner),
            Err(warning) => hook.warning = Some(warning),
        }
        Ok(hook)
    }

    pub(crate) fn active(&self) -> bool {
        self.runner.is_some()
    }

    pub(crate) fn run(&self, repo: &Repository, refs: &[PushedRef]) -> AppResult<()> {
        let Some(runner) = &self.runner else {
            return Ok(());
        };
        let args = [self.args[0].as_os_str(), self.args[1].as_os_str()];
        run(
            repo,
            runner,
            PRE_PUSH,
            &args,
            &[],
            Some(&pre_push_input(repo, refs)),
        )
    }
}

pub(crate) fn pre_push_input(repo: &Repository, refs: &[PushedRef]) -> String {
    refs.iter()
        .filter(|r| r.local != r.remote && !rejected_as_non_fast_forward(repo, r))
        .map(|r| {
            if r.local.is_zero() {
                format!("(delete) {} {} {}\n", Oid::zero(), r.remote_ref, r.remote)
            } else {
                format!(
                    "{} {} {} {}\n",
                    r.local_ref, r.local, r.remote_ref, r.remote
                )
            }
        })
        .collect()
}

fn rejected_as_non_fast_forward(repo: &Repository, r: &PushedRef) -> bool {
    if r.force || r.local.is_zero() || r.remote.is_zero() || r.remote_ref.starts_with("refs/tags/")
    {
        return false;
    }
    let commit = |oid: Oid| {
        repo.find_object(oid, None)
            .and_then(|object| object.peel_to_commit())
            .ok()
    };
    match (commit(r.local), commit(r.remote)) {
        (Some(local), Some(remote)) => {
            local.id() != remote.id()
                && !repo
                    .graph_descendant_of(local.id(), remote.id())
                    .unwrap_or(false)
        }
        _ => false,
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

    fn git_at(version: (u32, u32)) -> GitCli {
        GitCli {
            path: PathBuf::from("git"),
            version,
        }
    }

    #[test]
    fn hooks_with_input_need_git_2_40_or_the_hook_file_on_unix() {
        let hook = PathBuf::from("/repo/.git/hooks/pre-push");
        assert!(matches!(
            pick_runner(git_at((2, 36)), PRE_COMMIT, false, None),
            Ok(Runner::Git(_))
        ));
        assert!(matches!(
            pick_runner(git_at((2, 40)), PRE_PUSH, true, Some(hook.clone())),
            Ok(Runner::Git(_))
        ));
        let old = pick_runner(git_at((2, 39)), PRE_PUSH, true, Some(hook.clone()));
        if cfg!(unix) {
            assert!(matches!(old, Ok(Runner::Direct(ref file)) if *file == hook));
        } else {
            assert!(old.is_err());
        }
        let Err(warning) = pick_runner(git_at((2, 39)), PRE_PUSH, true, None) else {
            panic!("an old git without a hook file must not run the hook");
        };
        assert!(warning.contains("git 2.39"), "{warning}");
        assert!(warning.contains("Git 2.40 or newer"), "{warning}");
    }

    fn temp_repo(name: &str) -> (PathBuf, Repository) {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-hooks-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        let repo = Repository::init(&dir).expect("init repo");
        (dir, repo)
    }

    #[test]
    fn pre_push_input_matches_the_git_line_format() {
        let (dir, repo) = temp_repo("input");
        let a = Oid::from_str("1111111111111111111111111111111111111111").unwrap();
        let b = Oid::from_str("2222222222222222222222222222222222222222").unwrap();
        let line = |local_ref: &str, local: Oid, remote_ref: &str, remote: Oid| PushedRef {
            local_ref: local_ref.to_string(),
            local,
            remote_ref: remote_ref.to_string(),
            remote,
            force: false,
        };
        let input = pre_push_input(
            &repo,
            &[
                line("refs/heads/new", a, "refs/heads/new", Oid::zero()),
                line("refs/heads/same", a, "refs/heads/same", a),
                line("", Oid::zero(), "refs/heads/gone", b),
                line("refs/heads/unknown", a, "refs/heads/unknown", b),
            ],
        );
        let zero = Oid::zero();
        assert_eq!(
            input,
            format!(
                "refs/heads/new {a} refs/heads/new {zero}\n\
                 (delete) {zero} refs/heads/gone {b}\n\
                 refs/heads/unknown {a} refs/heads/unknown {b}\n"
            )
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn direct_runner_hands_the_hook_its_args_and_stdin() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, repo) = temp_repo("direct");
        let hook = dir.join(".git").join("hooks").join("pre-push");
        std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
        std::fs::write(
            &hook,
            "#!/bin/sh\nprintf '%s|%s\\n' \"$1\" \"$2\" > got\ncat >> got\necho refused >&2\nexit 4\n",
        )
        .unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();

        let error = run(
            &repo,
            &Runner::Direct(hook),
            PRE_PUSH,
            &[OsStr::new("origin"), OsStr::new("/srv/r.git")],
            &[],
            Some("refs/heads/main a refs/heads/main b\n"),
        )
        .unwrap_err();
        assert!(
            matches!(&error, AppError::Hook { hook, status: 4, output } if hook == PRE_PUSH && output == "refused"),
            "{error:?}"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("got")).unwrap(),
            "origin|/srv/r.git\nrefs/heads/main a refs/heads/main b\n"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_an_exec_format_error_retries_the_hook_through_sh() {
        let error = |code| std::io::Error::from_raw_os_error(code);
        assert!(is_exec_format_error(&error(libc::ENOEXEC)));
        assert!(!is_exec_format_error(&error(libc::ENOENT)));
        assert!(!is_exec_format_error(&error(libc::EACCES)));
    }

    #[cfg(unix)]
    #[test]
    fn direct_runner_runs_a_hook_without_a_shebang_through_sh_like_git() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, repo) = temp_repo("no-shebang");
        let hook = dir.join(".git").join("hooks").join("pre-push");
        std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
        std::fs::write(
            &hook,
            "printf '%s|%s|%s|%s\\n' \"$1\" \"$2\" \"$ANGKORGIT_HOOK_PROBE\" \"$(pwd -P)\" > got\ncat >> got\necho refused >&2\nexit 4\n",
        )
        .unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();

        let error = run(
            &repo,
            &Runner::Direct(hook),
            PRE_PUSH,
            &[OsStr::new("origin"), OsStr::new("/srv/r.git")],
            &[("ANGKORGIT_HOOK_PROBE", OsStr::new("kept"))],
            Some("refs/heads/main a refs/heads/main b\n"),
        )
        .unwrap_err();
        assert!(
            matches!(&error, AppError::Hook { hook, status: 4, output } if hook == PRE_PUSH && output == "refused"),
            "{error:?}"
        );
        let workdir = std::fs::canonicalize(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("got")).unwrap(),
            format!(
                "origin|/srv/r.git|kept|{}\nrefs/heads/main a refs/heads/main b\n",
                workdir.display()
            )
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
