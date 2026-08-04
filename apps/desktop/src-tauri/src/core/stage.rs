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
                // "no newline at end of file" markers: the unterminated line
                // before them carries no \n of its own, so add one first.
                if let Some(last) = hunks.last_mut() {
                    if !last.ends_with('\n') {
                        last.push('\n');
                    }
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

/// Build a patch containing ONLY one selected +/- line of a hunk.
///
/// Forward mode (stage): unselected additions are dropped, unselected
/// deletions become context — applying to the index stages just that line.
/// Reverse mode (unstage/discard): the selected line's sign flips, unselected
/// additions become context, unselected deletions are dropped — applying
/// undoes just that line on the target side.
fn single_line_patch(
    diff: &git2::Diff,
    hunk_index: usize,
    selected: &[usize],
    reverse: bool,
) -> AppResult<String> {
    let (file_header, _) = split_patch(diff)?;
    let patch = git2::Patch::from_diff(diff, 0)?
        .ok_or_else(|| AppError::other("no textual diff for this file"))?;
    if hunk_index >= patch.num_hunks() {
        return Err(AppError::other(format!("hunk {hunk_index} not found")));
    }
    let (hunk, line_count) = patch.hunk(hunk_index)?;

    // Staging a line that sits below the old file's unterminated last line
    // only works if that line's newline fix comes along — a patch cannot
    // append below a line that has no newline. Same rule as `git add -p`.
    let mut selected: Vec<usize> = selected.to_vec();
    if !reverse {
        let noeol_del = (0..line_count).find(|&j| {
            patch
                .line_in_hunk(hunk_index, j)
                .map(|l| l.origin() == '-' && !l.content().ends_with(b"\n"))
                .unwrap_or(false)
        });
        if let Some(d) = noeol_del {
            let adds_below = selected.iter().any(|&j| {
                j > d
                    && patch
                        .line_in_hunk(hunk_index, j)
                        .map(|l| l.origin() == '+')
                        .unwrap_or(false)
            });
            if adds_below && !selected.contains(&d) {
                selected.push(d);
                if let Some(p) = pair_partner(&patch, hunk_index, line_count, d)? {
                    if !selected.contains(&p) {
                        selected.push(p);
                    }
                }
            }
        }
    }

    let mut emitted: Vec<(char, String)> = Vec::new();
    let mut old_count = 0u32;
    let mut new_count = 0u32;
    let mut selected_found = false;

    for j in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, j)?;
        let content = String::from_utf8_lossy(line.content()).to_string();
        let is_selected = selected.contains(&j);
        match line.origin() {
            ' ' => {
                emitted.push((' ', content));
                old_count += 1;
                new_count += 1;
            }
            '+' => {
                if is_selected {
                    selected_found = true;
                    emitted.push((if reverse { '-' } else { '+' }, content));
                    if reverse {
                        old_count += 1;
                    } else {
                        new_count += 1;
                    }
                } else if reverse {
                    // stays present on the target side → context
                    emitted.push((' ', content));
                    old_count += 1;
                    new_count += 1;
                }
                // forward: unselected additions are simply not staged
            }
            '-' => {
                if is_selected {
                    selected_found = true;
                    emitted.push((if reverse { '+' } else { '-' }, content));
                    if reverse {
                        new_count += 1;
                    } else {
                        old_count += 1;
                    }
                } else if !reverse {
                    // still present on the target side → context
                    emitted.push((' ', content));
                    old_count += 1;
                    new_count += 1;
                }
                // reverse: unselected deletions don't exist on the target side
            }
            _ => {} // eof-newline markers: re-derived from content below
        }
    }

    if !selected_found {
        return Err(AppError::other(
            "the selected line is not an added or removed line",
        ));
    }

    // Render, restoring "\ No newline at end of file" markers wherever the
    // emitted content is unterminated. A marker is only representable when
    // nothing follows on that line's side of the patch; anywhere else the
    // newline has to materialize instead.
    let mut body = String::new();
    for (i, (sign, content)) in emitted.iter().enumerate() {
        body.push(*sign);
        body.push_str(content);
        if !content.ends_with('\n') {
            body.push('\n');
            let last_of_side = match sign {
                '-' => emitted[i + 1..].iter().all(|(s, _)| *s == '+'),
                _ => i + 1 == emitted.len(),
            };
            if last_of_side {
                body.push_str("\\ No newline at end of file\n");
            }
        }
    }
    let start = if reverse {
        hunk.new_start()
    } else {
        hunk.old_start()
    };
    Ok(format!(
        "{file_header}@@ -{start},{old_count} +{start},{new_count} @@\n{body}"
    ))
}

/// The counterpart of a line inside a -/+ modification block: the k-th
/// deletion pairs with the k-th addition of the same contiguous block.
/// Discarding a modified line must revert the PAIR, restoring the original.
fn pair_partner(
    patch: &git2::Patch,
    hunk_index: usize,
    line_count: usize,
    selected: usize,
) -> AppResult<Option<usize>> {
    let mut minus: Vec<usize> = Vec::new();
    let mut plus: Vec<usize> = Vec::new();
    let mut partner = None;
    let mut resolve = |minus: &mut Vec<usize>, plus: &mut Vec<usize>| {
        if let Some(k) = minus.iter().position(|&j| j == selected) {
            partner = plus.get(k).copied();
        } else if let Some(k) = plus.iter().position(|&j| j == selected) {
            partner = minus.get(k).copied();
        }
        minus.clear();
        plus.clear();
    };
    for j in 0..line_count {
        match patch.line_in_hunk(hunk_index, j)?.origin() {
            '-' => minus.push(j),
            '+' => plus.push(j),
            ' ' => resolve(&mut minus, &mut plus),
            _ => {} // eof-newline markers sit inside a block — don't split it
        }
    }
    resolve(&mut minus, &mut plus);
    Ok(partner)
}

/// Locate a change line by its stable identity — origin sign + line number —
/// independent of how the UI's diff was rendered (context size, split view…).
/// The engine always relocates the line in ITS OWN compact diff.
fn locate_line(diff: &git2::Diff, kind: &str, line_no: u32) -> AppResult<(usize, usize)> {
    let patch = git2::Patch::from_diff(diff, 0)?
        .ok_or_else(|| AppError::other("no textual diff for this file"))?;
    let want_origin = match kind {
        "addition" => '+',
        "deletion" => '-',
        _ => {
            return Err(AppError::other(
                "only added or removed lines can be selected",
            ))
        }
    };
    for h in 0..patch.num_hunks() {
        let (_, line_count) = patch.hunk(h)?;
        for j in 0..line_count {
            let line = patch.line_in_hunk(h, j)?;
            if line.origin() != want_origin {
                continue;
            }
            let matches = match want_origin {
                '+' => line.new_lineno() == Some(line_no),
                _ => line.old_lineno() == Some(line_no),
            };
            if matches {
                return Ok((h, j));
            }
        }
    }
    Err(AppError::other(
        "that line is no longer part of the current changes — refresh and try again",
    ))
}

/// Stage a single line of a file's unstaged changes.
pub fn stage_line(path: &str, file: &str, kind: &str, line_no: u32) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let diff = file_diff_workdir_to_index(&repo, file)?;
    let (hunk_index, line_index) = locate_line(&diff, kind, line_no)?;
    let patch_text = single_line_patch(&diff, hunk_index, &[line_index], false)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}

/// Unstage a single line (identified against the staged HEAD→index diff).
pub fn unstage_line(path: &str, file: &str, kind: &str, line_no: u32) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(file).context_lines(3);
    let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
    let (hunk_index, line_index) = locate_line(&diff, kind, line_no)?;
    let patch_text = single_line_patch(&diff, hunk_index, &[line_index], true)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}

/// Discard a single unstaged line from the working tree. Destructive.
/// Pair-aware: discarding either side of a modified line reverts the pair,
/// restoring the original text instead of just deleting the line.
pub fn discard_line(path: &str, file: &str, kind: &str, line_no: u32) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let diff = file_diff_workdir_to_index(&repo, file)?;
    let (hunk_index, line_index) = locate_line(&diff, kind, line_no)?;
    let patch = git2::Patch::from_diff(&diff, 0)?
        .ok_or_else(|| AppError::other("no textual diff for this file"))?;
    let (_, line_count) = patch.hunk(hunk_index)?;
    let mut selected = vec![line_index];
    if let Some(partner) = pair_partner(&patch, hunk_index, line_count, line_index)? {
        selected.push(partner);
    }
    let patch_text = single_line_patch(&diff, hunk_index, &selected, true)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::WorkDir, None)?;
    Ok(())
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
