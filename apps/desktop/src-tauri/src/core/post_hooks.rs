use std::path::Path;

use git2::Oid;

use super::hooks::{run_post, PostHook, PostHooks};
use super::types::{CommitOutcome, HookWarning, OpOutcome, RebaseTodoEntry, WorktreeAddRequest};
use super::{branch, commit, misc, remote, stage, submodule, worktree};
use crate::error::AppResult;

pub struct Hooked<T> {
    pub value: T,
    pub warnings: Vec<HookWarning>,
}

impl<T> Hooked<T> {
    fn plain(value: T) -> Self {
        Hooked {
            value,
            warnings: Vec::new(),
        }
    }
}

impl<T> Hooked<AppResult<T>> {
    pub fn into_result(self) -> AppResult<Hooked<T>> {
        let warnings = self.warnings;
        self.value.map(|value| Hooked { value, warnings })
    }
}

fn ran<T>(path: &str, value: T, hooks: &[PostHook], no_verify: bool) -> Hooked<T> {
    let warnings = match super::repo::open(path) {
        Ok(repo) if !hooks.is_empty() => run_post(&repo, hooks, no_verify),
        _ => Vec::new(),
    };
    Hooked { value, warnings }
}

fn finished<T>(path: &str, value: T, hooks: PostHooks) -> Hooked<T> {
    let repo = super::repo::open(path).ok();
    Hooked {
        value,
        warnings: hooks.finish(repo.as_ref()),
    }
}

fn finished_or_failed<T>(
    path: &str,
    result: AppResult<T>,
    hooks: PostHooks,
) -> Hooked<AppResult<T>> {
    match result {
        Ok(value) => {
            let done = finished(path, value, hooks);
            Hooked {
                value: Ok(done.value),
                warnings: done.warnings,
            }
        }
        Err(error) => Hooked {
            value: Err(error),
            warnings: hooks.abandon(),
        },
    }
}

fn head_oid(path: &str) -> Oid {
    super::repo::open(path)
        .ok()
        .and_then(|repo| repo.head().ok().and_then(|head| head.target()))
        .unwrap_or_else(Oid::zero)
}

fn switched<T>(
    path: &str,
    no_verify: bool,
    op: impl FnOnce() -> AppResult<T>,
) -> AppResult<Hooked<T>> {
    let previous = head_oid(path);
    let value = submodule::synced(path, op)?;
    let checkout = PostHook::Checkout {
        previous,
        new: head_oid(path),
        branch: true,
    };
    Ok(ran(path, value, &[checkout], no_verify))
}

fn restored<T>(path: &str, value: T, no_verify: bool) -> Hooked<T> {
    let head = head_oid(path);
    let checkout = PostHook::Checkout {
        previous: head,
        new: head,
        branch: false,
    };
    ran(path, value, &[checkout], no_verify)
}

fn checked_out<T>(path: &str, value: T, no_verify: bool) -> Hooked<T> {
    let head = head_oid(path);
    if head.is_zero() {
        return Hooked::plain(value);
    }
    let checkout = PostHook::Checkout {
        previous: Oid::zero(),
        new: head,
        branch: true,
    };
    ran(path, value, &[checkout], no_verify)
}

pub fn checkout_branch(path: &str, name: &str, no_verify: bool) -> AppResult<Hooked<()>> {
    switched(path, no_verify, || branch::checkout_branch(path, name))
}

pub fn checkout_detached(path: &str, rev: &str, no_verify: bool) -> AppResult<Hooked<()>> {
    switched(path, no_verify, || branch::checkout_detached(path, rev))
}

pub fn branch_create(
    path: &str,
    name: &str,
    from_oid: Option<&str>,
    checkout: bool,
    no_verify: bool,
) -> AppResult<Hooked<()>> {
    let create = || branch::create(path, name, from_oid, checkout);
    if checkout {
        switched(path, no_verify, create)
    } else {
        submodule::synced(path, create).map(Hooked::plain)
    }
}

pub fn checkout_remote_ref(
    path: &str,
    remote_name: &str,
    source_ref: &str,
    local_branch: &str,
    track: bool,
    no_verify: bool,
) -> AppResult<Hooked<()>> {
    switched(path, no_verify, || {
        remote::checkout_remote_ref(path, remote_name, source_ref, local_branch, track)
    })
}

pub fn merge(path: &str, name: &str, no_ff: bool, no_verify: bool) -> AppResult<Hooked<OpOutcome>> {
    let outcome = submodule::synced(path, || branch::merge(path, name, no_ff))?;
    let hooks: Vec<PostHook> = PostHook::merged(&outcome).into_iter().collect();
    Ok(ran(path, outcome, &hooks, no_verify))
}

pub fn pull(
    path: &str,
    remote_name: &str,
    mode: Option<&str>,
    no_verify: bool,
) -> Hooked<AppResult<OpOutcome>> {
    let mut hooks = PostHooks::new(no_verify);
    let outcome = submodule::synced(path, || {
        remote::pull_with_hooks(path, remote_name, mode, &mut hooks)
    });
    finished_or_failed(path, outcome, hooks)
}

pub fn pull_branch(path: &str, branch_name: &str, no_verify: bool) -> AppResult<Hooked<OpOutcome>> {
    let mut hooks = PostHooks::new(no_verify);
    let outcome = remote::pull_branch_with_hooks(path, branch_name, &mut hooks)?;
    Ok(finished(path, outcome, hooks))
}

pub fn rebase(path: &str, upstream: &str, no_verify: bool) -> Hooked<AppResult<OpOutcome>> {
    let mut hooks = PostHooks::new(no_verify);
    let outcome = submodule::synced(path, || {
        branch::rebase_with_hooks(path, upstream, &mut hooks)
    });
    finished_or_failed(path, outcome, hooks)
}

pub fn rebase_continue(path: &str, no_verify: bool) -> AppResult<Hooked<OpOutcome>> {
    let mut hooks = PostHooks::new(no_verify);
    let outcome = submodule::synced(path, || {
        branch::rebase_continue_with_hooks(path, &mut hooks)
    })?;
    Ok(finished(path, outcome, hooks))
}

pub fn rebase_interactive(
    path: &str,
    base: &str,
    todo: &[RebaseTodoEntry],
    no_verify: bool,
) -> AppResult<Hooked<String>> {
    let mut hooks = PostHooks::new(no_verify);
    let head = submodule::synced(path, || {
        branch::rebase_interactive_with_hooks(path, base, todo, &mut hooks)
    })?;
    Ok(finished(path, head, hooks))
}

pub fn amend(
    path: &str,
    message: Option<&str>,
    no_verify: bool,
) -> AppResult<Hooked<CommitOutcome>> {
    let mut hooks = PostHooks::new(no_verify);
    let outcome = commit::amend_with_hooks(path, message, no_verify, &mut hooks)?;
    Ok(finished(path, outcome, hooks))
}

pub fn reword(path: &str, oid: &str, message: &str, no_verify: bool) -> AppResult<Hooked<String>> {
    let mut hooks = PostHooks::new(no_verify);
    let reworded = commit::reword_with_hooks(path, oid, message, &mut hooks)?;
    Ok(finished(path, reworded, hooks))
}

pub fn discard_file(path: &str, file: &str, no_verify: bool) -> AppResult<Hooked<bool>> {
    let restores = {
        let repo = super::repo::open(path)?;
        let tracked = repo.index()?.get_path(Path::new(file), 0).is_some();
        tracked && submodule::drifted(&repo, file).is_none()
    };
    let clean = stage::discard_file(path, file)?;
    Ok(if restores {
        restored(path, clean, no_verify)
    } else {
        Hooked::plain(clean)
    })
}

pub fn discard_all(path: &str, no_verify: bool) -> AppResult<Hooked<Vec<String>>> {
    let restores = has_status(
        path,
        git2::Status::WT_MODIFIED
            | git2::Status::WT_DELETED
            | git2::Status::WT_TYPECHANGE
            | git2::Status::WT_RENAMED,
    )?;
    let leftovers = stage::discard_all(path)?;
    Ok(if restores {
        restored(path, leftovers, no_verify)
    } else {
        Hooked::plain(leftovers)
    })
}

pub fn discard_staged_file(path: &str, file: &str, no_verify: bool) -> AppResult<Hooked<bool>> {
    let clean = stage::discard_staged_file(path, file)?;
    Ok(restored(path, clean, no_verify))
}

pub fn discard_staged_all(path: &str, no_verify: bool) -> AppResult<Hooked<Vec<String>>> {
    let restores = has_status(
        path,
        git2::Status::INDEX_NEW
            | git2::Status::INDEX_MODIFIED
            | git2::Status::INDEX_DELETED
            | git2::Status::INDEX_RENAMED
            | git2::Status::INDEX_TYPECHANGE,
    )?;
    let leftovers = stage::discard_staged_all(path)?;
    Ok(if restores {
        restored(path, leftovers, no_verify)
    } else {
        Hooked::plain(leftovers)
    })
}

fn has_status(path: &str, wanted: git2::Status) -> AppResult<bool> {
    let repo = super::repo::open(path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    let found = statuses
        .iter()
        .any(|entry| entry.status().intersects(wanted));
    Ok(found)
}

pub fn stash_restore_files(
    path: &str,
    index: usize,
    paths: &[String],
    no_verify: bool,
) -> AppResult<Hooked<Vec<String>>> {
    let restored_paths = misc::stash_restore_files(path, index, paths)?;
    Ok(if restored_paths.is_empty() {
        Hooked::plain(restored_paths)
    } else {
        restored(path, restored_paths, no_verify)
    })
}

pub fn clone(
    url: &str,
    into: &str,
    branch: Option<&str>,
    on_progress: impl Fn(u32) + Send,
    no_verify: bool,
) -> AppResult<Hooked<String>> {
    let root = remote::clone(url, into, branch, on_progress)?;
    let path = root.clone();
    Ok(checked_out(&path, root, no_verify))
}

pub fn worktree_add(
    path: &str,
    request: &WorktreeAddRequest,
    no_verify: bool,
) -> AppResult<Hooked<String>> {
    let created = worktree::add(path, request)?;
    let worktree_path = created.clone();
    Ok(checked_out(&worktree_path, created, no_verify))
}
