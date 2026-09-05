use tauri::{AppHandle, Emitter, State};

use crate::core::types::*;
use crate::core::{branch, commit, conflict, diff, history, misc, remote, repo, stage, worktree};
use crate::error::AppResult;
use crate::terminal::TerminalState;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| crate::error::AppError::other(e.to_string()))?
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
pub async fn repo_ref_fingerprint(path: String) -> AppResult<String> {
    blocking(move || repo::ref_fingerprint(&path)).await
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
pub async fn state_cleanup(path: String) -> AppResult<()> {
    blocking(move || repo::cleanup_state(&path)).await
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
pub async fn stage_line(path: String, file: String, kind: String, lineNo: u32) -> AppResult<()> {
    blocking(move || stage::stage_line(&path, &file, &kind, lineNo)).await
}

#[tauri::command]
pub async fn unstage_line(path: String, file: String, kind: String, lineNo: u32) -> AppResult<()> {
    blocking(move || stage::unstage_line(&path, &file, &kind, lineNo)).await
}

#[tauri::command]
pub async fn discard_line(path: String, file: String, kind: String, lineNo: u32) -> AppResult<()> {
    blocking(move || stage::discard_line(&path, &file, &kind, lineNo)).await
}

const MAX_EDITABLE_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
pub async fn read_file(path: String, file: String) -> AppResult<String> {
    blocking(move || {
        let full = std::path::Path::new(&path).join(&file);
        let meta = std::fs::metadata(&full)?;
        if meta.len() > MAX_EDITABLE_BYTES {
            return Err(crate::error::AppError::other(
                "file is larger than 5 MB — open it in an external editor",
            ));
        }
        let bytes = std::fs::read(&full)?;
        String::from_utf8(bytes)
            .map_err(|_| crate::error::AppError::other("file is not valid UTF-8 text"))
    })
    .await
}

#[tauri::command]
pub async fn write_file(path: String, file: String, content: String) -> AppResult<()> {
    blocking(move || {
        let full = std::path::Path::new(&path).join(&file);
        std::fs::write(full, content)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn open_path(path: String) -> AppResult<()> {
    blocking(move || {
        let status = {
            #[cfg(target_os = "macos")]
            {
                crate::proc::hidden("open").arg(&path).status()
            }
            #[cfg(target_os = "windows")]
            {
                crate::proc::hidden("cmd")
                    .args(["/C", "start", "", &path])
                    .status()
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                crate::proc::hidden("xdg-open").arg(&path).status()
            }
        }?;
        if !status.success() {
            return Err(crate::error::AppError::other("could not open path"));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn reveal_path(path: String) -> AppResult<()> {
    blocking(move || {
        let status = {
            #[cfg(target_os = "macos")]
            {
                crate::proc::hidden("open").args(["-R", &path]).status()
            }
            #[cfg(target_os = "windows")]
            {
                crate::proc::hidden("explorer")
                    .arg(format!("/select,{path}"))
                    .status()
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                let parent = std::path::Path::new(&path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.clone());
                crate::proc::hidden("xdg-open").arg(parent).status()
            }
        }?;
        let _ = status;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_file(path: String, file: String) -> AppResult<()> {
    blocking(move || {
        let full = std::path::Path::new(&path).join(&file);
        if full.is_file() {
            std::fs::remove_file(full)?;
        } else if full.is_dir() {
            std::fs::remove_dir_all(full)?;
        }
        Ok(())
    })
    .await
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
pub async fn merge_message(path: String) -> AppResult<Option<String>> {
    blocking(move || commit::merge_message(&path)).await
}

#[tauri::command]
pub async fn merge_can_ff(path: String, target: String, source: String) -> AppResult<bool> {
    blocking(move || branch::can_fast_forward(&path, &target, &source)).await
}

#[tauri::command]
pub async fn commit_revert(path: String, oid: String) -> AppResult<OpOutcome> {
    blocking(move || commit::revert(&path, &oid)).await
}

#[tauri::command]
pub async fn history_list(path: String, query: HistoryQuery) -> AppResult<HistoryPage> {
    blocking(move || history::list(&path, query)).await
}

#[tauri::command]
pub async fn history_commit(path: String, oid: String) -> AppResult<CommitInfo> {
    blocking(move || history::single(&path, &oid)).await
}

#[tauri::command]
pub async fn history_position(path: String, rev: String) -> AppResult<Option<HistoryPosition>> {
    blocking(move || history::position(&path, &rev)).await
}

#[tauri::command]
pub async fn history_file(
    path: String,
    file: String,
    limit: Option<usize>,
    skip: Option<usize>,
) -> AppResult<HistoryPage> {
    blocking(move || history::file_history(&path, &file, limit.unwrap_or(200), skip.unwrap_or(0)))
        .await
}

#[tauri::command]
pub async fn repo_files(path: String) -> AppResult<Vec<String>> {
    blocking(move || repo::list_files(&path)).await
}

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
pub async fn branch_merge(path: String, name: String, noFf: Option<bool>) -> AppResult<OpOutcome> {
    blocking(move || branch::merge(&path, &name, noFf.unwrap_or(false))).await
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
pub async fn rebase_commits(path: String, baseOid: String) -> AppResult<Vec<CommitInfo>> {
    blocking(move || branch::rebase_commits(&path, &baseOid)).await
}

#[tauri::command]
pub async fn rebase_interactive(
    path: String,
    baseOid: String,
    todo: Vec<RebaseTodoEntry>,
) -> AppResult<String> {
    blocking(move || branch::rebase_interactive(&path, &baseOid, &todo)).await
}

#[tauri::command]
pub async fn cherry_pick(path: String, oid: String, recordOrigin: bool) -> AppResult<OpOutcome> {
    blocking(move || branch::cherry_pick(&path, &oid, recordOrigin)).await
}

#[tauri::command]
pub async fn cherry_pick_many(
    path: String,
    oids: Vec<String>,
    recordOrigin: bool,
) -> AppResult<OpOutcome> {
    blocking(move || branch::cherry_pick_many(&path, &oids, recordOrigin)).await
}

#[tauri::command]
pub async fn reset_to(path: String, oid: String, mode: String) -> AppResult<()> {
    blocking(move || branch::reset(&path, &oid, &mode)).await
}

#[tauri::command]
pub async fn remote_list(path: String) -> AppResult<Vec<RemoteInfo>> {
    blocking(move || remote::list(&path)).await
}

#[tauri::command]
pub async fn remote_edit(
    path: String,
    name: String,
    newName: String,
    url: String,
) -> AppResult<()> {
    blocking(move || remote::edit(&path, &name, &newName, &url)).await
}

#[tauri::command]
pub async fn remote_remove(path: String, name: String) -> AppResult<()> {
    blocking(move || remote::remove(&path, &name)).await
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

#[tauri::command]
pub async fn submodule_list(path: String) -> AppResult<Vec<SubmoduleInfo>> {
    blocking(move || misc::submodule_list(&path)).await
}

#[tauri::command]
pub async fn submodule_update(path: String, name: String) -> AppResult<()> {
    blocking(move || misc::submodule_update(&path, &name)).await
}

#[tauri::command]
pub async fn worktree_list(path: String) -> AppResult<Vec<WorktreeInfo>> {
    blocking(move || worktree::list(&path)).await
}

#[tauri::command]
pub async fn worktree_add(path: String, request: WorktreeAddRequest) -> AppResult<String> {
    blocking(move || worktree::add(&path, &request)).await
}

#[tauri::command]
pub async fn worktree_remove(path: String, name: String, force: bool) -> AppResult<()> {
    blocking(move || worktree::remove(&path, &name, force)).await
}

#[tauri::command]
pub async fn worktree_prune(path: String) -> AppResult<Vec<String>> {
    blocking(move || worktree::prune(&path)).await
}

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
pub async fn diff_commit_files(path: String, oid: String) -> AppResult<Vec<CommitFileInfo>> {
    blocking(move || diff::commit_files(&path, &oid)).await
}

#[tauri::command]
pub async fn diff_commit_file(
    path: String,
    oid: String,
    file: String,
    oldPath: Option<String>,
    contextLines: Option<u32>,
) -> AppResult<FileDiff> {
    blocking(move || {
        diff::commit_file_diff(
            &path,
            &oid,
            &file,
            oldPath.as_deref(),
            contextLines.unwrap_or(3),
        )
    })
    .await
}

#[tauri::command]
pub async fn staged_patch(path: String) -> AppResult<String> {
    blocking(move || diff::staged_patch_text(&path)).await
}

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

#[tauri::command]
pub async fn term_create(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> AppResult<u32> {
    let sessions = state.sessions();
    blocking(move || crate::terminal::create(&app, &sessions, &cwd, cols, rows)).await
}

#[tauri::command]
pub async fn term_write(state: State<'_, TerminalState>, id: u32, data: String) -> AppResult<()> {
    let sessions = state.sessions();
    blocking(move || crate::terminal::write(&sessions, id, &data)).await
}

#[tauri::command]
pub async fn term_resize(
    state: State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let sessions = state.sessions();
    blocking(move || crate::terminal::resize(&sessions, id, cols, rows)).await
}

#[tauri::command]
pub async fn term_kill(state: State<'_, TerminalState>, id: u32) -> AppResult<()> {
    let sessions = state.sessions();
    blocking(move || crate::terminal::kill(&sessions, id)).await
}

#[tauri::command]
pub async fn watch_repo(
    app: AppHandle,
    state: State<'_, crate::watcher::WatcherState>,
    path: String,
) -> AppResult<()> {
    let slot = state.slot();
    blocking(move || crate::watcher::watch(&app, &slot, &path)).await
}

#[tauri::command]
pub async fn watch_stop(state: State<'_, crate::watcher::WatcherState>) -> AppResult<()> {
    let slot = state.slot();
    blocking(move || {
        crate::watcher::stop(&slot);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn credential_store(host: String, username: String, password: String) -> AppResult<()> {
    blocking(move || remote::credential_approve(&host, &username, &password)).await
}

#[tauri::command]
pub fn credential_prefs_set(sshKeyPath: Option<String>, useAgent: bool, useCredentialHelper: bool) {
    remote::set_credential_prefs(sshKeyPath, useAgent, useCredentialHelper);
}

#[tauri::command]
pub async fn ssh_public_key(path: String) -> AppResult<String> {
    blocking(move || remote::ssh_public_key(&path)).await
}

#[tauri::command]
pub async fn ssh_key_generate(path: String, comment: String) -> AppResult<GeneratedKey> {
    blocking(move || remote::ssh_key_generate(&path, &comment)).await
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
    verified: bool,
    email: Option<String>,
) -> AppResult<Vec<crate::core::accounts::AccountInfo>> {
    blocking(move || {
        crate::core::accounts::add(
            &host,
            &username,
            &provider,
            &token,
            verified,
            email.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn account_remove(
    host: String,
    username: String,
) -> AppResult<Vec<crate::core::accounts::AccountInfo>> {
    blocking(move || crate::core::accounts::remove(&host, &username)).await
}

#[tauri::command]
pub async fn account_set_default(
    host: String,
    username: String,
) -> AppResult<Vec<crate::core::accounts::AccountInfo>> {
    blocking(move || crate::core::accounts::set_default(&host, &username)).await
}

#[tauri::command]
pub async fn account_check(
    host: String,
    username: String,
) -> AppResult<crate::account_check::AccountCheckResult> {
    crate::account_check::check(host, username).await
}

#[tauri::command]
pub async fn ai_key_get(provider: String) -> AppResult<Option<String>> {
    blocking(move || crate::core::ai_keys::get(&provider)).await
}

#[tauri::command]
pub async fn ai_key_set(provider: String, key: String) -> AppResult<()> {
    blocking(move || crate::core::ai_keys::set(&provider, &key)).await
}

#[tauri::command]
pub async fn ai_key_delete(provider: String) -> AppResult<()> {
    blocking(move || crate::core::ai_keys::delete(&provider)).await
}

#[tauri::command]
pub async fn http_request(
    request: crate::http::HttpRequest,
) -> AppResult<crate::http::HttpResponse> {
    crate::http::request(request).await
}

#[tauri::command]
pub async fn forge_request(
    repoPath: Option<String>,
    host: String,
    request: crate::http::HttpRequest,
) -> AppResult<crate::http::HttpResponse> {
    crate::forge::request(repoPath, host, request).await
}

#[tauri::command]
pub async fn pr_checkout(
    path: String,
    remote: String,
    sourceRef: String,
    branch: String,
    track: bool,
) -> AppResult<()> {
    blocking(move || remote::checkout_remote_ref(&path, &remote, &sourceRef, &branch, track)).await
}

#[tauri::command]
pub async fn ai_cli_detect() -> AppResult<Vec<crate::ai_cli::CliAgentInfo>> {
    blocking(|| Ok(crate::ai_cli::detect())).await
}

#[tauri::command]
pub async fn ai_cli_run(
    request: crate::ai_cli::CliRunRequest,
) -> AppResult<crate::ai_cli::CliRunResult> {
    blocking(move || crate::ai_cli::run(request)).await
}
