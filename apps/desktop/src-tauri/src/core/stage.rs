use std::{fs, io::ErrorKind, path::Path};

use git2::{ApplyLocation, DiffFormat, DiffOptions, Repository};

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
    let repo = super::repo::open(path)?;
    discard_to_head(&repo, file)?;
    Ok(!touched_paths(&repo)?.iter().any(|p| p == file))
}

pub fn discard_staged_all(path: &str) -> AppResult<Vec<String>> {
    let (batch, _) = discard_staged_all_reporting(path)?;
    if let Some(failure) = batch.failed.first() {
        return Err(AppError::other(failure.message.clone()));
    }
    Ok(batch.leftovers)
}

pub(crate) fn discard_staged_all_reporting(path: &str) -> AppResult<(DiscardBatch, bool)> {
    let repo = super::repo::open(path)?;
    let mut opts = git2::StatusOptions::new();
    opts.show(git2::StatusShow::Index)
        .include_untracked(false)
        .renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut staged: Vec<_> = statuses
        .iter()
        .filter(|e| {
            e.status().intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            )
        })
        .filter_map(|e| {
            let delta = e.head_to_index()?;
            let source = delta.old_file().path()?.to_string_lossy().into_owned();
            let destination = if e.status().is_index_renamed() {
                Some(delta.new_file().path()?.to_string_lossy().into_owned())
            } else {
                None
            };
            Some((source, destination))
        })
        .collect();
    drop(statuses);
    let mut batch = DiscardBatch::default();
    let mut restored_any = false;
    let mut restored = Vec::new();
    loop {
        let mut progress = false;
        let mut deferred = Vec::new();
        for (source, destination) in staged {
            let mut failed_path = &source;
            let source_result = match destination.as_deref() {
                Some(file) => discard_rename_source(&repo, &source, file),
                None => discard_to_head(&repo, &source).map(|()| None),
            };
            let result = source_result.and_then(|backup| {
                progress = true;
                restored_any = true;
                if let Some(file) = &destination {
                    failed_path = file;
                    discard_rename_destination(&repo, file, backup)?;
                }
                Ok(())
            });
            match result {
                Ok(()) => restored.push((source, destination)),
                Err(error) => {
                    repo.index()?.read(true)?;
                    let failure = DiscardFailure {
                        path: failed_path.clone(),
                        message: error.to_string(),
                    };
                    if destination.is_some()
                        && failed_path == &source
                        && matches!(error, AppError::Conflict(_))
                    {
                        deferred.push((source, destination, failure));
                    } else {
                        batch.failed.push(failure);
                    }
                }
            }
        }
        if deferred.is_empty() || !progress {
            batch
                .failed
                .extend(deferred.into_iter().map(|(_, _, failure)| failure));
            break;
        }
        staged = deferred
            .into_iter()
            .map(|(source, destination, _)| (source, destination))
            .collect();
    }
    let remaining = touched_paths(&repo)?;
    batch.leftovers = restored
        .into_iter()
        .filter_map(|(source, destination)| {
            std::iter::once(source)
                .chain(destination)
                .find(|file| remaining.contains(file))
        })
        .collect();
    Ok((batch, restored_any))
}

fn discard_rename_source(
    repo: &Repository,
    source: &str,
    destination: &str,
) -> AppResult<Option<tempfile::TempDir>> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let source_path = workdir.join(source);
    let destination_path = workdir.join(destination);
    let Some(blocker) = rename_blocker(&source_path, &destination_path) else {
        if (source_path.is_dir() && !contains_only_empty_directories(&source_path)?)
            || source_path
                .ancestors()
                .skip(1)
                .take_while(|parent| *parent != workdir)
                .any(Path::is_file)
        {
            return Err(AppError::Conflict(format!(
                "another path occupies {source}"
            )));
        }
        return restore_rename_source(repo, source, destination).map(|()| None);
    };
    let metadata = match blocker.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return restore_rename_source(repo, source, destination).map(|()| None);
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.is_dir() && !contains_only_rename_destination(blocker, &destination_path)? {
        return Err(AppError::Conflict(format!(
            "a directory containing other files occupies {source}"
        )));
    }

    let parent = blocker.parent().expect("path is inside the worktree");
    let backup = tempfile::Builder::new()
        .prefix(".angkorgit-discard-")
        .tempdir_in(parent)?;
    let original = backup.path().join("original");
    fs::rename(blocker, &original)?;
    if let Err(error) = restore_rename_source(repo, source, destination) {
        let replacement = backup.path().join("replacement");
        let rollback = match fs::rename(blocker, replacement) {
            Ok(()) => fs::rename(&original, blocker),
            Err(error) if error.kind() == ErrorKind::NotFound => fs::rename(&original, blocker),
            Err(error) => Err(error),
        };
        if let Err(rollback) = rollback {
            let backup_path = backup.keep().join("original");
            return Err(AppError::other(format!(
                "{error}. Could not put the original back ({rollback}). It is saved at {}",
                backup_path.display()
            )));
        }
        return Err(error);
    }
    Ok(Some(backup))
}

fn restore_rename_source(repo: &Repository, source: &str, destination: &str) -> AppResult<()> {
    let tree = repo.head()?.peel_to_tree()?;
    let source_path = Path::new(source);
    let destination_path = Path::new(destination);
    let head_entry = tree.get_path(source_path)?;
    checkout_head_file(repo, &tree, source, false)?;

    let mut index = repo.index()?;
    index.read(true)?;
    if index
        .get_path(destination_path, 0)
        .is_some_and(|entry| entry.path == destination.as_bytes())
    {
        index.remove(destination_path, 0)?;
    }
    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: head_entry.filemode() as u32,
        uid: 0,
        gid: 0,
        file_size: 0,
        id: head_entry.id(),
        flags: 0,
        flags_extended: 0,
        path: source.as_bytes().to_vec(),
    };
    let expected_len = index.len()
        + usize::from(
            !index
                .get_path(source_path, 0)
                .is_some_and(|existing| existing.path == entry.path),
        );
    index.add(&entry)?;
    if index.len() != expected_len {
        return Err(AppError::Conflict(format!(
            "another staged path occupies {source}"
        )));
    }
    if !index.get_path(source_path, 0).is_some_and(|restored| {
        restored.path == entry.path && restored.id == entry.id && restored.mode == entry.mode
    }) {
        return Err(AppError::other(format!(
            "Could not restore {source} in the index"
        )));
    }
    index.write()?;
    Ok(())
}

fn rename_blocker<'a>(source: &Path, destination: &'a Path) -> Option<&'a Path> {
    let source_depth = source.components().count();
    let destination_depth = destination.components().count();
    let source_root = source
        .ancestors()
        .nth(source_depth.saturating_sub(destination_depth))?;
    let destination_root = destination
        .ancestors()
        .nth(destination_depth.saturating_sub(source_depth))?;
    same_checkout_path(source_root, destination_root).then_some(destination_root)
}

fn same_checkout_path(source: &Path, destination: &Path) -> bool {
    if source == destination {
        return true;
    }
    let Ok(source_metadata) = source.symlink_metadata() else {
        return false;
    };
    let Ok(destination_metadata) = destination.symlink_metadata() else {
        return false;
    };
    if source_metadata.is_symlink() || destination_metadata.is_symlink() {
        return source_metadata.is_symlink()
            && destination_metadata.is_symlink()
            && source
                .as_os_str()
                .eq_ignore_ascii_case(destination.as_os_str());
    }
    source.canonicalize().is_ok_and(|source| {
        destination
            .canonicalize()
            .is_ok_and(|destination| source == destination)
    })
}

fn contains_only_rename_destination(blocker: &Path, destination: &Path) -> AppResult<bool> {
    match destination.symlink_metadata() {
        Ok(metadata) if metadata.is_dir() => return Ok(false),
        Err(error) if error.kind() != ErrorKind::NotFound => return Err(error.into()),
        _ => {}
    }
    let mut child = destination;
    while let Some(parent) = child.parent().filter(|parent| parent.starts_with(blocker)) {
        if !parent.symlink_metadata()?.is_dir() {
            return Ok(false);
        }
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            let path = entry.path();
            if path != child && !contains_only_empty_directories(&path)? {
                return Ok(false);
            }
        }
        if parent == blocker {
            return Ok(true);
        }
        child = parent;
    }
    Ok(false)
}

fn contains_only_empty_directories(path: &Path) -> AppResult<bool> {
    if !path.symlink_metadata()?.is_dir() {
        return Ok(false);
    }
    for child in fs::read_dir(path)? {
        if !contains_only_empty_directories(&child?.path())? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn discard_rename_destination(
    repo: &Repository,
    file: &str,
    backup: Option<tempfile::TempDir>,
) -> AppResult<()> {
    let Some(backup) = backup else {
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::other("bare repository"))?;
        return remove_worktree_file(workdir, file);
    };
    let backup_path = backup.path().to_path_buf();
    backup.close().map_err(|error| {
        AppError::other(format!(
            "Could not remove the backup at {}: {error}",
            backup_path.display()
        ))
    })
}

fn discard_to_head(repo: &Repository, file: &str) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    if let Some(tree) = head_tree.filter(|tree| tree.get_path(Path::new(file)).is_ok()) {
        checkout_head_file(repo, &tree, file, true)
    } else {
        let mut index = repo.index()?;
        let _ = index.remove_path(Path::new(file));
        index.write()?;
        remove_worktree_file(workdir, file)
    }
}

fn checkout_head_file(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    file: &str,
    update_index: bool,
) -> AppResult<()> {
    let mut builder = git2::build::CheckoutBuilder::new();
    builder
        .path(file)
        .disable_pathspec_match(true)
        .force()
        .update_index(update_index);
    repo.checkout_tree(tree.as_object(), Some(&mut builder))?;
    Ok(())
}

fn remove_worktree_file(workdir: &Path, file: &str) -> AppResult<()> {
    let full = workdir.join(file);
    if full.is_file() || full.is_symlink() {
        fs::remove_file(full)?;
    }
    Ok(())
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
