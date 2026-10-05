use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppResult;

use super::repo::{repo_name, root_path};
use super::types::{RepositoryScan, ScannedRepository};

pub const SCAN_MAX_DEPTH: usize = 16;
pub const SCAN_MAX_RESULTS: usize = 2000;

const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    "obj",
    "venv",
    "Pods",
    "Library",
    "bower_components",
    "__pycache__",
];

fn skipped(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.contains(&name)
}

fn repository_at(dir: &Path) -> Option<ScannedRepository> {
    if !dir.join(".git").exists() {
        return None;
    }
    let repo = Repository::open(dir).ok()?;
    let path = root_path(&repo);
    Some(ScannedRepository {
        name: repo_name(&path),
        is_worktree: repo.is_worktree(),
        path,
    })
}

pub fn scan(root: &str, max_depth: usize) -> AppResult<RepositoryScan> {
    let start = PathBuf::from(root);
    if !start.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("{root}: no such folder"),
        )
        .into());
    }
    let mut repositories = Vec::new();
    let mut seen = HashSet::new();
    let mut truncated = false;
    let mut queue = VecDeque::from([(start, 0usize)]);
    while let Some((dir, depth)) = queue.pop_front() {
        if let Some(found) = repository_at(&dir) {
            if seen.insert(found.path.clone()) {
                if repositories.len() == SCAN_MAX_RESULTS {
                    truncated = true;
                    break;
                }
                repositories.push(found);
            }
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter(|entry| !skipped(&entry.file_name().to_string_lossy()))
            .map(|entry| entry.path())
            .collect();
        children.sort();
        queue.extend(children.into_iter().map(|child| (child, depth + 1)));
    }
    repositories.sort_by_key(|r| r.path.to_lowercase());
    Ok(RepositoryScan {
        repositories,
        truncated,
    })
}
