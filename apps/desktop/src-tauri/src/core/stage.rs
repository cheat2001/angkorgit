use std::path::{Path, PathBuf};

use git2::{ApplyLocation, DiffFormat, DiffOptions, Index, IndexEntry, IndexTime, Repository};

use super::types::{DiscardBatch, DiscardFailure};
use crate::error::{AppError, AppResult};

pub fn stage_file(path: &str, file: &str) -> AppResult<()> {
    stage_files(path, &[file.to_string()])
}

pub fn stage_files(path: &str, files: &[String]) -> AppResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let repo = super::repo::open(path)?;
    let mut index = repo.index()?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    for file in files {
        if workdir.join(file).symlink_metadata().is_ok() {
            index.add_path(Path::new(file))?;
        } else {
            index.remove_path(Path::new(file))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn unstage_file(path: &str, file: &str) -> AppResult<()> {
    unstage_files(path, &[file.to_string()])
}

pub fn unstage_files(path: &str, files: &[String]) -> AppResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let repo = super::repo::open(path)?;
    match repo.head() {
        Ok(head) => {
            let obj = head.peel(git2::ObjectType::Commit)?;
            repo.reset_default(Some(&obj), files)?;
        }
        Err(_) => {
            let mut index = repo.index()?;
            for file in files {
                index.remove_path(Path::new(file))?;
            }
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

pub fn discard_file(path: &str, file: &str) -> AppResult<bool> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let index = repo.index()?;
    let is_tracked = index.get_path(Path::new(file), 0).is_some();
    if !is_tracked {
        let full = workdir.join(file);
        if full.is_file() {
            std::fs::remove_file(full)?;
        }
    } else if let Some(mut sub) = super::submodule::drifted(&repo, file) {
        super::submodule::checkout_recorded(&mut sub)?;
    } else {
        let mut builder = git2::build::CheckoutBuilder::new();
        builder.path(file).force().update_index(false);
        repo.checkout_index(None, Some(&mut builder))?;
    }
    Ok(!unstaged_paths(&repo)?.iter().any(|p| p == file))
}

pub fn discard_all(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;

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

    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force().update_index(false);
    repo.checkout_index(None, Some(&mut builder))?;

    for leftover in unstaged_paths(&repo)? {
        if let Some(mut sub) = super::submodule::drifted(&repo, &leftover) {
            let _ = super::submodule::checkout_recorded(&mut sub);
        }
    }
    unstaged_paths(&repo)
}

pub fn discard_staged_file(path: &str, file: &str) -> AppResult<bool> {
    let (batch, _) = discard_staged(path, Some(&[file.to_string()]))?;
    if let Some(failure) = batch.failed.into_iter().next() {
        return Err(AppError::other(failure.message));
    }
    Ok(batch.leftovers.is_empty())
}

pub fn discard_staged_all(path: &str) -> AppResult<Vec<String>> {
    let (batch, _) = discard_staged_all_reporting(path)?;
    if let Some(failure) = batch.failed.first() {
        return Err(AppError::other(failure.message.clone()));
    }
    Ok(batch.leftovers)
}

pub(crate) fn discard_staged_all_reporting(path: &str) -> AppResult<(DiscardBatch, bool)> {
    discard_staged(path, None)
}

pub(crate) fn discard_staged_files_reporting(
    path: &str,
    files: &[String],
) -> AppResult<(DiscardBatch, bool)> {
    discard_staged(path, Some(files))
}

fn discard_staged(path: &str, selected: Option<&[String]>) -> AppResult<(DiscardBatch, bool)> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?
        .to_path_buf();
    let lock = IndexLock::acquire(&repo)?;
    let files = staged_targets(&repo, selected)?;
    let mut batch = DiscardBatch::default();
    let mut restored_any = false;
    if files.is_empty() {
        return Ok((batch, restored_any));
    }
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let (removals, restores): (Vec<_>, Vec<_>) = files
        .into_iter()
        .map(|file| {
            let entry = head_tree
                .as_ref()
                .and_then(|tree| tree.get_path(Path::new(&file)).ok())
                .filter(|entry| entry.kind() != Some(git2::ObjectType::Tree));
            (file, entry)
        })
        .partition(|(_, entry)| entry.is_none());
    let mut index = lock.index()?;
    let mut processed = Vec::new();
    for (file, entry) in removals.into_iter().chain(restores) {
        let result = match (&head_tree, &entry) {
            (Some(tree), Some(entry)) => restore_from_head(&repo, tree, &mut index, &file, entry),
            _ => remove_staged_addition(&workdir, &mut index, &file),
        };
        match result {
            Ok(()) => {
                restored_any = true;
                processed.push(file);
            }
            Err(error) => batch.failed.push(DiscardFailure {
                path: file,
                message: error.to_string(),
            }),
        }
    }
    if restored_any {
        lock.publish(index)?;
    }
    let remaining = touched_paths(&repo)?;
    batch.leftovers = processed
        .into_iter()
        .filter(|p| remaining.contains(p))
        .collect();
    Ok((batch, restored_any))
}

fn staged_targets(repo: &Repository, selected: Option<&[String]>) -> AppResult<Vec<String>> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(false).renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let staged = git2::Status::INDEX_NEW
        | git2::Status::INDEX_MODIFIED
        | git2::Status::INDEX_DELETED
        | git2::Status::INDEX_RENAMED
        | git2::Status::INDEX_TYPECHANGE;
    let groups: Vec<Vec<String>> = statuses
        .iter()
        .filter(|e| e.status().intersects(staged))
        .map(|e| {
            let delta = e.head_to_index();
            let old = delta
                .as_ref()
                .and_then(|d| d.old_file().path().map(path_string));
            let new = delta.and_then(|d| d.new_file().path().map(path_string));
            let mut paths: Vec<String> = old.into_iter().chain(new).collect();
            paths.dedup();
            if paths.is_empty() {
                paths.extend(e.path().map(String::from));
            }
            paths
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::new();
    let mut take = |paths: &[String]| {
        for path in paths {
            if seen.insert(path.clone()) {
                targets.push(path.clone());
            }
        }
    };
    match selected {
        None => groups.iter().for_each(|group| take(group)),
        Some(files) => {
            for file in files {
                match groups.iter().find(|group| group.contains(file)) {
                    Some(group) => take(group),
                    None => take(std::slice::from_ref(file)),
                }
            }
        }
    }
    Ok(targets)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn restore_from_head(
    repo: &Repository,
    tree: &git2::Tree,
    index: &mut Index,
    file: &str,
    entry: &git2::TreeEntry,
) -> AppResult<()> {
    let mut builder = git2::build::CheckoutBuilder::new();
    builder
        .path(file)
        .disable_pathspec_match(true)
        .force()
        .update_index(false);
    repo.checkout_tree(tree.as_object(), Some(&mut builder))?;
    index.remove_path(Path::new(file))?;
    index.add(&IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: entry.filemode() as u32,
        uid: 0,
        gid: 0,
        file_size: 0,
        id: entry.id(),
        flags: 0,
        flags_extended: 0,
        path: file.as_bytes().to_vec(),
    })?;
    Ok(())
}

fn remove_staged_addition(workdir: &Path, index: &mut Index, file: &str) -> AppResult<()> {
    let full = workdir.join(file);
    if full.is_file() || full.is_symlink() {
        std::fs::remove_file(full)?;
    }
    index.remove_path(Path::new(file))?;
    Ok(())
}

struct IndexLock {
    lock: PathBuf,
    index: PathBuf,
    held: bool,
}

impl IndexLock {
    fn acquire(repo: &Repository) -> AppResult<Self> {
        let lock = repo.path().join("index.lock");
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
        {
            Ok(_) => Ok(Self {
                lock,
                index: repo.path().join("index"),
                held: true,
            }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(AppError::other(format!(
                    "Another Git process is using this repository ({} exists), so nothing was discarded. If no Git process is running, delete that file and try again.",
                    lock.display()
                )))
            }
            Err(error) => Err(error.into()),
        }
    }

    fn index(&self) -> AppResult<Index> {
        std::fs::copy(&self.index, &self.lock)?;
        Ok(Index::open(&self.lock)?)
    }

    fn publish(mut self, mut index: Index) -> AppResult<()> {
        index.write()?;
        drop(index);
        std::fs::rename(&self.lock, &self.index)?;
        self.held = false;
        Ok(())
    }
}

impl Drop for IndexLock {
    fn drop(&mut self) {
        if self.held {
            let _ = std::fs::remove_file(&self.lock);
        }
    }
}

fn touched_paths(repo: &git2::Repository) -> AppResult<Vec<String>> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(statuses
        .iter()
        .filter_map(|e| e.path().map(String::from))
        .collect())
}

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
                    emitted.push((' ', content));
                    old_count += 1;
                    new_count += 1;
                }
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
                    emitted.push((' ', content));
                    old_count += 1;
                    new_count += 1;
                }
            }
            _ => {} // eof-newline markers: re-derived from content below
        }
    }

    if !selected_found {
        return Err(AppError::other(
            "the selected line is not an added or removed line",
        ));
    }

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

pub fn stage_line(path: &str, file: &str, kind: &str, line_no: u32) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let diff = file_diff_workdir_to_index(&repo, file)?;
    let (hunk_index, line_index) = locate_line(&diff, kind, line_no)?;
    let patch_text = single_line_patch(&diff, hunk_index, &[line_index], false)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}

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

fn isolated_hunk_patch(diff: &git2::Diff, hunk_index: usize) -> AppResult<String> {
    let (header, hunks) = split_patch(diff)?;
    let hunk_text = hunks
        .get(hunk_index)
        .ok_or_else(|| AppError::other(format!("hunk {hunk_index} not found")))?;
    let patch = git2::Patch::from_diff(diff, 0)?
        .ok_or_else(|| AppError::other("no textual diff for this file"))?;
    let (hunk, _) = patch.hunk(hunk_index)?;
    let body = hunk_text
        .split_once('\n')
        .map(|(_, body)| body)
        .unwrap_or("");
    let new_start = if hunk.old_lines() == 0 {
        hunk.new_start()
    } else {
        hunk.old_start()
    };
    Ok(format!(
        "{header}@@ -{},{} +{new_start},{} @@\n{body}",
        hunk.old_start(),
        hunk.old_lines(),
        hunk.new_lines()
    ))
}

pub fn stage_hunk(path: &str, file: &str, hunk_index: usize) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let diff = file_diff_workdir_to_index(&repo, file)?;
    let patch_text = isolated_hunk_patch(&diff, hunk_index)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}

pub fn unstage_hunk(path: &str, file: &str, hunk_index: usize) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(file).context_lines(3).reverse(true);
    let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
    let patch_text = isolated_hunk_patch(&diff, hunk_index)?;
    let patch = git2::Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&patch, ApplyLocation::Index, None)?;
    Ok(())
}
