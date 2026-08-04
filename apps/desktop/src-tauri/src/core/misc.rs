use git2::{Oid, StashApplyOptions, StashFlags};

use crate::error::{AppError, AppResult};

use super::types::{StashInfo, SubmoduleInfo, TagInfo};

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

pub fn stash_create(path: &str, message: Option<&str>, include_untracked: bool) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    let sig = repo.signature()?;
    let mut flags = StashFlags::DEFAULT;
    if include_untracked {
        flags |= StashFlags::INCLUDE_UNTRACKED;
    }
    repo.stash_save2(&sig, message, Some(flags))?;
    Ok(())
}

pub fn stash_apply(path: &str, index: usize) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    let mut opts = StashApplyOptions::new();
    repo.stash_apply(index, Some(&mut opts))?;
    Ok(())
}

pub fn stash_pop(path: &str, index: usize) -> AppResult<()> {
    let mut repo = super::repo::open(path)?;
    let mut opts = StashApplyOptions::new();
    repo.stash_pop(index, Some(&mut opts))?;
    Ok(())
}

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

pub fn submodule_list(path: &str) -> AppResult<Vec<SubmoduleInfo>> {
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

pub fn submodule_update(path: &str, name: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut sub = repo.find_submodule(name)?;
    let mut fetch = git2::FetchOptions::new();
    fetch.remote_callbacks(super::remote::make_callbacks());
    let mut opts = git2::SubmoduleUpdateOptions::new();
    opts.fetch(fetch);
    sub.update(true, Some(&mut opts))?;
    Ok(())
}
