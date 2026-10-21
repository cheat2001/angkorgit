use std::path::Path;

use git2::{Oid, Repository, StashApplyOptions, StashFlags, Tree};

use crate::error::{AppError, AppResult};

use super::types::{CommitFileInfo, StashInfo, TagInfo};

pub fn stash_list(path: &str) -> AppResult<Vec<StashInfo>> {
    let mut repo = super::repo::open(path)?;
    let mut result = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        result.push(StashInfo {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })?;
    Ok(result)
}

pub fn stash_create(
    path: &str,
    message: Option<&str>,
    include_untracked: bool,
    paths: &[String],
) -> AppResult<()> {
    if !paths.is_empty() {
        return stash_paths(path, message, include_untracked, paths);
    }
    let mut repo = super::repo::open(path)?;
    let sig = repo.signature()?;
    let mut flags = StashFlags::DEFAULT;
    if include_untracked {
        flags |= StashFlags::INCLUDE_UNTRACKED;
    }
    repo.stash_save2(&sig, message, Some(flags))?;
    Ok(())
}

fn stash_paths(
    path: &str,
    message: Option<&str>,
    include_untracked: bool,
    paths: &[String],
) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("cannot stash in a bare repository"))?
        .to_path_buf();
    let sig = repo.signature()?;
    let head = repo.head()?.peel_to_commit()?;
    let head_tree = head.tree()?;
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "(no branch)".into());
    let short = head.id().to_string()[..7].to_string();
    let summary = head.summary().unwrap_or_default().to_string();

    let mut real_index = repo.index()?;
    let mut index_tree = git2::Index::new()?;
    index_tree.read_tree(&head_tree)?;
    let mut wt_tree = git2::Index::new()?;
    wt_tree.read_tree(&head_tree)?;
    let mut untracked_tree = git2::Index::new()?;
    let mut has_untracked = false;
    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for file in paths {
        let status = repo.status_file(Path::new(file))?;
        let is_untracked = status.contains(git2::Status::WT_NEW);
        if is_untracked {
            if !include_untracked {
                return Err(AppError::other(format!("{file} is untracked")));
            }
            if let Some(entry) = workdir_entry(&repo, &workdir, file)? {
                untracked_tree.add(&entry)?;
                has_untracked = true;
            }
            untracked.push(file.clone());
            continue;
        }
        if status.is_empty() {
            return Err(AppError::other(format!("{file} has no changes to stash")));
        }
        match real_index.get_path(Path::new(file), 0) {
            Some(entry) => index_tree.add(&entry)?,
            None => {
                let _ = index_tree.remove_path(Path::new(file));
            }
        }
        match workdir_entry(&repo, &workdir, file)? {
            Some(entry) => wt_tree.add(&entry)?,
            None => {
                let _ = wt_tree.remove_path(Path::new(file));
            }
        }
        tracked.push(file.clone());
    }
    if tracked.is_empty() && !has_untracked {
        return Err(AppError::other("nothing to stash in the selected files"));
    }

    let index_commit = repo.find_commit(repo.commit(
        None,
        &sig,
        &sig,
        &format!("index on {branch}: {short} {summary}"),
        &repo.find_tree(index_tree.write_tree_to(&repo)?)?,
        &[&head],
    )?)?;
    let untracked_commit = if has_untracked {
        Some(repo.find_commit(repo.commit(
            None,
            &sig,
            &sig,
            &format!("untracked files on {branch}: {short} {summary}"),
            &repo.find_tree(untracked_tree.write_tree_to(&repo)?)?,
            &[],
        )?)?)
    } else {
        None
    };
    let full_message = match message {
        Some(m) => format!("On {branch}: {m}"),
        None => format!("WIP on {branch}: {short} {summary}"),
    };
    let mut parents: Vec<&git2::Commit> = vec![&head, &index_commit];
    if let Some(u) = untracked_commit.as_ref() {
        parents.push(u);
    }
    let stash_oid = repo.commit(
        None,
        &sig,
        &sig,
        &full_message,
        &repo.find_tree(wt_tree.write_tree_to(&repo)?)?,
        &parents,
    )?;
    repo.reference("refs/stash", stash_oid, true, &full_message)?;
    let mut reflog = repo.reflog("refs/stash")?;
    let logged = reflog
        .get(0)
        .map(|e| e.id_new() == stash_oid)
        .unwrap_or(false);
    if !logged {
        reflog.append(stash_oid, &sig, Some(&full_message))?;
        reflog.write()?;
    }

    for file in &tracked {
        let rel = Path::new(file);
        if head_tree.get_path(rel).is_ok() {
            let mut builder = git2::build::CheckoutBuilder::new();
            builder.force().path(file);
            repo.checkout_tree(head_tree.as_object(), Some(&mut builder))?;
        } else {
            let _ = real_index.remove_path(rel);
            let target = workdir.join(rel);
            if target.exists() {
                std::fs::remove_file(target)?;
            }
        }
    }
    for file in &untracked {
        let target = workdir.join(file);
        if target.is_dir() {
            std::fs::remove_dir_all(target)?;
        } else if target.exists() {
            std::fs::remove_file(target)?;
        }
    }
    real_index.write()?;
    Ok(())
}

fn workdir_entry(
    repo: &Repository,
    workdir: &Path,
    file: &str,
) -> AppResult<Option<git2::IndexEntry>> {
    let full = workdir.join(file);
    let meta = match std::fs::symlink_metadata(&full) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };
    let (id, mode) = if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full)?;
        (repo.blob(target.to_string_lossy().as_bytes())?, 0o120000)
    } else if meta.is_file() {
        (repo.blob_path(&full)?, file_mode(&meta))
    } else {
        return Ok(None);
    };
    Ok(Some(git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: meta.len() as u32,
        id,
        flags: 0,
        flags_extended: 0,
        path: file.as_bytes().to_vec(),
    }))
}

#[cfg(unix)]
fn file_mode(meta: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        0o100755
    } else {
        0o100644
    }
}

#[cfg(not(unix))]
fn file_mode(_meta: &std::fs::Metadata) -> u32 {
    0o100644
}

pub fn stash_apply(path: &str, index: usize) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    let mut opts = StashApplyOptions::new();
    match repo.stash_apply(index, Some(&mut opts)) {
        Ok(()) => Ok(()),
        Err(e) if dirty_index_refusal(&e) => stash_via_cli(&repo, "apply", index),
        Err(e) => Err(e.into()),
    }
}

pub fn stash_pop(path: &str, index: usize) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    let mut opts = StashApplyOptions::new();
    match repo.stash_pop(index, Some(&mut opts)) {
        Ok(()) => Ok(()),
        Err(e) if dirty_index_refusal(&e) => stash_via_cli(&repo, "pop", index),
        Err(e) => Err(e.into()),
    }
}

fn dirty_index_refusal(error: &git2::Error) -> bool {
    error
        .message()
        .contains("uncommitted changes exist in the index")
}

fn stash_via_cli(repo: &Repository, verb: &str, index: usize) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("cannot apply a stash in a bare repository"))?;
    let output = crate::proc::hidden("git")
        .args(["stash", verb, "--quiet", &format!("stash@{{{index}}}")])
        .current_dir(workdir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| AppError::other(format!("could not run git stash {verb}: {e}")))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::other(if stderr.is_empty() {
        format!("git stash {verb} failed")
    } else {
        stderr
    }))
}

fn stash_oid(repo: &mut Repository, index: usize) -> AppResult<Oid> {
    let mut found = None;
    repo.stash_foreach(|i, _, oid| {
        if i == index {
            found = Some(*oid);
            false
        } else {
            true
        }
    })?;
    found.ok_or_else(|| AppError::other(format!("stash {index} does not exist")))
}

fn untracked_tree<'r>(repo: &'r Repository, stash: &git2::Commit<'r>) -> Option<Tree<'r>> {
    let untracked = stash.parent(2).ok()?;
    if !untracked
        .message()
        .unwrap_or_default()
        .starts_with("untracked files on ")
    {
        return None;
    }
    repo.find_tree(untracked.tree_id()).ok()
}

pub fn stash_files(path: &str, index: usize) -> AppResult<Vec<CommitFileInfo>> {
    let mut repo = super::repo::open(path)?;
    let oid = stash_oid(&mut repo, index)?;
    let mut result = super::diff::files_of_commit(&repo, &oid.to_string())?;
    let stash = repo.find_commit(oid)?;
    if let Some(tree) = untracked_tree(&repo, &stash) {
        let source = stash.parent_id(2)?.to_string();
        tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                let file = format!("{dir}{}", entry.name().unwrap_or_default());
                let blob = repo.find_blob(entry.id()).ok();
                let is_binary = blob.as_ref().is_some_and(|b| b.is_binary());
                let additions = blob
                    .as_ref()
                    .filter(|_| !is_binary)
                    .map(|b| b.content().iter().filter(|c| **c == b'\n').count() as u32)
                    .unwrap_or(0);
                result.push(CommitFileInfo {
                    is_image: super::diff::is_image_path(&file),
                    path: file,
                    old_path: None,
                    status: "new".into(),
                    is_binary,
                    additions,
                    deletions: 0,
                    source_oid: Some(source.clone()),
                });
            }
            git2::TreeWalkResult::Ok
        })?;
    }
    Ok(result)
}

pub fn stash_restore_files(path: &str, index: usize, paths: &[String]) -> AppResult<Vec<String>> {
    let mut repo = super::repo::open(path)?;
    let oid = stash_oid(&mut repo, index)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("cannot restore into a bare repository"))?
        .to_path_buf();
    let stash = repo.find_commit(oid)?;
    let stashed = stash.tree()?;
    let base = stash.parent(0)?.tree()?;
    let untracked = untracked_tree(&repo, &stash);
    let mut restored = Vec::new();
    for file in paths {
        let rel = Path::new(file);
        let entry = stashed
            .get_path(rel)
            .ok()
            .or_else(|| untracked.as_ref().and_then(|t| t.get_path(rel).ok()));
        match entry {
            Some(entry) if entry.kind() == Some(git2::ObjectType::Blob) => {
                let blob = repo.find_blob(entry.id())?;
                let target = workdir.join(rel);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&target, blob.content())?;
                set_executable(&target, entry.filemode() == 0o100755);
                restored.push(file.clone());
            }
            Some(_) => {}
            None if base.get_path(rel).is_ok() => {
                let target = workdir.join(rel);
                if target.exists() {
                    std::fs::remove_file(&target)?;
                }
                restored.push(file.clone());
            }
            None => {
                return Err(AppError::other(format!("{file} is not part of this stash")));
            }
        }
    }
    Ok(restored)
}

#[cfg(unix)]
fn set_executable(target: &Path, executable: bool) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(target) {
        let mut perms = meta.permissions();
        let mode = perms.mode();
        perms.set_mode(if executable {
            mode | 0o111
        } else {
            mode & !0o111
        });
        let _ = std::fs::set_permissions(target, perms);
    }
}

#[cfg(not(unix))]
fn set_executable(_target: &Path, _executable: bool) {}

pub fn stash_drop(path: &str, index: usize) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    repo.stash_drop(index)?;
    Ok(())
}

pub fn tag_list(path: &str) -> AppResult<Vec<TagInfo>> {
    let repo = super::repo::open(path)?;
    let mut result = Vec::new();
    repo.tag_foreach(|oid, name_bytes| {
        let full = String::from_utf8_lossy(name_bytes).to_string();
        let name = full.trim_start_matches("refs/tags/").to_string();
        match repo.find_tag(oid) {
            Ok(tag) => {
                result.push(TagInfo {
                    name,
                    target_oid: tag.target_id().to_string(),
                    message: tag.message().map(|m| m.trim().to_string()),
                    is_annotated: true,
                });
            }
            Err(_) => {
                result.push(TagInfo {
                    name,
                    target_oid: oid.to_string(),
                    message: None,
                    is_annotated: false,
                });
            }
        }
        true
    })?;
    result.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(result)
}

pub fn tag_create(
    path: &str,
    name: &str,
    target: Option<&str>,
    message: Option<&str>,
) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let obj = match target {
        Some(rev) => repo.revparse_single(rev)?,
        None => repo
            .head()
            .map_err(|_| AppError::other("cannot tag: repository has no commits"))?
            .peel(git2::ObjectType::Commit)?,
    };
    match message {
        Some(msg) if !msg.trim().is_empty() => {
            let sig = repo.signature()?;
            repo.tag(name, &obj, &sig, msg, false)?;
        }
        _ => {
            repo.tag_lightweight(name, &obj, false)?;
        }
    }
    Ok(())
}

pub fn tag_delete(path: &str, name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    repo.tag_delete(name)?;
    Ok(())
}
