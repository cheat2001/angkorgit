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
const PROCESS_EXIT_GRACE: Duration = Duration::from_secs(1);
pub(crate) const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);
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

pub(crate) struct TreeChild {
    child: Child,
    leftovers: Option<Leftovers>,
}

pub(crate) fn spawn_tree(
    mut command: Command,
    track_descendants: bool,
) -> std::io::Result<TreeChild> {
    #[cfg(not(any(unix, windows)))]
    let _ = track_descendants;
    #[cfg(windows)]
    if track_descendants {
        let job = job::Job::new()?;
        let child = job::spawn_assigned(command, |child| job.assign(child))?;
        return Ok(TreeChild {
            child,
            leftovers: Some(Leftovers { job }),
        });
    }
    own_process_group(&mut command);
    let child = spawn_piped(command)?;
    #[cfg(unix)]
    let leftovers = if track_descendants {
        Some(Leftovers {
            #[cfg(target_os = "linux")]
            group: ProcessGroup::open(&child),
        })
    } else {
        None
    };
    #[cfg(not(unix))]
    let leftovers = None;
    Ok(TreeChild { child, leftovers })
}

pub(crate) fn capture_child(child: Child, stdin: &str, timeout: Duration) -> AppResult<Captured> {
    collect(child, stdin, timeout, false)
}

pub(crate) struct TreeRun {
    pub(crate) captured: Captured,
    pub(crate) timed_out: bool,
    pub(crate) exit_unconfirmed: bool,
    pub(crate) background: Option<BackgroundProcesses>,
}

pub(crate) fn run_tree(tree: TreeChild, stdin: &str, timeout: Duration) -> TreeRun {
    gather(tree.child, stdin, timeout, true, tree.leftovers)
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
fn kill_group(id: u32) {
    if let Ok(group) = libc::pid_t::try_from(id) {
        unsafe {
            libc::killpg(group, libc::SIGKILL);
        }
    }
}

#[cfg(unix)]
fn kill_tree(child: &mut Child) {
    kill_group(child.id());
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

#[cfg(target_os = "linux")]
struct ProcessGroup(std::os::fd::OwnedFd);

#[cfg(target_os = "linux")]
impl ProcessGroup {
    fn open(child: &Child) -> Option<Self> {
        use std::os::fd::{FromRawFd, OwnedFd, RawFd};

        let pid = libc::pid_t::try_from(child.id()).ok()?;
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0u32) };
        if fd < 0 {
            return None;
        }
        let group = Self(unsafe { OwnedFd::from_raw_fd(fd as RawFd) });
        group.signal(0).then_some(group)
    }

    fn signal(&self, signal: libc::c_int) -> bool {
        use std::os::fd::AsRawFd;

        unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.0.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                libc::PIDFD_SIGNAL_PROCESS_GROUP,
            ) == 0
        }
    }
}

struct Leftovers {
    #[cfg(target_os = "linux")]
    group: Option<ProcessGroup>,
    #[cfg(windows)]
    job: job::Job,
}

pub(crate) struct BackgroundProcesses {
    leftovers: Option<Leftovers>,
    deadline: Instant,
    stop_deadline: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CancelOutcome {
    Unconfirmed,
    TimedOut { confirmed: bool },
}

pub(crate) enum CancelPoll<T> {
    Waiting(Instant),
    Finished(Option<T>),
}

impl BackgroundProcesses {
    #[cfg(test)]
    pub(crate) fn is_tracking(&self) -> bool {
        self.leftovers.is_some()
    }

    pub(crate) fn retain_for_cancel(&mut self) -> bool {
        if self
            .leftovers
            .as_ref()
            .is_some_and(|group| !group.running())
        {
            self.leftovers = None;
        }
        cfg!(unix) || self.leftovers.is_some()
    }

    pub(crate) fn poll_on_cancel(&mut self) -> CancelPoll<CancelOutcome> {
        let unconfirmed = || CancelPoll::Finished(cfg!(unix).then_some(CancelOutcome::Unconfirmed));
        let Some(leftovers) = &self.leftovers else {
            return unconfirmed();
        };
        let running = leftovers.running();
        let now = Instant::now();
        if let Some(deadline) = self.stop_deadline {
            if running && now < deadline {
                return CancelPoll::Waiting(deadline);
            }
            return CancelPoll::Finished(Some(CancelOutcome::TimedOut {
                confirmed: cfg!(windows) && !running,
            }));
        }
        if !running {
            return unconfirmed();
        }
        if now < self.deadline {
            return CancelPoll::Waiting(self.deadline);
        }
        let grace = if leftovers.request_stop() {
            PROCESS_EXIT_GRACE
        } else {
            Duration::ZERO
        };
        let deadline = Instant::now() + grace;
        self.stop_deadline = Some(deadline);
        CancelPoll::Waiting(deadline)
    }

    #[cfg(test)]
    fn wait_on_cancel(mut self) -> Option<CancelOutcome> {
        loop {
            match self.poll_on_cancel() {
                CancelPoll::Waiting(deadline) => std::thread::sleep(
                    deadline
                        .saturating_duration_since(Instant::now())
                        .min(PROCESS_POLL_INTERVAL),
                ),
                CancelPoll::Finished(outcome) => return outcome,
            }
        }
    }
}

impl Leftovers {
    fn running(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            self.group.as_ref().is_some_and(|group| group.signal(0))
        }
        #[cfg(windows)]
        {
            self.job.running()
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            false
        }
    }

    fn stop(self, child: &mut Child) -> bool {
        #[cfg(unix)]
        {
            kill_tree(child);
            let _ = wait_for_process_exit(PROCESS_EXIT_GRACE, || {
                Some(child.try_wait().ok()?.is_some() && !self.running())
            });
            false
        }
        #[cfg(not(unix))]
        let _ = child;
        #[cfg(windows)]
        {
            self.job.stop()
        }
        #[cfg(not(any(unix, windows)))]
        {
            true
        }
    }

    fn request_stop(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            self.group
                .as_ref()
                .is_some_and(|group| group.signal(libc::SIGKILL))
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            false
        }
        #[cfg(windows)]
        {
            self.job.terminate()
        }
    }
}

#[cfg(any(unix, windows, test))]
fn wait_for_process_exit(timeout: Duration, mut exited: impl FnMut() -> Option<bool>) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match exited() {
            Some(true) => return true,
            None => return false,
            Some(false) => {}
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        std::thread::sleep(remaining.min(PROCESS_POLL_INTERVAL));
    }
}

#[cfg(windows)]
mod job {
    use std::io;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};

    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
        QueryInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    };
    use windows_sys::Win32::System::Threading::{
        OpenThread, ResumeThread, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
    };

    pub(super) struct Job(OwnedHandle);

    impl Job {
        pub(super) fn new() -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(windows_error("could not create the hook job"));
            }
            Ok(Job(unsafe { OwnedHandle::from_raw_handle(handle) }))
        }

        pub(super) fn assign(&self, child: &Child) -> io::Result<()> {
            if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) }
                == 0
            {
                return Err(windows_error(
                    "could not assign the suspended process to the hook job",
                ));
            }
            Ok(())
        }

        pub(super) fn running(&self) -> bool {
            self.active_processes() != Some(0)
        }

        fn active_processes(&self) -> Option<u32> {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let queried = unsafe {
                QueryInformationJobObject(
                    self.0.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    std::ptr::addr_of_mut!(info).cast(),
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                )
            };
            (queried != 0).then_some(info.ActiveProcesses)
        }

        pub(super) fn terminate(&self) -> bool {
            unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) != 0 }
        }

        pub(super) fn stop(self) -> bool {
            if !self.terminate() {
                return self.active_processes() == Some(0);
            }
            super::wait_for_process_exit(super::PROCESS_EXIT_GRACE, || {
                self.active_processes().map(|count| count == 0)
            })
        }
    }

    pub(super) fn spawn_assigned(
        mut command: Command,
        assign: impl FnOnce(&Child) -> io::Result<()>,
    ) -> io::Result<Child> {
        command.creation_flags(crate::proc::CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = super::spawn_piped(command)?;
        if let Err(error) = assign(&child).and_then(|()| resume_primary_thread(child.id())) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(child)
    }

    fn resume_primary_thread(process_id: u32) -> io::Result<()> {
        let thread = primary_thread(process_id)?;
        match unsafe { ResumeThread(thread.as_raw_handle()) } {
            1 => Ok(()),
            u32::MAX => Err(windows_error("could not resume the hook thread")),
            _ => Err(io::Error::other("unexpected hook thread suspend count")),
        }
    }

    fn primary_thread(process_id: u32) -> io::Result<OwnedHandle> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(windows_error("could not find the suspended hook thread"));
        }
        let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot) };
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut found = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) };
        while found != 0 {
            if entry.th32OwnerProcessID == process_id {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err(windows_error("could not open the suspended hook thread"));
                }
                return Ok(unsafe { OwnedHandle::from_raw_handle(thread) });
            }
            found = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) };
        }
        Err(windows_error("could not find the suspended hook thread"))
    }

    fn windows_error(action: &str) -> io::Error {
        io::Error::other(format!("{action}: {}", io::Error::last_os_error()))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::System::Threading::SuspendThread;

        #[test]
        fn hook_is_still_suspended_if_assignment_fails() {
            let mut command = crate::proc::hidden("cmd");
            command.args(["/C", "pause"]);
            let mut previous_suspend_count = 0;
            let error = spawn_assigned(command, |child| {
                let thread = primary_thread(child.id())?;
                previous_suspend_count = unsafe { SuspendThread(thread.as_raw_handle()) };
                Err(io::Error::other("assignment refused"))
            })
            .unwrap_err();
            assert_eq!(error.to_string(), "assignment refused");
            assert_eq!(previous_suspend_count, 1);
        }
    }
}

fn collect(child: Child, stdin: &str, timeout: Duration, whole_tree: bool) -> AppResult<Captured> {
    let run = gather(child, stdin, timeout, whole_tree, None);
    if run.timed_out {
        return Err(timed_out(timeout));
    }
    Ok(run.captured)
}

fn gather(
    mut child: Child,
    stdin: &str,
    timeout: Duration,
    whole_tree: bool,
    mut leftovers: Option<Leftovers>,
) -> TreeRun {
    let deadline = Instant::now() + timeout;
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
    let mut exit_unconfirmed = false;
    let status = match wait_with_timeout(&mut child, timeout) {
        Some(status) => status,
        None => {
            expired = true;
            if let Some(leftovers) = leftovers.take() {
                exit_unconfirmed = !leftovers.stop(&mut child);
            } else {
                if whole_tree {
                    kill_tree(&mut child);
                    exit_unconfirmed = true;
                } else {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
            -1
        }
    };
    let drain_until = Instant::now() + OUTPUT_DRAIN;
    while !(stdout_thread.is_finished() && stderr_thread.is_finished())
        && Instant::now() < drain_until
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(stdin_thread);
    #[cfg(unix)]
    if exit_unconfirmed && !matches!(child.try_wait(), Ok(Some(_))) {
        let _ = std::thread::Builder::new().spawn(move || {
            let _ = child.wait();
        });
    }
    let captured = Captured {
        status,
        stdout: take_output(&stdout),
        stderr: take_output(&stderr),
    };
    TreeRun {
        captured,
        timed_out: expired,
        exit_unconfirmed,
        background: leftovers.and_then(|leftovers| {
            let mut background = BackgroundProcesses {
                leftovers: Some(leftovers),
                deadline,
                stop_deadline: None,
            };
            background.retain_for_cancel().then_some(background)
        }),
    }
}

type SharedOutput = std::sync::Arc<std::sync::Mutex<Option<Vec<u8>>>>;

fn read_pipe<R: Read + Send + 'static>(
    pipe: Option<R>,
) -> (SharedOutput, std::thread::JoinHandle<()>) {
    let output = SharedOutput::new(std::sync::Mutex::new(Some(Vec::new())));
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
                    if let Ok(mut output) = sink.lock() {
                        if let Some(buffer) = output.as_mut() {
                            buffer.extend_from_slice(&chunk[..read]);
                        }
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
        .ok()
        .and_then(|mut buffer| buffer.take())
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
        let child = spawn_tree(command, false).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1));
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
    fn cancellation_waits_for_a_windows_background_child() {
        let mut command = crate::proc::hidden("cmd");
        command.args(["/C", "start", "", "/B", "ping", "-n", "3", "127.0.0.1"]);
        let started = Instant::now();
        let child = spawn_tree(command, true).unwrap();
        let run = run_tree(child, "", Duration::from_secs(30));
        assert!(!run.timed_out);
        assert_eq!(run.background.unwrap().wait_on_cancel(), None);
        assert!(
            started.elapsed() >= Duration::from_millis(1500),
            "returned after {:?}, before the background ping finished",
            started.elapsed()
        );
    }

    #[test]
    fn process_cleanup_stops_polling_at_the_deadline_without_confirming_exit() {
        let mut states = [Some(false), Some(false), Some(true)].into_iter();
        let poll = || states.next().flatten();
        assert!(!wait_for_process_exit(Duration::from_millis(5), poll));
        assert!(wait_for_process_exit(Duration::ZERO, || Some(true)));
        assert!(!wait_for_process_exit(Duration::ZERO, || None));
    }

    #[cfg(windows)]
    #[test]
    fn cancellation_stops_a_windows_background_child_at_the_deadline() {
        let mut command = crate::proc::hidden("cmd");
        command.args(["/C", "start", "", "/B", "ping", "-n", "30", "127.0.0.1"]);
        let started = Instant::now();
        let child = spawn_tree(command, true).unwrap();
        let run = run_tree(child, "", Duration::from_secs(2));
        assert!(!run.timed_out);
        assert_eq!(
            run.background.unwrap().wait_on_cancel(),
            Some(CancelOutcome::TimedOut { confirmed: true })
        );
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[cfg(unix)]
    #[test]
    fn a_timed_out_group_hook_cannot_confirm_descendant_exit_after_reaping_its_direct_child() {
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("echo started; exec sleep 30");
        let child = spawn_tree(command, true).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1));
        assert!(run.timed_out);
        assert!(run.exit_unconfirmed);
        assert_eq!(run.captured.stdout.trim(), "started");
    }

    #[cfg(unix)]
    #[test]
    fn a_timed_out_tree_run_keeps_the_output_it_printed_before() {
        let mut command = crate::proc::hidden("/bin/sh");
        command
            .arg("-c")
            .arg("echo started; echo warming up >&2; sleep 30");
        let child = spawn_tree(command, false).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1));
        assert!(run.timed_out);
        assert!(run.exit_unconfirmed);
        assert_eq!(run.captured.stdout.trim(), "started");
        assert_eq!(run.captured.stderr.trim(), "warming up");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn hook_timeouts_cannot_confirm_a_detached_child_exited() {
        for track_descendants in [false, true] {
            assert_detached_child_exit_unconfirmed(track_descendants);
        }
    }

    #[cfg(target_os = "linux")]
    fn assert_detached_child_exit_unconfirmed(track_descendants: bool) {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("child-pid");
        let mut command = crate::proc::hidden("/bin/sh");
        command
            .arg("-c")
            .arg("setsid sleep 30 > /dev/null 2>&1 & echo $! > \"$1\"; wait")
            .arg("hook")
            .arg(&pid_file);
        let child = spawn_tree(command, track_descendants).unwrap();
        let run = run_tree(child, "", Duration::from_secs(3));
        let detached: libc::pid_t = std::fs::read_to_string(pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let alive = unsafe { libc::kill(detached, 0) == 0 };
        if alive {
            unsafe { libc::kill(detached, libc::SIGKILL) };
        }
        assert!(
            alive,
            "the fixture child should outlive its original process group"
        );
        assert!(run.timed_out);
        assert!(run.exit_unconfirmed);
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_waits_for_background_work_to_finish() {
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
        let child = spawn_tree(command, true).unwrap();
        let run = run_tree(child, "", Duration::from_secs(20));
        assert!(!marker.exists());
        let background = run.background.unwrap();
        let tracks_group = background.is_tracking();
        assert_eq!(
            background.wait_on_cancel(),
            Some(CancelOutcome::Unconfirmed)
        );
        let written = marker.exists();
        std::fs::remove_dir_all(&dir).ok();
        assert!(!run.timed_out);
        assert_eq!(run.captured.stdout.trim(), "done");
        assert!(
            !tracks_group || written,
            "the run returned before its background work finished"
        );
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_stops_verified_background_work_at_the_deadline() {
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("sleep 30 > /dev/null 2>&1 & echo $!");
        let started = Instant::now();
        let child = spawn_tree(command, true).unwrap();
        let run = run_tree(child, "", Duration::from_secs(1));
        assert!(!run.timed_out);
        let background: libc::pid_t = run.captured.stdout.trim().parse().unwrap();
        let processes = run.background.unwrap();
        let tracks_group = processes.is_tracking();
        let outcome = processes.wait_on_cancel();
        if !tracks_group {
            unsafe { libc::kill(background, libc::SIGKILL) };
            assert_eq!(outcome, Some(CancelOutcome::Unconfirmed));
            return;
        }
        assert_eq!(outcome, Some(CancelOutcome::TimedOut { confirmed: false }));
        assert!(started.elapsed() < Duration::from_secs(10));
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

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "run the test binary in a private PID namespace as PID 1"]
    fn cancellation_does_not_signal_a_reused_process_group() {
        assert_eq!(std::process::id(), 1);
        assert_eq!(std::fs::read_link("/proc/self").unwrap(), Path::new("1"));

        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("sleep 30 > /dev/null 2>&1 & echo $!");
        let original = spawn_tree(command, true).unwrap();
        let group = original.child.id();
        let run = run_tree(original, "", Duration::from_secs(1));
        assert!(!run.timed_out);
        let orphan: libc::pid_t = run.captured.stdout.trim().parse().unwrap();
        assert_eq!(unsafe { libc::kill(orphan, libc::SIGKILL) }, 0);
        assert_eq!(
            unsafe { libc::waitpid(orphan, std::ptr::null_mut(), 0) },
            orphan
        );

        std::fs::write("/proc/sys/kernel/ns_last_pid", (group - 1).to_string()).unwrap();
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("exec sleep 30");
        let mut unrelated = spawn_tree(command, false).unwrap();
        assert_eq!(unrelated.child.id(), group);
        let outcome = run.background.unwrap().wait_on_cancel();
        let survived = unrelated.child.try_wait().unwrap().is_none();
        if survived {
            unrelated.child.kill().unwrap();
        }
        unrelated.child.wait().unwrap();

        assert!(survived, "Cancel killed the unrelated process group");
        assert_eq!(outcome, Some(CancelOutcome::Unconfirmed));
    }

    #[cfg(unix)]
    #[test]
    fn a_background_process_holding_the_pipes_does_not_hold_up_the_capture() {
        let mut command = crate::proc::hidden("/bin/sh");
        command.arg("-c").arg("sleep 30 & echo $!; echo done");
        let started = Instant::now();
        let child = spawn_tree(command, false).unwrap();
        let run = run_tree(child, "", Duration::from_secs(60));
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
