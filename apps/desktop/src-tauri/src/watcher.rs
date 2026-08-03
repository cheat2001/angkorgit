//! Filesystem watcher: keeps the UI live while the user edits in another
//! tool. Watches the open repository recursively, debounces event bursts
//! (builds, branch switches) and emits a single `repo-changed` event the
//! frontend uses to refresh status — no manual reload needed.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// Workdir changes always matter. Inside `.git`, only ref/HEAD/index
/// movements do — object writes and lock files would cause refresh storms.
fn relevant(path: &Path, root: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(rel) => rel,
        Err(_) => return true,
    };
    let mut components = rel.components();
    let first = components
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("");
    if first != ".git" {
        return true;
    }
    let rest: PathBuf = components.collect();
    let rest = rest.to_string_lossy();
    if rest.ends_with(".lock") {
        return false;
    }
    rest == "HEAD"
        || rest == "index"
        || rest.starts_with("refs")
        || rest.ends_with("_HEAD")
        || rest == "packed-refs"
}

pub fn watch(app: &AppHandle, state: &WatcherState, path: &str) -> AppResult<()> {
    let root = PathBuf::from(path);
    let emitter = app.clone();
    let filter_root = root.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                if events.iter().any(|e| relevant(&e.path, &filter_root)) {
                    let _ = emitter.emit("repo-changed", ());
                }
            }
        },
    )
    .map_err(|e| AppError::other(format!("could not create watcher: {e}")))?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::other(format!("could not watch {path}: {e}")))?;

    // Replacing the previous watcher drops (and stops) it.
    *state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

pub fn stop(state: &WatcherState) {
    *state.0.lock().unwrap() = None;
}
