use git2::{build::CheckoutBuilder, BranchType, Repository, ResetType};

use crate::error::{AppError, AppResult};

use super::types::{BranchInfo, OpOutcome};

pub fn list(path: &str) -> AppResult<Vec<BranchInfo>> {
    let repo = super::repo::open(path)?;
    let mut result = Vec::new();
    for entry in repo.branches(None)? {
        let (branch, kind) = entry?;
        let name = match branch.name()? {
            Some(n) => n.to_string(),
            None => continue,
        };
        let is_remote = kind == BranchType::Remote;
        if is_remote && name.ends_with("/HEAD") {
            continue;
        }
        let target_oid = match branch.get().target() {
            Some(o) => o.to_string(),
            None => continue,
        };
        let (upstream, ahead, behind) = if is_remote {
            (None, 0, 0)
        } else {
            match branch.upstream() {
                Ok(up) => {
                    let up_name = up.name()?.map(String::from);
                    let (a, b) = match (branch.get().target(), up.get().target()) {
                        (Some(l), Some(u)) => repo.graph_ahead_behind(l, u).unwrap_or((0, 0)),
                        _ => (0, 0),
                    };
                    (up_name, a, b)
                }
                Err(_) => (None, 0, 0),
            }
        };
        result.push(BranchInfo {
            is_head: branch.is_head(),
            name,
            is_remote,
            upstream,
            ahead,
            behind,
            target_oid,
        });
    }
    result.sort_by(|a, b| (a.is_remote, &a.name).cmp(&(b.is_remote, &b.name)));
    Ok(result)
}

pub fn create(path: &str, name: &str, from_oid: Option<&str>, checkout: bool) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let commit = match from_oid {
        Some(oid) => repo.find_commit(git2::Oid::from_str(oid)?)?,
        None => repo
            .head()
            .map_err(|_| AppError::other("cannot branch: repository has no commits"))?
            .peel_to_commit()?,
    };
    repo.branch(name, &commit, false)?;
    if checkout {
        checkout_branch(path, name)?;
    }
    Ok(())
}

pub fn delete(path: &str, name: &str, remote: bool) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let kind = if remote {
        BranchType::Remote
    } else {
        BranchType::Local
    };
    let mut branch = repo.find_branch(name, kind)?;
    branch.delete()?;
    Ok(())
}

pub fn rename(path: &str, old_name: &str, new_name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut branch = repo.find_branch(old_name, BranchType::Local)?;
    branch.rename(new_name, false)?;
    Ok(())
}

pub fn checkout_branch(path: &str, name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;

    if let Ok(remote_branch) = repo.find_branch(name, BranchType::Remote) {
        if repo
            .find_branch(local_name_of(name), BranchType::Local)
            .is_err()
        {
            let commit = remote_branch.get().peel_to_commit()?;
            let mut local = repo.branch(local_name_of(name), &commit, false)?;
            local.set_upstream(Some(name))?;
        }
        return do_checkout(&repo, &format!("refs/heads/{}", local_name_of(name)));
    }

    do_checkout(&repo, &format!("refs/heads/{name}"))
}

fn local_name_of(remote_branch: &str) -> &str {
    remote_branch
        .split_once('/')
        .map(|(_, rest)| rest)
        .unwrap_or(remote_branch)
}

pub fn resolve_branch_ref<'repo>(
    repo: &'repo Repository,
    name: &str,
) -> AppResult<git2::Reference<'repo>> {
    if let Ok(local) = repo.find_reference(&format!("refs/heads/{name}")) {
        return Ok(local);
    }
    if let Ok(remote) = repo.find_reference(&format!("refs/remotes/{name}")) {
        return Ok(remote);
    }
    Ok(repo.resolve_reference_from_short_name(name)?)
}

pub fn can_fast_forward(path: &str, target: &str, source: &str) -> AppResult<bool> {
    let repo = super::repo::open(path)?;
    let target_oid = resolve_branch_ref(&repo, target)?.peel_to_commit()?.id();
    let source_oid = resolve_branch_ref(&repo, source)?.peel_to_commit()?.id();
    let (target_unique, source_unique) = repo.graph_ahead_behind(target_oid, source_oid)?;
    Ok(target_unique == 0 && source_unique > 0)
}

fn do_checkout(repo: &Repository, refname: &str) -> AppResult<()> {
    let obj = repo.revparse_single(refname)?;
    let mut builder = CheckoutBuilder::new();
    builder.safe();
    repo.checkout_tree(&obj, Some(&mut builder))?;
    repo.set_head(refname)?;
    Ok(())
}

pub fn checkout_detached(path: &str, rev: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let obj = repo.revparse_single(rev)?;
    let commit = obj.peel(git2::ObjectType::Commit)?;
    let mut builder = CheckoutBuilder::new();
    builder.safe();
    repo.checkout_tree(&commit, Some(&mut builder))?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}

pub fn merge(path: &str, branch: &str, no_ff: bool) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let reference = resolve_branch_ref(&repo, branch)?;
    let annotated = repo.reference_to_annotated_commit(&reference)?;
    let (analysis, _pref) = repo.merge_analysis(&[&annotated])?;

    if analysis.is_up_to_date() {
        return Ok(OpOutcome {
            status: "up_to_date".into(),
            message: format!("Already up to date with {branch}"),
        });
    }

    if analysis.is_fast_forward() && !no_ff {
        let target = annotated.id();
        let target_commit = repo.find_commit(target)?;
        let mut builder = CheckoutBuilder::new();
        builder.safe();
        repo.checkout_tree(target_commit.as_object(), Some(&mut builder))?;
        let mut head_ref = repo.head()?;
        head_ref.set_target(target, &format!("fast-forward merge {branch}"))?;
        return Ok(OpOutcome {
            status: "fast_forward".into(),
            message: format!("Fast-forwarded to {branch}"),
        });
    }

    let sig = super::commit::default_signature(&repo)?;
    repo.merge(&[&annotated], None, None)?;
    let index = repo.index()?;
    if index.has_conflicts() {
        return Ok(OpOutcome {
            status: "conflicts".into(),
            message: format!("Merge of {branch} has conflicts to resolve"),
        });
    }

    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_ref = repo.head()?;
    let into = head_ref.shorthand().unwrap_or("HEAD").to_string();
    let head_commit = head_ref.peel_to_commit()?;
    let their_commit = reference.peel_to_commit()?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge branch '{branch}' into {into}"),
        &tree,
        &[&head_commit, &their_commit],
    )?;
    repo.cleanup_state()?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Merged {branch}"),
    })
}

pub fn abort_merge(path: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let head = repo.head()?.peel(git2::ObjectType::Commit)?;
    repo.reset(&head, ResetType::Hard, None)?;
    repo.cleanup_state()?;
    Ok(())
}

pub fn rebase(path: &str, upstream: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let reference = resolve_branch_ref(&repo, upstream)?;
    let upstream_annotated = repo.reference_to_annotated_commit(&reference)?;
    let sig = repo.signature()?;

    let mut opts = git2::RebaseOptions::new();
    let mut rebase = repo.rebase(None, Some(&upstream_annotated), None, Some(&mut opts))?;

    while let Some(op) = rebase.next() {
        op?;
        let index = repo.index()?;
        if index.has_conflicts() {
            return Ok(OpOutcome {
                status: "conflicts".into(),
                message: "Rebase paused on conflicts. Resolve them, then continue.".into(),
            });
        }
        match rebase.commit(None, &sig, None) {
            Ok(_) => {}
            Err(e) if e.code() == git2::ErrorCode::Applied => {}
            Err(e) => return Err(e.into()),
        }
    }
    rebase.finish(Some(&sig))?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Rebased onto {upstream}"),
    })
}

pub fn rebase_continue(path: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let sig = repo.signature()?;
    let mut rebase = repo.open_rebase(None)?;

    {
        let index = repo.index()?;
        if index.has_conflicts() {
            return Ok(OpOutcome {
                status: "conflicts".into(),
                message: "Conflicts are still unresolved.".into(),
            });
        }
    }
    match rebase.commit(None, &sig, None) {
        Ok(_) => {}
        Err(e) if e.code() == git2::ErrorCode::Applied => {}
        Err(e) => return Err(e.into()),
    }

    while let Some(op) = rebase.next() {
        op?;
        let index = repo.index()?;
        if index.has_conflicts() {
            return Ok(OpOutcome {
                status: "conflicts".into(),
                message: "Rebase paused on conflicts. Resolve them, then continue.".into(),
            });
        }
        match rebase.commit(None, &sig, None) {
            Ok(_) => {}
            Err(e) if e.code() == git2::ErrorCode::Applied => {}
            Err(e) => return Err(e.into()),
        }
    }
    rebase.finish(Some(&sig))?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: "Rebase complete".into(),
    })
}

pub fn rebase_abort(path: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut rebase = repo.open_rebase(None)?;
    rebase.abort()?;
    Ok(())
}

pub fn cherry_pick(path: &str, oid: &str) -> AppResult<OpOutcome> {
    let repo = super::repo::open(path)?;
    let sig = super::commit::default_signature(&repo)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    repo.cherrypick(&commit, None)?;

    let index = repo.index()?;
    if index.has_conflicts() {
        return Ok(OpOutcome {
            status: "conflicts".into(),
            message: "Cherry-pick has conflicts to resolve".into(),
        });
    }

    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_commit = repo.head()?.peel_to_commit()?;
    let author = commit.author().to_owned();
    repo.commit(
        Some("HEAD"),
        &author,
        &sig,
        commit.message().unwrap_or("cherry-pick"),
        &tree,
        &[&head_commit],
    )?;
    repo.cleanup_state()?;
    Ok(OpOutcome {
        status: "ok".into(),
        message: format!("Cherry-picked {}", &oid[..8.min(oid.len())]),
    })
}

pub fn reset(path: &str, oid: &str, mode: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let obj = repo.find_object(git2::Oid::from_str(oid)?, None)?;
    let kind = match mode {
        "soft" => ResetType::Soft,
        "mixed" => ResetType::Mixed,
        "hard" => ResetType::Hard,
        _ => return Err(AppError::other(format!("unknown reset mode: {mode}"))),
    };
    repo.reset(&obj, kind, None)?;
    Ok(())
}
