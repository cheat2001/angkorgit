use std::path::{Path, PathBuf};

use git2::{
    BranchType, Repository, StatusOptions, WorktreeAddOptions, WorktreeLockStatus,
    WorktreePruneOptions,
};

use crate::error::{AppError, AppResult};

use super::types::{WorktreeAddRequest, WorktreeInfo};

fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn clean_string(path: &Path) -> String {
    path.to_string_lossy().trim_end_matches('/').to_string()
}

pub fn open_main(path: &str) -> AppResult<Repository> {
    let repo = super::repo::open(path)?;
    if repo.is_worktree() {
        Ok(Repository::open(repo.commondir())?)
    } else {
        Ok(repo)
    }
}

pub fn main_workdir(repo: &Repository) -> Option<String> {
    if repo.is_worktree() {
        Repository::open(repo.commondir())
            .ok()
            .and_then(|main| main.workdir().map(clean_string))
    } else {
        repo.workdir().map(clean_string)
    }
}

fn head_of(repo: &Repository) -> (Option<String>, Option<String>, bool) {
    match repo.head() {
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
        Err(_) => (None, None, false),
    }
}

fn head_from_file(head_file: &Path) -> (Option<String>, Option<String>, bool) {
    let Ok(raw) = std::fs::read_to_string(head_file) else {
        return (None, None, false);
    };
    let line = raw.trim();
    match line.strip_prefix("ref: ") {
        Some(reference) => (
            Some(
                reference
                    .strip_prefix("refs/heads/")
                    .unwrap_or(reference)
                    .to_string(),
            ),
            None,
            false,
        ),
        None if line.is_empty() => (None, None, false),
        None => (None, Some(line.to_string()), true),
    }
}

fn is_dirty(repo: &Repository) -> bool {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .exclude_submodules(true);
    repo.statuses(Some(&mut opts))
        .map(|statuses| !statuses.is_empty())
        .unwrap_or(false)
}

fn linked_names(main: &Repository) -> AppResult<Vec<String>> {
    Ok(main
        .worktrees()?
        .iter()
        .flatten()
        .map(String::from)
        .collect())
}

pub fn list(path: &str) -> AppResult<Vec<WorktreeInfo>> {
    let current = normalize(Path::new(path));
    let main = open_main(path)?;
    let main_workdir = main
        .workdir()
        .ok_or_else(|| AppError::other("bare repositories have no working tree"))?
        .to_path_buf();
    let mut result = Vec::new();

    let main_is_current = normalize(&main_workdir) == current;
    let (branch, head_oid, is_detached) = head_of(&main);
    result.push(WorktreeInfo {
        name: super::repo::repo_name(&clean_string(&main_workdir)),
        path: clean_string(&main_workdir),
        branch,
        head_oid,
        is_main: true,
        is_current: main_is_current,
        is_locked: false,
        is_detached,
        is_missing: false,
        is_dirty: if main_is_current {
            None
        } else {
            Some(is_dirty(&main))
        },
    });

    for name in linked_names(&main)? {
        let Ok(wt) = main.find_worktree(&name) else {
            continue;
        };
        let wt_path = wt.path().to_path_buf();
        let is_locked = matches!(wt.is_locked(), Ok(WorktreeLockStatus::Locked(_)));
        let is_missing = wt.validate().is_err() || !wt_path.exists();
        let is_current = !is_missing && normalize(&wt_path) == current;
        let opened = if is_missing {
            None
        } else {
            Repository::open_from_worktree(&wt).ok()
        };
        let (branch, head_oid, is_detached) = match &opened {
            Some(repo) => head_of(repo),
            None => head_from_file(&main.path().join("worktrees").join(&name).join("HEAD")),
        };
        let is_dirty = match (&opened, is_current) {
            (Some(repo), false) => Some(is_dirty(repo)),
            _ => None,
        };
        result.push(WorktreeInfo {
            name,
            path: clean_string(&wt_path),
            branch,
            head_oid,
            is_main: false,
            is_current,
            is_locked,
            is_detached,
            is_missing,
            is_dirty,
        });
    }
    Ok(result)
}

pub fn checked_out_at(main: &Repository, branch: &str) -> AppResult<Option<String>> {
    let (head, _, _) = head_of(main);
    if head.as_deref() == Some(branch) {
        return Ok(main.workdir().map(clean_string));
    }
    for name in linked_names(main)? {
        let Ok(wt) = main.find_worktree(&name) else {
            continue;
        };
        let (head, _, _) = match Repository::open_from_worktree(&wt) {
            Ok(repo) => head_of(&repo),
            Err(_) => head_from_file(&main.path().join("worktrees").join(&name).join("HEAD")),
        };
        if head.as_deref() == Some(branch) {
            return Ok(Some(clean_string(wt.path())));
        }
    }
    Ok(None)
}

pub fn checked_out_elsewhere(repo: &Repository, branch: &str) -> Option<String> {
    let main = if repo.is_worktree() {
        Repository::open(repo.commondir()).ok()?
    } else {
        Repository::open(repo.path()).ok()?
    };
    let location = checked_out_at(&main, branch).ok()??;
    let own = repo.workdir().map(normalize)?;
    if normalize(Path::new(&location)) == own {
        None
    } else {
        Some(location)
    }
}

fn sanitize_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '-' || c == '.');
    if trimmed.is_empty() {
        "worktree".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_name(main: &Repository, base: &str) -> AppResult<String> {
    let existing = linked_names(main)?;
    let base = sanitize_name(base);
    if !existing.iter().any(|n| n == &base) {
        return Ok(base);
    }
    for i in 2.. {
        let candidate = format!("{base}-{i}");
        if !existing.iter().any(|n| n == &candidate) {
            return Ok(candidate);
        }
    }
    unreachable!()
}

pub fn add(path: &str, request: &WorktreeAddRequest) -> AppResult<String> {
    let main = open_main(path)?;
    let target = PathBuf::from(request.directory.trim());
    if request.directory.trim().is_empty() {
        return Err(AppError::other("choose a folder for the new worktree"));
    }
    if target.exists() {
        return Err(AppError::other(format!(
            "{} already exists — pick a folder that does not exist yet",
            clean_string(&target)
        )));
    }
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err(AppError::other("choose a branch for the new worktree"));
    }
    if !git2::Reference::is_valid_name(&format!("refs/heads/{branch}")) {
        return Err(AppError::other(format!(
            "'{branch}' is not a valid branch name"
        )));
    }

    let local_name: String = if request.create_branch {
        if main.find_branch(branch, BranchType::Local).is_ok() {
            return Err(AppError::other(format!(
                "branch '{branch}' already exists — uncheck \"Create new branch\" to use it"
            )));
        }
        let base = request.base.as_deref().unwrap_or("HEAD");
        let commit = main.revparse_single(base)?.peel_to_commit()?;
        main.branch(branch, &commit, false)?;
        branch.to_string()
    } else if main.find_branch(branch, BranchType::Local).is_ok() {
        branch.to_string()
    } else if let Ok(remote_branch) = main.find_branch(branch, BranchType::Remote) {
        let local = branch
            .split_once('/')
            .map(|(_, rest)| rest)
            .unwrap_or(branch);
        if main.find_branch(local, BranchType::Local).is_err() {
            let commit = remote_branch.get().peel_to_commit()?;
            let mut created = main.branch(local, &commit, false)?;
            created.set_upstream(Some(branch))?;
        }
        local.to_string()
    } else {
        return Err(AppError::other(format!("branch '{branch}' does not exist")));
    };

    if let Some(location) = checked_out_at(&main, &local_name)? {
        return Err(AppError::other(format!(
            "'{local_name}' is already checked out in {location}. Open that worktree instead, or pick another branch."
        )));
    }

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let name = unique_name(
        &main,
        &target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| local_name.clone()),
    )?;
    let reference = main.find_reference(&format!("refs/heads/{local_name}"))?;
    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(&reference));
    let created = main.worktree(&name, &target, Some(&opts))?;
    Ok(clean_string(created.path()))
}

pub fn remove(path: &str, name: &str, force: bool) -> AppResult<()> {
    let main = open_main(path)?;
    let wt = main
        .find_worktree(name)
        .map_err(|_| AppError::other(format!("worktree '{name}' not found")))?;
    let is_locked = matches!(wt.is_locked(), Ok(WorktreeLockStatus::Locked(_)));
    if is_locked && !force {
        return Err(AppError::other(format!(
            "worktree '{name}' is locked — unlock it (git worktree unlock) or force the removal"
        )));
    }
    let exists = wt.path().exists();
    if exists && !force {
        let repo = Repository::open_from_worktree(&wt)?;
        if is_dirty(&repo) {
            return Err(AppError::other(format!(
                "worktree '{name}' has uncommitted changes — commit or stash them, or force the removal"
            )));
        }
    }
    let mut opts = WorktreePruneOptions::new();
    opts.valid(true).working_tree(exists).locked(force);
    wt.prune(Some(&mut opts))?;
    Ok(())
}

pub fn prune(path: &str) -> AppResult<Vec<String>> {
    let main = open_main(path)?;
    let mut pruned = Vec::new();
    for name in linked_names(&main)? {
        let Ok(wt) = main.find_worktree(&name) else {
            continue;
        };
        if wt.path().exists() {
            continue;
        }
        if matches!(wt.is_locked(), Ok(WorktreeLockStatus::Locked(_))) {
            continue;
        }
        let mut opts = WorktreePruneOptions::new();
        opts.valid(true);
        if wt.prune(Some(&mut opts)).is_ok() {
            pruned.push(name);
        }
    }
    Ok(pruned)
}

pub fn fingerprint_parts(repo: &Repository) -> Vec<String> {
    let mut parts = Vec::new();
    let main = if repo.is_worktree() {
        match Repository::open(repo.commondir()) {
            Ok(main) => main,
            Err(_) => return parts,
        }
    } else {
        match Repository::open(repo.path()) {
            Ok(main) => main,
            Err(_) => return parts,
        }
    };
    let Ok(names) = linked_names(&main) else {
        return parts;
    };
    for name in names {
        let Ok(wt) = main.find_worktree(&name) else {
            continue;
        };
        let head_file = main.path().join("worktrees").join(&name).join("HEAD");
        let (branch, oid, _) = head_from_file(&head_file);
        parts.push(format!(
            "worktree:{name}:{}:{}:{}",
            clean_string(wt.path()),
            branch.unwrap_or_default(),
            oid.unwrap_or_default()
        ));
    }
    parts
}
