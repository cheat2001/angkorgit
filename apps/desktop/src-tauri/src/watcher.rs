use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use git2::Repository;
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub type WatcherSlot = Mutex<Option<Debouncer<RecommendedWatcher>>>;

#[derive(Default)]
pub struct WatcherState(Arc<WatcherSlot>);

impl WatcherState {
    pub fn slot(&self) -> Arc<WatcherSlot> {
        Arc::clone(&self.0)
    }
}

fn relevant(path: &Path, root: &Path, repo: Option<&Repository>) -> bool {
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
        return match repo {
            Some(repo) => !repo.is_path_ignored(rel).unwrap_or(false),
            None => true,
        };
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

pub fn watch(app: &AppHandle, slot: &WatcherSlot, path: &str) -> AppResult<()> {
    let root = PathBuf::from(path);
    let emitter = app.clone();
    let filter_root = root.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                let repo = Repository::open(&filter_root).ok();
                if events
                    .iter()
                    .any(|e| relevant(&e.path, &filter_root, repo.as_ref()))
                {
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

    *slot.lock().unwrap() = Some(debouncer);
    Ok(())
}

pub fn stop(slot: &WatcherSlot) {
    *slot.lock().unwrap() = None;
}
