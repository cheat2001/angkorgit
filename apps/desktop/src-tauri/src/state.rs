use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

use crate::core::types::RecentRepository;
use crate::error::{AppError, AppResult};

fn store_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("recent-repositories.json"))
}

pub fn recent_list(app: &tauri::AppHandle) -> AppResult<Vec<RecentRepository>> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn recent_add(app: &tauri::AppHandle, repo_path: &str) -> AppResult<Vec<RecentRepository>> {
    let mut list = recent_list(app)?;
    list.retain(|r| r.path != repo_path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    list.insert(
        0,
        RecentRepository {
            path: repo_path.to_string(),
            name: crate::core::repo::repo_name(repo_path),
            last_opened_at: now,
        },
    );
    list.truncate(30);
    let path = store_path(app)?;
    std::fs::write(
        path,
        serde_json::to_string_pretty(&list).unwrap_or_default(),
    )?;
    Ok(list)
}

pub fn recent_remove(app: &tauri::AppHandle, repo_path: &str) -> AppResult<Vec<RecentRepository>> {
    let mut list = recent_list(app)?;
    list.retain(|r| r.path != repo_path);
    let path = store_path(app)?;
    std::fs::write(
        path,
        serde_json::to_string_pretty(&list).unwrap_or_default(),
    )?;
    Ok(list)
}
