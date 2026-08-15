use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalSessions {
    sessions: Mutex<HashMap<u32, PtySession>>,
    next_id: AtomicU32,
}

#[derive(Default)]
pub struct TerminalState(Arc<TerminalSessions>);

impl TerminalState {
    pub fn sessions(&self) -> Arc<TerminalSessions> {
        Arc::clone(&self.0)
    }
}

#[derive(Serialize, Clone)]
struct TermData {
    data: String,
}

fn default_shell() -> CommandBuilder {
    #[cfg(target_os = "windows")]
    {
        CommandBuilder::new("powershell.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.env("TERM", "xterm-256color");
        cmd
    }
}

pub fn create(
    app: &AppHandle,
    state: &Arc<TerminalSessions>,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> AppResult<u32> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::other(format!("failed to open pty: {e}")))?;

    let mut cmd = default_shell();
    cmd.cwd(cwd);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::other(format!("failed to spawn shell: {e}")))?;
    let killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::other(format!("failed to clone pty reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::other(format!("failed to take pty writer: {e}")))?;

    state.sessions.lock().unwrap().insert(
        id,
        PtySession {
            writer,
            master: pair.master,
            killer,
        },
    );

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&format!("term-data-{id}"), TermData { data });
                }
            }
        }
    });

    let exit_app = app.clone();
    let exit_sessions = Arc::clone(state);
    std::thread::spawn(move || {
        let _ = child.wait();
        exit_sessions.sessions.lock().unwrap().remove(&id);
        let _ = exit_app.emit(&format!("term-exit-{id}"), ());
    });

    Ok(id)
}

pub fn write(state: &TerminalSessions, id: u32, data: &str) -> AppResult<()> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| AppError::other("terminal session not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(AppError::from)?;
    session.writer.flush().ok();
    Ok(())
}

pub fn resize(state: &TerminalSessions, id: u32, cols: u16, rows: u16) -> AppResult<()> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| AppError::other("terminal session not found"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::other(format!("resize failed: {e}")))?;
    Ok(())
}

pub fn kill(state: &TerminalSessions, id: u32) -> AppResult<()> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        session.killer.kill().ok();
    }
    Ok(())
}
