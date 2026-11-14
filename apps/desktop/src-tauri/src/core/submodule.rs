use git2::{Oid, Repository, Submodule, SubmoduleIgnore, SubmoduleStatus};
use std::{io::Write, path::Path};

use crate::error::{AppError, AppResult};

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

const REBASE_BASELINE: &str = "angkorgit-submodules";

pub fn synced_rebase<T>(path: &str, op: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    let before = rebase_baseline(&super::repo::open(path)?)?;
    let result = op();
    if result.is_ok() {
        follow_recorded(path, &before, true);
    }
    if let Err(error) = save_rebase_baseline(path, &before, result.is_ok()) {
        eprintln!("Cannot save rebase submodule baseline in {path}: {error}");
    }
    result
}

fn rebase_baseline(repo: &Repository) -> AppResult<Vec<(String, Oid)>> {
    let mut before = at_recorded_commit(repo);
    if repo.state() != git2::RepositoryState::RebaseMerge {
        return Ok(before);
    }
    let file = repo.path().join("rebase-merge").join(REBASE_BASELINE);
    let saved = match std::fs::read(file) {
        Ok(bytes) => serde_json::from_slice::<Vec<(String, String)>>(&bytes)
            .map_err(|error| {
                AppError::other(format!("Cannot read rebase submodule baseline: {error}"))
            })?
            .into_iter()
            .map(|(name, oid)| Ok((name, Oid::from_str(&oid)?)))
            .collect::<AppResult<Vec<_>>>()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let rebase = repo.open_rebase(None)?;
            let original = rebase
                .orig_head_id()
                .ok_or_else(|| AppError::other("The rebase has no original commit"))?;
            let tree = repo.find_commit(original)?.tree()?;
            repo.submodules()
                .unwrap_or_default()
                .iter()
                .filter_map(|submodule| {
                    let entry = tree.get_path(submodule.path()).ok()?;
                    let name = submodule.name()?.to_string();
                    (entry.kind() == Some(git2::ObjectType::Commit)).then(|| (name, entry.id()))
                })
                .collect()
        }
        Err(error) => return Err(error.into()),
    };
    for (name, previous) in saved {
        if before.iter().any(|(existing, _)| existing == &name) {
            continue;
        }
        if repo
            .find_submodule(&name)
            .ok()
            .and_then(|sub| sub.workdir_id())
            == Some(previous)
        {
            before.push((name, previous));
        }
    }
    Ok(before)
}

fn save_rebase_baseline(path: &str, before: &[(String, Oid)], followed: bool) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    if repo.state() != git2::RepositoryState::RebaseMerge {
        return Ok(());
    }
    let saved: Vec<_> = before
        .iter()
        .filter_map(|(name, previous)| {
            let submodule = repo.find_submodule(name).ok()?;
            let current = submodule.workdir_id()?;
            (current == *previous || (followed && submodule.index_id() == Some(current)))
                .then(|| (name, current.to_string()))
        })
        .collect();
    let bytes = serde_json::to_vec(&saved).map_err(|error| {
        AppError::other(format!("Cannot save rebase submodule baseline: {error}"))
    })?;
    publish_rebase_baseline(&repo.path().join("rebase-merge"), |file| {
        file.write_all(&bytes)
    })?;
    Ok(())
}

fn publish_rebase_baseline(
    directory: &Path,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    write(temporary.as_file_mut())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(directory.join(REBASE_BASELINE))
        .map_err(|error| error.error)?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishing_a_baseline_replaces_only_the_complete_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(REBASE_BASELINE);
        std::fs::write(&file, b"[ ]").unwrap();
        publish_rebase_baseline(directory.path(), |temporary| {
            temporary.write_all(b"[")?;
            assert_eq!(std::fs::read(&file).unwrap(), b"[ ]");
            temporary.write_all(b"]")
        })
        .unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"[]");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_partial_baseline_write_failure_keeps_the_previous_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(REBASE_BASELINE);
        let previous = b"[[\"library\",\"0123456789012345678901234567890123456789\"]]";
        std::fs::write(&file, previous).unwrap();
        let result = publish_rebase_baseline(directory.path(), |temporary| {
            temporary.write_all(b"[")?;
            Err(std::io::Error::other("disk full"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&file).unwrap(), previous);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
