use git2::Repository;

use crate::error::{AppError, AppResult};

use super::types::OpOutcome;

fn default_signature(repo: &Repository) -> AppResult<git2::Signature<'static>> {
    repo.signature().map_err(|_| {
        AppError::other("Git identity is not configured. Set user.name and user.email in Settings.")
    })
}

pub fn commit(path: &str, message: &str) -> AppResult<String> {
    let mut repo = super::repo::open(path)?;
    let sig = default_signature(&repo)?;

    let is_merge = repo.state() == git2::RepositoryState::Merge;
    let mut merge_oids: Vec<git2::Oid> = Vec::new();
    if is_merge {
        repo.mergehead_foreach(|oid| {
            merge_oids.push(*oid);
            true
        })?;
    }

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    drop(index);

    let oid = {
        let tree = repo.find_tree(tree_oid)?;
        let mut parents: Vec<git2::Commit> = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect();
        for merge_oid in merge_oids {
            if let Ok(commit) = repo.find_commit(merge_oid) {
                parents.push(commit);
            }
        }
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?
    };

    if is_merge {
        repo.cleanup_state()?;
    }
    Ok(oid.to_string())
}

pub fn revert(path: &str, oid: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;

    let mut opts = git2::RevertOptions::new();
    if commit.parent_count() > 1 {
        opts.mainline(1);
    }
    repo.revert(&commit, Some(&mut opts))?;

    if repo.index()?.has_conflicts() {
        return Ok(OpOutcome {
            status: "conflicts".into(),
            message: "Revert has conflicts to resolve".into(),
        });
    }

    let sig = default_signature(&repo)?;
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head = repo.head()?.peel_to_commit()?;
    let summary = commit.summary().unwrap_or("").to_string();
    let full_oid = commit.id().to_string();
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Revert \"{summary}\"\n\nThis reverts commit {full_oid}."),
        &tree,
        &[&head],
    )?;
    repo.cleanup_state()?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Reverted {}", &oid[..8.min(oid.len())]),
    })
}

pub fn amend(path: &str, message: Option<&str>) -> AppResult<String> {
    let repo = super::repo::open(path)?;
    let head = repo
        .head()
        .map_err(|_| AppError::other("nothing to amend: repository has no commits"))?;
    let commit = head.peel_to_commit()?;
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let oid = commit.amend(Some("HEAD"), None, None, None, message, Some(&tree))?;
    Ok(oid.to_string())
}
