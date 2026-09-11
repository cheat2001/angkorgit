use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(unix)]
use crate::ai_cli::home_dir;
use crate::error::{AppError, AppResult};

const EVENT: &str = "cli-request";
const SHIM_MARK: &str = "angkorgit-cli";
pub const HELP: &str = include_str!("../cli/help.txt");

static PENDING: Mutex<Option<CliRequest>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliToolStatus {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CliRequest {
    Open {
        path: String,
    },
    Clone {
        url: String,
        into: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        branch: Option<String>,
    },
}

pub fn parse_args(args: &[String], cwd: Option<&str>) -> Option<CliRequest> {
    let rest: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    if rest.is_empty() {
        return None;
    }
    match rest[0] {
        "-h" | "--help" | "help" => None,
        "--open" => rest.get(1).map(|path| CliRequest::Open {
            path: resolve_path(path, cwd),
        }),
        "--clone" => parse_clone_flags(&rest[1..], cwd),
        "open" => {
            if rest.get(1).is_some_and(|a| *a == "-h" || *a == "--help") {
                return None;
            }
            Some(CliRequest::Open {
                path: resolve_path(rest.get(1).copied().unwrap_or("."), cwd),
            })
        }
        "clone" => parse_clone_flags(&rest[1..], cwd),
        flag if flag.starts_with('-') => None,
        path => Some(CliRequest::Open {
            path: resolve_path(path, cwd),
        }),
    }
}

fn parse_clone_flags(args: &[&str], cwd: Option<&str>) -> Option<CliRequest> {
    let mut url = None;
    let mut branch = None;
    let mut into = None;
    let mut i = 0;
    while i < args.len() {
        match args[i] {
            "-h" | "--help" => return None,
            "-b" | "--branch" => {
                branch = args.get(i + 1).map(|s| (*s).to_string());
                i += 2;
            }
            "--into" => {
                into = args.get(i + 1).map(|s| (*s).to_string());
                i += 2;
            }
            flag if flag.starts_with('-') => i += 1,
            value => {
                url = Some((*value).to_string());
                i += 1;
            }
        }
    }
    let url = resolve_clone_url(&url?);
    let into = resolve_path(into.as_deref().unwrap_or("."), cwd);
    Some(CliRequest::Clone { url, into, branch })
}

pub fn resolve_clone_url(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.contains("://") || trimmed.starts_with("git@") {
        return trimmed.to_string();
    }
    let parts: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() == 2 && !trimmed.starts_with('.') {
        return format!("https://github.com/{}/{}.git", parts[0], parts[1]);
    }
    trimmed.to_string()
}

pub fn resolve_path(path: &str, cwd: Option<&str>) -> String {
    if path == "." {
        return cwd
            .map(str::to_string)
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|d| d.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| path.to_string());
    }
    let p = Path::new(path);
    if p.is_absolute() {
        return path.to_string();
    }
    match cwd {
        Some(c) => Path::new(c).join(p).to_string_lossy().into_owned(),
        None => std::env::current_dir()
            .map(|d| d.join(p).to_string_lossy().into_owned())
            .unwrap_or_else(|_| path.to_string()),
    }
}

pub fn queue(request: CliRequest) {
    *PENDING.lock().expect("cli pending") = Some(request);
}

pub fn take_pending() -> Option<CliRequest> {
    PENDING.lock().expect("cli pending").take()
}

pub fn request(app: &AppHandle, request: CliRequest) {
    queue(request.clone());
    let _ = app.emit(EVENT, &request);
    focus_main(app);
}

#[cfg(target_os = "macos")]
pub fn request_open(app: &AppHandle, path: String) {
    request(app, CliRequest::Open { path });
}

pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn status() -> Option<CliToolStatus> {
    find_shim().map(|path| status_of(&path))
}

pub fn install() -> AppResult<CliToolStatus> {
    let body = shim_body()?;
    let mut last_err = None;
    for dir in dest_dirs() {
        if let Err(error) = std::fs::create_dir_all(&dir) {
            last_err = Some(error);
            continue;
        }
        let dest = dir.join(shim_name());
        match write_shim(&dest, &body) {
            Ok(()) => return Ok(status_of(&dest)),
            Err(error) => last_err = Some(error),
        }
    }
    Err(last_err.map(AppError::from).unwrap_or_else(|| {
        AppError::other("could not find a writable directory for the command line tool")
    }))
}

pub fn uninstall() -> AppResult<()> {
    if let Some(path) = find_shim() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn on_second_instance(app: &AppHandle, argv: Vec<String>, cwd: String) {
    if let Some(request) = parse_args(&argv, Some(&cwd)) {
        self::request(app, request);
    } else {
        focus_main(app);
    }
}

fn write_shim(dest: &Path, body: &str) -> std::io::Result<()> {
    std::fs::write(dest, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(dest)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dest, perms)?;
    }
    Ok(())
}

fn status_of(path: &Path) -> CliToolStatus {
    CliToolStatus {
        path: path.to_string_lossy().into_owned(),
    }
}

fn shim_name() -> &'static str {
    if cfg!(windows) {
        "angkorgit.cmd"
    } else {
        "angkorgit"
    }
}

fn dest_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(unix)]
    {
        candidates.push(PathBuf::from("/usr/local/bin"));
        if let Some(home) = home_dir() {
            candidates.push(home.join(".local").join("bin"));
        }
    }
    #[cfg(windows)]
    {
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(base).join("angkorgit").join("bin"));
        }
    }
    candidates
}

fn find_shim() -> Option<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let extra = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    for dir in dest_dirs().into_iter().chain(extra) {
        if !seen.insert(dir.clone()) {
            continue;
        }
        let dest = dir.join(shim_name());
        if is_our_shim(&dest) {
            return Some(dest);
        }
    }
    None
}

fn is_our_shim(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .map(|text| text.contains(SHIM_MARK))
        .unwrap_or(false)
}

enum LaunchTarget {
    #[cfg(target_os = "macos")]
    MacApp(PathBuf),
    Binary(PathBuf),
}

fn launch_target() -> AppResult<LaunchTarget> {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            return Ok(LaunchTarget::Binary(PathBuf::from(appimage)));
        }
    }
    let exe = std::env::current_exe()?;
    #[cfg(target_os = "macos")]
    {
        if let Some(bundle) = exe
            .ancestors()
            .find(|p| p.extension().is_some_and(|ext| ext == "app"))
        {
            return Ok(LaunchTarget::MacApp(bundle.to_path_buf()));
        }
    }
    Ok(LaunchTarget::Binary(exe))
}

fn shim_body() -> AppResult<String> {
    let target = launch_target()?;
    Ok(match target {
        #[cfg(target_os = "macos")]
        LaunchTarget::MacApp(app) => unix_shim(&app, "app"),
        LaunchTarget::Binary(exe) => {
            if cfg!(windows) {
                windows_shim(&exe)
            } else {
                unix_shim(&exe, "exe")
            }
        }
    })
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn unix_shim(app: &Path, kind: &str) -> String {
    include_str!("../cli/angkorgit.sh")
        .replace("@APP@", &sh_quote(&app.to_string_lossy()))
        .replace("@KIND@", kind)
        .replace("@HELP@", HELP.trim_end())
}

fn windows_shim(exe: &Path) -> String {
    include_str!("../cli/angkorgit.cmd").replace("@APP@", &exe.to_string_lossy().replace('"', ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<String> {
        std::iter::once("angkorgit".to_string())
            .chain(parts.iter().map(|s| (*s).to_string()))
            .collect()
    }

    #[test]
    fn parse_open_forms() {
        assert_eq!(
            parse_args(&args(&["--open", "/tmp/repo"]), Some("/cwd")),
            Some(CliRequest::Open {
                path: "/tmp/repo".into()
            })
        );
        assert_eq!(
            parse_args(&args(&["open", "/tmp/repo"]), Some("/cwd")),
            Some(CliRequest::Open {
                path: "/tmp/repo".into()
            })
        );
        assert_eq!(
            parse_args(&args(&["/tmp/repo"]), Some("/cwd")),
            Some(CliRequest::Open {
                path: "/tmp/repo".into()
            })
        );
        assert_eq!(
            parse_args(&args(&["open"]), Some("/cwd")),
            Some(CliRequest::Open {
                path: "/cwd".into()
            })
        );
        assert_eq!(parse_args(&args(&[]), Some("/cwd")), None);
        assert_eq!(parse_args(&args(&["--help"]), None), None);
        assert_eq!(parse_args(&args(&["help"]), None), None);
    }

    #[test]
    fn parse_clone_url_slug_and_branch() {
        assert_eq!(
            parse_args(&args(&["clone", "torvalds/linux"]), Some("/src")),
            Some(CliRequest::Clone {
                url: "https://github.com/torvalds/linux.git".into(),
                into: "/src".into(),
                branch: None,
            })
        );
        assert_eq!(
            parse_args(
                &args(&["clone", "-b", "dev", "https://gitlab.com/acme/app.git"]),
                Some("/src")
            ),
            Some(CliRequest::Clone {
                url: "https://gitlab.com/acme/app.git".into(),
                into: "/src".into(),
                branch: Some("dev".into()),
            })
        );
        assert_eq!(
            parse_args(
                &args(&[
                    "--clone",
                    "git@github.com:acme/app.git",
                    "--into",
                    "/src",
                    "--branch",
                    "main"
                ]),
                Some("/cwd")
            ),
            Some(CliRequest::Clone {
                url: "git@github.com:acme/app.git".into(),
                into: "/src".into(),
                branch: Some("main".into()),
            })
        );
        assert_eq!(parse_args(&args(&["clone"]), Some("/src")), None);
    }

    #[test]
    fn resolve_keeps_absolute_and_joins_relative() {
        assert_eq!(resolve_path("/abs/repo", Some("/cwd")), "/abs/repo");
        assert_eq!(
            resolve_path("repo", Some("/cwd")),
            Path::new("/cwd").join("repo").to_string_lossy()
        );
    }

    #[test]
    fn pending_is_taken_once() {
        queue(CliRequest::Open {
            path: "/once".into(),
        });
        assert_eq!(
            take_pending(),
            Some(CliRequest::Open {
                path: "/once".into()
            })
        );
        assert_eq!(take_pending(), None);
    }

    #[test]
    fn unix_shim_lists_the_github_desktop_commands() {
        let body = unix_shim(Path::new("/Applications/AngKorGit.app"), "app");
        assert!(body.contains(SHIM_MARK));
        assert!(body.contains("APP='/Applications/AngKorGit.app'"));
        assert!(body.contains("open -a \"$APP\""));
        assert!(body.contains("angkorgit open [path]"));
        assert!(body.contains("angkorgit clone [-b branch] <url>"));
        assert!(body.contains("torvalds/linux"));
        assert!(body.contains("abs=$(resolve \"$2\") || exit 1"));
        assert!(!body.contains("launch_open \"$(resolve"));
        assert_eq!(HELP.lines().next(), Some("Usage:"));
    }

    #[cfg(unix)]
    #[test]
    fn dest_dirs_are_usr_local_then_home_local() {
        let dirs = dest_dirs();
        assert_eq!(dirs.first(), Some(&PathBuf::from("/usr/local/bin")));
        assert!(!dirs.iter().any(|dir| dir == Path::new("/opt/homebrew/bin")));
    }
}
