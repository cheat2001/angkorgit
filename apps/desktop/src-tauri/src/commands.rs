//! Thin Tauri command layer over the core git engine.
//! Long-running git work runs on blocking threads so the UI never stalls.

use tauri::{AppHandle, Emitter, State};

use crate::core::types::*;
use crate::core::{branch, commit, conflict, diff, history, misc, remote, repo, stage};
use crate::error::AppResult;
use crate::terminal::TerminalState;

/// Run a blocking git operation off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| crate::error::AppError::other(e.to_string()))?
}

// ---- Repository ------------------------------------------------------------

#[tauri::command]
pub async fn repo_discover(path: String) -> AppResult<String> {
    blocking(move || repo::discover(&path)).await
}

#[tauri::command]
pub async fn repo_open(app: AppHandle, path: String) -> AppResult<RepositoryInfo> {
    let info = blocking(move || {
        let root = repo::discover(&path)?;
        repo::info(&root)
    })
    .await?;
    crate::state::recent_add(&app, &info.path)?;
    Ok(info)
}

#[tauri::command]
pub async fn repo_info(path: String) -> AppResult<RepositoryInfo> {
    blocking(move || repo::info(&path)).await
}

#[tauri::command]
pub async fn repo_init(app: AppHandle, path: String) -> AppResult<RepositoryInfo> {
    let info = blocking(move || repo::init(&path)).await?;
    crate::state::recent_add(&app, &info.path)?;
    Ok(info)
}

#[tauri::command]
pub async fn repo_status(path: String) -> AppResult<StatusSummary> {
    blocking(move || repo::status(&path)).await
}

#[tauri::command]
pub async fn repo_clone(app: AppHandle, url: String, into: String) -> AppResult<String> {
    let emitter = app.clone();
    let root = blocking(move || {
        remote::clone(&url, &into, move |pct| {
            let _ = emitter.emit("clone-progress", pct);
        })
    })
    .await?;
    crate::state::recent_add(&app, &root)?;
    Ok(root)
}

#[tauri::command]
pub fn recent_repositories(app: AppHandle) -> AppResult<Vec<RecentRepository>> {
    crate::state::recent_list(&app)
}

#[tauri::command]
pub fn recent_remove(app: AppHandle, path: String) -> AppResult<Vec<RecentRepository>> {
    crate::state::recent_remove(&app, &path)
}

// ---- Config -----------------------------------------------------------------

#[tauri::command]
pub async fn config_get(path: Option<String>, key: String) -> AppResult<Option<String>> {
    blocking(move || repo::get_config(path.as_deref(), &key)).await
}

#[tauri::command]
pub async fn config_set(
    path: Option<String>,
    key: String,
    value: String,
    global: bool,
) -> AppResult<()> {
    blocking(move || repo::set_config(path.as_deref(), &key, &value, global)).await
}

// ---- Staging & commit ----------------------------------------------------------

#[tauri::command]
pub async fn stage_file(path: String, file: String) -> AppResult<()> {
    blocking(move || stage::stage_file(&path, &file)).await
}

#[tauri::command]
pub async fn unstage_file(path: String, file: String) -> AppResult<()> {
    blocking(move || stage::unstage_file(&path, &file)).await
}

#[tauri::command]
pub async fn stage_all(path: String) -> AppResult<()> {
    blocking(move || stage::stage_all(&path)).await
}

#[tauri::command]
pub async fn unstage_all(path: String) -> AppResult<()> {
    blocking(move || stage::unstage_all(&path)).await
}

#[tauri::command]
pub async fn discard_file(path: String, file: String) -> AppResult<bool> {
    blocking(move || stage::discard_file(&path, &file)).await
}

#[tauri::command]
pub async fn discard_all(path: String) -> AppResult<Vec<String>> {
    blocking(move || stage::discard_all(&path)).await
}

#[tauri::command]
pub async fn stage_hunk(path: String, file: String, hunkIndex: usize) -> AppResult<()> {
    blocking(move || stage::stage_hunk(&path, &file, hunkIndex)).await
}

#[tauri::command]
pub async fn unstage_hunk(path: String, file: String, hunkIndex: usize) -> AppResult<()> {
    blocking(move || stage::unstage_hunk(&path, &file, hunkIndex)).await
}

#[tauri::command]
pub async fn commit_create(path: String, message: String) -> AppResult<String> {
    blocking(move || commit::commit(&path, &message)).await
}

#[tauri::command]
pub async fn commit_amend(path: String, message: Option<String>) -> AppResult<String> {
    blocking(move || commit::amend(&path, message.as_deref())).await
}

#[tauri::command]
pub async fn commit_revert(path: String, oid: String) -> AppResult<OpOutcome> {
    blocking(move || commit::revert(&path, &oid)).await
}

// ---- History ---------------------------------------------------------------------

#[tauri::command]
pub async fn history_list(path: String, query: HistoryQuery) -> AppResult<HistoryPage> {
    blocking(move || history::list(&path, query)).await
}

#[tauri::command]
pub async fn history_commit(path: String, oid: String) -> AppResult<CommitInfo> {
    blocking(move || history::single(&path, &oid)).await
}

// ---- Branches ----------------------------------------------------------------------

#[tauri::command]
pub async fn branch_list(path: String) -> AppResult<Vec<BranchInfo>> {
    blocking(move || branch::list(&path)).await
}

#[tauri::command]
pub async fn branch_create(
    path: String,
    name: String,
    fromOid: Option<String>,
    checkout: bool,
) -> AppResult<()> {
    blocking(move || branch::create(&path, &name, fromOid.as_deref(), checkout)).await
}

#[tauri::command]
pub async fn branch_delete(path: String, name: String, remote: bool) -> AppResult<()> {
    blocking(move || branch::delete(&path, &name, remote)).await
}

#[tauri::command]
pub async fn branch_rename(path: String, oldName: String, newName: String) -> AppResult<()> {
    blocking(move || branch::rename(&path, &oldName, &newName)).await
}

#[tauri::command]
pub async fn branch_checkout(path: String, name: String) -> AppResult<()> {
    blocking(move || branch::checkout_branch(&path, &name)).await
}

#[tauri::command]
pub async fn checkout_detached(path: String, rev: String) -> AppResult<()> {
    blocking(move || branch::checkout_detached(&path, &rev)).await
}

#[tauri::command]
pub async fn branch_merge(path: String, name: String) -> AppResult<OpOutcome> {
    blocking(move || branch::merge(&path, &name)).await
}

#[tauri::command]
pub async fn merge_abort(path: String) -> AppResult<()> {
    blocking(move || branch::abort_merge(&path)).await
}

#[tauri::command]
pub async fn branch_rebase(path: String, upstream: String) -> AppResult<OpOutcome> {
    blocking(move || branch::rebase(&path, &upstream)).await
}

#[tauri::command]
pub async fn rebase_continue(path: String) -> AppResult<OpOutcome> {
    blocking(move || branch::rebase_continue(&path)).await
}

#[tauri::command]
pub async fn rebase_abort(path: String) -> AppResult<()> {
    blocking(move || branch::rebase_abort(&path)).await
}

#[tauri::command]
pub async fn cherry_pick(path: String, oid: String) -> AppResult<OpOutcome> {
    blocking(move || branch::cherry_pick(&path, &oid)).await
}

#[tauri::command]
pub async fn reset_to(path: String, oid: String, mode: String) -> AppResult<()> {
    blocking(move || branch::reset(&path, &oid, &mode)).await
}

// ---- Remotes -------------------------------------------------------------------------

#[tauri::command]
pub async fn remote_list(path: String) -> AppResult<Vec<RemoteInfo>> {
    blocking(move || remote::list(&path)).await
}

#[tauri::command]
pub async fn remote_fetch(
    path: String,
    remote: String,
    tags: bool,
    prune: bool,
) -> AppResult<OpOutcome> {
    blocking(move || remote::fetch(&path, &remote, tags, prune)).await
}

#[tauri::command]
pub async fn remote_pull(path: String, remote: String) -> AppResult<OpOutcome> {
    blocking(move || remote::pull(&path, &remote)).await
}

#[tauri::command]
pub async fn remote_push(
    path: String,
    remote: String,
    branch: Option<String>,
    force: bool,
    withTags: bool,
    setUpstream: bool,
) -> AppResult<OpOutcome> {
    blocking(move || {
        remote::push(
            &path,
            &remote,
            branch.as_deref(),
            force,
            withTags,
            setUpstream,
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_pull_branch(path: String, branch: String) -> AppResult<OpOutcome> {
    blocking(move || remote::pull_branch(&path, &branch)).await
}

#[tauri::command]
pub async fn remote_push_tag(path: String, remote: String, tag: String) -> AppResult<OpOutcome> {
    blocking(move || remote::push_tag(&path, &remote, &tag)).await
}

// ---- Stash ---------------------------------------------------------------------------

#[tauri::command]
pub async fn stash_list(path: String) -> AppResult<Vec<StashInfo>> {
    blocking(move || misc::stash_list(&path)).await
}

#[tauri::command]
pub async fn stash_create(
    path: String,
    message: Option<String>,
    includeUntracked: bool,
) -> AppResult<()> {
    blocking(move || misc::stash_create(&path, message.as_deref(), includeUntracked)).await
}

#[tauri::command]
pub async fn stash_apply(path: String, index: usize) -> AppResult<()> {
    blocking(move || misc::stash_apply(&path, index)).await
}

#[tauri::command]
pub async fn stash_pop(path: String, index: usize) -> AppResult<()> {
    blocking(move || misc::stash_pop(&path, index)).await
}

#[tauri::command]
pub async fn stash_drop(path: String, index: usize) -> AppResult<()> {
    blocking(move || misc::stash_drop(&path, index)).await
}

// ---- Tags ----------------------------------------------------------------------------

#[tauri::command]
pub async fn tag_list(path: String) -> AppResult<Vec<TagInfo>> {
    blocking(move || misc::tag_list(&path)).await
}

#[tauri::command]
pub async fn tag_create(
    path: String,
    name: String,
    target: Option<String>,
    message: Option<String>,
) -> AppResult<()> {
    blocking(move || misc::tag_create(&path, &name, target.as_deref(), message.as_deref())).await
}

#[tauri::command]
pub async fn tag_delete(path: String, name: String) -> AppResult<()> {
    blocking(move || misc::tag_delete(&path, &name)).await
}

// ---- Submodules -------------------------------------------------------------------------

#[tauri::command]
pub async fn submodule_list(path: String) -> AppResult<Vec<SubmoduleInfo>> {
    blocking(move || misc::submodule_list(&path)).await
}

#[tauri::command]
pub async fn submodule_update(path: String, name: String) -> AppResult<()> {
    blocking(move || misc::submodule_update(&path, &name)).await
}

// ---- Diff ---------------------------------------------------------------------------------

#[tauri::command]
pub async fn diff_file(
    path: String,
    file: String,
    staged: bool,
    contextLines: Option<u32>,
) -> AppResult<FileDiff> {
    blocking(move || diff::file_diff(&path, &file, staged, contextLines.unwrap_or(3))).await
}

#[tauri::command]
pub async fn diff_commit(
    path: String,
    oid: String,
    contextLines: Option<u32>,
) -> AppResult<Vec<FileDiff>> {
    blocking(move || diff::commit_diff(&path, &oid, contextLines.unwrap_or(3))).await
}

#[tauri::command]
pub async fn staged_patch(path: String) -> AppResult<String> {
    blocking(move || diff::staged_patch_text(&path)).await
}

// ---- Conflicts -------------------------------------------------------------------------------

#[tauri::command]
pub async fn conflict_list(path: String) -> AppResult<Vec<String>> {
    blocking(move || conflict::list(&path)).await
}

#[tauri::command]
pub async fn conflict_read(path: String, file: String) -> AppResult<ConflictFile> {
    blocking(move || conflict::read(&path, &file)).await
}

#[tauri::command]
pub async fn conflict_resolve(path: String, file: String, content: String) -> AppResult<()> {
    blocking(move || conflict::resolve(&path, &file, &content)).await
}

// ---- Terminal ----------------------------------------------------------------------------------

#[tauri::command]
pub fn term_create(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> AppResult<u32> {
    crate::terminal::create(&app, &state, &cwd, cols, rows)
}

#[tauri::command]
pub fn term_write(state: State<'_, TerminalState>, id: u32, data: String) -> AppResult<()> {
    crate::terminal::write(&state, id, &data)
}

#[tauri::command]
pub fn term_resize(
    state: State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    crate::terminal::resize(&state, id, cols, rows)
}

#[tauri::command]
pub fn term_kill(state: State<'_, TerminalState>, id: u32) -> AppResult<()> {
    crate::terminal::kill(&state, id)
}

// ---- Filesystem watcher ---------------------------------------------------------------------------

#[tauri::command]
pub fn watch_repo(
    app: AppHandle,
    state: State<'_, crate::watcher::WatcherState>,
    path: String,
) -> AppResult<()> {
    crate::watcher::watch(&app, &state, &path)
}

#[tauri::command]
pub fn watch_stop(state: State<'_, crate::watcher::WatcherState>) -> AppResult<()> {
    crate::watcher::stop(&state);
    Ok(())
}

// ---- Credentials & accounts -----------------------------------------------------------------------

#[tauri::command]
pub async fn credential_store(host: String, username: String, password: String) -> AppResult<()> {
    blocking(move || remote::credential_approve(&host, &username, &password)).await
}

#[tauri::command]
pub fn account_list() -> Vec<crate::core::accounts::AccountInfo> {
    crate::core::accounts::list()
}

#[tauri::command]
pub async fn account_add(
    host: String,
    username: String,
    provider: String,
    token: String,
) -> AppResult<Vec<crate::core::accounts::AccountInfo>> {
    blocking(move || crate::core::accounts::add(&host, &username, &provider, &token)).await
}

#[tauri::command]
pub async fn account_remove(host: String) -> AppResult<Vec<crate::core::accounts::AccountInfo>> {
    blocking(move || crate::core::accounts::remove(&host)).await
}

// ---- AI proxy -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn http_request(
    request: crate::http::HttpRequest,
) -> AppResult<crate::http::HttpResponse> {
    crate::http::request(request).await
}
