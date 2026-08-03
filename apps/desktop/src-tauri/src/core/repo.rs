use std::path::Path;

use git2::{Repository, RepositoryState, StatusOptions};

use crate::error::{AppError, AppResult};

use super::types::{FileStatus, RepositoryInfo, StatusSummary};

pub fn open(path: &str) -> AppResult<Repository> {
    Ok(Repository::open(path)?)
}

/// Discover a repository from any path inside a working tree.
pub fn discover(path: &str) -> AppResult<String> {
    let repo = Repository::discover(path)?;
    let root = repo
        .workdir()
        .unwrap_or_else(|| repo.path())
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();
    Ok(root)
}

pub fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn state_name(state: RepositoryState) -> &'static str {
    match state {
        RepositoryState::Merge => "merge",
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => "rebase",
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherrypick",
        RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
        RepositoryState::Bisect => "bisect",
        _ => "clean",
    }
}

pub fn info(path: &str) -> AppResult<RepositoryInfo> {
    let repo = open(path)?;
    let (head_branch, head_oid, is_detached) = match repo.head() {
        Ok(head) => {
            let oid = head.target().map(|o| o.to_string());
            let detached = repo.head_detached().unwrap_or(false);
            let branch = if detached {
                None
            } else {
                head.shorthand().map(String::from)
            };
            (branch, oid, detached)
        }
        Err(_) => (None, None, false), // unborn HEAD (fresh repo)
    };
    Ok(RepositoryInfo {
        path: path.to_string(),
        name: repo_name(path),
        head_branch,
        head_oid,
        is_detached,
        is_bare: repo.is_bare(),
        state: state_name(repo.state()).to_string(),
    })
}

fn status_kind(status: git2::Status, staged: bool) -> Option<String> {
    let kind = if staged {
        if status.is_index_new() {
            "new"
        } else if status.is_index_modified() {
            "modified"
        } else if status.is_index_deleted() {
            "deleted"
        } else if status.is_index_renamed() {
            "renamed"
        } else if status.is_index_typechange() {
            "typechange"
        } else {
            return None;
        }
    } else {
        if status.is_conflicted() {
            "conflicted"
        } else if status.is_wt_new() {
            "untracked"
        } else if status.is_wt_modified() {
            "modified"
        } else if status.is_wt_deleted() {
            "deleted"
        } else if status.is_wt_renamed() {
            "renamed"
        } else if status.is_wt_typechange() {
            "typechange"
        } else {
            return None;
        }
    };
    Some(kind.to_string())
}

pub fn status(path: &str) -> AppResult<StatusSummary> {
    let repo = open(path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry
            .index_to_workdir()
            .and_then(|d| d.new_file().path())
            .or_else(|| entry.head_to_index().and_then(|d| d.new_file().path()))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| entry.path().unwrap_or_default().to_string());
        let orig_path = entry
            .head_to_index()
            .and_then(|d| d.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .filter(|old| *old != path);
        files.push(FileStatus {
            path,
            orig_path,
            staged: status_kind(s, true),
            unstaged: status_kind(s, false),
        });
    }

    let (branch, ahead, behind) = upstream_divergence(&repo);
    Ok(StatusSummary {
        files,
        branch,
        ahead,
        behind,
    })
}

pub fn upstream_divergence(repo: &Repository) -> (Option<String>, usize, usize) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (None, 0, 0),
    };
    let branch_name = head.shorthand().map(String::from);
    let local_oid = match head.target() {
        Some(o) => o,
        None => return (branch_name, 0, 0),
    };
    let upstream_oid = head
        .shorthand()
        .and_then(|name| repo.find_branch(name, git2::BranchType::Local).ok())
        .and_then(|b| b.upstream().ok())
        .and_then(|u| u.get().target());
    match upstream_oid {
        Some(up) => {
            let (ahead, behind) = repo.graph_ahead_behind(local_oid, up).unwrap_or((0, 0));
            (branch_name, ahead, behind)
        }
        None => (branch_name, 0, 0),
    }
}

pub fn init(path: &str) -> AppResult<RepositoryInfo> {
    Repository::init(path)?;
    info(path)
}

// ---- git config ------------------------------------------------------------

pub fn get_config(repo_path: Option<&str>, key: &str) -> AppResult<Option<String>> {
    let config = match repo_path {
        Some(p) => open(p)?.config()?,
        None => git2::Config::open_default()?,
    };
    match config.get_string(key) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set_config(repo_path: Option<&str>, key: &str, value: &str, global: bool) -> AppResult<()> {
    let mut config = match (global, repo_path) {
        (false, Some(path)) => open(path)?.config()?,
        _ => git2::Config::open_default()?
            .open_level(git2::ConfigLevel::Global)
            .map_err(AppError::from)?,
    };
    config.set_str(key, value)?;
    Ok(())
}
