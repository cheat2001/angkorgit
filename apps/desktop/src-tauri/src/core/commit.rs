use git2::Repository;

use crate::error::{AppError, AppResult};

use super::hooks::CommitHooks;
use super::types::{CommitOutcome, OpOutcome, RebaseTodoEntry};

pub(crate) fn default_signature(repo: &Repository) -> AppResult<git2::Signature<'static>> {
    repo.signature().map_err(|_| {
        AppError::other("Git identity is not configured. Set user.name and user.email in Settings.")
    })
}

pub fn commit(path: &str, message: &str, no_verify: bool) -> AppResult<CommitOutcome> {
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

    let tree_oid = staged_tree(&repo, is_merge)?;
    let hooks = CommitHooks::prepare(&repo, &sig, no_verify)?;
    let tree_oid = if hooks.pre_commit(&repo)? {
        staged_tree(&repo, is_merge)?
    } else {
        tree_oid
    };
    let message = hooks.commit_msg(&repo, message)?;

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
        super::sign::create_commit(
            &repo,
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &parent_refs,
        )?
    };

    if is_merge {
        repo.cleanup_state()?;
    }
    Ok(CommitOutcome {
        oid: oid.to_string(),
        hook_warning: hooks.warning,
    })
}

fn staged_tree(repo: &Repository, is_merge: bool) -> AppResult<git2::Oid> {
    let mut index = repo.index()?;
    index.read(true)?;
    let index_is_empty = index.is_empty();
    let tree_oid = index.write_tree()?;
    if !is_merge {
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok())
            .map(|t| t.id());
        let nothing_staged = match head_tree {
            Some(head_tree) => head_tree == tree_oid,
            None => index_is_empty,
        };
        if nothing_staged {
            return Err(AppError::other("Nothing staged to commit"));
        }
    }
    Ok(tree_oid)
}

pub fn merge_message(path: &str) -> AppResult<Option<String>> {
    let repo = super::repo::open(path)?;
    if repo.state() != git2::RepositoryState::Merge {
        return Ok(None);
    }
    let Ok(raw) = std::fs::read_to_string(repo.path().join("MERGE_MSG")) else {
        return Ok(None);
    };
    let message = raw
        .lines()
        .filter(|line| !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    Ok((!message.is_empty()).then_some(message))
}

pub fn revert(path: &str, oid: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let sig = default_signature(&repo)?;
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

pub fn amend(path: &str, message: Option<&str>, no_verify: bool) -> AppResult<CommitOutcome> {
    let repo = super::repo::open(path)?;
    let head = repo
        .head()
        .map_err(|_| AppError::other("nothing to amend: repository has no commits"))?;
    let commit = head.peel_to_commit()?;
    let hooks = CommitHooks::prepare(&repo, &commit.author(), no_verify)?;
    hooks.pre_commit(&repo)?;
    let message = match message {
        Some(message) => Some(hooks.commit_msg(&repo, message)?),
        None => {
            let current = String::from_utf8_lossy(commit.message_bytes()).into_owned();
            let checked = hooks.commit_msg(&repo, &current)?;
            (checked != current).then_some(checked)
        }
    };
    let mut index = repo.index()?;
    index.read(true)?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    if super::sign::signing_config(&repo)?.is_none() {
        let oid = commit.amend(
            Some("HEAD"),
            None,
            None,
            None,
            message.as_deref(),
            Some(&tree),
        )?;
        return Ok(CommitOutcome {
            oid: oid.to_string(),
            hook_warning: hooks.warning,
        });
    }
    let message =
        message.unwrap_or_else(|| String::from_utf8_lossy(commit.message_bytes()).into_owned());
    let author = commit.author();
    let committer = commit.committer();
    let parents: Vec<git2::Commit> = commit.parents().collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = super::sign::create_commit(
        &repo,
        Some("HEAD"),
        &author,
        &committer,
        &message,
        &tree,
        &parent_refs,
    )?;
    Ok(CommitOutcome {
        oid: oid.to_string(),
        hook_warning: hooks.warning,
    })
}

pub fn reword(path: &str, oid: &str, message: &str) -> AppResult<String> {
    let message = message.trim_end();
    if message.trim().is_empty() {
        return Err(AppError::other("the commit message cannot be empty"));
    }
    let repo = super::repo::open(path)?;
    let target = repo.find_commit(git2::Oid::from_str(oid)?)?;
    let head = repo
        .head()
        .map_err(|_| AppError::other("nothing to reword: repository has no commits"))?
        .peel_to_commit()?;
    if target.id() == head.id() {
        return reword_head(&repo, &head, message);
    }
    let parent = target.parent(0).map_err(|_| {
        AppError::other("the root commit can only be reworded while it is the latest commit")
    })?;
    let parent_oid = parent.id().to_string();
    let target_oid = target.id().to_string();
    let range = super::branch::rebase_commits(path, &parent_oid)?;
    let Some(index) = range.iter().position(|c| c.oid == target_oid) else {
        return Err(AppError::other(
            "only commits on the current branch can be reworded",
        ));
    };
    let todo: Vec<RebaseTodoEntry> = range
        .iter()
        .rev()
        .map(|c| {
            let is_target = c.oid == target_oid;
            RebaseTodoEntry {
                oid: c.oid.clone(),
                action: if is_target { "reword" } else { "pick" }.to_string(),
                message: is_target.then(|| message.to_string()),
            }
        })
        .collect();
    let new_head = super::branch::rebase_interactive(path, &parent_oid, &todo)?;
    let mut commit = repo.find_commit(git2::Oid::from_str(&new_head)?)?;
    for _ in 0..index {
        commit = commit.parent(0)?;
    }
    Ok(commit.id().to_string())
}

fn reword_head(repo: &Repository, head: &git2::Commit, message: &str) -> AppResult<String> {
    if super::sign::signing_config(repo)?.is_none() {
        let oid = head.amend(Some("HEAD"), None, None, None, Some(message), None)?;
        return Ok(oid.to_string());
    }
    let tree = head.tree()?;
    let parents: Vec<git2::Commit> = head.parents().collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = super::sign::create_commit(
        repo,
        Some("HEAD"),
        &head.author(),
        &head.committer(),
        message,
        &tree,
        &parent_refs,
    )?;
    Ok(oid.to_string())
}
