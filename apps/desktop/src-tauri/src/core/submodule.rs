use git2::{Oid, Repository, Submodule, SubmoduleIgnore, SubmoduleStatus};

use crate::error::AppResult;

use super::types::{SubmoduleCommits, SubmoduleInfo};

pub fn list(path: &str) -> AppResult<Vec<SubmoduleInfo>> {
    let repo = super::repo::open(path)?;
    let mut result = Vec::new();
    for sub in repo.submodules()? {
        result.push(SubmoduleInfo {
            name: sub.name().unwrap_or("").to_string(),
            path: sub.path().to_string_lossy().to_string(),
            url: sub.url().map(String::from),
            head_oid: sub.head_id().as_ref().map(Oid::to_string),
        });
    }
    Ok(result)
}

pub fn update(path: &str, name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut sub = repo.find_submodule(name)?;
    run_update(&mut sub, true, true)
}

pub fn drifted<'r>(repo: &'r Repository, path: &str) -> Option<Submodule<'r>> {
    let sub = repo.find_submodule(path).ok()?;
    let recorded = sub.index_id()?;
    let checked_out = sub.workdir_id()?;
    (recorded != checked_out).then_some(sub)
}

pub fn commits(repo: &Repository, path: &str) -> Option<SubmoduleCommits> {
    let sub = drifted(repo, path)?;
    Some(SubmoduleCommits {
        recorded: sub.index_id()?.to_string(),
        checked_out: sub.workdir_id()?.to_string(),
    })
}

pub fn checkout_recorded(sub: &mut Submodule) -> AppResult<()> {
    run_update(sub, false, true)
}

pub fn synced<T>(path: &str, op: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    let before = super::repo::open(path)
        .map(|repo| at_recorded_commit(&repo))
        .unwrap_or_default();
    let result = op()?;
    if !before.is_empty() {
        follow_recorded(path, &before, true);
    }
    Ok(result)
}

pub fn at_recorded_commit(repo: &Repository) -> Vec<(String, Oid)> {
    let Ok(submodules) = repo.submodules() else {
        return Vec::new();
    };
    submodules
        .iter()
        .filter_map(|sub| {
            let recorded = sub.index_id()?;
            let name = sub.name()?.to_string();
            (sub.workdir_id() == Some(recorded)).then_some((name, recorded))
        })
        .collect()
}

pub fn download_missing(
    repo: &Repository,
    target: &git2::Tree,
    before: &[(String, Oid)],
    keep_going: &dyn Fn() -> bool,
) {
    for (name, previous) in before {
        if !keep_going() {
            return;
        }
        let Ok(sub) = repo.find_submodule(name) else {
            continue;
        };
        let Some(wanted) = target.get_path(sub.path()).ok().map(|entry| entry.id()) else {
            continue;
        };
        if wanted == *previous {
            continue;
        }
        let Ok(sub_repo) = sub.open() else {
            continue;
        };
        if sub_repo.find_commit(wanted).is_ok() {
            continue;
        }
        let Some(mut remote) = default_remote(&sub_repo) else {
            continue;
        };
        let mut callbacks = super::remote::make_callbacks();
        callbacks.transfer_progress(|_| keep_going());
        callbacks.sideband_progress(|_| keep_going());
        let mut options = git2::FetchOptions::new();
        options.remote_callbacks(callbacks);
        let _ = remote.download(&[] as &[&str], Some(&mut options));
        let _ = remote.disconnect();
    }
}

pub fn follow_recorded(path: &str, before: &[(String, Oid)], fetch: bool) {
    let Ok(repo) = super::repo::open(path) else {
        return;
    };
    for (name, previous) in before {
        let Ok(mut sub) = repo.find_submodule(name) else {
            continue;
        };
        let Some(recorded) = sub.index_id() else {
            continue;
        };
        if recorded == *previous || sub.workdir_id() != Some(*previous) {
            continue;
        }
        if has_local_edits(&repo, name) {
            continue;
        }
        let _ = run_update(&mut sub, false, fetch);
    }
}

fn default_remote(repo: &Repository) -> Option<git2::Remote<'_>> {
    if let Ok(remote) = repo.find_remote("origin") {
        return Some(remote);
    }
    let names = repo.remotes().ok()?;
    let first = names.iter().flatten().next()?.to_string();
    repo.find_remote(&first).ok()
}

fn has_local_edits(repo: &Repository, name: &str) -> bool {
    repo.submodule_status(name, SubmoduleIgnore::Untracked)
        .map(|status| {
            status.intersects(SubmoduleStatus::WD_INDEX_MODIFIED | SubmoduleStatus::WD_WD_MODIFIED)
        })
        .unwrap_or(true)
}

fn run_update(sub: &mut Submodule, init: bool, fetch: bool) -> AppResult<()> {
    let mut fetch_options = git2::FetchOptions::new();
    fetch_options.remote_callbacks(super::remote::make_callbacks());
    let mut opts = git2::SubmoduleUpdateOptions::new();
    opts.fetch(fetch_options).allow_fetch(fetch);
    sub.update(init, Some(&mut opts))?;
    Ok(())
}
