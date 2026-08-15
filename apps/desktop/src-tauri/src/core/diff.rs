use base64::Engine;
use git2::{Delta, Diff, DiffOptions, Patch, Repository};

use crate::error::{AppError, AppResult};

use super::types::{DiffHunk, DiffLine, FileDiff};

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif",
];

fn is_image_path(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Clone, Copy, PartialEq)]
pub enum DiffTarget {
    Unstaged,
    Staged,
}

fn base_opts(file: Option<&str>, context_lines: u32) -> DiffOptions {
    let mut opts = DiffOptions::new();
    let context_lines = context_lines.min(10_000_000);
    opts.context_lines(context_lines)
        .include_untracked(true)
        .show_untracked_content(true)
        .recurse_untracked_dirs(true);
    if let Some(f) = file {
        opts.pathspec(f);
    }
    opts
}

fn make_diff<'a>(
    repo: &'a Repository,
    target: DiffTarget,
    file: Option<&str>,
    context_lines: u32,
) -> AppResult<Diff<'a>> {
    let mut opts = base_opts(file, context_lines);
    let diff = match target {
        DiffTarget::Unstaged => repo.diff_index_to_workdir(None, Some(&mut opts))?,
        DiffTarget::Staged => {
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
        }
    };
    Ok(diff)
}

fn hunks_from_patch(patch: &Patch) -> AppResult<(Vec<DiffHunk>, u32, u32)> {
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    let mut additions = 0u32;
    let mut deletions = 0u32;
    for h in 0..patch.num_hunks() {
        let (hunk, line_count) = patch.hunk(h)?;
        let mut lines = Vec::with_capacity(line_count);
        for l in 0..line_count {
            let line = patch.line_in_hunk(h, l)?;
            if matches!(line.origin(), '<' | '>' | '=') {
                continue; // "\ No newline at end of file" markers — not real lines
            }
            let kind = match line.origin() {
                '+' => {
                    additions += 1;
                    "addition"
                }
                '-' => {
                    deletions += 1;
                    "deletion"
                }
                _ => "context",
            };
            lines.push(DiffLine {
                kind: kind.to_string(),
                old_line_no: line.old_lineno(),
                new_line_no: line.new_lineno(),
                content: String::from_utf8_lossy(line.content())
                    .trim_end_matches('\n')
                    .to_string(),
            });
        }
        hunks.push(DiffHunk {
            header: String::from_utf8_lossy(hunk.header())
                .trim_end()
                .to_string(),
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            lines,
        });
    }
    Ok((hunks, additions, deletions))
}

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

fn blob_base64(repo: &Repository, oid: git2::Oid) -> Option<String> {
    if oid.is_zero() {
        return None;
    }
    let blob = repo.find_blob(oid).ok()?;
    if blob.content().len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(blob.content()))
}

fn workdir_base64(repo: &Repository, path: &str) -> Option<String> {
    let full = repo.workdir()?.join(path);
    let meta = std::fs::metadata(&full).ok()?;
    if meta.len() > MAX_IMAGE_BYTES as u64 {
        return None;
    }
    std::fs::read(full)
        .ok()
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn file_diff_from(
    repo: &Repository,
    diff: &Diff,
    delta_index: usize,
    workdir_new: bool,
) -> AppResult<FileDiff> {
    let delta = diff
        .get_delta(delta_index)
        .ok_or_else(|| AppError::other("delta out of range"))?;
    let new_path = delta
        .new_file()
        .path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let old_path = delta
        .old_file()
        .path()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|p| *p != new_path && delta.status() == Delta::Renamed);

    let status = match delta.status() {
        Delta::Added | Delta::Copied | Delta::Untracked => "new",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        _ => "modified",
    }
    .to_string();

    let is_binary = delta.flags().is_binary();
    let is_image = is_image_path(&new_path);

    let (hunks, additions, deletions) = if is_binary || is_image {
        (Vec::new(), 0, 0)
    } else {
        match Patch::from_diff(diff, delta_index)? {
            Some(patch) => hunks_from_patch(&patch)?,
            None => (Vec::new(), 0, 0),
        }
    };

    let (old_image, new_image) = if is_image {
        let old = blob_base64(repo, delta.old_file().id());
        let new = if workdir_new {
            workdir_base64(repo, &new_path)
        } else {
            blob_base64(repo, delta.new_file().id())
        };
        (old, new)
    } else {
        (None, None)
    };

    Ok(FileDiff {
        path: new_path,
        old_path,
        status,
        hunks,
        is_binary,
        is_image,
        old_image,
        new_image,
        additions,
        deletions,
    })
}

pub fn file_diff(path: &str, file: &str, staged: bool, context_lines: u32) -> AppResult<FileDiff> {
    let repo = super::repo::open(path)?;
    let target = if staged {
        DiffTarget::Staged
    } else {
        DiffTarget::Unstaged
    };
    let diff = make_diff(&repo, target, Some(file), context_lines)?;
    if diff.deltas().len() == 0 {
        return Ok(FileDiff {
            path: file.to_string(),
            old_path: None,
            status: "modified".into(),
            hunks: Vec::new(),
            is_binary: false,
            is_image: is_image_path(file),
            old_image: None,
            new_image: None,
            additions: 0,
            deletions: 0,
        });
    }
    file_diff_from(&repo, &diff, 0, !staged)
}

pub fn commit_diff(path: &str, oid: &str, context_lines: u32) -> AppResult<Vec<FileDiff>> {
    let repo = super::repo::open(path)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;

    let mut opts = base_opts(None, context_lines);
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true);
    diff.find_similar(Some(&mut find_opts))?;

    let count = diff.deltas().len();
    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        result.push(file_diff_from(&repo, &diff, i, false)?);
    }
    Ok(result)
}

pub fn staged_patch_text(path: &str) -> AppResult<String> {
    let repo = super::repo::open(path)?;
    let diff = make_diff(&repo, DiffTarget::Staged, None, 3)?;
    let mut text = String::new();
    diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        match line.origin() {
            '+' | '-' | ' ' => text.push(line.origin()),
            _ => {}
        }
        text.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;
    Ok(text)
}
