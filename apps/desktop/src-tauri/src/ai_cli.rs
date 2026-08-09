use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const AGENTS: &[(&str, &str, &str)] = &[
    ("claude", "Claude Code", "claude"),
    ("codex", "Codex CLI", "codex"),
    ("gemini", "Gemini CLI", "gemini"),
    ("opencode", "OpenCode", "opencode"),
    ("antigravity", "Antigravity CLI", "agy"),
];

const OUTPUT_FILE_PLACEHOLDER: &str = "{OUTPUT_FILE}";
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliAgentInfo {
    pub id: String,
    pub label: String,
    pub path: String,
    pub version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRunRequest {
    pub program: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin: String,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRunResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
    pub output: Option<String>,
}

struct Captured {
    status: i32,
    stdout: String,
    stderr: String,
}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

fn search_path(extra: Option<&Path>) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let push = |dirs: &mut Vec<PathBuf>, p: PathBuf| {
        if !p.as_os_str().is_empty() && !dirs.contains(&p) {
            dirs.push(p);
        }
    };
    if let Some(dir) = extra {
        push(&mut dirs, dir.to_path_buf());
    }
    if let Some(current) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&current) {
            push(&mut dirs, p);
        }
    }
    if cfg!(unix) {
        for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            push(&mut dirs, PathBuf::from(fixed));
        }
    }
    if let Some(home) = home_dir() {
        for rel in [
            ".local/bin",
            ".claude/local",
            ".bun/bin",
            ".cargo/bin",
            ".volta/bin",
            ".asdf/shims",
            ".npm-global/bin",
            "bin",
        ] {
            push(&mut dirs, home.join(rel));
        }
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            for entry in entries.flatten() {
                push(&mut dirs, entry.path().join("bin"));
            }
        }
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            push(&mut dirs, PathBuf::from(appdata).join("npm"));
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

fn is_supported(program: &str) -> bool {
    let stem = Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    AGENTS.iter().any(|(_, _, bin)| *bin == stem)
}

fn capture(mut command: Command, stdin: &str, timeout: Duration) -> AppResult<Captured> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| AppError::other(format!("failed to launch: {e}")))?;

    let stdin_data = stdin.as_bytes().to_vec();
    let mut stdin_pipe = child.stdin.take();
    let stdin_thread = std::thread::spawn(move || {
        if let Some(mut pipe) = stdin_pipe.take() {
            let _ = pipe.write_all(&stdin_data);
        }
    });
    let mut stdout_pipe = child.stdout.take();
    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let mut stderr_pipe = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let status = match wait_with_timeout(&mut child, timeout) {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdin_thread);
            drop(stdout_thread);
            drop(stderr_thread);
            return Err(AppError::other(format!(
                "timed out after {}s",
                timeout.as_secs()
            )));
        }
    };
    let _ = stdin_thread.join();
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    Ok(Captured {
        status,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

fn wait_with_timeout(child: &mut Child, timeout: Duration) -> Option<i32> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.code().unwrap_or(-1)),
            Ok(None) => {
                if Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return Some(-1),
        }
    }
}

#[cfg(unix)]
fn shell_lookup(missing: &[&str]) -> Vec<(String, PathBuf)> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let script = missing
        .iter()
        .map(|name| format!("command -v {name} || true"))
        .collect::<Vec<_>>()
        .join("; ");
    let mut command = Command::new(shell);
    command.args(["-lc", &script]);
    let Ok(captured) = capture(command, "", VERSION_TIMEOUT) else {
        return Vec::new();
    };
    captured
        .stdout
        .lines()
        .filter_map(|line| {
            let path = PathBuf::from(line.trim());
            let stem = path.file_stem().and_then(|s| s.to_str())?.to_lowercase();
            if missing.contains(&stem.as_str()) && path.is_file() {
                Some((stem, path))
            } else {
                None
            }
        })
        .collect()
}

fn agent_version(path: &Path) -> String {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .current_dir(std::env::temp_dir())
        .env("PATH", search_path(path.parent()))
        .env("NO_COLOR", "1")
        .env("TERM", "dumb");
    match capture(command, "", VERSION_TIMEOUT) {
        Ok(captured) if captured.status == 0 => captured
            .stdout
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

pub fn detect() -> Vec<CliAgentInfo> {
    let path_env = search_path(None);
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir());
    let mut located: Vec<(usize, PathBuf)> = Vec::new();
    for (index, (_, _, bin)) in AGENTS.iter().enumerate() {
        if let Ok(path) = which::which_in(bin, Some(&path_env), &cwd) {
            located.push((index, path));
        }
    }
    #[cfg(unix)]
    {
        let missing: Vec<&str> = AGENTS
            .iter()
            .enumerate()
            .filter(|(index, _)| !located.iter().any(|(i, _)| i == index))
            .map(|(_, (_, _, bin))| *bin)
            .collect();
        if !missing.is_empty() {
            for (stem, path) in shell_lookup(&missing) {
                if let Some(index) = AGENTS.iter().position(|(_, _, bin)| *bin == stem) {
                    located.push((index, path));
                }
            }
        }
    }
    located.sort_by_key(|(index, _)| *index);
    located
        .into_iter()
        .map(|(index, path)| {
            let (id, label, _) = AGENTS[index];
            CliAgentInfo {
                id: id.to_string(),
                label: label.to_string(),
                version: agent_version(&path),
                path: path.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

fn temp_output_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("angkorgit-ai-{}-{nanos}.txt", std::process::id()))
}

pub fn run(request: CliRunRequest) -> AppResult<CliRunResult> {
    if !is_supported(&request.program) {
        return Err(AppError::other(format!(
            "{} is not a supported AI CLI",
            request.program
        )));
    }
    let timeout = Duration::from_secs(request.timeout_secs.unwrap_or(240).clamp(1, 600));

    let mut output_file: Option<PathBuf> = None;
    let args: Vec<String> = request
        .args
        .iter()
        .map(|arg| {
            if arg == OUTPUT_FILE_PLACEHOLDER {
                let file = output_file.get_or_insert_with(temp_output_path).clone();
                file.to_string_lossy().into_owned()
            } else {
                arg.clone()
            }
        })
        .collect();

    let program_dir = Path::new(&request.program).parent().map(Path::to_path_buf);
    let mut command = Command::new(&request.program);
    command
        .args(&args)
        .current_dir(std::env::temp_dir())
        .env("PATH", search_path(program_dir.as_deref()))
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .env("TERM", "dumb");

    let result = capture(command, &request.stdin, timeout);
    let output = output_file.as_ref().and_then(|file| {
        let content = std::fs::read_to_string(file).ok();
        let _ = std::fs::remove_file(file);
        content.filter(|c| !c.trim().is_empty())
    });
    let captured = result.map_err(|e| {
        let name = Path::new(&request.program)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("AI CLI")
            .to_string();
        AppError::other(format!("{name} {}", e))
    })?;
    Ok(CliRunResult {
        status: captured.status,
        stdout: captured.stdout,
        stderr: captured.stderr,
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsupported_program() {
        let err = run(CliRunRequest {
            program: "echo".to_string(),
            args: vec!["hi".to_string()],
            stdin: String::new(),
            timeout_secs: Some(5),
        });
        assert!(err.is_err());
    }

    #[cfg(unix)]
    fn fake_agent(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("claude");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn runs_supported_cli_and_captures_stdout() {
        let dir = std::env::temp_dir().join(format!("angkorgit-ai-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent = fake_agent(&dir, "cat > /dev/null\necho pong");
        let result = run(CliRunRequest {
            program: agent.to_string_lossy().into_owned(),
            args: vec![],
            stdin: "hello".to_string(),
            timeout_secs: Some(30),
        })
        .unwrap();
        assert_eq!(result.status, 0);
        assert_eq!(result.stdout.trim(), "pong");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn substitutes_and_reads_output_file() {
        let dir =
            std::env::temp_dir().join(format!("angkorgit-ai-test-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent = fake_agent(&dir, "printf from-file > \"$2\"");
        let result = run(CliRunRequest {
            program: agent.to_string_lossy().into_owned(),
            args: vec!["--out".to_string(), OUTPUT_FILE_PLACEHOLDER.to_string()],
            stdin: String::new(),
            timeout_secs: Some(30),
        })
        .unwrap();
        assert_eq!(result.output.as_deref(), Some("from-file"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn leaves_prompt_args_containing_placeholder_text_untouched() {
        let dir =
            std::env::temp_dir().join(format!("angkorgit-ai-test-prompt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent = fake_agent(&dir, "printf '%s' \"$1\"");
        let prompt = format!("diff mentioning {OUTPUT_FILE_PLACEHOLDER} literally");
        let result = run(CliRunRequest {
            program: agent.to_string_lossy().into_owned(),
            args: vec![prompt.clone()],
            stdin: String::new(),
            timeout_secs: Some(30),
        })
        .unwrap();
        assert_eq!(result.stdout, prompt);
        assert!(result.output.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn kills_process_on_timeout() {
        let dir =
            std::env::temp_dir().join(format!("angkorgit-ai-test-slow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent = fake_agent(&dir, "sleep 20");
        let started = Instant::now();
        let err = run(CliRunRequest {
            program: agent.to_string_lossy().into_owned(),
            args: vec![],
            stdin: String::new(),
            timeout_secs: Some(1),
        });
        assert!(err.is_err());
        assert!(started.elapsed() < Duration::from_secs(10));
        std::fs::remove_dir_all(&dir).ok();
    }
}
