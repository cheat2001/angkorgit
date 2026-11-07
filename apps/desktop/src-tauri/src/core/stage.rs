use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

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
    let mut staged = staged_discard_paths(&statuses);
    drop(statuses);
    let mut batch = DiscardBatch::default();
    let mut restored_any = false;
    let mut restored = Vec::new();
    loop {
        let mut progress = false;
        let mut deferred = Vec::new();
        for (source, destination) in staged {
            let mut failed_path = source.as_str();
            let source_result = match destination.as_deref() {
                Some(file) => {
                    checkout_with_rollback(&repo, &source, Some(file), |destination_backed_up| {
                        restore_rename_source(
                            &repo,
                            &source,
                            file,
                            destination_backed_up,
                            &mut failed_path,
                        )
                    })
                }
                None => discard_to_head(&repo, &source).map(|()| (None, None)),
            };
            let result = source_result.and_then(|(source_backup, destination_backup)| {
                progress = true;
                restored_any = true;
                if let Some(file) = &destination {
                    failed_path = file;
                    if let Err(error) =
                        destination_backup.map_or(Ok(()), WorktreeFileBackup::discard)
                    {
                        let Some(backup) = source_backup else {
                            return Err(error);
                        };
                        return Err(AppError::other(format!(
                            "{error}. The original {source} is saved at {}",
                            backup.keep().join("original").display()
                        )));
                    }
                    if let Some(backup) = source_backup {
                        close_checkout_backup(backup)?;
                    }
                }
                Ok(())
            });
            match result {
                Ok(()) => restored.push((source, destination)),
                Err(error) => {
                    repo.index()?.read(true)?;
                    let failure = DiscardFailure {
                        path: failed_path.to_owned(),
                        message: error.to_string(),
                    };
                    if failed_path == source && matches!(error, AppError::Conflict(_)) {
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

fn staged_discard_paths(statuses: &git2::Statuses<'_>) -> Vec<(String, Option<String>)> {
    let mut staged = Vec::new();
    let mut symlinks: HashMap<git2::Oid, (Vec<usize>, Vec<usize>)> = HashMap::new();
    for entry in statuses.iter() {
        let status = entry.status();
        if !status.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            continue;
        }
        let Some(delta) = entry.head_to_index() else {
            continue;
        };
        let old = delta.old_file();
        let new = delta.new_file();
        let Some(source) = old.path() else {
            continue;
        };
        let destination = if status.is_index_renamed() {
            let Some(destination) = new.path() else {
                continue;
            };
            Some(destination.to_string_lossy().into_owned())
        } else {
            None
        };
        if status.is_index_deleted() && old.mode() == git2::FileMode::Link {
            symlinks.entry(old.id()).or_default().0.push(staged.len());
        } else if status.is_index_new() && new.mode() == git2::FileMode::Link {
            symlinks.entry(new.id()).or_default().1.push(staged.len());
        }
        staged.push(Some((source.to_string_lossy().into_owned(), destination)));
    }
    for (sources, destinations) in symlinks.into_values() {
        if let ([source], [destination]) = (sources.as_slice(), destinations.as_slice()) {
            let (destination, _) = staged[*destination]
                .take()
                .expect("staged symlink addition");
            staged[*source].as_mut().expect("staged symlink deletion").1 = Some(destination);
        }
    }
    staged.into_iter().flatten().collect()
}

fn checkout_with_rollback<T>(
    repo: &Repository,
    source: &str,
    destination: Option<&str>,
    checkout: impl FnOnce(bool) -> AppResult<T>,
) -> AppResult<(Option<tempfile::TempDir>, T)> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let source_path = workdir.join(source);
    let destination_path = destination.map(|file| workdir.join(file));
    let destination_blocker = match &destination_path {
        Some(path) => rename_blocker(&source_path, path)?,
        None => None,
    };
    let blocker = destination_blocker.unwrap_or(&source_path);
    check_checkout_parents(workdir, blocker, None)?;
    if let Some(blocker) = destination_blocker {
        check_checkout_parents(workdir, &source_path, Some(blocker))?;
    }
    let metadata = match blocker.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let error = match checkout(false) {
                Ok(result) => return Ok((None, result)),
                Err(error) => error,
            };
            if let Err(rollback) = remove_created_rename_source(&source_path) {
                return Err(AppError::other(format!(
                    "{error}. Could not remove the newly created {source} ({rollback})"
                )));
            }
            return Err(error);
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.is_dir() {
        let safe_to_move =
            if let (Some(_), Some(destination)) = (destination_blocker, &destination_path) {
                contains_only_rename_destination(blocker, destination)?
            } else {
                contains_only_empty_directories(blocker)?
            };
        if !safe_to_move {
            return Err(AppError::Conflict(format!(
                "a directory containing other files occupies {source}"
            )));
        }
    }

    let blocker = if destination.is_none() || metadata.is_symlink() {
        checkout_entry_path(blocker)?
    } else {
        blocker.to_path_buf()
    };
    let parent = blocker.parent().expect("path is inside the worktree");
    let backup = tempfile::Builder::new()
        .prefix(".angkorgit-discard-")
        .tempdir_in(parent)?;
    let original = backup.path().join("original");
    fs::rename(&blocker, &original)?;
    let error = match checkout(destination_blocker.is_some()) {
        Ok(result) => return Ok((Some(backup), result)),
        Err(error) => error,
    };
    let replacement = backup.path().join("replacement");
    let rollback = match fs::rename(&blocker, replacement) {
        Ok(()) => fs::rename(&original, &blocker),
        Err(error) if error.kind() == ErrorKind::NotFound => fs::rename(&original, &blocker),
        Err(error) => Err(error),
    };
    if let Err(rollback) = rollback {
        let backup_path = backup.keep().join("original");
        return Err(AppError::other(format!(
            "{error}. Could not put the original back ({rollback}). It is saved at {}",
            backup_path.display()
        )));
    }
    Err(error)
}

fn check_checkout_parents(
    workdir: &Path,
    path: &Path,
    movable_blocker: Option<&Path>,
) -> AppResult<()> {
    let relative = path
        .strip_prefix(workdir)
        .map_err(|_| AppError::other(format!("Invalid worktree path: {}", path.display())))?;
    let (_, parents) = worktree_file_parts(relative)?;
    let mut parent = workdir.to_path_buf();
    for part in parents {
        parent.push(part);
        match parent.symlink_metadata() {
            Ok(metadata) if is_real_directory(&metadata) => {}
            Ok(_) => {
                if let Some(blocker) = movable_blocker {
                    if same_checkout_path(&parent, blocker)? {
                        return Ok(());
                    }
                }
                return Err(AppError::Conflict(format!(
                    "another path occupies {}",
                    relative.display()
                )));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn remove_created_rename_source(path: &Path) -> std::io::Result<()> {
    match path.symlink_metadata() {
        Ok(metadata) => remove_worktree_entry(path, metadata.file_type()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn restore_rename_source<'a>(
    repo: &Repository,
    source: &str,
    destination: &'a str,
    destination_backed_up: bool,
    failed_path: &mut &'a str,
) -> AppResult<Option<WorktreeFileBackup>> {
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
    let backup = if destination_backed_up {
        None
    } else {
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::other("bare repository"))?;
        let result = prepare_worktree_file_removal(workdir, destination).and_then(|removal| {
            removal
                .map(|removal| removal.back_up(&workdir.join(destination)))
                .transpose()
        });
        result.inspect_err(|_| *failed_path = destination)?
    };
    if let Err(error) = index.write() {
        if let Some(backup) = backup {
            backup
                .restore()
                .map_err(|rollback| AppError::other(format!("{error}. {rollback}")))?;
        }
        return Err(error.into());
    }
    Ok(backup)
}

fn rename_blocker<'a>(source: &Path, destination: &'a Path) -> AppResult<Option<&'a Path>> {
    let source_depth = source.components().count();
    let destination_depth = destination.components().count();
    let (Some(source_root), Some(destination_root)) = (
        source
            .ancestors()
            .nth(source_depth.saturating_sub(destination_depth)),
        destination
            .ancestors()
            .nth(destination_depth.saturating_sub(source_depth)),
    ) else {
        return Ok(None);
    };
    Ok(same_checkout_path(source_root, destination_root)?.then_some(destination_root))
}

fn same_checkout_path(source: &Path, destination: &Path) -> AppResult<bool> {
    if source == destination {
        return Ok(true);
    }
    let Ok(source_metadata) = source.symlink_metadata() else {
        return Ok(false);
    };
    let Ok(destination_metadata) = destination.symlink_metadata() else {
        return Ok(false);
    };
    if source_metadata.is_symlink() || destination_metadata.is_symlink() {
        if source_metadata.is_symlink() && destination_metadata.is_symlink() {
            return same_symlink_entry(source, destination);
        }
        return Ok(false);
    }
    Ok(source.canonicalize().is_ok_and(|source| {
        destination
            .canonicalize()
            .is_ok_and(|destination| source == destination)
    }))
}

fn same_symlink_entry(source: &Path, destination: &Path) -> AppResult<bool> {
    let parent = source.parent().expect("symlink has a parent directory");
    let destination_parent = destination
        .parent()
        .expect("symlink has a parent directory");
    if !same_file::is_same_file(parent, destination_parent)? {
        return Ok(false);
    }
    Ok(checkout_entry_path(source)?.file_name() == checkout_entry_path(destination)?.file_name())
}

fn checkout_entry_path(path: &Path) -> AppResult<PathBuf> {
    let name = path.file_name().expect("checkout path has a file name");
    let parent = path.parent().expect("checkout path has a parent directory");
    for entry in fs::read_dir(parent)? {
        if entry?.file_name() == name {
            return Ok(path.to_path_buf());
        }
    }
    let identity = checkout_entry_identity(path)?;
    let mut actual = None;
    let unidentified = || {
        AppError::other(format!(
            "Could not identify a unique directory entry for {}",
            path.display()
        ))
    };
    for entry in fs::read_dir(parent)? {
        let candidate = entry?.path();
        if checkout_entry_identity(&candidate).is_ok_and(|candidate| candidate == identity) {
            if actual.is_some() {
                return Err(unidentified());
            }
            actual = Some(candidate);
        }
    }
    actual.ok_or_else(unidentified)
}

#[cfg(unix)]
fn checkout_entry_identity(path: &Path) -> std::io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;

    let metadata = path.symlink_metadata()?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn checkout_entry_identity(path: &Path) -> std::io::Result<same_file::Handle> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };

    let file = fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    same_file::Handle::from_file(file)
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

fn close_checkout_backup(backup: tempfile::TempDir) -> AppResult<()> {
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
    if let Some((tree, entry)) = head_tree.as_ref().and_then(|tree| {
        tree.get_path(Path::new(file))
            .ok()
            .map(|entry| (tree, entry))
    }) {
        let checkout = || checkout_head_file(repo, tree, file, true);
        if entry.filemode() != i32::from(git2::FileMode::Link) {
            return checkout();
        }
        let (backup, ()) = checkout_with_rollback(repo, file, None, |_| checkout())?;
        if let Some(backup) = backup {
            close_checkout_backup(backup)?;
        }
        Ok(())
    } else {
        let removal = prepare_worktree_file_removal(workdir, file)?;
        let mut index = repo.index()?;
        let _ = index.remove_path(Path::new(file));
        index.write()?;
        if let Some(removal) = removal {
            removal.remove()?;
        }
        Ok(())
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

fn prepare_worktree_file_removal(
    workdir: &Path,
    file: &str,
) -> AppResult<Option<WorktreeFileRemoval>> {
    let (name, parents) = worktree_file_parts(Path::new(file))?;
    Ok(prepare_worktree_file_removal_at(workdir, &parents, name)?)
}

fn worktree_file_parts(path: &Path) -> AppResult<(&OsStr, Vec<&OsStr>)> {
    let invalid = || AppError::other(format!("Invalid worktree path: {}", path.display()));
    let mut components = path
        .components()
        .map(|part| match part {
            Component::Normal(name) if Path::new(name).file_name() == Some(name) => Ok(name),
            _ => Err(invalid()),
        })
        .collect::<AppResult<Vec<_>>>()?;
    let name = components.pop().ok_or_else(invalid)?;
    Ok((name, components))
}

fn is_real_directory(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    metadata.is_dir()
}

#[cfg(unix)]
struct WorktreeFileRemoval {
    parent: rustix::fd::OwnedFd,
    name: std::ffi::OsString,
}

#[cfg(unix)]
impl WorktreeFileRemoval {
    fn remove(self) -> std::io::Result<()> {
        unlink_worktree_entry(&self.parent, &self.name)
    }

    fn back_up(self, path: &Path) -> AppResult<WorktreeFileBackup> {
        use rustix::fs::{self, Mode, OFlags};

        let parent_path = path.parent().expect("path is inside the worktree");
        let name = tempfile::Builder::new()
            .prefix(".angkorgit-discard-")
            .disable_cleanup(true)
            .make_in(parent_path, |path| {
                let name = path.file_name().expect("temporary path has a name");
                fs::openat(
                    &self.parent,
                    name,
                    OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC,
                    Mode::RUSR | Mode::WUSR,
                )?;
                Ok(name.to_os_string())
            })?
            .into_file();
        if let Err(error) = fs::renameat(&self.parent, &self.name, &self.parent, &name) {
            let _ = unlink_worktree_entry(&self.parent, &name);
            return Err(std::io::Error::from(error).into());
        }
        Ok(WorktreeFileBackup {
            saved_path: parent_path.join(&name),
            original: self,
            name,
        })
    }
}

#[cfg(unix)]
struct WorktreeFileBackup {
    original: WorktreeFileRemoval,
    name: std::ffi::OsString,
    saved_path: PathBuf,
}

#[cfg(unix)]
impl WorktreeFileBackup {
    fn restore(self) -> AppResult<()> {
        use rustix::fs;

        let parent = &self.original.parent;
        let original = &self.original.name;
        let put_back = || {
            #[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
            {
                use rustix::io::Errno;

                match fs::renameat_with(
                    parent,
                    &self.name,
                    parent,
                    original,
                    fs::RenameFlags::NOREPLACE,
                ) {
                    Err(Errno::INVAL | Errno::NOSYS | Errno::NOTSUP) => {}
                    result => return result,
                }
            }
            fs::linkat(parent, &self.name, parent, original, fs::AtFlags::empty())?;
            fs::unlinkat(parent, &self.name, fs::AtFlags::empty())
        };
        put_back().map_err(|error| destination_restore_error(&self.saved_path, error))
    }

    fn discard(self) -> AppResult<()> {
        unlink_worktree_entry(&self.original.parent, &self.name).map_err(|error| {
            AppError::other(format!(
                "Could not remove the backup at {}: {error}",
                self.saved_path.display()
            ))
        })
    }
}

#[cfg(unix)]
fn unlink_worktree_entry(parent: &rustix::fd::OwnedFd, name: &OsStr) -> std::io::Result<()> {
    use rustix::fs::{self, AtFlags};
    use rustix::io::Errno;

    match fs::unlinkat(parent, name, AtFlags::empty()) {
        Ok(()) | Err(Errno::NOENT) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(unix)]
fn prepare_worktree_file_removal_at(
    workdir: &Path,
    parents: &[&OsStr],
    name: &OsStr,
) -> std::io::Result<Option<WorktreeFileRemoval>> {
    use rustix::fs::{self, AtFlags, FileType, Mode, OFlags};
    use rustix::io::Errno;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    let access = OFlags::PATH;
    #[cfg(any(target_vendor = "apple", target_os = "freebsd", target_os = "netbsd"))]
    let access = OFlags::from_bits_retain(libc::O_SEARCH as u32);
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_vendor = "apple",
        target_os = "freebsd",
        target_os = "netbsd"
    )))]
    let access = OFlags::RDONLY;
    let flags = access | OFlags::DIRECTORY | OFlags::CLOEXEC;
    let mut dir = fs::open(workdir, flags, Mode::empty())?;
    let mut ancestors = Vec::with_capacity(parents.len());
    for parent in parents {
        let next = match fs::openat(&dir, *parent, flags | OFlags::NOFOLLOW, Mode::empty()) {
            Ok(next) => next,
            Err(Errno::NOENT | Errno::NOTDIR | Errno::LOOP) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        ancestors.push(dir);
        dir = next;
    }
    let entry = match fs::statat(&dir, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(entry) => entry,
        Err(Errno::NOENT) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    match FileType::from_raw_mode(entry.st_mode) {
        FileType::RegularFile => {}
        FileType::Symlink => {
            for (parent, spelling) in ancestors.iter().zip(parents).chain([(&dir, &name)]) {
                if !unix_has_exact_entry(parent, spelling)? {
                    return Ok(None);
                }
            }
        }
        _ => return Ok(None),
    }
    Ok(Some(WorktreeFileRemoval {
        parent: dir,
        name: name.to_os_string(),
    }))
}

#[cfg(unix)]
fn unix_has_exact_entry(dir: &rustix::fd::OwnedFd, name: &OsStr) -> std::io::Result<bool> {
    use rustix::fs::{self, Mode, OFlags};
    use std::os::unix::ffi::OsStrExt;

    let readable = fs::openat(
        dir,
        ".",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )?;
    for entry in fs::Dir::new(readable)? {
        if entry?.file_name().to_bytes() == name.as_bytes() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
struct WorktreeFileRemoval {
    path: PathBuf,
    kind: fs::FileType,
    _directories: Vec<fs::File>,
}

#[cfg(windows)]
impl WorktreeFileRemoval {
    fn remove(self) -> std::io::Result<()> {
        match remove_worktree_entry(&self.path, self.kind) {
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }

    fn back_up(self, _path: &Path) -> AppResult<WorktreeFileBackup> {
        let parent = self.path.parent().expect("path is inside the worktree");
        let (saved_path, kind) = tempfile::Builder::new()
            .prefix(".angkorgit-discard-")
            .disable_cleanup(true)
            .make_in(parent, |path| {
                let kind = rename_worktree_entry(&self.path, path)?;
                Ok((path.to_path_buf(), kind))
            })?
            .into_file();
        Ok(WorktreeFileBackup {
            original: self,
            saved_path,
            kind,
        })
    }
}

#[cfg(windows)]
struct WorktreeFileBackup {
    original: WorktreeFileRemoval,
    saved_path: PathBuf,
    kind: fs::FileType,
}

#[cfg(windows)]
impl WorktreeFileBackup {
    fn restore(self) -> AppResult<()> {
        rename_worktree_entry(&self.saved_path, &self.original.path)
            .map(|_| ())
            .map_err(|error| destination_restore_error(&self.saved_path, error))
    }

    fn discard(self) -> AppResult<()> {
        remove_worktree_entry(&self.saved_path, self.kind).map_err(|error| {
            AppError::other(format!(
                "Could not remove the backup at {}: {error}",
                self.saved_path.display()
            ))
        })
    }
}

#[cfg(windows)]
fn rename_worktree_entry(from: &Path, to: &Path) -> std::io::Result<fs::FileType> {
    use std::mem::size_of;
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle};
    use std::ptr;
    use windows_sys::Wdk::Storage::FileSystem::{
        FileRenameInformation, NtSetInformationFile, FILE_RENAME_INFORMATION,
    };
    use windows_sys::Win32::Foundation::RtlNtStatusToDosError;
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    debug_assert_eq!(from.parent(), to.parent());
    let entry = fs::OpenOptions::new()
        .access_mode(DELETE | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(from)?;
    let kind = entry.metadata()?.file_type();
    if !kind.is_file() && !kind.is_symlink() {
        return Err(std::io::Error::other(
            "the rename destination changed during discard",
        ));
    }
    let name: Vec<_> = to
        .file_name()
        .expect("rename destination has a name")
        .encode_wide()
        .collect();
    let name_bytes = name.len() * size_of::<u16>();
    let buffer_size = size_of::<FILE_RENAME_INFORMATION>() + name_bytes;
    let mut buffer = vec![0usize; buffer_size.div_ceil(size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    let mut status_block = IO_STATUS_BLOCK::default();
    let status = unsafe {
        (*info).FileNameLength = name_bytes as u32;
        ptr::addr_of_mut!((*info).FileName)
            .cast::<u16>()
            .copy_from_nonoverlapping(name.as_ptr(), name.len());
        NtSetInformationFile(
            entry.as_raw_handle(),
            &mut status_block,
            info.cast(),
            buffer_size as u32,
            FileRenameInformation,
        )
    };
    if status < 0 {
        return Err(std::io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(status) } as i32,
        ));
    }
    Ok(kind)
}

fn destination_restore_error(path: &Path, error: impl std::fmt::Display) -> AppError {
    AppError::other(format!(
        "Could not put the rename destination back ({error}). It is saved at {}",
        path.display()
    ))
}

#[cfg(windows)]
fn prepare_worktree_file_removal_at(
    workdir: &Path,
    parents: &[&OsStr],
    name: &OsStr,
) -> std::io::Result<Option<WorktreeFileRemoval>> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
    };

    let root = workdir.canonicalize()?;
    let mut dir = root.clone();
    let mut handles = Vec::with_capacity(parents.len() + 1);
    for part in std::iter::once(None).chain(parents.iter().map(Some)) {
        if let Some(part) = part {
            dir.push(part);
        }
        let handle = match fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&dir)
        {
            Ok(handle) => handle,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if !is_real_directory(&handle.metadata()?) {
            return Ok(None);
        }
        handles.push(handle);
    }
    let full = dir.join(name);
    let kind = match full.symlink_metadata() {
        Ok(metadata) => metadata.file_type(),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if kind.is_symlink() {
        let mut parent = root;
        for part in parents.iter().copied().chain([name]) {
            if !windows_has_exact_entry(&parent, part)? {
                return Ok(None);
            }
            parent.push(part);
        }
    }
    if kind.is_file() || kind.is_symlink() {
        Ok(Some(WorktreeFileRemoval {
            path: full,
            kind,
            _directories: handles,
        }))
    } else {
        Ok(None)
    }
}

#[cfg(windows)]
fn windows_has_exact_entry(parent: &Path, name: &OsStr) -> std::io::Result<bool> {
    for entry in fs::read_dir(parent)? {
        if entry?.file_name() == name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn remove_worktree_entry(path: &Path, kind: fs::FileType) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;

        if kind.is_symlink_dir() {
            return fs::remove_dir(path);
        }
    }
    if kind.is_dir() {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
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
