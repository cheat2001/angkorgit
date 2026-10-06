use std::collections::{HashMap, HashSet};

use git2::{Oid, Repository, Sort};

use crate::error::AppResult;

use super::types::{
    CommitInfo, HistoryPage, HistoryPosition, HistoryQuery, HistorySearch, HistorySearchQuery,
    RefInfo, SignatureInfo,
};

pub const SEARCH_MATCH_CAP: usize = 1000;

fn signature_info(sig: &git2::Signature) -> SignatureInfo {
    SignatureInfo {
        name: sig.name().unwrap_or("").to_string(),
        email: sig.email().unwrap_or("").to_string(),
        time: sig.when().seconds(),
    }
}

struct StashEntry {
    oid: Oid,
    index: usize,
    message: String,
}

fn stash_entries(repo: &Repository) -> Vec<StashEntry> {
    let Ok(reflog) = repo.reflog("refs/stash") else {
        return Vec::new();
    };
    reflog
        .iter()
        .enumerate()
        .map(|(index, entry)| StashEntry {
            oid: entry.id_new(),
            index,
            message: entry.message().unwrap_or("").to_string(),
        })
        .collect()
}

struct StashWalk {
    commits: HashSet<Oid>,
    skipped: HashSet<Oid>,
}

fn push_stashes(repo: &Repository, walk: &mut git2::Revwalk) -> StashWalk {
    let mut commits = HashSet::new();
    let mut skipped = HashSet::new();
    for entry in stash_entries(repo) {
        let Ok(commit) = repo.find_commit(entry.oid) else {
            continue;
        };
        if walk.push(entry.oid).is_err() {
            continue;
        }
        commits.insert(entry.oid);
        skipped.extend(commit.parent_ids().skip(1));
    }
    StashWalk { commits, skipped }
}

fn ref_decorations(repo: &Repository) -> HashMap<Oid, Vec<RefInfo>> {
    let mut map: HashMap<Oid, Vec<RefInfo>> = HashMap::new();
    for entry in stash_entries(repo) {
        map.entry(entry.oid).or_default().push(RefInfo {
            kind: "stash".to_string(),
            name: format!("stash@{{{}}}", entry.index),
            shorthand: entry.message,
        });
    }
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

fn open_walk<'r>(
    repo: &'r Repository,
    branch: Option<&str>,
) -> AppResult<(git2::Revwalk<'r>, StashWalk)> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    match branch {
        Some(branch) => {
            let reference = match super::branch::resolve_branch_ref(repo, branch) {
                Ok(r) => r,
                Err(_) => repo.find_reference(branch)?,
            };
            if let Some(oid) = reference.peel_to_commit().ok().map(|c| c.id()) {
                walk.push(oid)?;
            }
            Ok((
                walk,
                StashWalk {
                    commits: HashSet::new(),
                    skipped: HashSet::new(),
                },
            ))
        }
        None => {
            let _ = walk.push_glob("refs/heads/*");
            let _ = walk.push_glob("refs/remotes/*");
            let _ = walk.push_glob("refs/tags/*");
            let _ = walk.push_head();
            let stashes = push_stashes(repo, &mut walk);
            Ok((walk, stashes))
        }
    }
}

fn text_matches(commit: &git2::Commit, oid: Oid, needle: &str) -> bool {
    let hay = format!(
        "{} {} {}",
        commit.summary().unwrap_or(""),
        commit.body().unwrap_or(""),
        oid
    )
    .to_lowercase();
    hay.contains(needle)
}

fn author_matches(commit: &git2::Commit, needle: &str) -> bool {
    let sig = commit.author();
    let hay = format!("{} {}", sig.name().unwrap_or(""), sig.email().unwrap_or("")).to_lowercase();
    hay.contains(needle)
}

fn non_empty_lowercase(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_lowercase)
}

pub fn list(path: &str, query: HistoryQuery) -> AppResult<HistoryPage> {
    let repo = super::repo::open(path)?;
    let (walk, stashes) = open_walk(&repo, query.branch.as_deref())?;

    let decorations = ref_decorations(&repo);
    let head_oid = repo.head().ok().and_then(|h| h.target());

    let search = non_empty_lowercase(query.search.as_deref());
    let author = non_empty_lowercase(query.author.as_deref());
    let filtered = search.is_some() || author.is_some();

    let mut commits = Vec::with_capacity(query.limit);
    let mut matched = 0usize;
    let mut has_more = false;

    for oid in walk.flatten() {
        if stashes.skipped.contains(&oid) {
            continue;
        }
        if !filtered && matched < query.skip {
            matched += 1;
            continue;
        }

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if filtered {
            if let Some(q) = &search {
                if !text_matches(&commit, oid, q) {
                    continue;
                }
            }
            if let Some(a) = &author {
                if !author_matches(&commit, a) {
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
        let mut info = commit_info(&repo, &commit, &decorations, head_oid);
        if stashes.commits.contains(&oid) {
            info.parents.truncate(1);
        }
        commits.push(info);
    }

    Ok(HistoryPage {
        commits,
        has_more,
        total: None,
    })
}

pub fn position(path: &str, rev: &str) -> AppResult<Option<HistoryPosition>> {
    let repo = super::repo::open(path)?;
    let Ok(object) = repo.revparse_single(rev) else {
        return Ok(None);
    };
    let Ok(commit) = object.peel_to_commit() else {
        return Ok(None);
    };
    let target = commit.id();

    let (walk, stashes) = open_walk(&repo, None)?;

    for (index, oid) in walk
        .flatten()
        .filter(|oid| !stashes.skipped.contains(oid))
        .enumerate()
    {
        if oid == target {
            return Ok(Some(HistoryPosition {
                index,
                oid: oid.to_string(),
            }));
        }
    }
    Ok(None)
}

pub fn search(path: &str, query: HistorySearchQuery) -> AppResult<HistorySearch> {
    let repo = super::repo::open(path)?;
    let mut matches = Vec::new();
    let mut truncated = false;
    let needle = non_empty_lowercase(Some(query.search.as_str()));
    let author = non_empty_lowercase(query.author.as_deref());
    if needle.is_none() && author.is_none() {
        return Ok(HistorySearch { matches, truncated });
    }
    let (walk, stashes) = open_walk(&repo, query.branch.as_deref())?;

    for (index, oid) in walk
        .flatten()
        .filter(|oid| !stashes.skipped.contains(oid))
        .enumerate()
    {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let text_ok = match &needle {
            Some(q) => text_matches(&commit, oid, q),
            None => true,
        };
        let author_ok = match &author {
            Some(a) => author_matches(&commit, a),
            None => true,
        };
        if text_ok && author_ok {
            if matches.len() >= SEARCH_MATCH_CAP {
                truncated = true;
                break;
            }
            matches.push(HistoryPosition {
                index,
                oid: oid.to_string(),
            });
        }
    }
    Ok(HistorySearch { matches, truncated })
}

pub fn file_history(path: &str, file: &str, limit: usize, skip: usize) -> AppResult<HistoryPage> {
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
    let mut matched = 0usize;
    for oid in walk.flatten() {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let current = blob_of(&commit);
        let parent_commit = commit.parent(0).ok();
        let parent = parent_commit.as_ref().and_then(blob_of);
        let changed = match (current, parent) {
            (Some(c), Some(p)) => c != p,
            (Some(_), None) => true, // added here (or root commit)
            (None, Some(_)) => true, // deleted here
            (None, None) => false,
        };
        if !changed {
            continue;
        }
        matched += 1;
        if matched <= skip {
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

const UNPUSHED_CAP: usize = 1000;

pub fn unpushed(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    walk.push_head()?;
    let _ = walk.hide_glob("refs/remotes/*");
    Ok(walk
        .take(UNPUSHED_CAP)
        .filter_map(Result::ok)
        .map(|oid| oid.to_string())
        .collect())
}
