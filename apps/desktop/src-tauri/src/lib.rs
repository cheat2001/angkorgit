#![allow(non_snake_case)] // command args mirror camelCase IPC payloads

mod commands;
mod core;
mod error;
mod http;
mod state;
mod terminal;
mod watcher;

/// Flat re-exports of the git engine for integration tests
/// (`tests/git_engine.rs`). Not part of the IPC surface.
pub mod test_api {
    pub use crate::core::branch::{
        checkout_branch, cherry_pick, create as branch_create, merge, rebase, reset,
    };
    pub use crate::core::commit::{amend, commit, revert};
    pub use crate::core::conflict::{
        list as conflict_list, read as conflict_read, resolve as conflict_resolve,
    };
    pub use crate::core::diff::file_diff;
    pub use crate::core::history::list as history;
    pub use crate::core::misc::{
        stash_create, stash_list, stash_pop, tag_create, tag_delete, tag_list,
    };
    pub use crate::core::repo::{init, set_config, status};
    pub use crate::core::stage::{discard_all, stage_all, stage_file, unstage_all, unstage_file};
    pub use crate::core::types::HistoryQuery;
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = core::accounts::CONFIG_DIR.set(dir);
            }
            Ok(())
        })
        .manage(terminal::TerminalState::default())
        .manage(watcher::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::repo_discover,
            commands::repo_open,
            commands::repo_info,
            commands::repo_init,
            commands::repo_status,
            commands::repo_clone,
            commands::recent_repositories,
            commands::recent_remove,
            commands::config_get,
            commands::config_set,
            commands::stage_file,
            commands::unstage_file,
            commands::stage_all,
            commands::unstage_all,
            commands::discard_file,
            commands::discard_all,
            commands::stage_hunk,
            commands::unstage_hunk,
            commands::commit_create,
            commands::commit_amend,
            commands::commit_revert,
            commands::history_list,
            commands::history_commit,
            commands::branch_list,
            commands::branch_create,
            commands::branch_delete,
            commands::branch_rename,
            commands::branch_checkout,
            commands::checkout_detached,
            commands::branch_merge,
            commands::merge_abort,
            commands::branch_rebase,
            commands::rebase_continue,
            commands::rebase_abort,
            commands::cherry_pick,
            commands::reset_to,
            commands::remote_list,
            commands::remote_fetch,
            commands::remote_pull,
            commands::remote_pull_branch,
            commands::remote_push,
            commands::remote_push_tag,
            commands::stash_list,
            commands::stash_create,
            commands::stash_apply,
            commands::stash_pop,
            commands::stash_drop,
            commands::tag_list,
            commands::tag_create,
            commands::tag_delete,
            commands::submodule_list,
            commands::submodule_update,
            commands::diff_file,
            commands::diff_commit,
            commands::staged_patch,
            commands::conflict_list,
            commands::conflict_read,
            commands::conflict_resolve,
            commands::term_create,
            commands::term_write,
            commands::term_resize,
            commands::term_kill,
            commands::watch_repo,
            commands::watch_stop,
            commands::credential_store,
            commands::account_list,
            commands::account_add,
            commands::account_remove,
            commands::http_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AngKorGit");
}
