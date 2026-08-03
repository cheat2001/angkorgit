use std::path::Path;

use crate::error::{AppError, AppResult};

use super::types::ConflictFile;

/// Paths currently conflicted in the index.
pub fn list(path: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open(path)?;
    let index = repo.index()?;
    let mut paths = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let entry = conflict.our.or(conflict.their).or(conflict.ancestor);
        if let Some(entry) = entry {
            paths.push(String::from_utf8_lossy(&entry.path).to_string());
        }
    }
    paths.dedup();
    Ok(paths)
}

/// Read a conflicted file's working-tree content (with conflict markers).
pub fn read(path: &str, file: &str) -> AppResult<ConflictFile> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    let content = std::fs::read_to_string(workdir.join(file))?;
    let has_markers = content.contains("<<<<<<<");
    Ok(ConflictFile {
        path: file.to_string(),
        content,
        has_markers,
    })
}

/// Write the resolved content and mark the path resolved in the index.
pub fn resolve(path: &str, file: &str, content: &str) -> AppResult<()> {
    let repo = super::repo::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::other("bare repository"))?;
    std::fs::write(workdir.join(file), content)?;

    let mut index = repo.index()?;
    index.remove_path(Path::new(file)).ok(); // clears conflict stages
    index.add_path(Path::new(file))?;
    index.write()?;
    Ok(())
}
