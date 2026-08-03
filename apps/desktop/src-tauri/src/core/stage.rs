use std::path::Path;

use git2::{ApplyLocation, DiffFormat, DiffOptions, Repository};

use crate::error::{AppError, AppResult};

/// Stage a whole file (handles new, modified and deleted files).
pub fn stage_file(path: &str, file: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut index = repo.index()?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    if workdir.join(file).exists() {
        index.add_path(Path::new(file))?;
    } else {
        index.remove_path(Path::new(file))?;
    }
    index.write()?;
    Ok(())
}

/// Unstage a file — reset its index entry back to HEAD.
pub fn unstage_file(path: &str, file: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    match repo.head() {
        Ok(head) => {
            let obj = head.peel(git2::ObjectType::Commit)?;
            repo.reset_default(Some(&obj), [file])?;
        }
        Err(_) => {
            // Unborn HEAD: unstage means removing the entry entirely.
            let mut index = repo.index()?;
            index.remove_path(Path::new(file))?;
            index.write()?;
        }
    }
    Ok(())
}

pub fn stage_all(path: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_all(path: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    match repo.head() {
        Ok(head) => {
            let obj = head.peel(git2::ObjectType::Commit)?;
            // libgit2 pathspecs use fnmatch: "*" matches everything ("." does not)
            repo.reset_default(Some(&obj), ["*"])?;
        }
        Err(_) => {
            let mut index = repo.index()?;
            index.clear()?;
            index.write()?;
        }
    }
    Ok(())
}

/// Paths that still have unstaged changes (used to detect discard no-ops,
/// e.g. submodule pointer changes that checkout-index cannot touch).
fn unstaged_paths(repo: &git2::Repository) -> AppResult<Vec<String>> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(statuses
        .iter()
        .filter(|e| {
            let s = e.status();
            s.is_wt_new()
                || s.is_wt_modified()
                || s.is_wt_deleted()
                || s.is_wt_renamed()
                || s.is_wt_typechange()
        })
        .filter_map(|e| e.path().map(String::from))
        .collect())
}

/// Discard workdir changes for a file (checkout from index).
/// Returns `true` when the file is actually clean afterwards — submodule
/// changes, for example, cannot be discarded from the parent repository.
pub fn discard_file(path: &str, file: &str) -> AppResult<bool> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let index = repo.index()?;
    let is_tracked = index.get_path(Path::new(file), 0).is_some();
    if !is_tracked {
        // Untracked file: discard means delete.
        let full = workdir.join(file);
        if full.is_file() {
            std::fs::remove_file(full)?;
        }
    } else {
        let mut builder = git2::build::CheckoutBuilder::new();
        builder.path(file).force().update_index(false);
        repo.checkout_index(None, Some(&mut builder))?;
    }
    Ok(!unstaged_paths(&repo)?.iter().any(|p| p == file))
}

/// Discard ALL working-tree changes: restore tracked files from the index
/// and delete untracked files. Destructive — the UI confirms first.
/// Returns paths that could NOT be discarded (typically submodules).
pub fn discard_all(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;

    // Untracked files: discard means delete.
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    for entry in statuses.iter() {
        if entry.status().is_wt_new() {
            if let Some(rel) = entry.path() {
                let full = workdir.join(rel);
                if full.is_file() {
                    let _ = std::fs::remove_file(full);
                }
            }
        }
    }

    // Tracked files: restore workdir from the index.
    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force().update_index(false);
    repo.checkout_index(None, Some(&mut builder))?;

    unstaged_paths(&repo)
}

/// Render the full patch text of a diff, split per hunk, keeping the file
/// header so single hunks can be re-parsed as standalone patches.
fn split_patch(diff: &git2::Diff) -> AppResult<(String, Vec<String>)> {
    let mut file_header = String::new();
    let mut hunks: Vec<String> = Vec::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let content = std::str::from_utf8(line.content()).unwrap_or("");
        match line.origin() {
            'F' => file_header.push_str(content),
            'H' => hunks.push(content.to_string()),
            '+' | '-' | ' ' => {
                if let Some(last) = hunks.last_mut() {
                    last.push(line.origin());
                    last.push_str(content);
                }
            }
            '<' | '>' | '=' => {
                // "no newline at end of file" markers
                if let Some(last) = hunks.last_mut() {
                    last.push_str("\\ No newline at end of file\n");
                }
            }
            _ => {}
        }
        true
    })?;
    Ok((file_header, hunks))
}

fn file_diff_workdir_to_index<'a>(repo: &'a Repository, file: &str) -> AppResult<git2::Diff<'a>> {
    let mut opts = DiffOptions::new();
    opts.pathspec(file)
        .include_untracked(true)
        .show_untracked_content(true)
        .recurse_untracked_dirs(true)
        .context_lines(3);
    Ok(repo.diff_index_to_workdir(None, Some(&mut opts))?)
}

/// Stage a single hunk of a file's unstaged changes.
pub fn stage_hunk(path: &str, file: &str, hunk_index: usize) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let diff = file_diff_workdir_to_index(&repo, file)?;
    let (header, hunks) = split_patch(&diff)?;
    let hunk = hunks
        .get(hunk_index)
        .ok_or_else(|| AppError::other(format!("hunk {hunk_index} not found")))?;
    let patch_text = format!("{header}{hunk}");
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}

/// Unstage a single hunk: apply the reverse of the staged (HEAD -> index)
/// hunk back onto the index.
pub fn unstage_hunk(path: &str, file: &str, hunk_index: usize) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(file).context_lines(3).reverse(true);
    let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
    let (header, hunks) = split_patch(&diff)?;
    let hunk = hunks
        .get(hunk_index)
        .ok_or_else(|| AppError::other(format!("hunk {hunk_index} not found")))?;
    let patch_text = format!("{header}{hunk}");
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}
