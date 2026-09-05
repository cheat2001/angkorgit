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

fn git_metadata_relevant(rest: &Path) -> bool {
    let rest = rest.to_string_lossy();
    if rest.is_empty() || rest.ends_with(".lock") {
        return false;
    }
    rest == "HEAD"
        || rest == "index"
        || rest.starts_with("refs")
        || rest.ends_with("_HEAD")
        || rest == "packed-refs"
        || (rest.starts_with("worktrees/")
            && (rest.ends_with("/HEAD") || rest.ends_with("/gitdir") || rest.ends_with("/locked")))
}

fn relevant(path: &Path, root: &Path, gitdirs: &[PathBuf], repo: Option<&Repository>) -> bool {
    for gitdir in gitdirs {
        if let Ok(rest) = path.strip_prefix(gitdir) {
            return git_metadata_relevant(rest);
        }
    }
    let rel = match path.strip_prefix(root) {
        Ok(rel) => rel,
        Err(_) => return true,
    };
    let first = rel
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("");
    if first == ".git" {
        let rest: PathBuf = rel.components().skip(1).collect();
        return git_metadata_relevant(&rest);
    }
    match repo {
        Some(repo) => !repo.is_path_ignored(rel).unwrap_or(false),
        None => true,
    }
}

fn trim_trailing_separator(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().trim_end_matches('/'))
}

fn git_directories(root: &Path) -> Vec<PathBuf> {
    let Ok(repo) = Repository::open(root) else {
        return vec![root.join(".git")];
    };
    let mut dirs = vec![trim_trailing_separator(repo.path())];
    if repo.is_worktree() {
        dirs.push(trim_trailing_separator(repo.commondir()));
    }
    dirs
}

fn extra_watch_roots(root: &Path, gitdirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for dir in gitdirs {
        if dir.starts_with(root) {
            continue;
        }
        if roots.iter().any(|r| dir.starts_with(r)) {
            continue;
        }
        roots.retain(|r| !r.starts_with(dir));
        roots.push(dir.clone());
    }
    roots
}

pub fn watch(app: &AppHandle, slot: &WatcherSlot, path: &str) -> AppResult<()> {
    let root = PathBuf::from(path);
    let emitter = app.clone();
    let filter_root = root.clone();
    let gitdirs = git_directories(&root);
    let filter_gitdirs = gitdirs.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                let repo = Repository::open(&filter_root).ok();
                if events
                    .iter()
                    .any(|e| relevant(&e.path, &filter_root, &filter_gitdirs, repo.as_ref()))
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
    for extra in extra_watch_roots(&root, &gitdirs) {
        let _ = debouncer.watcher().watch(&extra, RecursiveMode::Recursive);
    }

    *slot.lock().unwrap() = Some(debouncer);
    Ok(())
}

pub fn stop(slot: &WatcherSlot) {
    *slot.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_repo_metadata_filter_matches_previous_behaviour() {
        let root = Path::new("/repo");
        let gitdirs = vec![PathBuf::from("/repo/.git")];
        assert!(relevant(Path::new("/repo/.git/HEAD"), root, &gitdirs, None));
        assert!(relevant(
            Path::new("/repo/.git/refs/heads/main"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(
            Path::new("/repo/.git/packed-refs"),
            root,
            &gitdirs,
            None
        ));
        assert!(!relevant(
            Path::new("/repo/.git/index.lock"),
            root,
            &gitdirs,
            None
        ));
        assert!(!relevant(
            Path::new("/repo/.git/objects/ab/cd"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(
            Path::new("/repo/src/main.rs"),
            root,
            &gitdirs,
            None
        ));
    }

    #[test]
    fn linked_worktree_heads_and_registrations_are_relevant_to_the_main_repo() {
        let root = Path::new("/repo");
        let gitdirs = vec![PathBuf::from("/repo/.git")];
        assert!(relevant(
            Path::new("/repo/.git/worktrees/x/HEAD"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(
            Path::new("/repo/.git/worktrees/x/gitdir"),
            root,
            &gitdirs,
            None
        ));
        assert!(!relevant(
            Path::new("/repo/.git/worktrees/x/index"),
            root,
            &gitdirs,
            None
        ));
    }

    #[test]
    fn worktree_watches_its_own_gitdir_and_the_shared_refs() {
        let root = Path::new("/wt");
        let gitdirs = vec![
            PathBuf::from("/repo/.git/worktrees/wt"),
            PathBuf::from("/repo/.git"),
        ];
        assert!(relevant(
            Path::new("/repo/.git/worktrees/wt/index"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(
            Path::new("/repo/.git/worktrees/wt/HEAD"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(
            Path::new("/repo/.git/refs/heads/main"),
            root,
            &gitdirs,
            None
        ));
        assert!(!relevant(
            Path::new("/repo/.git/objects/ab/cd"),
            root,
            &gitdirs,
            None
        ));
        assert!(relevant(Path::new("/wt/src/lib.rs"), root, &gitdirs, None));
        assert_eq!(
            extra_watch_roots(root, &gitdirs),
            vec![PathBuf::from("/repo/.git")]
        );
    }

    #[test]
    fn main_repo_needs_no_extra_watch_roots() {
        let root = Path::new("/repo");
        let gitdirs = vec![PathBuf::from("/repo/.git")];
        assert!(extra_watch_roots(root, &gitdirs).is_empty());
    }
}
