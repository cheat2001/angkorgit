use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const AGENTS: &[(&str, &str, &[&str])] = &[
    ("claude", "Claude Code", &["claude"]),
    ("copilot", "GitHub Copilot CLI", &["copilot"]),
    ("codex", "Codex CLI", &["codex"]),
    ("gemini", "Gemini CLI", &["gemini"]),
    ("opencode", "OpenCode", &["opencode"]),
    ("antigravity", "Antigravity CLI", &["agy"]),
    ("cursor", "Cursor CLI", &["cursor-agent", "agent"]),
];

const OUTPUT_FILE_PLACEHOLDER: &str = "{OUTPUT_FILE}";
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_DRAIN: Duration = Duration::from_secs(1);
const CURSOR_LAUNCHERS: &[&str] = &["cursor-agent", "agent"];

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

pub(crate) struct Captured {
    pub(crate) status: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

pub(crate) fn search_path(extra: Option<&Path>) -> std::ffi::OsString {
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
            ".opencode/bin",
            "Library/pnpm",
            ".local/share/pnpm",
            ".local/share/mise/shims",
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
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            let local_appdata = PathBuf::from(local_appdata);
            push(&mut dirs, local_appdata.join("Microsoft/WinGet/Links"));
            push(&mut dirs, local_appdata.join("cursor-agent"));
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

fn is_batch_launcher(program: &Path) -> bool {
    program
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
}

fn cursor_version_key(name: &str) -> Option<u32> {
    let head = name.split('-').next()?;
    let mut parts = head.split('.');
    let year: u32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(year * 10_000 + month * 100 + day)
}

pub(crate) fn cursor_node_launch(launcher: &Path) -> Option<(PathBuf, PathBuf)> {
    let stem = launcher.file_stem()?.to_str()?.to_lowercase();
    if !CURSOR_LAUNCHERS.contains(&stem.as_str()) {
        return None;
    }
    let versions = launcher.parent()?.join("versions");
    let mut best: Option<(u32, PathBuf)> = None;
    for entry in std::fs::read_dir(versions).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(key) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(cursor_version_key)
        else {
            continue;
        };
        if best.as_ref().map_or(true, |(k, _)| key > *k) {
            best = Some((key, path));
        }
    }
    let (_, dir) = best?;
    let node = dir.join("node.exe");
    let index = dir.join("index.js");
    (node.is_file() && index.is_file()).then_some((node, index))
}

fn launch_command(program: &Path) -> Command {
    if is_batch_launcher(program) {
        if let Some((node, index)) = cursor_node_launch(program) {
            let mut command = crate::proc::hidden(&node);
            command.arg(index);
            if let Some(name) = program.file_name() {
                command.env("CURSOR_INVOKED_AS", name);
            }
            return command;
        }
    }
    crate::proc::hidden(program)
}

fn is_supported(program: &str) -> bool {
    let stem = Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    AGENTS
        .iter()
        .any(|(_, _, bins)| bins.contains(&stem.as_str()))
}

pub(crate) fn capture(command: Command, stdin: &str, timeout: Duration) -> AppResult<Captured> {
    let child =
        spawn_piped(command).map_err(|e| AppError::other(format!("failed to launch: {e}")))?;
    capture_child(child, stdin, timeout)
}

pub(crate) fn spawn_piped(mut command: Command) -> std::io::Result<Child> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.spawn()
}

pub(crate) fn spawn_tree(mut command: Command) -> std::io::Result<Child> {
    own_process_group(&mut command);
    spawn_piped(command)
}

pub(crate) fn capture_child(child: Child, stdin: &str, timeout: Duration) -> AppResult<Captured> {
    collect(child, stdin, timeout, false)
}

pub(crate) struct TreeRun {
    pub(crate) captured: Captured,
    pub(crate) timed_out: bool,
}

pub(crate) fn run_tree(
    child: Child,
    stdin: &str,
    timeout: Duration,
    wait_for_group: bool,
) -> TreeRun {
    let (captured, timed_out) = gather(child, stdin, timeout, true, wait_for_group);
    TreeRun {
        captured,
        timed_out,
    }
}

fn timed_out(timeout: Duration) -> AppError {
    AppError::other(format!("timed out after {}s", timeout.as_secs()))
}

#[cfg(unix)]
fn own_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn own_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn kill_tree(child: &mut Child) {
    if let Ok(group) = libc::pid_t::try_from(child.id()) {
        unsafe {
            libc::killpg(group, libc::SIGKILL);
        }
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_tree(child: &mut Child) {
    let _ = crate::proc::hidden("taskkill")
        .args(["/F", "/T", "/PID", &child.id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn kill_tree(child: &mut Child) {
    let _ = child.kill();
}

struct Leftovers {
    #[cfg(unix)]
    group: u32,
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl Leftovers {
    fn track(child: &Child) -> Self {
        #[cfg(unix)]
        {
            Leftovers { group: child.id() }
        }
        #[cfg(windows)]
        {
            Leftovers {
                job: job::Job::holding(child),
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = child;
            Leftovers {}
        }
    }

    fn running(&self) -> bool {
        #[cfg(unix)]
        {
            let Ok(group) = libc::pid_t::try_from(self.group) else {
                return false;
            };
            unsafe { libc::killpg(group, 0) == 0 }
        }
        #[cfg(windows)]
        {
            self.job.as_ref().is_some_and(job::Job::running)
        }
        #[cfg(not(any(unix, windows)))]
        {
            false
        }
    }

    fn stop(&self) {
        #[cfg(unix)]
        if let Ok(group) = libc::pid_t::try_from(self.group) {
            unsafe {
                libc::killpg(group, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.stop();
        }
    }
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
        QueryInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    };

    pub(super) struct Job(HANDLE);

    impl Job {
        pub(super) fn holding(child: &Child) -> Option<Job> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return None;
            }
            let job = Job(handle);
            let process: HANDLE = child.as_raw_handle();
            if unsafe { AssignProcessToJobObject(job.0, process) } == 0 {
                return None;
            }
            Some(job)
        }

        pub(super) fn running(&self) -> bool {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let queried = unsafe {
                QueryInformationJobObject(
                    self.0,
                    JobObjectBasicAccountingInformation,
                    std::ptr::addr_of_mut!(info).cast(),
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                )
            };
            queried != 0 && info.ActiveProcesses > 0
        }

        pub(super) fn stop(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn collect(child: Child, stdin: &str, timeout: Duration, whole_tree: bool) -> AppResult<Captured> {
    let (captured, expired) = gather(child, stdin, timeout, whole_tree, false);
    if expired {
        return Err(timed_out(timeout));
    }
    Ok(captured)
}

fn gather(
    mut child: Child,
    stdin: &str,
    timeout: Duration,
    whole_tree: bool,
    wait_for_group: bool,
) -> (Captured, bool) {
    let deadline = Instant::now() + timeout;
    let leftovers = wait_for_group.then(|| Leftovers::track(&child));
    let stdin_data = stdin.as_bytes().to_vec();
    let mut stdin_pipe = child.stdin.take();
    let stdin_thread = std::thread::spawn(move || {
        if let Some(mut pipe) = stdin_pipe.take() {
            let _ = pipe.write_all(&stdin_data);
        }
    });
    let (stdout, stdout_thread) = read_pipe(child.stdout.take());
    let (stderr, stderr_thread) = read_pipe(child.stderr.take());

    let mut expired = false;
    let status = match wait_with_timeout(&mut child, timeout) {
        Some(status) => status,
        None => {
            expired = true;
            if whole_tree {
                kill_tree(&mut child);
            } else {
                let _ = child.kill();
            }
            if let Some(leftovers) = &leftovers {
                leftovers.stop();
            }
            let _ = child.wait();
            -1
        }
    };
    if let Some(leftovers) = leftovers.as_ref().filter(|_| !expired) {
        while leftovers.running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        if leftovers.running() {
            expired = true;
            leftovers.stop();
        }
    }
    let drain_until = Instant::now() + OUTPUT_DRAIN;
    while !(stdout_thread.is_finished() && stderr_thread.is_finished())
        && Instant::now() < drain_until
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(stdin_thread);
    let captured = Captured {
        status,
        stdout: take_output(&stdout),
        stderr: take_output(&stderr),
    };
    (captured, expired)
}

type SharedOutput = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;

fn read_pipe<R: Read + Send + 'static>(
    pipe: Option<R>,
) -> (SharedOutput, std::thread::JoinHandle<()>) {
    let output = SharedOutput::default();
    let sink = std::sync::Arc::clone(&output);
    let handle = std::thread::spawn(move || {
        let Some(mut pipe) = pipe else {
            return;
        };
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut buffer) = sink.lock() {
                        buffer.extend_from_slice(&chunk[..read]);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
    });
    (output, handle)
}

fn take_output(output: &SharedOutput) -> String {
    let bytes = output
        .lock()
        .map(|mut buffer| std::mem::take(&mut *buffer))
        .unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
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
    let mut command = crate::proc::hidden(shell);
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
    let mut command = crate::proc::hidden(path);
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
    for (index, (_, _, bins)) in AGENTS.iter().enumerate() {
        let found = bins
            .iter()
            .find_map(|bin| which::which_in(bin, Some(&path_env), &cwd).ok());
        if let Some(path) = found {
            located.push((index, path));
        }
    }
    #[cfg(unix)]
    {
        let missing: Vec<&str> = AGENTS
            .iter()
            .enumerate()
            .filter(|(index, _)| !located.iter().any(|(i, _)| i == index))
            .flat_map(|(_, (_, _, bins))| bins.iter().copied())
            .collect();
        if !missing.is_empty() {
            for (stem, path) in shell_lookup(&missing) {
                let agent = AGENTS
                    .iter()
                    .position(|(_, _, bins)| bins.contains(&stem.as_str()))
                    .filter(|index| !located.iter().any(|(i, _)| i == index));
                if let Some(index) = agent {
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
    let mut command = launch_command(Path::new(&request.program));
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
    fn cursor_version_keys_follow_the_date_and_ignore_other_folders() {
        assert_eq!(cursor_version_key("2026.09.26-abcdef01"), Some(20_260_926));
        assert_eq!(
            cursor_version_key("2026.09.26-12-00-00-abcdef01"),
            Some(20_260_926)
        );
        assert_eq!(cursor_version_key("2026.9.5-aa"), Some(20_260_905));
        assert_eq!(cursor_version_key("cache"), None);
        assert_eq!(cursor_version_key("2026.13.01-aa"), None);
        assert_eq!(cursor_version_key("2026.09.26.1-aa"), None);
    }

    #[test]
    fn cursor_batch_launcher_resolves_to_the_newest_node_entry() {
        let root = std::env::temp_dir().join(format!("angkorgit-cursor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for version in ["2026.08.30-aaaa", "2026.09.26-12-00-00-bbbb", "notes"] {
            let dir = root.join("versions").join(version);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("node.exe"), b"").unwrap();
            std::fs::write(dir.join("index.js"), b"").unwrap();
        }
        let launcher = root.join("cursor-agent.cmd");
        std::fs::write(&launcher, b"@echo off").unwrap();

        let (node, index) = cursor_node_launch(&launcher).expect("resolved");
        assert!(node.ends_with(Path::new("2026.09.26-12-00-00-bbbb").join("node.exe")));
        assert!(index.ends_with(Path::new("2026.09.26-12-00-00-bbbb").join("index.js")));
        assert!(is_batch_launcher(&launcher));
        assert!(!is_batch_launcher(&root.join("cursor-agent")));

        assert!(cursor_node_launch(&root.join("claude.cmd")).is_none());
        std::fs::remove_dir_all(root.join("versions")).unwrap();
        assert!(cursor_node_launch(&launcher).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn search_path_covers_dedicated_installer_dirs() {
        let path = search_path(None);
        let joined = path.to_string_lossy().to_string();
        for dir in [".opencode/bin", "pnpm", ".claude/local"] {
            assert!(joined.contains(dir), "missing {dir} in {joined}");
        }
    }

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

    #[test]
    fn accepts_cursor_cli_under_both_of_its_names() {
        assert!(is_supported("agent"));
        assert!(is_supported("/home/u/.local/bin/cursor-agent"));
        #[cfg(windows)]
        assert!(is_supported(
            r"C:\Users\u\AppData\Local\cursor-agent\agent.exe"
        ));
        assert!(!is_supported("cursor"));
    }

    #[test]
    fn accepts_github_copilot_cli_program() {
        assert!(is_supported("copilot"));
        assert!(is_supported("/usr/local/bin/copilot"));
        #[cfg(windows)]
        assert!(is_supported(r"C:\Program Files\GitHub Copilot\copilot.exe"));
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

    #[cfg(unix)]
    #[test]
    fn a_timed_out_tree_capture_stops_what_the_child_started() {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-ai-test-tree-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("grandchild");
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg(format!(
            "sleep 30 & echo $! > '{}'; wait",
            pid_file.display()
        ));
        let started = Instant::now();
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1), false);
        assert!(run.timed_out, "the sleeping shell must time out");
        assert!(started.elapsed() < Duration::from_secs(10));
        let grandchild: libc::pid_t = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut alive = true;
        while alive && Instant::now() < deadline {
            alive = unsafe { libc::kill(grandchild, 0) } == 0;
            if alive {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        if alive {
            unsafe {
                libc::kill(grandchild, libc::SIGKILL);
            }
        }
        std::fs::remove_dir_all(&dir).ok();
        assert!(!alive, "the grandchild outlived the timeout");
    }

    #[cfg(windows)]
    #[test]
    fn waiting_for_leftovers_tracks_a_windows_background_child() {
        let mut command = crate::proc::hidden("cmd");
        command.args(["/C", "start", "", "/B", "ping", "-n", "3", "127.0.0.1"]);
        let started = Instant::now();
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(30), true);
        assert!(!run.timed_out);
        assert!(
            started.elapsed() >= Duration::from_millis(1500),
            "returned after {:?}, before the background ping finished",
            started.elapsed()
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_background_child_left_at_the_deadline_is_stopped() {
        let mut command = crate::proc::hidden("cmd");
        command.args(["/C", "start", "", "/B", "ping", "-n", "30", "127.0.0.1"]);
        let started = Instant::now();
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(2), true);
        assert!(run.timed_out);
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[cfg(unix)]
    #[test]
    fn a_timed_out_tree_run_keeps_the_output_it_printed_before() {
        let mut command = crate::proc::hidden("/bin/sh");
        command
            .arg("-c")
            .arg("echo started; echo warming up >&2; sleep 30");
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1), false);
        assert!(run.timed_out);
        assert_eq!(run.captured.stdout.trim(), "started");
        assert_eq!(run.captured.stderr.trim(), "warming up");
    }

    #[cfg(unix)]
    #[test]
    fn waiting_for_leftovers_returns_only_after_the_background_work_finished() {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-leftovers-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("late");
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg(format!(
            "(sleep 1; echo late > '{}') > /dev/null 2>&1 & echo done",
            marker.display()
        ));
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(20), true);
        let written = marker.exists();
        std::fs::remove_dir_all(&dir).ok();
        assert!(!run.timed_out);
        assert_eq!(run.captured.stdout.trim(), "done");
        assert!(
            written,
            "the run returned before its background work finished"
        );
    }

    #[cfg(unix)]
    #[test]
    fn leftovers_still_running_at_the_deadline_are_stopped_and_count_as_a_timeout() {
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("sleep 30 > /dev/null 2>&1 & echo $!");
        let started = Instant::now();
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1), true);
        assert!(run.timed_out);
        assert!(started.elapsed() < Duration::from_secs(10));
        let background: libc::pid_t = run.captured.stdout.trim().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut alive = true;
        while alive && Instant::now() < deadline {
            alive = unsafe { libc::kill(background, 0) } == 0;
            if alive {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        if alive {
            unsafe {
                libc::kill(background, libc::SIGKILL);
            }
        }
        assert!(!alive, "the leftover process outlived the deadline");
    }

    #[cfg(unix)]
    #[test]
    fn a_background_process_holding_the_pipes_does_not_hold_up_the_capture() {
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("sleep 30 & echo $!; echo done");
        let started = Instant::now();
        let child = spawn_tree(command).unwrap();
        let run = run_tree(child, "", Duration::from_secs(60), false);
        assert!(!run.timed_out);
        let captured = run.captured;
        let elapsed = started.elapsed();
        let mut lines = captured.stdout.lines();
        let background: libc::pid_t = lines.next().unwrap().trim().parse().unwrap();
        unsafe {
            libc::kill(background, libc::SIGKILL);
        }
        assert_eq!(lines.next(), Some("done"));
        assert_eq!(captured.status, 0);
        assert!(elapsed < Duration::from_secs(10), "waited {elapsed:?}");
    }
}
