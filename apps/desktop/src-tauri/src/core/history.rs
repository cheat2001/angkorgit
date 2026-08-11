use std::collections::HashMap;

use git2::{Oid, Repository, Sort};

use crate::error::AppResult;

use super::types::{CommitInfo, HistoryPage, HistoryQuery, RefInfo, SignatureInfo};

fn signature_info(sig: &git2::Signature) -> SignatureInfo {
    SignatureInfo {
        name: sig.name().unwrap_or("").to_string(),
        email: sig.email().unwrap_or("").to_string(),
        time: sig.when().seconds(),
    }
}

fn ref_decorations(repo: &Repository) -> HashMap<Oid, Vec<RefInfo>> {
    let mut map: HashMap<Oid, Vec<RefInfo>> = HashMap::new();
    if let Ok(refs) = repo.references() {
        for reference in refs.flatten() {
            let name = reference.name().unwrap_or("").to_string();
            let shorthand = reference.shorthand().unwrap_or("").to_string();
            let kind = if name.starts_with("refs/heads/") {
                "localBranch"
            } else if name.starts_with("refs/remotes/") {
                "remoteBranch"
            } else if name.starts_with("refs/tags/") {
                "tag"
            } else {
                continue;
            };
            let target = reference
                .peel_to_commit()
                .ok()
                .map(|c| c.id())
                .or_else(|| reference.target());
            if let Some(oid) = target {
                map.entry(oid).or_default().push(RefInfo {
                    kind: kind.to_string(),
                    name,
                    shorthand,
                });
            }
        }
    }
    map
}

pub fn commit_info(
    repo: &Repository,
    commit: &git2::Commit,
    decorations: &HashMap<Oid, Vec<RefInfo>>,
    head_oid: Option<Oid>,
) -> CommitInfo {
    let oid = commit.id();
    let _ = repo;
    CommitInfo {
        oid: oid.to_string(),
        short_oid: oid.to_string()[..8.min(oid.to_string().len())].to_string(),
        summary: commit.summary().unwrap_or("").to_string(),
        body: commit.body().unwrap_or("").to_string(),
        author: signature_info(&commit.author()),
        committer: signature_info(&commit.committer()),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        refs: decorations.get(&oid).cloned().unwrap_or_default(),
        is_head: head_oid == Some(oid),
    }
}

pub fn list(path: &str, query: HistoryQuery) -> AppResult<HistoryPage> {
    let repo = super::repo::open(path)?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    match &query.branch {
        Some(branch) => {
            let reference = match super::branch::resolve_branch_ref(&repo, branch) {
                Ok(r) => r,
                Err(_) => repo.find_reference(branch)?,
            };
            if let Some(oid) = reference.peel_to_commit().ok().map(|c| c.id()) {
                walk.push(oid)?;
            }
        }
        None => {
            let _ = walk.push_glob("refs/heads/*");
            let _ = walk.push_glob("refs/remotes/*");
            let _ = walk.push_glob("refs/tags/*");
            let _ = walk.push_head();
        }
    }

    let decorations = ref_decorations(&repo);
    let head_oid = repo.head().ok().and_then(|h| h.target());

    let search = query.search.as_deref().map(str::to_lowercase);
    let author = query.author.as_deref().map(str::to_lowercase);
    let filtered = search.is_some() || author.is_some();

    let mut commits = Vec::with_capacity(query.limit);
    let mut matched = 0usize;
    let mut has_more = false;

    for oid in walk.flatten() {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if filtered {
            if let Some(q) = &search {
                let hay = format!(
                    "{} {} {}",
                    commit.summary().unwrap_or(""),
                    commit.body().unwrap_or(""),
                    oid
                )
                .to_lowercase();
                if !hay.contains(q.as_str()) {
                    continue;
                }
            }
            if let Some(a) = &author {
                let sig = commit.author();
                let hay = format!("{} {}", sig.name().unwrap_or(""), sig.email().unwrap_or(""))
                    .to_lowercase();
                if !hay.contains(a.as_str()) {
                    continue;
                }
            }
        }

        matched += 1;
        if matched <= query.skip {
            continue;
        }
        if commits.len() >= query.limit {
            has_more = true;
            break;
        }
        commits.push(commit_info(&repo, &commit, &decorations, head_oid));
    }

    Ok(HistoryPage {
        commits,
        has_more,
        total: None,
    })
}

pub fn file_history(path: &str, file: &str, limit: usize) -> AppResult<HistoryPage> {
    let repo = super::repo::open(path)?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    walk.push_head()?;

    let decorations = ref_decorations(&repo);
    let head_oid = repo.head().ok().and_then(|h| h.target());
    let file_path = std::path::Path::new(file);
    let blob_of = |commit: &git2::Commit| -> Option<Oid> {
        commit
            .tree()
            .ok()?
            .get_path(file_path)
            .ok()
            .map(|entry| entry.id())
    };

    let mut commits = Vec::new();
    let mut has_more = false;
    for oid in walk.flatten() {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let current = blob_of(&commit);
        let parent_commit = commit.parent(0).ok();
        let parent = parent_commit.as_ref().and_then(&blob_of);
        let changed = match (current, parent) {
            (Some(c), Some(p)) => c != p,
            (Some(_), None) => true, // added here (or root commit)
            (None, Some(_)) => true, // deleted here
            (None, None) => false,
        };
        if !changed {
            continue;
        }
        if commits.len() >= limit {
            has_more = true;
            break;
        }
        commits.push(commit_info(&repo, &commit, &decorations, head_oid));
    }

    Ok(HistoryPage {
        commits,
        has_more,
        total: None,
    })
}

pub fn single(path: &str, oid: &str) -> AppResult<CommitInfo> {
    let repo = super::repo::open(path)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    let decorations = ref_decorations(&repo);
    let head_oid = repo.head().ok().and_then(|h| h.target());
    Ok(commit_info(&repo, &commit, &decorations, head_oid))
}
