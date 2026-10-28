use std::path::PathBuf;
use std::process::Command;

use angkorgit_lib::test_api as core;

struct TempRepo {
    dir: PathBuf,
}

impl TempRepo {
    fn new() -> Self {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap();
        core::init(path).unwrap();
        git2::Repository::open(path)
            .unwrap()
            .set_head("refs/heads/master")
            .unwrap();
        core::set_config(Some(path), "commit.gpgsign", "false", false).unwrap();
        core::set_config(Some(path), "user.name", "Test User", false).unwrap();
        core::set_config(Some(path), "user.email", "test@angkorgit.dev", false).unwrap();
        core::set_config(Some(path), "core.autocrlf", "false", false).unwrap();
        Self { dir }
    }

    fn path(&self) -> &str {
        self.dir.to_str().unwrap()
    }

    fn write(&self, file: &str, content: &str) {
        let full = self.dir.join(file);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(full, content).unwrap();
    }

    fn read(&self, file: &str) -> String {
        std::fs::read_to_string(self.dir.join(file)).unwrap()
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn commit_all(repo: &TempRepo, message: &str) -> String {
    core::stage_all(repo.path()).unwrap();
    core::commit(repo.path(), message, false).unwrap().oid
}

#[test]
fn discover_does_not_walk_up_from_a_missing_path() {
    let repo = TempRepo::new();
    let root = PathBuf::from(repo.path());
    let err = core::discover(root.join("aaa").to_str().unwrap()).unwrap_err();
    assert!(err.to_string().contains("no such file or directory"));
    std::fs::create_dir(root.join("src")).unwrap();
    let found = core::discover(root.join("src").to_str().unwrap()).unwrap();
    assert_eq!(
        std::fs::canonicalize(&found).unwrap(),
        std::fs::canonicalize(&root).unwrap()
    );
}

#[test]
fn stage_commit_and_history() {
    let repo = TempRepo::new();
    repo.write("a.txt", "hello\n");
    core::stage_file(repo.path(), "a.txt").unwrap();

    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].staged.as_deref(), Some("new"));

    let oid = core::commit(repo.path(), "feat: initial commit", false)
        .unwrap()
        .oid;
    assert_eq!(oid.len(), 40);

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 10,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].summary, "feat: initial commit");
    assert!(page.commits[0].is_head);
}

#[test]
fn unstage_and_amend() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    commit_all(&repo, "first");

    repo.write("a.txt", "two\n");
    core::stage_file(repo.path(), "a.txt").unwrap();
    core::unstage_file(repo.path(), "a.txt").unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged, None);
    assert_eq!(status.files[0].unstaged.as_deref(), Some("modified"));

    core::stage_file(repo.path(), "a.txt").unwrap();
    core::amend(repo.path(), Some("first (amended)"), false).unwrap();
    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 10,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].summary, "first (amended)");
}

#[test]
fn stage_and_unstage_many_files() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "two\n");
    commit_all(&repo, "first");

    repo.write("a.txt", "one changed\n");
    repo.write("c.txt", "three\n");
    std::fs::remove_file(repo.dir.join("b.txt")).unwrap();

    core::stage_files(
        repo.path(),
        &[
            "a.txt".to_string(),
            "b.txt".to_string(),
            "c.txt".to_string(),
        ],
    )
    .unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files.len(), 3);
    let by_path = |p: &str| {
        status
            .files
            .iter()
            .find(|f| f.path == p)
            .unwrap_or_else(|| panic!("{p} missing"))
    };
    assert_eq!(by_path("a.txt").staged.as_deref(), Some("modified"));
    assert_eq!(by_path("b.txt").staged.as_deref(), Some("deleted"));
    assert_eq!(by_path("c.txt").staged.as_deref(), Some("new"));
    assert!(status.files.iter().all(|f| f.unstaged.is_none()));

    core::unstage_files(repo.path(), &["a.txt".to_string(), "b.txt".to_string()]).unwrap();
    let status = core::status(repo.path()).unwrap();
    let staged: Vec<&str> = status
        .files
        .iter()
        .filter(|f| f.staged.is_some())
        .map(|f| f.path.as_str())
        .collect();
    assert_eq!(staged, vec!["c.txt"]);

    core::unstage_files(repo.path(), &[]).unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(
        status.files.iter().filter(|f| f.staged.is_some()).count(),
        1
    );
}

#[test]
fn branch_create_checkout_merge_ff_and_normal() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "feature", None, true).unwrap();
    repo.write("b.txt", "feature work\n");
    commit_all(&repo, "feature work");

    core::checkout_branch(repo.path(), "master").unwrap();
    let outcome = core::merge(repo.path(), "feature", false).unwrap();
    assert_eq!(outcome.status, "fast_forward");
    assert!(repo.dir.join("b.txt").exists());

    core::branch_create(repo.path(), "topic", None, true).unwrap();
    repo.write("c.txt", "topic\n");
    commit_all(&repo, "topic work");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("d.txt", "master\n");
    commit_all(&repo, "master work");
    let outcome = core::merge(repo.path(), "topic", false).unwrap();
    assert_eq!(outcome.status, "ok");
}

#[test]
fn merge_conflict_detect_and_resolve() {
    let repo = TempRepo::new();
    repo.write("a.txt", "line\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "other", None, true).unwrap();
    repo.write("a.txt", "other change\n");
    commit_all(&repo, "other");

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("a.txt", "master change\n");
    commit_all(&repo, "master");

    let outcome = core::merge(repo.path(), "other", false).unwrap();
    assert_eq!(outcome.status, "conflicts");

    let conflicts = core::conflict_list(repo.path()).unwrap();
    assert_eq!(conflicts, vec!["a.txt".to_string()]);
    let file = core::conflict_read(repo.path(), "a.txt").unwrap();
    assert!(file.has_markers);

    core::conflict_resolve(repo.path(), "a.txt", "resolved content\n").unwrap();
    assert_eq!(core::conflict_list(repo.path()).unwrap().len(), 0);
    core::commit(repo.path(), "merge other", false).unwrap();
    assert_eq!(repo.read("a.txt"), "resolved content\n");
}

fn head_commit(repo: &TempRepo) -> (String, usize) {
    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let head = &page.commits[0];
    (head.oid.clone(), head.parents.len())
}

#[test]
fn commit_with_nothing_staged_is_refused_and_head_stays() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let base = commit_all(&repo, "base");
    repo.write("a.txt", "unstaged edit\n");

    let err = core::commit(repo.path(), "empty", false).unwrap_err();
    assert!(err.to_string().contains("Nothing staged to commit"));
    let head = head_commit(&repo);
    assert_eq!(head.0, base);
    assert_eq!(repo.read("a.txt"), "unstaged edit\n");
}

#[test]
fn first_commit_with_an_empty_index_is_refused() {
    let repo = TempRepo::new();
    repo.write("a.txt", "untracked\n");
    let err = core::commit(repo.path(), "empty", false).unwrap_err();
    assert!(err.to_string().contains("Nothing staged to commit"));
    core::stage_file(repo.path(), "a.txt").unwrap();
    core::commit(repo.path(), "first", false).unwrap();
}

#[test]
fn merge_that_keeps_head_tree_still_commits() {
    let repo = TempRepo::new();
    repo.write("a.txt", "line\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "other", None, true).unwrap();
    repo.write("a.txt", "other change\n");
    commit_all(&repo, "other");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("a.txt", "master change\n");
    let master = commit_all(&repo, "master");

    let outcome = core::merge(repo.path(), "other", false).unwrap();
    assert_eq!(outcome.status, "conflicts");
    core::conflict_resolve(repo.path(), "a.txt", "master change\n").unwrap();
    let merged = core::commit(repo.path(), "merge other, keep ours", false)
        .unwrap()
        .oid;
    assert_ne!(merged, master);
    let head = head_commit(&repo);
    assert_eq!(head.1, 2);
}

#[test]
fn unstage_all_and_discard_all() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "two\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "untracked\n");
    core::stage_all(repo.path()).unwrap();
    core::unstage_all(repo.path()).unwrap();
    let status = core::status(repo.path()).unwrap();
    assert!(status.files.iter().all(|f| f.staged.is_none()));
    assert_eq!(status.files.len(), 2);

    let remaining = core::discard_all(repo.path()).unwrap();
    assert!(remaining.is_empty());
    assert_eq!(repo.read("a.txt"), "one\n");
    assert!(!repo.dir.join("new.txt").exists());
    assert_eq!(core::status(repo.path()).unwrap().files.len(), 0);
}

#[test]
fn merge_message_includes_into_branch() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "topic", None, true).unwrap();
    repo.write("t.txt", "topic\n");
    commit_all(&repo, "topic work");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("m.txt", "master\n");
    commit_all(&repo, "master work");

    let outcome = core::merge(repo.path(), "topic", false).unwrap();
    assert_eq!(outcome.status, "ok");
    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits[0].summary, "Merge branch 'topic' into master");
}

#[test]
fn stash_roundtrip() {
    let repo = TempRepo::new();
    repo.write("a.txt", "committed\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "dirty\n");
    core::stash_create(repo.path(), Some("wip"), true, &[]).unwrap();
    assert_eq!(repo.read("a.txt"), "committed\n");
    assert_eq!(core::stash_list(repo.path()).unwrap().len(), 1);

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("a.txt"), "dirty\n");
    assert_eq!(core::stash_list(repo.path()).unwrap().len(), 0);
}

#[test]
fn stash_selected_files_leaves_the_rest_in_place() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "a dirty\n");
    repo.write("b.txt", "b dirty\n");
    repo.write("new.txt", "untracked\n");
    core::stash_create(repo.path(), Some("only a"), true, &["a.txt".into()]).unwrap();

    assert_eq!(repo.read("a.txt"), "a\n");
    assert_eq!(repo.read("b.txt"), "b dirty\n");
    assert_eq!(repo.read("new.txt"), "untracked\n");
    let stashes = core::stash_list(repo.path()).unwrap();
    assert_eq!(stashes.len(), 1);
    assert!(stashes[0].message.contains("only a"));

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("a.txt"), "a dirty\n");
    assert_eq!(repo.read("b.txt"), "b dirty\n");
}

#[test]
fn stash_selected_staged_file_leaves_other_staged_files_alone() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "A\n");
    repo.write("b.txt", "B\n");
    repo.write("c.txt", "new staged\n");
    core::stage_all(repo.path()).unwrap();
    core::stash_create(repo.path(), Some("only a"), true, &["a.txt".into()]).unwrap();

    let status = core::status(repo.path()).unwrap();
    let mut paths: Vec<_> = status.files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(paths, vec!["b.txt", "c.txt"]);
    assert!(status.files.iter().all(|f| f.staged.is_some()));
    assert_eq!(repo.read("a.txt"), "a\n");

    let files = core::stash_files(repo.path(), 0).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "a.txt");
    let stashes = core::stash_list(repo.path()).unwrap();
    assert_eq!(stashes[0].message, "On master: only a");

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("a.txt"), "A\n");
    assert_eq!(repo.read("b.txt"), "B\n");
    assert_eq!(repo.read("c.txt"), "new staged\n");

    let status = Command::new("git")
        .args(["stash", "list"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert!(String::from_utf8_lossy(&status.stdout).trim().is_empty());
}

#[test]
fn stash_selected_new_staged_file_is_removed_and_restored() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    commit_all(&repo, "base");
    repo.write("fresh.txt", "fresh\n");
    core::stage_file(repo.path(), "fresh.txt").unwrap();
    core::stash_create(repo.path(), None, true, &["fresh.txt".into()]).unwrap();
    assert!(!repo.dir.join("fresh.txt").exists());
    assert_eq!(core::status(repo.path()).unwrap().files.len(), 0);

    let stashes = core::stash_list(repo.path()).unwrap();
    assert!(stashes[0].message.starts_with("WIP on master: "));
    let listed = Command::new("git")
        .args(["stash", "show", "--name-only", "stash@{0}"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(String::from_utf8_lossy(&listed.stdout).trim(), "fresh.txt");

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("fresh.txt"), "fresh\n");
}

#[test]
fn discard_staged_file_restores_head_for_index_and_worktree() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    commit_all(&repo, "base");
    repo.write("a.txt", "staged\n");
    core::stage_file(repo.path(), "a.txt").unwrap();
    repo.write("a.txt", "staged then edited\n");
    repo.write("b.txt", "B\n");
    core::stage_file(repo.path(), "b.txt").unwrap();
    repo.write("fresh.txt", "new\n");
    core::stage_file(repo.path(), "fresh.txt").unwrap();

    assert!(core::discard_staged_file(repo.path(), "a.txt").unwrap());
    assert_eq!(repo.read("a.txt"), "a\n");
    let status = core::status(repo.path()).unwrap();
    assert!(status.files.iter().all(|f| f.path != "a.txt"));
    assert!(status
        .files
        .iter()
        .any(|f| f.path == "b.txt" && f.staged.is_some()));

    assert!(core::discard_staged_file(repo.path(), "fresh.txt").unwrap());
    assert!(!repo.dir.join("fresh.txt").exists());

    let leftovers = core::discard_staged_all(repo.path()).unwrap();
    assert!(leftovers.is_empty());
    assert_eq!(repo.read("b.txt"), "b\n");
    assert_eq!(core::status(repo.path()).unwrap().files.len(), 0);
}

#[test]
fn history_shows_stashes_as_single_parent_commits_and_hides_their_helpers() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    let base = commit_all(&repo, "base");
    repo.write("a.txt", "dirty\n");
    repo.write("new.txt", "untracked\n");
    core::stash_create(repo.path(), Some("wip graph"), true, &[]).unwrap();
    let stash_oid = core::stash_list(repo.path()).unwrap()[0].oid.clone();

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 20,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let summaries: Vec<_> = page.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(page.commits.len(), 2, "{summaries:?}");
    assert!(summaries
        .iter()
        .all(|s| !s.starts_with("index on") && !s.starts_with("untracked files on")));

    let stash = page
        .commits
        .iter()
        .find(|c| c.oid == stash_oid)
        .expect("stash listed");
    assert_eq!(stash.parents, vec![base.clone()]);
    let decoration = stash
        .refs
        .iter()
        .find(|r| r.kind == "stash")
        .expect("stash decoration");
    assert_eq!(decoration.name, "stash@{0}");
    assert_eq!(decoration.shorthand, "On master: wip graph");

    let position = core::history_position(repo.path(), &stash_oid)
        .unwrap()
        .expect("position");
    assert_eq!(position.index, 0);

    let branch_only = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 20,
            search: None,
            author: None,
            branch: Some("master".into()),
        },
    )
    .unwrap();
    assert!(branch_only.commits.iter().all(|c| c.oid != stash_oid));
}

#[test]
fn stash_selected_untracked_file_only() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "a dirty\n");
    repo.write("new.txt", "untracked\n");
    core::stash_create(repo.path(), None, true, &["new.txt".into()]).unwrap();

    assert!(!repo.dir.join("new.txt").exists());
    assert_eq!(repo.read("a.txt"), "a dirty\n");

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("new.txt"), "untracked\n");
}

#[test]
fn stash_files_lists_tracked_and_untracked_entries() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    commit_all(&repo, "base");
    repo.write("a.txt", "a dirty\n");
    repo.write("new/fresh.txt", "one\ntwo\n");
    core::stash_create(repo.path(), Some("wip"), true, &[]).unwrap();

    let mut files = core::stash_files(repo.path(), 0).unwrap();
    files.sort_by(|x, y| x.path.cmp(&y.path));
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "a.txt");
    assert_eq!(files[0].status, "modified");
    assert!(files[0].source_oid.is_none());
    assert_eq!(files[1].path, "new/fresh.txt");
    assert_eq!(files[1].status, "new");
    assert_eq!(files[1].additions, 2);
    assert!(files[1].source_oid.is_some());
}

#[test]
fn stash_restore_files_brings_back_only_the_chosen_files_and_keeps_the_stash() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    repo.write("gone.txt", "bye\n");
    commit_all(&repo, "base");
    repo.write("a.txt", "a dirty\n");
    repo.write("b.txt", "b dirty\n");
    repo.write("new/fresh.txt", "fresh\n");
    std::fs::remove_file(repo.dir.join("gone.txt")).unwrap();
    core::stash_create(repo.path(), None, true, &[]).unwrap();
    assert_eq!(repo.read("a.txt"), "a\n");
    assert!(!repo.dir.join("new/fresh.txt").exists());

    let restored = core::stash_restore_files(
        repo.path(),
        0,
        &["a.txt".into(), "new/fresh.txt".into(), "gone.txt".into()],
    )
    .unwrap();
    assert_eq!(restored.len(), 3);
    assert_eq!(repo.read("a.txt"), "a dirty\n");
    assert_eq!(repo.read("b.txt"), "b\n");
    assert_eq!(repo.read("new/fresh.txt"), "fresh\n");
    assert!(!repo.dir.join("gone.txt").exists());
    assert_eq!(core::stash_list(repo.path()).unwrap().len(), 1);

    let status = core::status(repo.path()).unwrap();
    let paths: Vec<_> = status.files.iter().map(|f| f.path.as_str()).collect();
    assert!(paths.contains(&"a.txt"));
    assert!(paths.contains(&"new/fresh.txt"));
    assert!(!paths.contains(&"b.txt"));

    let err = core::stash_restore_files(repo.path(), 0, &["nope.txt".into()]).unwrap_err();
    assert!(err.to_string().contains("not part of this stash"));
}

#[test]
fn checkout_remote_branch_fast_forwards_a_stale_local_branch() {
    let origin = TempRepo::new();
    origin.write("a.txt", "base\n");
    commit_all(&origin, "base");
    core::branch_create(origin.path(), "feature", None, true).unwrap();
    origin.write("f.txt", "one\n");
    commit_all(&origin, "feature one");

    let local = TempRepo::new();
    local.write("readme.md", "local\n");
    commit_all(&local, "local base");
    add_origin(&local, &origin);
    core::fetch(local.path(), "origin", false, false).unwrap();

    core::checkout_branch(local.path(), "origin/feature").unwrap();
    assert_eq!(local.read("f.txt"), "one\n");
    core::checkout_branch(local.path(), "master").unwrap();

    origin.write("f.txt", "two\n");
    let newest = commit_all(&origin, "feature two");
    core::fetch(local.path(), "origin", false, false).unwrap();

    local.write("notes.txt", "kept across checkout\n");
    core::checkout_branch(local.path(), "origin/feature").unwrap();
    let info = core::repo_info(local.path()).unwrap();
    assert_eq!(info.head_branch.as_deref(), Some("feature"));
    assert_eq!(info.head_oid.as_deref(), Some(newest.as_str()));
    assert_eq!(local.read("f.txt"), "two\n");
    assert_eq!(local.read("notes.txt"), "kept across checkout\n");
    let feature = core::branches(local.path())
        .unwrap()
        .into_iter()
        .find(|b| b.name == "feature" && !b.is_remote)
        .unwrap();
    assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));
    assert_eq!(feature.behind, 0);
}

#[test]
fn checkout_remote_branch_keeps_a_diverged_local_branch() {
    let origin = TempRepo::new();
    origin.write("a.txt", "base\n");
    commit_all(&origin, "base");
    core::branch_create(origin.path(), "feature", None, true).unwrap();
    origin.write("f.txt", "one\n");
    commit_all(&origin, "feature one");

    let local = TempRepo::new();
    local.write("readme.md", "local\n");
    commit_all(&local, "local base");
    add_origin(&local, &origin);
    core::fetch(local.path(), "origin", false, false).unwrap();
    core::checkout_branch(local.path(), "origin/feature").unwrap();
    local.write("mine.txt", "local work\n");
    let mine = commit_all(&local, "local feature work");
    core::checkout_branch(local.path(), "master").unwrap();

    origin.write("f.txt", "two\n");
    commit_all(&origin, "feature two");
    core::fetch(local.path(), "origin", false, false).unwrap();

    core::checkout_branch(local.path(), "origin/feature").unwrap();
    let info = core::repo_info(local.path()).unwrap();
    assert_eq!(info.head_oid.as_deref(), Some(mine.as_str()));
    assert_eq!(local.read("f.txt"), "one\n");
}

#[test]
fn tags_create_list_delete() {
    let repo = TempRepo::new();
    repo.write("a.txt", "x\n");
    commit_all(&repo, "base");

    core::tag_create(repo.path(), "v1.0.0", None, Some("release 1.0.0")).unwrap();
    core::tag_create(repo.path(), "light", None, None).unwrap();

    let tags = core::tag_list(repo.path()).unwrap();
    assert_eq!(tags.len(), 2);
    let annotated = tags.iter().find(|t| t.name == "v1.0.0").unwrap();
    assert!(annotated.is_annotated);

    core::tag_delete(repo.path(), "light").unwrap();
    assert_eq!(core::tag_list(repo.path()).unwrap().len(), 1);
}

#[test]
fn cherry_pick_applies_commit() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "source", None, true).unwrap();
    repo.write("picked.txt", "cherry\n");
    let picked_oid = commit_all(&repo, "add picked file");

    core::checkout_branch(repo.path(), "master").unwrap();
    assert!(!repo.dir.join("picked.txt").exists());
    let outcome = core::cherry_pick(repo.path(), &picked_oid, false).unwrap();
    assert_eq!(outcome.status, "ok");
    assert!(repo.dir.join("picked.txt").exists());
    assert_eq!(head_message(&repo), "add picked file\n");
}

fn head_message(repo: &TempRepo) -> String {
    let output = Command::new("git")
        .args(["log", "-1", "--format=%B"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn cherry_pick_many_applies_in_order_with_origin_lines() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "source", None, true).unwrap();
    repo.write("one.txt", "1\n");
    let first = commit_all(&repo, "feat: one");
    repo.write("two.txt", "2\n");
    let second = commit_all(&repo, "feat: two");

    core::checkout_branch(repo.path(), "master").unwrap();
    let outcome =
        core::cherry_pick_many(repo.path(), &[first.clone(), second.clone()], true).unwrap();
    assert_eq!(outcome.status, "ok");
    assert_eq!(outcome.message, "Cherry-picked 2 commits");
    assert!(repo.dir.join("one.txt").exists());
    assert!(repo.dir.join("two.txt").exists());

    assert_eq!(
        head_message(&repo),
        format!("feat: two\n\n(cherry picked from commit {second})\n\n")
    );
    let output = Command::new("git")
        .args(["log", "-1", "--format=%B", "HEAD~1"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        format!("feat: one\n\n(cherry picked from commit {first})\n\n")
    );
}

#[test]
fn cherry_pick_many_stops_at_the_first_conflict_and_reports_progress() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "source", None, true).unwrap();
    repo.write("clean.txt", "clean\n");
    let clean = commit_all(&repo, "feat: clean pick");
    repo.write("a.txt", "source change\n");
    let conflicting = commit_all(&repo, "feat: conflicting pick");
    repo.write("after.txt", "later\n");
    let after = commit_all(&repo, "feat: after the conflict");

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("a.txt", "master change\n");
    commit_all(&repo, "diverge on master");

    let outcome =
        core::cherry_pick_many(repo.path(), &[clean, conflicting.clone(), after], true).unwrap();
    assert_eq!(outcome.status, "conflicts");
    assert_eq!(
        outcome.message,
        format!(
            "Cherry-picked 1 of 3 commits. {} has conflicts to resolve; 1 more commit is waiting",
            &conflicting[..8]
        )
    );
    assert!(repo.dir.join("clean.txt").exists());
    assert!(!repo.dir.join("after.txt").exists());
    assert!(head_message(&repo).starts_with("feat: clean pick\n"));
    assert!(!core::conflict_list(repo.path()).unwrap().is_empty());
}

#[test]
fn cherry_pick_record_origin_matches_git_cli() {
    let messages = [
        "feat: add picked file\n\nSome body text.",
        "fix: adjust\n\nSigned-off-by: Test User <test@angkorgit.dev>",
    ];
    for message in messages {
        let repo = TempRepo::new();
        repo.write("a.txt", "base\n");
        let base = commit_all(&repo, "base");

        core::branch_create(repo.path(), "source", None, true).unwrap();
        repo.write("picked.txt", "cherry\n");
        let picked = commit_all(&repo, message);

        core::checkout_branch(repo.path(), "master").unwrap();
        let outcome = core::cherry_pick(repo.path(), &picked, true).unwrap();
        assert_eq!(outcome.status, "ok");
        let engine_message = head_message(&repo);
        assert!(
            engine_message.contains(&format!("(cherry picked from commit {picked})")),
            "missing origin line in: {engine_message:?}"
        );

        core::reset(repo.path(), &base, "hard").unwrap();
        let output = Command::new("git")
            .args(["cherry-pick", "-x", &picked])
            .current_dir(&repo.dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git CLI available");
        assert!(
            output.status.success(),
            "git cherry-pick -x failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(engine_message, head_message(&repo), "message {message:?}");
    }
}

#[test]
fn revert_creates_inverse_commit() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    repo.write("bad.txt", "mistake\n");
    let bad = commit_all(&repo, "add bad file");

    let outcome = core::revert(repo.path(), &bad).unwrap();
    assert_eq!(outcome.status, "ok");
    assert!(!repo.dir.join("bad.txt").exists());

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits[0].summary, "Revert \"add bad file\"");
}

#[test]
fn reset_modes() {
    let repo = TempRepo::new();
    repo.write("a.txt", "v1\n");
    let first = commit_all(&repo, "v1");
    repo.write("a.txt", "v2\n");
    commit_all(&repo, "v2");

    core::reset(repo.path(), &first, "hard").unwrap();
    assert_eq!(repo.read("a.txt"), "v1\n");
    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 10,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits.len(), 1);
}

#[cfg(unix)]
#[test]
fn staging_a_broken_symlink_adds_it_to_the_index() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    std::os::unix::fs::symlink("missing-target", repo.dir.join("dangling")).unwrap();
    core::stage_file(repo.path(), "dangling").unwrap();

    let status = core::status(repo.path()).unwrap();
    let entry = status.files.iter().find(|f| f.path == "dangling").unwrap();
    assert_eq!(entry.staged.as_deref(), Some("new"));
}

#[test]
fn reset_rejects_unknown_mode() {
    let repo = TempRepo::new();
    repo.write("a.txt", "v1\n");
    let first = commit_all(&repo, "v1");
    repo.write("a.txt", "v2\n");
    commit_all(&repo, "v2");

    assert!(core::reset(repo.path(), &first, "sneaky").is_err());
    assert_eq!(repo.read("a.txt"), "v2\n");
}

#[test]
fn history_pagination_without_filters() {
    let repo = TempRepo::new();
    for i in 0..5 {
        repo.write("a.txt", &format!("v{i}\n"));
        commit_all(&repo, &format!("commit {i}"));
    }

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 2,
            limit: 2,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let summaries: Vec<_> = page.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["commit 2", "commit 1"]);
    assert!(page.has_more);

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 4,
            limit: 2,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].summary, "commit 0");
    assert!(!page.has_more);
}

#[test]
fn history_pagination_with_search_filter() {
    let repo = TempRepo::new();
    for i in 0..4 {
        repo.write("a.txt", &format!("f{i}\n"));
        commit_all(&repo, &format!("feature {i}"));
        repo.write("a.txt", &format!("c{i}\n"));
        commit_all(&repo, &format!("chore {i}"));
    }

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 1,
            limit: 2,
            search: Some("feature".into()),
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let summaries: Vec<_> = page.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["feature 2", "feature 1"]);
    assert!(page.has_more);
}

#[test]
fn line_level_stage_unstage_discard() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\ntwo\nthree\nfour\nfive\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "one\nTWO\nthree\nFOUR\nfive\n");
    let diff = core::file_diff(repo.path(), "a.txt", false, 3).unwrap();
    assert_eq!(diff.hunks.len(), 1);
    let first_addition = diff.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == "addition")
        .unwrap()
        .new_line_no
        .unwrap();

    core::stage_line(repo.path(), "a.txt", "addition", first_addition).unwrap();
    let status = core::status(repo.path()).unwrap();
    let entry = &status.files[0];
    assert_eq!(entry.staged.as_deref(), Some("modified"));
    assert_eq!(entry.unstaged.as_deref(), Some("modified"));

    let staged = core::file_diff(repo.path(), "a.txt", true, 3).unwrap();
    assert_eq!(staged.additions, 1); // only TWO staged
    let unstaged = core::file_diff(repo.path(), "a.txt", false, 3).unwrap();
    assert_eq!(unstaged.additions, 1); // FOUR still unstaged

    let staged_addition = staged.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == "addition")
        .unwrap()
        .new_line_no
        .unwrap();
    core::unstage_line(repo.path(), "a.txt", "addition", staged_addition).unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged, None);

    let diff = core::file_diff(repo.path(), "a.txt", false, 3).unwrap();
    let four_line = diff.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == "addition" && l.content.contains("FOUR"))
        .unwrap()
        .new_line_no
        .unwrap();
    core::discard_line(repo.path(), "a.txt", "addition", four_line).unwrap();
    assert_eq!(repo.read("a.txt"), "one\nTWO\nthree\nfour\nfive\n");
}

#[test]
fn line_ops_handle_missing_trailing_newline() {
    let repo = TempRepo::new();
    repo.write("README.md", "alpha\nbeta\ngamma");
    commit_all(&repo, "base");

    repo.write("README.md", "alpha\nbeta\ngamma\n\n\nkhlhlihho");

    let find_addition = |staged: bool, needle: &str| {
        let diff = core::file_diff(repo.path(), "README.md", staged, 3).unwrap();
        diff.hunks[0]
            .lines
            .iter()
            .find(|l| l.kind == "addition" && l.content.contains(needle))
            .map(|l| l.new_line_no.unwrap())
    };

    let last = find_addition(false, "khlhlihho").unwrap();
    core::discard_line(repo.path(), "README.md", "addition", last).unwrap();
    assert_eq!(repo.read("README.md"), "alpha\nbeta\ngamma\n\n\n");

    repo.write("README.md", "alpha\nbeta\ngamma\n\n\nkhlhlihho");
    let last = find_addition(false, "khlhlihho").unwrap();
    core::stage_line(repo.path(), "README.md", "addition", last).unwrap();
    let staged = find_addition(true, "khlhlihho");
    assert!(staged.is_some(), "line should be staged");

    core::unstage_line(repo.path(), "README.md", "addition", staged.unwrap()).unwrap();
    assert!(find_addition(true, "khlhlihho").is_none());
    assert_eq!(repo.read("README.md"), "alpha\nbeta\ngamma\n\n\nkhlhlihho");
}

#[test]
fn hunk_ops_handle_missing_trailing_newline() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\ntwo");
    commit_all(&repo, "base");

    repo.write("a.txt", "one\ntwo\nthree");
    core::stage_hunk(repo.path(), "a.txt", 0).unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged.as_deref(), Some("modified"));
    assert_eq!(status.files[0].unstaged, None);

    core::unstage_hunk(repo.path(), "a.txt", 0).unwrap();
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged, None);
}

#[test]
fn file_history_lists_only_touching_commits() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a1\n");
    repo.write("b.txt", "b1\n");
    commit_all(&repo, "add a and b");

    repo.write("b.txt", "b2\n");
    commit_all(&repo, "change b only");

    repo.write("a.txt", "a2\n");
    commit_all(&repo, "change a");

    repo.write("a.txt", "a3\n");
    repo.write("b.txt", "b3\n");
    commit_all(&repo, "change both");

    let page = core::file_history(repo.path(), "a.txt", 100, 0).unwrap();
    let summaries: Vec<_> = page.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["change both", "change a", "add a and b"]);
    assert!(!page.has_more);

    let page = core::file_history(repo.path(), "a.txt", 2, 0).unwrap();
    assert_eq!(page.commits.len(), 2);
    assert!(page.has_more);
}

fn todo_entry(oid: &str, action: &str, message: Option<&str>) -> core::RebaseTodoEntry {
    core::RebaseTodoEntry {
        oid: oid.to_string(),
        action: action.to_string(),
        message: message.map(String::from),
    }
}

fn history_summaries(repo: &TempRepo) -> Vec<String> {
    core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 20,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap()
    .commits
    .iter()
    .map(|c| c.summary.clone())
    .collect()
}

#[test]
fn interactive_rebase_reorders_drops_and_lists_range() {
    let repo = TempRepo::new();
    repo.write("base.txt", "base\n");
    let base = commit_all(&repo, "base");
    repo.write("f1.txt", "1\n");
    let c1 = commit_all(&repo, "one");
    repo.write("f2.txt", "2\n");
    let c2 = commit_all(&repo, "two");
    repo.write("f3.txt", "3\n");
    let c3 = commit_all(&repo, "three");

    let range = core::rebase_commits(repo.path(), &base).unwrap();
    let summaries: Vec<_> = range.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["three", "two", "one"]);

    let todo = vec![
        todo_entry(&c3, "pick", None),
        todo_entry(&c2, "drop", None),
        todo_entry(&c1, "pick", None),
    ];
    core::rebase_interactive(repo.path(), &base, &todo).unwrap();

    assert_eq!(history_summaries(&repo), vec!["one", "three", "base"]);
    assert_eq!(repo.read("f1.txt"), "1\n");
    assert_eq!(repo.read("f3.txt"), "3\n");
    assert!(!repo.dir.join("f2.txt").exists());
}

#[test]
fn interactive_rebase_squashes_and_rewords() {
    let repo = TempRepo::new();
    repo.write("base.txt", "base\n");
    let base = commit_all(&repo, "base");
    repo.write("f1.txt", "1\n");
    let c1 = commit_all(&repo, "one");
    repo.write("f2.txt", "2\n");
    let c2 = commit_all(&repo, "two");
    repo.write("f3.txt", "3\n");
    let c3 = commit_all(&repo, "three");

    let todo = vec![
        todo_entry(&c1, "pick", None),
        todo_entry(&c2, "squash", None),
        todo_entry(&c3, "reword", Some("three renamed")),
    ];
    core::rebase_interactive(repo.path(), &base, &todo).unwrap();

    assert_eq!(
        history_summaries(&repo),
        vec!["three renamed", "one", "base"]
    );
    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 1,
            limit: 1,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert!(page.commits[0].body.contains("two"));
    assert_eq!(repo.read("f1.txt"), "1\n");
    assert_eq!(repo.read("f2.txt"), "2\n");
    assert_eq!(repo.read("f3.txt"), "3\n");
}

#[test]
fn interactive_rebase_conflict_aborts_without_touching_the_repo() {
    let repo = TempRepo::new();
    repo.write("f.txt", "zero\n");
    let base = commit_all(&repo, "base");
    repo.write("f.txt", "one\n");
    let c1 = commit_all(&repo, "one");
    repo.write("f.txt", "two\n");
    let c2 = commit_all(&repo, "two");

    let todo = vec![todo_entry(&c2, "pick", None), todo_entry(&c1, "pick", None)];
    let result = core::rebase_interactive(repo.path(), &base, &todo);
    assert!(result.is_err());

    assert_eq!(history_summaries(&repo), vec!["two", "one", "base"]);
    assert_eq!(repo.read("f.txt"), "two\n");
}

#[test]
fn interactive_rebase_rejects_invalid_plans() {
    let repo = TempRepo::new();
    repo.write("base.txt", "base\n");
    let base = commit_all(&repo, "base");
    repo.write("f1.txt", "1\n");
    let c1 = commit_all(&repo, "one");

    assert!(
        core::rebase_interactive(repo.path(), &base, &[todo_entry(&c1, "squash", None)]).is_err()
    );
    assert!(
        core::rebase_interactive(repo.path(), &base, &[todo_entry(&c1, "explode", None)]).is_err()
    );
    assert!(
        core::rebase_interactive(repo.path(), &base, &[todo_entry(&base, "pick", None)]).is_err()
    );

    repo.write("f1.txt", "dirty\n");
    assert!(
        core::rebase_interactive(repo.path(), &base, &[todo_entry(&c1, "pick", None)]).is_err()
    );

    assert_eq!(history_summaries(&repo), vec!["one", "base"]);
}

#[test]
fn cleanup_state_clears_a_stale_rebase_without_touching_files() {
    let repo = TempRepo::new();
    repo.write("f.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "topic", None, true).unwrap();
    repo.write("f.txt", "topic\n");
    commit_all(&repo, "topic change");

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("f.txt", "master\n");
    commit_all(&repo, "master change");

    core::checkout_branch(repo.path(), "topic").unwrap();
    let outcome = core::rebase(repo.path(), "master").unwrap();
    assert_eq!(outcome.status, "conflicts");
    assert_eq!(core::repo_info(repo.path()).unwrap().state, "rebase");

    core::conflict_resolve(repo.path(), "f.txt", "resolved\n").unwrap();
    core::commit(repo.path(), "resolved by hand", false).unwrap();
    assert_eq!(core::repo_info(repo.path()).unwrap().state, "rebase");

    core::cleanup_state(repo.path()).unwrap();
    assert_eq!(core::repo_info(repo.path()).unwrap().state, "clean");
    assert_eq!(repo.read("f.txt"), "resolved\n");
    assert_eq!(core::status(repo.path()).unwrap().files.len(), 0);
}

#[test]
fn file_history_paginates_with_skip() {
    let repo = TempRepo::new();
    for i in 0..5 {
        repo.write("a.txt", &format!("a{i}\n"));
        commit_all(&repo, &format!("change a {i}"));
        repo.write("b.txt", &format!("b{i}\n"));
        commit_all(&repo, &format!("change b {i}"));
    }

    let first = core::file_history(repo.path(), "a.txt", 2, 0).unwrap();
    let second = core::file_history(repo.path(), "a.txt", 2, 2).unwrap();
    let third = core::file_history(repo.path(), "a.txt", 2, 4).unwrap();

    let all: Vec<_> = first
        .commits
        .iter()
        .chain(&second.commits)
        .chain(&third.commits)
        .map(|c| c.summary.as_str())
        .collect();
    assert_eq!(
        all,
        vec![
            "change a 4",
            "change a 3",
            "change a 2",
            "change a 1",
            "change a 0"
        ]
    );
    assert!(first.has_more);
    assert!(second.has_more);
    assert!(!third.has_more);
}

#[test]
fn file_diff_reports_hunks() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\ntwo\nthree\n");
    commit_all(&repo, "base");

    repo.write("a.txt", "one\nTWO\nthree\n");
    let diff = core::file_diff(repo.path(), "a.txt", false, 3).unwrap();
    assert_eq!(diff.hunks.len(), 1);
    assert_eq!(diff.additions, 1);
    assert_eq!(diff.deletions, 1);

    let full = core::file_diff(repo.path(), "a.txt", false, u32::MAX).unwrap();
    let context_lines = full.hunks[0]
        .lines
        .iter()
        .filter(|l| l.kind == "context")
        .count();
    assert_eq!(context_lines, 2); // "one" and "three" around the change
}

#[test]
fn file_diff_can_ignore_whitespace() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n  two\nthree\n");
    commit_all(&repo, "base");
    repo.write("a.txt", "one\ntwo\nthree\n");

    let raw = core::file_diff(repo.path(), "a.txt", false, 3).unwrap();
    assert!(raw.additions + raw.deletions > 0);

    let ignored = core::file_diff_with(repo.path(), "a.txt", false, 3, true).unwrap();
    assert_eq!(ignored.additions, 0);
    assert_eq!(ignored.deletions, 0);

    repo.write("a.txt", "one\nTWO\nthree\n");
    let token = core::file_diff_with(repo.path(), "a.txt", false, 3, true).unwrap();
    assert!(token.additions + token.deletions > 0);

    commit_all(&repo, "token");
    repo.write("a.txt", "one\n  two\nthree\n");
    commit_all(&repo, "reindent");
    repo.write("a.txt", "one\ntwo\nthree\n");
    let oid = commit_all(&repo, "dedent");
    let commit = core::commit_file_diff_with(repo.path(), &oid, "a.txt", None, 3, true).unwrap();
    assert_eq!(commit.additions, 0);
    assert_eq!(commit.deletions, 0);
    let shown = core::commit_diff_with(repo.path(), &oid, 3, false).unwrap();
    assert!(shown.iter().any(|d| d.additions + d.deletions > 0));
}

#[test]
fn rebase_linearizes_history() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "feature", None, true).unwrap();
    repo.write("feature.txt", "f\n");
    commit_all(&repo, "feature commit");

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("master.txt", "m\n");
    commit_all(&repo, "master commit");

    core::checkout_branch(repo.path(), "feature").unwrap();
    let outcome = core::rebase(repo.path(), "master").unwrap();
    assert_eq!(outcome.status, "ok");
    assert!(repo.dir.join("master.txt").exists());
    assert!(repo.dir.join("feature.txt").exists());
}

#[test]
fn interoperates_with_git_cli() {
    let repo = TempRepo::new();
    repo.write("a.txt", "cli\n");
    commit_all(&repo, "from engine");

    let output = Command::new("git")
        .args(["log", "--oneline"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("from engine"));
}

#[test]
fn merge_prefers_branch_over_same_named_tag() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");

    core::branch_create(repo.path(), "production", None, false).unwrap();
    core::branch_create(repo.path(), "demo", None, true).unwrap();
    repo.write("demo.txt", "demo work\n");
    commit_all(&repo, "demo work");
    core::tag_create(repo.path(), "demo", Some(&base), None).unwrap();

    core::checkout_branch(repo.path(), "production").unwrap();
    let outcome = core::merge(repo.path(), "demo", false).unwrap();
    assert_eq!(outcome.status, "fast_forward");
    assert!(repo.dir.join("demo.txt").exists());
    assert_eq!(repo.read("demo.txt"), "demo work\n");
}

#[test]
fn rebase_prefers_branch_over_same_named_tag() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");

    core::branch_create(repo.path(), "demo", None, true).unwrap();
    repo.write("demo.txt", "demo work\n");
    commit_all(&repo, "demo work");
    core::tag_create(repo.path(), "demo", Some(&base), None).unwrap();

    core::checkout_branch(repo.path(), "master").unwrap();
    core::branch_create(repo.path(), "production", None, true).unwrap();
    repo.write("prod.txt", "prod work\n");
    commit_all(&repo, "prod work");

    let outcome = core::rebase(repo.path(), "demo").unwrap();
    assert_eq!(outcome.status, "ok");
    assert!(repo.dir.join("demo.txt").exists());
    assert!(repo.dir.join("prod.txt").exists());
}

#[test]
fn history_branch_filter_prefers_branch_over_tag() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");

    core::branch_create(repo.path(), "demo", None, true).unwrap();
    repo.write("demo.txt", "demo work\n");
    commit_all(&repo, "demo work");
    core::tag_create(repo.path(), "demo", Some(&base), None).unwrap();

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 10,
            search: None,
            author: None,
            branch: Some("demo".into()),
        },
    )
    .unwrap();
    assert_eq!(page.commits.len(), 2);
    assert_eq!(page.commits[0].summary, "demo work");
}

#[test]
fn merge_fast_forward_preserves_uncommitted_changes() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "feature", None, true).unwrap();
    repo.write("b.txt", "feature\n");
    commit_all(&repo, "feature work");

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("a.txt", "local edit\n");
    repo.write("wip.txt", "untracked\n");

    let outcome = core::merge(repo.path(), "feature", false).unwrap();
    assert_eq!(outcome.status, "fast_forward");
    assert!(repo.dir.join("b.txt").exists());
    assert_eq!(repo.read("a.txt"), "local edit\n");
    assert_eq!(repo.read("wip.txt"), "untracked\n");
}

#[test]
fn drag_merge_sequence_checkout_target_then_merge_source() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "production", None, false).unwrap();
    core::branch_create(repo.path(), "demo", None, true).unwrap();
    repo.write("feature.txt", "demo change\n");
    commit_all(&repo, "demo change");

    core::checkout_branch(repo.path(), "production").unwrap();
    repo.write("prod.txt", "production change\n");
    commit_all(&repo, "production change");
    core::checkout_branch(repo.path(), "master").unwrap();

    core::checkout_branch(repo.path(), "production").unwrap();
    let outcome = core::merge(repo.path(), "demo", false).unwrap();
    assert_eq!(outcome.status, "ok");
    assert_eq!(repo.read("feature.txt"), "demo change\n");
    assert_eq!(repo.read("prod.txt"), "production change\n");

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: Some("production".into()),
        },
    )
    .unwrap();
    assert_eq!(
        page.commits[0].summary,
        "Merge branch 'demo' into production"
    );
    assert_eq!(page.commits[0].parents.len(), 2);
}

#[test]
fn merge_no_ff_creates_merge_commit_when_fast_forward_possible() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "production", None, true).unwrap();
    repo.write("prod.txt", "released\n");
    commit_all(&repo, "release work");

    core::checkout_branch(repo.path(), "master").unwrap();
    let outcome = core::merge(repo.path(), "production", true).unwrap();
    assert_eq!(outcome.status, "ok");
    assert_eq!(repo.read("prod.txt"), "released\n");

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: Some("master".into()),
        },
    )
    .unwrap();
    assert_eq!(
        page.commits[0].summary,
        "Merge branch 'production' into master"
    );
    assert_eq!(page.commits[0].parents.len(), 2);

    let outcome = core::merge(repo.path(), "production", true).unwrap();
    assert_eq!(outcome.status, "up_to_date");
}

#[test]
fn merge_message_available_during_conflicted_merge_only() {
    let repo = TempRepo::new();
    repo.write("a.txt", "line\n");
    commit_all(&repo, "base");

    assert_eq!(core::merge_message(repo.path()).unwrap(), None);

    core::branch_create(repo.path(), "other", None, true).unwrap();
    repo.write("a.txt", "other change\n");
    commit_all(&repo, "other");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("a.txt", "master change\n");
    commit_all(&repo, "master");

    let outcome = core::merge(repo.path(), "other", false).unwrap();
    assert_eq!(outcome.status, "conflicts");

    let message = core::merge_message(repo.path()).unwrap().unwrap();
    assert!(message.starts_with("Merge branch 'other'"));
    assert!(!message.contains('#'));

    core::conflict_resolve(repo.path(), "a.txt", "resolved\n").unwrap();
    core::commit(repo.path(), &message, false).unwrap();
    assert_eq!(core::merge_message(repo.path()).unwrap(), None);
}

#[test]
fn can_fast_forward_only_when_target_is_strictly_behind() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");

    core::branch_create(repo.path(), "feature", None, true).unwrap();
    repo.write("b.txt", "feature\n");
    commit_all(&repo, "feature work");

    assert!(core::can_fast_forward(repo.path(), "master", "feature").unwrap());
    assert!(!core::can_fast_forward(repo.path(), "feature", "master").unwrap());

    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("c.txt", "master\n");
    commit_all(&repo, "master work");

    assert!(!core::can_fast_forward(repo.path(), "master", "feature").unwrap());
    assert!(!core::can_fast_forward(repo.path(), "feature", "feature").unwrap());
}

struct SigningKey {
    dir: PathBuf,
    key: PathBuf,
}

impl SigningKey {
    fn generate() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-signkey-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("signing_key");
        let status = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-q", "-f", key.to_str().unwrap()])
            .status()
            .expect("ssh-keygen available");
        assert!(status.success());
        Self { dir, key }
    }

    fn enable_for(&self, repo: &TempRepo) {
        core::set_config(Some(repo.path()), "commit.gpgsign", "true", false).unwrap();
        core::set_config(Some(repo.path()), "gpg.format", "ssh", false).unwrap();
        core::set_config(
            Some(repo.path()),
            "user.signingkey",
            self.key.to_str().unwrap(),
            false,
        )
        .unwrap();
    }
}

impl Drop for SigningKey {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn commit_header(repo: &TempRepo, rev: &str) -> String {
    let output = Command::new("git")
        .args(["cat-file", "commit", rev])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert!(output.status.success());
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn commit_signs_with_ssh_key_when_config_enables_it() {
    let repo = TempRepo::new();
    let signing = SigningKey::generate();
    signing.enable_for(&repo);

    repo.write("a.txt", "signed\n");
    commit_all(&repo, "feat: signed commit");

    let header = commit_header(&repo, "HEAD");
    assert!(header.contains("gpgsig"));
    assert!(header.contains("SSH SIGNATURE"));

    let pubkey = std::fs::read_to_string(signing.key.with_extension("pub")).unwrap();
    let signers = signing.dir.join("allowed_signers");
    std::fs::write(&signers, format!("test@angkorgit.dev {pubkey}")).unwrap();
    let verify = Command::new("git")
        .args([
            "-c",
            &format!("gpg.ssh.allowedSignersFile={}", signers.display()),
            "verify-commit",
            "HEAD",
        ])
        .current_dir(&repo.dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("git CLI available");
    assert!(
        verify.status.success(),
        "git verify-commit failed: {}",
        String::from_utf8_lossy(&verify.stderr)
    );
}

#[test]
fn commits_stay_unsigned_without_signing_config() {
    let repo = TempRepo::new();
    core::set_config(Some(repo.path()), "commit.gpgsign", "false", false).unwrap();
    repo.write("a.txt", "plain\n");
    commit_all(&repo, "plain commit");
    assert!(!commit_header(&repo, "HEAD").contains("gpgsig"));
}

#[test]
fn amend_re_signs_the_commit() {
    let repo = TempRepo::new();
    let signing = SigningKey::generate();
    signing.enable_for(&repo);

    repo.write("a.txt", "one\n");
    commit_all(&repo, "feat: original");
    repo.write("a.txt", "two\n");
    core::stage_all(repo.path()).unwrap();
    core::amend(repo.path(), Some("feat: amended"), false).unwrap();

    let header = commit_header(&repo, "HEAD");
    assert!(header.contains("SSH SIGNATURE"));
    assert!(header.contains("feat: amended"));
    assert_eq!(repo.read("a.txt"), "two\n");
}

#[test]
fn merge_commit_is_signed_when_signing_enabled() {
    let repo = TempRepo::new();
    let signing = SigningKey::generate();
    signing.enable_for(&repo);

    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, true).unwrap();
    repo.write("b.txt", "feature\n");
    commit_all(&repo, "feature work");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("c.txt", "master\n");
    commit_all(&repo, "master work");

    let outcome = core::merge(repo.path(), "feature", false).unwrap();
    assert_eq!(outcome.status, "ok");

    let header = commit_header(&repo, "HEAD");
    assert!(header.contains("SSH SIGNATURE"));
    assert!(header.contains("Merge branch 'feature'"));
}

#[test]
fn signing_failure_blocks_the_commit_and_leaves_the_repo_untouched() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let first = commit_all(&repo, "first");

    core::set_config(Some(repo.path()), "commit.gpgsign", "true", false).unwrap();
    core::set_config(Some(repo.path()), "gpg.format", "ssh", false).unwrap();
    core::set_config(
        Some(repo.path()),
        "user.signingkey",
        "/nonexistent/signing_key",
        false,
    )
    .unwrap();

    repo.write("a.txt", "two\n");
    core::stage_all(repo.path()).unwrap();
    let err = core::commit(repo.path(), "second", false).unwrap_err();
    assert!(err.to_string().contains("user.signingKey"));

    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), first);
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].staged.as_deref(), Some("modified"));
}

fn add_origin(local: &TempRepo, origin: &TempRepo) {
    let status = Command::new("git")
        .args(["remote", "add", "origin", origin.path()])
        .current_dir(&local.dir)
        .status()
        .expect("git CLI available");
    assert!(status.success());
}

#[test]
fn remote_add_registers_the_remote_and_fetch_uses_it() {
    let origin = TempRepo::new();
    origin.write("a.txt", "one\n");
    let tip = commit_all(&origin, "first");
    let local = TempRepo::new();
    local.write("b.txt", "two\n");
    commit_all(&local, "local");

    core::remote_add(local.path(), "upstream", origin.path()).unwrap();
    let remotes = core::remote_list(local.path()).unwrap();
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "upstream");
    assert_eq!(remotes[0].url, origin.path());

    let dup = core::remote_add(local.path(), "upstream", origin.path()).unwrap_err();
    assert!(dup.to_string().contains("already exists"));
    let blank = core::remote_add(local.path(), "  ", origin.path()).unwrap_err();
    assert!(blank.to_string().contains("required"));

    core::fetch(local.path(), "upstream", false, false).unwrap();
    let fetched = Command::new("git")
        .args(["rev-parse", "refs/remotes/upstream/master"])
        .current_dir(&local.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(String::from_utf8_lossy(&fetched.stdout).trim(), tip);
}

fn set_pull_head(origin: &TempRepo, oid: &str) {
    let status = Command::new("git")
        .args(["update-ref", "refs/pull/1/head", oid])
        .current_dir(&origin.dir)
        .status()
        .expect("git CLI available");
    assert!(status.success());
}

#[test]
fn pr_checkout_fetches_the_pull_head_and_updates_on_rerun() {
    let origin = TempRepo::new();
    origin.write("a.txt", "base\n");
    commit_all(&origin, "base");
    core::branch_create(origin.path(), "feature", None, true).unwrap();
    origin.write("pr.txt", "one\n");
    let first = commit_all(&origin, "pr work");
    set_pull_head(&origin, &first);

    let local = TempRepo::new();
    local.write("readme.md", "local\n");
    commit_all(&local, "local base");
    add_origin(&local, &origin);

    core::checkout_remote_ref(local.path(), "origin", "refs/pull/1/head", "pr/1", false).unwrap();
    let info = core::repo_info(local.path()).unwrap();
    assert_eq!(info.head_branch.as_deref(), Some("pr/1"));
    assert_eq!(local.read("pr.txt"), "one\n");

    origin.write("pr.txt", "two\n");
    let second = commit_all(&origin, "pr follow-up");
    set_pull_head(&origin, &second);

    core::checkout_remote_ref(local.path(), "origin", "refs/pull/1/head", "pr/1", false).unwrap();
    assert_eq!(local.read("pr.txt"), "two\n");
    assert_eq!(core::status(local.path()).unwrap().files.len(), 0);
}

#[test]
fn pr_checkout_refuses_a_diverged_local_branch() {
    let origin = TempRepo::new();
    origin.write("a.txt", "base\n");
    commit_all(&origin, "base");
    core::branch_create(origin.path(), "feature", None, true).unwrap();
    origin.write("pr.txt", "one\n");
    let first = commit_all(&origin, "pr work");
    set_pull_head(&origin, &first);

    let local = TempRepo::new();
    local.write("readme.md", "local\n");
    commit_all(&local, "local base");
    add_origin(&local, &origin);
    core::checkout_remote_ref(local.path(), "origin", "refs/pull/1/head", "pr/1", false).unwrap();

    local.write("mine.txt", "local work\n");
    let mine = commit_all(&local, "local divergence");

    origin.write("pr.txt", "two\n");
    let second = commit_all(&origin, "pr follow-up");
    set_pull_head(&origin, &second);

    let err = core::checkout_remote_ref(local.path(), "origin", "refs/pull/1/head", "pr/1", false)
        .unwrap_err();
    assert!(err.to_string().contains("delete or rename"));
    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&local.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), mine);
}

#[test]
fn pr_checkout_tracks_the_source_branch_for_same_repo_pull_requests() {
    let origin = TempRepo::new();
    origin.write("a.txt", "base\n");
    commit_all(&origin, "base");
    core::branch_create(origin.path(), "feature", None, true).unwrap();
    origin.write("pr.txt", "one\n");
    commit_all(&origin, "pr work");

    let local = TempRepo::new();
    local.write("readme.md", "local\n");
    commit_all(&local, "local base");
    add_origin(&local, &origin);

    core::checkout_remote_ref(
        local.path(),
        "origin",
        "refs/heads/feature",
        "feature",
        true,
    )
    .unwrap();
    let info = core::repo_info(local.path()).unwrap();
    assert_eq!(info.head_branch.as_deref(), Some("feature"));
    assert_eq!(local.read("pr.txt"), "one\n");

    let upstream = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "feature@{upstream}"])
        .current_dir(&local.dir)
        .output()
        .expect("git CLI available");
    assert_eq!(
        String::from_utf8_lossy(&upstream.stdout).trim(),
        "origin/feature"
    );

    origin.write("pr.txt", "two\n");
    commit_all(&origin, "pr follow-up");
    core::checkout_remote_ref(
        local.path(),
        "origin",
        "refs/heads/feature",
        "feature",
        true,
    )
    .unwrap();
    assert_eq!(local.read("pr.txt"), "two\n");

    local.write("mine.txt", "local work\n");
    commit_all(&local, "local divergence");
    origin.write("pr.txt", "three\n");
    commit_all(&origin, "pr third");
    let err = core::checkout_remote_ref(
        local.path(),
        "origin",
        "refs/heads/feature",
        "feature",
        true,
    )
    .unwrap_err();
    assert!(err.to_string().contains("delete or rename"));
    assert_eq!(local.read("pr.txt"), "two\n");
}

#[test]
fn history_position_locates_a_commit_in_the_default_walk() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let first = commit_all(&repo, "first");
    repo.write("a.txt", "two\n");
    commit_all(&repo, "second");
    repo.write("a.txt", "three\n");
    let third = commit_all(&repo, "third");

    let head = core::history_position(repo.path(), &third)
        .unwrap()
        .unwrap();
    assert_eq!(head.index, 0);
    assert_eq!(head.oid, third);

    let oldest = core::history_position(repo.path(), &first[..8])
        .unwrap()
        .unwrap();
    assert_eq!(oldest.index, 2);
    assert_eq!(oldest.oid, first);

    assert!(core::history_position(repo.path(), "deadbeef")
        .unwrap()
        .is_none());
    assert!(core::history_position(repo.path(), "not a rev")
        .unwrap()
        .is_none());
}

#[test]
fn history_search_lists_match_positions_in_the_displayed_walk() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let first = commit_all(&repo, "feature: lanes");
    repo.write("a.txt", "two\n");
    commit_all(&repo, "chore: bump");
    repo.write("a.txt", "three\n");
    let third = commit_all(&repo, "fix(lanes): colors");

    let found = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: "LANES".into(),
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let positions: Vec<_> = found
        .matches
        .iter()
        .map(|m| (m.index, m.oid.as_str()))
        .collect();
    assert_eq!(positions, vec![(0, third.as_str()), (2, first.as_str())]);
    assert!(!found.truncated);

    let by_hash = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: first[..7].to_string(),
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(by_hash.matches.len(), 1);
    assert_eq!(by_hash.matches[0].oid, first);

    let none = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: "nothing here".into(),
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert!(none.matches.is_empty());

    let blank = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: "   ".into(),
            author: None,
            branch: None,
        },
    )
    .unwrap();
    assert!(blank.matches.is_empty());

    let page = core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 1,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap();
    let author_name = page.commits[0].author.name.clone();
    let by_author = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: String::new(),
            author: Some(author_name.to_uppercase()),
            branch: None,
        },
    )
    .unwrap();
    let indices: Vec<_> = by_author.matches.iter().map(|m| m.index).collect();
    assert_eq!(indices, vec![0, 1, 2]);

    let both = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: "lanes".into(),
            author: Some(author_name),
            branch: None,
        },
    )
    .unwrap();
    assert_eq!(both.matches.len(), 2);

    let stranger = core::history_search(
        repo.path(),
        core::HistorySearchQuery {
            search: String::new(),
            author: Some("nobody-else".into()),
            branch: None,
        },
    )
    .unwrap();
    assert!(stranger.matches.is_empty());
}

#[test]
fn ref_fingerprint_tracks_refs_but_not_file_edits() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    commit_all(&repo, "first");
    let base = core::ref_fingerprint(repo.path()).unwrap();

    repo.write("a.txt", "two\n");
    assert_eq!(core::ref_fingerprint(repo.path()).unwrap(), base);

    commit_all(&repo, "second");
    let after_commit = core::ref_fingerprint(repo.path()).unwrap();
    assert_ne!(after_commit, base);

    core::branch_create(repo.path(), "feature", None, false).unwrap();
    assert_ne!(core::ref_fingerprint(repo.path()).unwrap(), after_commit);
}

#[test]
fn commit_files_reports_per_file_counts_without_hunks() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "keep\n");
    commit_all(&repo, "add files");
    repo.write("a.txt", "one\nplus\n");
    repo.write("c.txt", "new\n");
    let oid = commit_all(&repo, "change a add c");

    let files = core::commit_files(repo.path(), &oid).unwrap();
    assert_eq!(files.len(), 2);
    let a = files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(a.status, "modified");
    assert_eq!(a.additions, 1);
    assert_eq!(a.deletions, 0);
    let c = files.iter().find(|f| f.path == "c.txt").unwrap();
    assert_eq!(c.status, "new");
    assert_eq!(c.additions, 1);
}

#[test]
fn commit_file_diff_scopes_hunks_to_one_file() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "keep\n");
    commit_all(&repo, "add files");
    repo.write("a.txt", "one\nplus\n");
    repo.write("b.txt", "keep\nmore\n");
    let oid = commit_all(&repo, "change both");

    let diff = core::commit_file_diff(repo.path(), &oid, "a.txt", None, 3).unwrap();
    assert_eq!(diff.path, "a.txt");
    assert_eq!(diff.hunks.len(), 1);
    assert_eq!(diff.additions, 1);

    let untouched = core::commit_file_diff(repo.path(), &oid, "z.txt", None, 3).unwrap();
    assert!(untouched.hunks.is_empty());
}

struct CleanupDir(PathBuf);

impl Drop for CleanupDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn worktree_target(repo: &TempRepo, suffix: &str) -> (PathBuf, CleanupDir) {
    let name = repo.dir.file_name().unwrap().to_string_lossy().to_string();
    let dir = std::env::temp_dir().join(format!("{name}-{suffix}"));
    let _ = std::fs::remove_dir_all(&dir);
    (dir.clone(), CleanupDir(dir))
}

fn canonical(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap()
}

fn add_worktree(repo: &TempRepo, dir: &std::path::Path, branch: &str, create: bool) -> String {
    core::worktree_add(
        repo.path(),
        &core::WorktreeAddRequest {
            directory: dir.to_string_lossy().to_string(),
            branch: branch.to_string(),
            create_branch: create,
            base: None,
        },
    )
    .unwrap()
}

#[test]
fn worktree_add_lists_and_checks_out_the_branch() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "feature");

    let created = add_worktree(&repo, &dir, "feature", false);
    assert_eq!(canonical(&created), canonical(dir.to_str().unwrap()));
    assert!(dir.join("a.txt").exists());

    let list = core::worktree_list(repo.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0].is_main);
    assert!(list[0].is_current);
    assert_eq!(list[0].branch.as_deref(), Some("master"));
    let linked = &list[1];
    assert!(!linked.is_main);
    assert!(!linked.is_current);
    assert_eq!(linked.branch.as_deref(), Some("feature"));
    assert_eq!(linked.is_dirty, Some(false));
    assert!(!linked.is_missing);

    let info = core::repo_info(&created).unwrap();
    assert!(info.is_worktree);
    assert_eq!(info.head_branch.as_deref(), Some("feature"));
    assert_eq!(
        canonical(info.main_path.as_deref().unwrap()),
        canonical(repo.path())
    );

    let from_linked = core::worktree_list(&created).unwrap();
    assert_eq!(from_linked.len(), 2);
    assert!(from_linked[0].is_main && !from_linked[0].is_current);
    assert!(from_linked[1].is_current);
}

#[test]
fn worktree_add_can_create_a_branch_from_a_base_commit() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let first = commit_all(&repo, "first");
    repo.write("a.txt", "two\n");
    commit_all(&repo, "second");
    let (dir, _cleanup) = worktree_target(&repo, "hotfix");

    let created = core::worktree_add(
        repo.path(),
        &core::WorktreeAddRequest {
            directory: dir.to_string_lossy().to_string(),
            branch: "hotfix/one".to_string(),
            create_branch: true,
            base: Some(first.clone()),
        },
    )
    .unwrap();
    let info = core::repo_info(&created).unwrap();
    assert_eq!(info.head_branch.as_deref(), Some("hotfix/one"));
    assert_eq!(info.head_oid.as_deref(), Some(first.as_str()));
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one\n");

    let duplicate = core::worktree_add(
        repo.path(),
        &core::WorktreeAddRequest {
            directory: dir.to_string_lossy().to_string(),
            branch: "hotfix/one".to_string(),
            create_branch: true,
            base: None,
        },
    );
    assert!(duplicate.is_err());
}

#[test]
fn worktree_add_refuses_a_branch_checked_out_elsewhere() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    let (dir, _cleanup) = worktree_target(&repo, "dup");

    let err = core::worktree_add(
        repo.path(),
        &core::WorktreeAddRequest {
            directory: dir.to_string_lossy().to_string(),
            branch: "master".to_string(),
            create_branch: false,
            base: None,
        },
    )
    .expect_err("adding a worktree for the checked-out branch must fail");
    assert!(err.to_string().contains("already checked out"), "{err}");
    assert!(!dir.exists());
}

#[test]
fn checkout_refuses_a_branch_held_by_another_worktree() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "held");
    add_worktree(&repo, &dir, "feature", false);

    let err = core::checkout_branch(repo.path(), "feature")
        .expect_err("checkout must refuse a branch checked out in a worktree");
    assert!(err.to_string().contains("worktree"), "{err}");
    assert_eq!(
        core::repo_info(repo.path()).unwrap().head_branch.as_deref(),
        Some("master")
    );

    core::branch_create(repo.path(), "free", None, false).unwrap();
    core::checkout_branch(repo.path(), "free").unwrap();
}

#[test]
fn worktree_remove_refuses_dirty_trees_unless_forced() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "dirty");
    add_worktree(&repo, &dir, "feature", false);
    let name = core::worktree_list(repo.path()).unwrap()[1].name.clone();

    std::fs::write(dir.join("wip.txt"), "unsaved\n").unwrap();
    assert_eq!(
        core::worktree_list(repo.path()).unwrap()[1].is_dirty,
        Some(true)
    );
    let err = core::worktree_remove(repo.path(), &name, false)
        .expect_err("dirty worktree must not be removed");
    assert!(err.to_string().contains("uncommitted"), "{err}");
    assert!(dir.exists());

    core::worktree_remove(repo.path(), &name, true).unwrap();
    assert!(!dir.exists());
    assert_eq!(core::worktree_list(repo.path()).unwrap().len(), 1);
    assert!(
        core::repo_info(repo.path()).unwrap().head_branch.is_some(),
        "main repo stays intact"
    );
}

#[test]
fn worktree_prune_drops_folders_deleted_outside_the_app() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "gone");
    add_worktree(&repo, &dir, "feature", false);

    std::fs::remove_dir_all(&dir).unwrap();
    let list = core::worktree_list(repo.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[1].is_missing);
    assert_eq!(list[1].branch.as_deref(), Some("feature"));

    let pruned = core::worktree_prune(repo.path()).unwrap();
    assert_eq!(pruned, vec![list[1].name.clone()]);
    assert_eq!(core::worktree_list(repo.path()).unwrap().len(), 1);
    assert!(core::worktree_prune(repo.path()).unwrap().is_empty());
}

#[test]
fn ref_fingerprint_changes_when_a_worktree_is_added() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let before = core::ref_fingerprint(repo.path()).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "fp");
    add_worktree(&repo, &dir, "feature", false);
    let after = core::ref_fingerprint(repo.path()).unwrap();
    assert_ne!(before, after);
}

#[test]
fn git_cli_recognizes_worktrees_created_by_the_engine() {
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "cli");
    let created = add_worktree(&repo, &dir, "feature", false);

    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo.path())
        .output()
        .unwrap();
    let listing = String::from_utf8_lossy(&output.stdout);
    let canonical_created = canonical(&created);
    let listed = listing
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .any(|p| std::fs::canonicalize(p).ok().as_deref() == Some(canonical_created.as_path()));
    assert!(
        listed,
        "git worktree list did not report the new worktree:\n{listing}"
    );
    assert!(listing.contains("branch refs/heads/feature"), "{listing}");

    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&created)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(String::from_utf8_lossy(&status.stdout).trim().is_empty());
}

fn bare_origin(local: &TempRepo) -> PathBuf {
    let dir = local.dir.with_file_name(format!(
        "{}-origin.git",
        local.dir.file_name().unwrap().to_string_lossy()
    ));
    let status = Command::new("git")
        .args(["init", "--bare", "-q", dir.to_str().unwrap()])
        .status()
        .expect("git CLI available");
    assert!(status.success());
    let status = Command::new("git")
        .args(["remote", "add", "origin", dir.to_str().unwrap()])
        .current_dir(&local.dir)
        .status()
        .unwrap();
    assert!(status.success());
    dir
}

#[test]
fn push_reports_up_to_date_instead_of_pushing_again() {
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first_tip = commit_all(&local, "one");
    let origin = bare_origin(&local);

    let first = core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(first.status, "ok");
    let remote_tip = |name: &str| {
        let out = Command::new("git")
            .args(["rev-parse", name])
            .current_dir(&origin)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    assert_eq!(remote_tip("master"), first_tip);

    let again = core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(again.status, "up_to_date", "{}", again.message);
    assert!(
        again.message.contains("already up to date"),
        "{}",
        again.message
    );

    let cli = Command::new("git")
        .args(["push", "origin", "master"])
        .current_dir(&local.dir)
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&cli.stderr).contains("Everything up-to-date"),
        "{}",
        String::from_utf8_lossy(&cli.stderr)
    );

    local.write("a.txt", "two\n");
    let second_tip = commit_all(&local, "two");
    let moved = core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(moved.status, "ok");
    assert_eq!(remote_tip("master"), second_tip);

    let _ = std::fs::remove_dir_all(&origin);
}

#[test]
fn push_with_tags_sends_named_tag_refs() {
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    commit_all(&local, "one");
    let origin = bare_origin(&local);

    core::tag_create(local.path(), "v1.0.0", None, None).unwrap();
    let outcome = core::push(local.path(), "origin", None, false, true, true, false).unwrap();
    assert_eq!(outcome.status, "ok");

    let listed = Command::new("git")
        .args(["tag", "-l", "v1.0.0"])
        .current_dir(&origin)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&listed.stdout).trim(), "v1.0.0");

    let _ = std::fs::remove_dir_all(&origin);
}

fn clone_of(origin: &std::path::Path, local: &TempRepo, suffix: &str) -> TempRepo {
    let dir = local.dir.with_file_name(format!(
        "{}-{suffix}",
        local.dir.file_name().unwrap().to_string_lossy()
    ));
    let status = Command::new("git")
        .args([
            "-c",
            "core.autocrlf=false",
            "clone",
            "-q",
            "-b",
            "master",
            origin.to_str().unwrap(),
            dir.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(status.success());
    let clone = TempRepo { dir };
    core::set_config(Some(clone.path()), "commit.gpgsign", "false", false).unwrap();
    core::set_config(Some(clone.path()), "user.name", "Other User", false).unwrap();
    core::set_config(
        Some(clone.path()),
        "user.email",
        "other@angkorgit.dev",
        false,
    )
    .unwrap();
    core::set_config(Some(clone.path()), "core.autocrlf", "false", false).unwrap();
    clone
}

fn head_summary_and_parents(repo: &TempRepo) -> (String, usize) {
    let out = Command::new("git")
        .args(["log", "-1", "--format=%s%x00%P"])
        .current_dir(&repo.dir)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (summary, parents) = text.split_once('\0').unwrap();
    (summary.to_string(), parents.split_whitespace().count())
}

#[test]
fn pull_from_a_remote_other_than_the_upstream_merges_its_same_name_branch() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();

    let mirror = local.dir.with_file_name(format!(
        "{}-mirror.git",
        local.dir.file_name().unwrap().to_string_lossy()
    ));
    git2::Repository::init_bare(&mirror).unwrap();
    core::remote_add(local.path(), "mirror", mirror.to_str().unwrap()).unwrap();
    core::push(local.path(), "mirror", None, false, false, false, false).unwrap();
    let other = clone_of(&mirror, &local, "other");
    other.write("b.txt", "only on the mirror\n");
    commit_all(&other, "mirror commit");
    core::push(other.path(), "origin", None, false, false, true, false).unwrap();

    let outcome = core::pull(local.path(), "mirror", Some("merge")).unwrap();
    assert_eq!(outcome.status, "fast_forward", "{}", outcome.message);
    assert_eq!(local.read("b.txt"), "only on the mirror\n");
    let repo = git2::Repository::open(local.path()).unwrap();
    let branch = repo.find_branch("master", git2::BranchType::Local).unwrap();
    assert_eq!(
        branch.upstream().unwrap().name().unwrap(),
        Some("origin/master")
    );
    drop(branch);
    drop(repo);

    let empty = local.dir.with_file_name(format!(
        "{}-empty.git",
        local.dir.file_name().unwrap().to_string_lossy()
    ));
    git2::Repository::init_bare(&empty).unwrap();
    core::remote_add(local.path(), "empty", empty.to_str().unwrap()).unwrap();
    let err = core::pull(local.path(), "empty", Some("merge"))
        .expect_err("pulling a branch the remote lacks fails");
    assert!(
        err.to_string().contains("empty has no branch master"),
        "{err}"
    );

    let _ = std::fs::remove_dir_all(&origin);
    let _ = std::fs::remove_dir_all(&mirror);
    let _ = std::fs::remove_dir_all(&empty);
}

#[test]
fn pull_rebases_when_asked_or_configured_and_merges_otherwise() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "other");

    local.write("a.txt", "two\n");
    commit_all(&local, "two");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    other.write("b.txt", "mine\n");
    commit_all(&other, "mine");
    let outcome = core::pull(other.path(), "origin", Some("rebase")).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
    assert_eq!(head_summary_and_parents(&other), ("mine".to_string(), 1));
    assert_eq!(other.read("a.txt"), "two\n");

    local.write("a.txt", "three\n");
    commit_all(&local, "three");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    other.write("c.txt", "again\n");
    commit_all(&other, "again");
    core::set_config(Some(other.path()), "pull.rebase", "true", false).unwrap();
    let outcome = core::pull(other.path(), "origin", None).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
    assert_eq!(head_summary_and_parents(&other), ("again".to_string(), 1));

    local.write("a.txt", "four\n");
    commit_all(&local, "four");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    other.write("d.txt", "merge me\n");
    commit_all(&other, "merge me");
    let outcome = core::pull(other.path(), "origin", Some("merge")).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
    assert_eq!(head_summary_and_parents(&other).1, 2);

    let _ = std::fs::remove_dir_all(&origin);
}

#[test]
fn blame_of_an_uncommitted_edit_inside_a_committed_block_keeps_the_author() {
    let repo = TempRepo::new();
    repo.write("a.txt", "l1\nl2\nl3\nl4\nl5\nl6\n");
    let base = commit_all(&repo, "base");
    repo.write("a.txt", "l1\nl2\nCHANGED\nl4\nl5\nl6\n");

    let blame = core::blame_file(repo.path(), "a.txt", None).unwrap();
    let shape: Vec<(usize, usize, bool)> = blame
        .hunks
        .iter()
        .map(|h| (h.start_line, h.line_count, h.committed))
        .collect();
    assert_eq!(shape, vec![(1, 2, true), (3, 1, false), (4, 3, true)]);
    for hunk in blame.hunks.iter().filter(|h| h.committed) {
        assert_eq!(hunk.oid, base);
        assert_eq!(hunk.author_name, "Test User");
        assert_eq!(hunk.author_email, "test@angkorgit.dev");
        assert_eq!(hunk.summary, "base");
        assert!(hunk.time > 0);
    }
    assert_eq!(blame.hunks[1].author_name, "Not committed yet");

    repo.write("a.txt", "l1\nSTAGED\nl3\nl4\nl5\nl6\n");
    core::stage_file(repo.path(), "a.txt").unwrap();
    repo.write("a.txt", "l1\nSTAGED\nl3\nl4\nUNSTAGED\nl6\nnew\n");
    let mixed = core::blame_file(repo.path(), "a.txt", None).unwrap();
    assert_eq!(mixed.hunks.iter().map(|h| h.line_count).sum::<usize>(), 7);
    assert_eq!(
        mixed.hunks.iter().filter(|h| !h.committed).count(),
        3,
        "staged, unstaged and appended lines are all uncommitted"
    );
    assert!(mixed
        .hunks
        .iter()
        .filter(|h| h.committed)
        .all(|h| h.author_name == "Test User" && h.oid == base));
}

#[test]
fn stage_and_unstage_a_later_hunk_in_a_multi_hunk_file() {
    let repo = TempRepo::new();
    let base: String = (1..=40).map(|i| format!("line {i}\n")).collect();
    repo.write("a.txt", &base);
    commit_all(&repo, "base");
    let mut lines: Vec<String> = (1..=40).map(|i| format!("line {i}")).collect();
    lines.insert(2, "inserted near top".to_string());
    lines[30] = "line 31 changed".to_string();
    repo.write("a.txt", &(lines.join("\n") + "\n"));
    assert_eq!(
        core::file_diff(repo.path(), "a.txt", false, 3)
            .unwrap()
            .hunks
            .len(),
        2
    );

    core::stage_hunk(repo.path(), "a.txt", 1).unwrap();
    let staged = index_content(&repo, "a.txt");
    assert!(staged.contains("line 31 changed"));
    assert!(!staged.contains("inserted near top"));
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged.as_deref(), Some("modified"));
    assert_eq!(status.files[0].unstaged.as_deref(), Some("modified"));

    core::stage_hunk(repo.path(), "a.txt", 0).unwrap();
    assert!(index_content(&repo, "a.txt").contains("inserted near top"));
    assert_eq!(core::status(repo.path()).unwrap().files[0].unstaged, None);

    core::unstage_hunk(repo.path(), "a.txt", 1).unwrap();
    let after = index_content(&repo, "a.txt");
    assert!(after.contains("inserted near top"));
    assert!(!after.contains("line 31 changed"));
    assert_eq!(repo.read("a.txt"), lines.join("\n") + "\n");
}

fn index_content(repo: &TempRepo, file: &str) -> String {
    let out = Command::new("git")
        .args(["show", &format!(":{file}")])
        .current_dir(&repo.dir)
        .output()
        .unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn blame_explains_files_without_history_instead_of_failing_on_the_tree() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.write("gone.txt", "bye\n");
    let first = commit_all(&repo, "first");
    std::fs::remove_file(repo.dir.join("gone.txt")).unwrap();
    let second = commit_all(&repo, "delete gone");
    repo.write("new.txt", "fresh\n");

    let untracked = core::blame_file(repo.path(), "new.txt", None).unwrap_err();
    assert!(untracked.to_string().contains("no committed history yet"));
    core::stage_file(repo.path(), "new.txt").unwrap();
    let staged = core::blame_file(repo.path(), "new.txt", None).unwrap_err();
    assert!(staged.to_string().contains("no committed history yet"));

    let deleted = core::blame_file(repo.path(), "gone.txt", Some(&second)).unwrap_err();
    assert!(deleted.to_string().contains("does not exist in commit"));
    let alive = core::blame_file(repo.path(), "gone.txt", Some(&first)).unwrap();
    assert_eq!(alive.lines, vec!["bye"]);
}

#[test]
fn blame_attributes_lines_to_their_commits_and_uncommitted_edits() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\ntwo\n");
    let first = commit_all(&repo, "first");
    core::set_config(Some(repo.path()), "user.name", "Second Dev", false).unwrap();
    repo.write("a.txt", "one\nTWO\n");
    let second = commit_all(&repo, "second");

    let blame = core::blame_file(repo.path(), "a.txt", None).unwrap();
    assert_eq!(blame.lines, vec!["one", "TWO"]);
    assert_eq!(blame.hunks.len(), 2);
    assert_eq!(blame.hunks[0].oid, first);
    assert_eq!(
        (blame.hunks[0].start_line, blame.hunks[0].line_count),
        (1, 1)
    );
    assert_eq!(blame.hunks[1].oid, second);
    assert_eq!(blame.hunks[1].author_name, "Second Dev");
    assert_eq!(blame.hunks[1].summary, "second");
    assert!(blame.hunks.iter().all(|hunk| hunk.committed));
    assert_eq!(blame.rev, None);

    repo.write("a.txt", "one\nTWO\nthree\n");
    let dirty = core::blame_file(repo.path(), "a.txt", None).unwrap();
    assert_eq!(dirty.lines.len(), 3);
    let last = dirty.hunks.last().unwrap();
    assert!(!last.committed);
    assert_eq!((last.start_line, last.line_count), (3, 1));
    assert_eq!(last.summary, "Uncommitted changes");

    let old = core::blame_file(repo.path(), "a.txt", Some(&first)).unwrap();
    assert_eq!(old.lines, vec!["one", "two"]);
    assert_eq!(old.hunks.len(), 1);
    assert_eq!(old.hunks[0].oid, first);
    assert_eq!(old.rev.as_deref(), Some(first.as_str()));

    let before = core::blame_file(repo.path(), "a.txt", Some(&format!("{second}^"))).unwrap();
    assert_eq!(before.rev.as_deref(), Some(first.as_str()));
}

fn history_oid_of(repo: &TempRepo, summary: &str) -> String {
    core::history(
        repo.path(),
        core::HistoryQuery {
            skip: 0,
            limit: 20,
            search: None,
            author: None,
            branch: None,
        },
    )
    .unwrap()
    .commits
    .into_iter()
    .find(|c| c.summary == summary)
    .map(|c| c.oid)
    .expect("commit with that summary")
}

fn header_line<'a>(header: &'a str, key: &str) -> &'a str {
    header
        .lines()
        .find(|line| line.starts_with(key))
        .expect("header line")
}

#[test]
fn reword_head_changes_only_the_message_even_with_a_dirty_tree() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    commit_all(&repo, "feat: first");
    repo.write("a.txt", "two\n");
    let before = commit_all(&repo, "feat: typo in mesage");
    repo.write("a.txt", "three\n");
    repo.write("b.txt", "staged\n");
    core::stage_file(repo.path(), "b.txt").unwrap();
    let old_header = commit_header(&repo, &before);

    let after = core::reword(
        repo.path(),
        &before,
        "feat: typo in message\n\nExplains why.",
    )
    .unwrap();

    assert_ne!(after, before);
    assert_eq!(
        history_summaries(&repo),
        vec!["feat: typo in message", "feat: first"]
    );
    let new_header = commit_header(&repo, "HEAD");
    assert!(new_header.contains("Explains why."));
    assert_eq!(
        header_line(&new_header, "tree "),
        header_line(&old_header, "tree ")
    );
    assert_eq!(
        header_line(&new_header, "author "),
        header_line(&old_header, "author ")
    );
    assert_eq!(repo.read("a.txt"), "three\n");
    assert_eq!(core::status(repo.path()).unwrap().files.len(), 2);
}

#[test]
fn reword_an_earlier_commit_rewrites_the_commits_above_it() {
    let repo = TempRepo::new();
    repo.write("base.txt", "base\n");
    commit_all(&repo, "base");
    repo.write("f1.txt", "1\n");
    commit_all(&repo, "one");
    repo.write("f2.txt", "2\n");
    let two = commit_all(&repo, "two");
    repo.write("f3.txt", "3\n");
    commit_all(&repo, "three");

    let reworded = core::reword(repo.path(), &two, "two, reworded").unwrap();

    assert_eq!(
        history_summaries(&repo),
        vec!["three", "two, reworded", "one", "base"]
    );
    assert_eq!(reworded, history_oid_of(&repo, "two, reworded"));
    assert_ne!(reworded, two);
    assert_eq!(repo.read("f2.txt"), "2\n");
    assert_eq!(repo.read("f3.txt"), "3\n");

    repo.write("f3.txt", "dirty\n");
    let one = history_oid_of(&repo, "one");
    let err = core::reword(repo.path(), &one, "one, again").unwrap_err();
    assert!(err.to_string().contains("uncommitted changes"));
    assert_eq!(history_oid_of(&repo, "one"), one);
}

#[test]
fn unpushed_lists_only_commits_missing_from_every_remote_ref() {
    let repo = TempRepo::new();
    repo.write("a.txt", "1\n");
    let one = commit_all(&repo, "one");
    repo.write("a.txt", "2\n");
    let two = commit_all(&repo, "two");
    assert_eq!(
        core::unpushed(repo.path()).unwrap(),
        vec![two.clone(), one.clone()]
    );

    let track = |oid: &str| {
        let status = Command::new("git")
            .args(["update-ref", "refs/remotes/origin/master", oid])
            .current_dir(&repo.dir)
            .status()
            .expect("git CLI available");
        assert!(status.success());
    };
    track(&one);
    assert_eq!(core::unpushed(repo.path()).unwrap(), vec![two.clone()]);
    track(&two);
    assert!(core::unpushed(repo.path()).unwrap().is_empty());
}

#[test]
fn tree_files_lists_every_path_at_a_commit_including_unchanged_ones() {
    let repo = TempRepo::new();
    repo.write("README.md", "hi\n");
    repo.write("src/lib.rs", "fn a() {}\n");
    repo.write("src/nested/deep.rs", "fn b() {}\n");
    commit_all(&repo, "base");
    repo.write("src/lib.rs", "fn a() {}\nfn c() {}\n");
    repo.write("docs/guide.md", "guide\n");
    let oid = commit_all(&repo, "touch two");

    let mut files = core::tree_files(repo.path(), &oid).unwrap();
    files.sort();
    assert_eq!(
        files,
        vec![
            "README.md",
            "docs/guide.md",
            "src/lib.rs",
            "src/nested/deep.rs"
        ]
    );
    let changed = core::commit_files(repo.path(), &oid).unwrap();
    assert_eq!(changed.len(), 2);
}

#[test]
fn index_files_lists_tracked_paths_but_not_untracked_ones() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    repo.write("dir/b.txt", "b\n");
    commit_all(&repo, "base");
    repo.write("untracked.txt", "u\n");
    repo.write("dir/staged-new.txt", "s\n");
    core::stage_file(repo.path(), "dir/staged-new.txt").unwrap();

    let mut files = core::index_files(repo.path()).unwrap();
    files.sort();
    assert_eq!(files, vec!["a.txt", "dir/b.txt", "dir/staged-new.txt"]);
}

#[test]
fn file_contents_reads_a_file_at_a_commit_and_in_the_working_copy_as_context_lines() {
    let repo = TempRepo::new();
    repo.write("notes.txt", "one\ntwo\nthree\n");
    let oid = commit_all(&repo, "notes");
    repo.write("notes.txt", "one\ntwo\nthree\nfour");

    let at_commit = core::file_contents(repo.path(), "notes.txt", Some(&oid)).unwrap();
    assert_eq!(at_commit.status, "unchanged");
    assert_eq!(at_commit.additions, 0);
    assert_eq!(at_commit.hunks.len(), 1);
    let lines: Vec<&str> = at_commit.hunks[0]
        .lines
        .iter()
        .map(|l| l.content.as_str())
        .collect();
    assert_eq!(lines, vec!["one", "two", "three"]);
    assert!(at_commit.hunks[0].lines.iter().all(|l| l.kind == "context"));
    assert_eq!(at_commit.hunks[0].lines[2].new_line_no, Some(3));

    let on_disk = core::file_contents(repo.path(), "notes.txt", None).unwrap();
    let lines: Vec<&str> = on_disk.hunks[0]
        .lines
        .iter()
        .map(|l| l.content.as_str())
        .collect();
    assert_eq!(lines, vec!["one", "two", "three", "four"]);

    let missing = core::file_contents(repo.path(), "nope.txt", Some(&oid))
        .err()
        .expect("a path missing from the commit must error");
    assert!(missing.to_string().contains("not part of commit"));

    repo.write("blob.bin", "ab\0cd");
    let binary = core::file_contents(repo.path(), "blob.bin", None).unwrap();
    assert!(binary.is_binary);
    assert!(binary.hunks.is_empty());
}

#[test]
fn scan_finds_every_repository_and_skips_noise() {
    let root = std::env::temp_dir().join(format!(
        "angkorgit-scan-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let make = |rel: &str| {
        let dir = root.join(rel);
        std::fs::create_dir_all(&dir).unwrap();
        core::init(dir.to_str().unwrap()).unwrap();
    };
    make("alpha");
    make("alpha/inner");
    make("group/beta");
    make("node_modules/pkg");
    make(".cache/hidden");
    make("a/b/c/d/e/f/deep");
    make(&format!("{}/too-deep", "x/".repeat(core::SCAN_MAX_DEPTH)));
    std::fs::create_dir_all(root.join("plain/folder")).unwrap();
    std::fs::create_dir_all(root.join("fake/.git")).unwrap();

    let scan = core::scan_repositories(root.to_str().unwrap(), core::SCAN_MAX_DEPTH).unwrap();
    let names: Vec<&str> = scan.repositories.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["deep", "alpha", "inner", "beta"]);
    assert!(!scan.truncated);
    assert!(scan.repositories.iter().all(|r| !r.is_worktree));
    let alpha = &scan.repositories[1];
    assert_eq!(
        std::fs::canonicalize(&alpha.path).unwrap(),
        std::fs::canonicalize(root.join("alpha")).unwrap()
    );
    assert_eq!(alpha.path, core::discover(&alpha.path).unwrap());

    let shallow = core::scan_repositories(root.to_str().unwrap(), 1).unwrap();
    assert_eq!(shallow.repositories.len(), 1);

    let itself = core::scan_repositories(root.join("alpha").to_str().unwrap(), 4).unwrap();
    let names: Vec<&str> = itself
        .repositories
        .iter()
        .map(|r| r.name.as_str())
        .collect();
    assert_eq!(names, ["alpha", "inner"]);

    assert!(core::scan_repositories(root.join("missing").to_str().unwrap(), 4).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn group_pull_fast_forwards_configured_upstream_without_merging() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "group");
    let repo = git2::Repository::open(other.path()).unwrap();
    repo.find_branch("master", git2::BranchType::Local)
        .unwrap()
        .rename("topic", false)
        .unwrap();
    core::set_config(Some(other.path()), "pull.rebase", "true", false).unwrap();
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let result = core::group_update(other.path(), true).unwrap();
    assert_eq!(result.status, "ok");
    assert_eq!(result.changes[0].name, "topic");
    assert_eq!(result.changes[0].old_oid.as_deref(), Some(old.as_str()));
    assert_eq!(result.changes[0].new_oid.as_deref(), Some(new.as_str()));
    assert_eq!(result.changes[0].commits, Some(1));
    assert_eq!(other.read("a.txt"), "updated\n");
    assert_eq!(head_summary_and_parents(&other).1, 1);
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "up_to_date"
    );
    other.write("mine.txt", "mine\n");
    let mine = commit_all(&other, "mine");
    local.write("a.txt", "remote again\n");
    commit_all(&local, "remote again");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let result = core::group_update(other.path(), true).unwrap();
    assert_eq!(result.status, "skipped");
    assert!(result.message.contains("diverged"));
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), mine);
    assert_eq!(repo.state(), git2::RepositoryState::Clean);
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_pull_skips_conflicting_changes_detached_missing_upstream_and_unfinished_repos() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "group-skip");
    local.write("a.txt", "remote\n");
    commit_all(&local, "remote");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    for staged in [false, true] {
        other.write("a.txt", "dirty\n");
        if staged {
            core::stage_all(other.path()).unwrap();
        }
        let result = core::group_update(other.path(), true).unwrap();
        assert_eq!(result.status, "skipped");
        assert!(result.message.contains("Local changes prevent checkout"));
        assert_eq!(other.read("a.txt"), "dirty\n");
    }
    let repo = git2::Repository::open(other.path()).unwrap();
    repo.reset(
        &repo
            .find_object(git2::Oid::from_str(&old).unwrap(), None)
            .unwrap(),
        git2::ResetType::Hard,
        None,
    )
    .unwrap();
    local.write("incoming.txt", "remote file\n");
    commit_all(&local, "add incoming file");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    other.write("incoming.txt", "untracked file\n");
    let result = core::group_update(other.path(), true).unwrap();
    assert_eq!(result.status, "skipped");
    assert!(result.message.contains("Local changes prevent checkout"));
    assert_eq!(other.read("incoming.txt"), "untracked file\n");
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), old);
    std::fs::remove_file(other.dir.join("incoming.txt")).unwrap();
    std::fs::write(repo.path().join("MERGE_HEAD"), &old).unwrap();
    assert!(core::group_update(other.path(), true)
        .unwrap()
        .message
        .contains("unfinished"));
    std::fs::remove_file(repo.path().join("MERGE_HEAD")).unwrap();
    repo.set_head_detached(git2::Oid::from_str(&old).unwrap())
        .unwrap();
    assert!(core::group_update(other.path(), true)
        .unwrap()
        .message
        .contains("detached"));
    repo.set_head("refs/heads/master").unwrap();
    repo.find_branch("master", git2::BranchType::Local)
        .unwrap()
        .set_upstream(None)
        .unwrap();
    assert!(core::group_update(other.path(), true)
        .unwrap()
        .message
        .contains("no upstream"));
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), old);
    assert_eq!(
        core::group_update(other.dir.join("missing").to_str().unwrap(), true)
            .unwrap()
            .status,
        "skipped"
    );
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_fetch_reports_moved_refs_and_continues_after_remote_failure() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "group-fetch");
    core::remote_add(
        other.path(),
        "broken",
        other.dir.join("missing.git").to_str().unwrap(),
    )
    .unwrap();
    local.write("a.txt", "new\n");
    let new = commit_all(&local, "new");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let result = core::group_update(other.path(), false).unwrap();
    assert_eq!(result.status, "partial");
    assert!(result.message.contains("broken"));
    let moved = result
        .changes
        .iter()
        .find(|r| r.name == "refs/remotes/origin/master")
        .unwrap();
    assert_eq!(moved.old_oid.as_deref(), Some(old.as_str()));
    assert_eq!(moved.new_oid.as_deref(), Some(new.as_str()));
    assert_eq!(other.read("a.txt"), "base\n");
    assert_eq!(
        git2::Repository::open(other.path())
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        old
    );
    let unchanged_partial = core::group_update(other.path(), false).unwrap();
    assert_eq!(unchanged_partial.status, "partial");
    assert!(unchanged_partial.changes.is_empty());
    let empty = TempRepo::new();
    assert_eq!(
        core::group_update(empty.path(), false).unwrap().status,
        "skipped"
    );
    assert!(core::group_update(empty.path(), true)
        .unwrap()
        .message
        .contains("no commits"));
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_pull_restores_missing_tracking_refs_and_reports_deleted_upstreams() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "missing-upstream");
    let repo = git2::Repository::open(other.path()).unwrap();
    repo.find_reference("refs/remotes/origin/master")
        .unwrap()
        .delete()
        .unwrap();
    assert!(repo
        .find_branch("master", git2::BranchType::Local)
        .unwrap()
        .upstream()
        .is_err());
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "up_to_date"
    );
    git2::Repository::open_bare(&origin)
        .unwrap()
        .find_reference("refs/heads/master")
        .unwrap()
        .delete()
        .unwrap();
    let result = core::group_update(other.path(), true).unwrap();
    assert_eq!(result.status, "skipped");
    assert!(
        result
            .message
            .contains("Configured upstream refs/remotes/origin/master is missing"),
        "{}",
        result.message
    );
    assert!(!result.message.contains("no upstream"));
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), old);
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_pull_matches_toolbar_pull_with_submodule_metadata_and_lfs_attributes() {
    for (file, content) in [
        (
            ".gitmodules",
            "[submodule \"sub\"]\npath = sub\nurl = ../sub.git\n",
        ),
        (".gitattributes", "*.txt filter=lfs diff=lfs -text\n"),
    ] {
        let local = TempRepo::new();
        local.write("a.txt", "base\n");
        commit_all(&local, "base");
        let origin = bare_origin(&local);
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        let other = clone_of(&origin, &local, "group-compatible");
        let toolbar = clone_of(&origin, &local, "toolbar-compatible");
        local.write(file, content);
        local.write(
            "a.txt",
            "version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 1\n",
        );
        let new = commit_all(&local, "special checkout");
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        assert_eq!(core::group_update(other.path(), true).unwrap().status, "ok");
        core::pull(toolbar.path(), "origin", Some("merge")).unwrap();
        assert_eq!(other.read("a.txt"), toolbar.read("a.txt"));
        assert_eq!(other.read(file), toolbar.read(file));
        assert_eq!(
            git2::Repository::open(other.path())
                .unwrap()
                .head()
                .unwrap()
                .target()
                .unwrap()
                .to_string(),
            new
        );
        std::fs::remove_dir_all(origin).unwrap();
    }
}

#[test]
fn group_pull_matches_toolbar_pull_with_active_hooks() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "group-hooks");
    let toolbar = clone_of(&origin, &local, "toolbar-hooks");
    let repo = git2::Repository::open(other.path()).unwrap();
    let hooks = repo.path().join("custom-hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    for path in [other.path(), toolbar.path()] {
        core::set_config(Some(path), "core.hooksPath", hooks.to_str().unwrap(), false).unwrap();
    }
    for name in ["post-checkout", "post-merge"] {
        let hook = hooks.join(name);
        std::fs::write(&hook, "#!/bin/sh\nprintf invoked > hook-ran\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(core::group_update(other.path(), true).unwrap().status, "ok");
    core::pull(toolbar.path(), "origin", Some("merge")).unwrap();
    assert_eq!(other.read("a.txt"), toolbar.read("a.txt"));
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), new);
    assert!(!other.dir.join("hook-ran").exists());
    assert!(!toolbar.dir.join("hook-ran").exists());
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_cancel_prevents_all_future_updates() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let control = core::GroupUpdateControl::default();
    control.ensure_active().unwrap();
    control.cancel().unwrap();
    assert!(control.ensure_active().is_err());
    assert!(control
        .with_active::<()>(|| panic!("cancelled action must not run"))
        .is_err());
    let result = core::group_update_controlled(local.path(), true, &control).unwrap();
    assert_eq!(result.status, "cancelled");
    assert_eq!(
        git2::Repository::open(local.path())
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        old
    );
}

#[test]
fn group_cancel_acknowledges_a_stalled_remote_without_waiting_for_the_socket() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    core::remote_add(
        local.path(),
        "origin",
        &format!("http://{}/repo.git", listener.local_addr().unwrap()),
    )
    .unwrap();
    let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        drop(listener);
        accepted_tx.send(()).unwrap();
        release_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        drop(socket);
    });
    let control = std::sync::Arc::new(core::GroupUpdateControl::default());
    let worker_control = control.clone();
    let path = local.path().to_string();
    let worker =
        std::thread::spawn(move || core::group_update_controlled(&path, false, &worker_control));
    accepted_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let start = std::time::Instant::now();
    control.cancel().unwrap();
    assert!(start.elapsed() < std::time::Duration::from_secs(1));
    assert!(!worker.is_finished());
    release_tx.send(()).unwrap();
    server.join().unwrap();
    assert_eq!(worker.join().unwrap().unwrap().status, "cancelled");
    let repo = git2::Repository::open(local.path()).unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), old);
    assert!(repo.find_reference("refs/remotes/origin/master").is_err());
}

#[test]
fn group_run_registry_keeps_cancellation_on_in_flight_handles_after_finish() {
    let local = TempRepo::new();
    let id = local.path();
    core::group_update_start(id).unwrap();
    assert!(core::group_update_start(id).is_err());
    let control = core::group_update_control(id).unwrap();
    assert!(!control.is_cancelled());
    core::group_update_cancel(id).unwrap();
    assert!(control.is_cancelled());
    core::group_update_finish(id).unwrap();
    assert!(core::group_update_control(id).is_err());
    assert!(control
        .with_active::<()>(|| panic!("finished handles cannot mutate"))
        .is_err());
    core::group_update_finish(id).unwrap();
}

#[test]
fn group_pull_preserves_unrelated_untracked_unstaged_and_staged_changes() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    local.write("notes.txt", "notes\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    for mode in ["untracked", "unstaged", "staged"] {
        let other = clone_of(&origin, &local, mode);
        other.write("scratch.txt", "untracked notes\n");
        if mode != "untracked" {
            other.write("notes.txt", "local notes\n");
        }
        if mode == "staged" {
            core::stage_file(other.path(), "notes.txt").unwrap();
        }
        local.write("a.txt", mode);
        let new = commit_all(&local, mode);
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        assert_eq!(core::group_update(other.path(), true).unwrap().status, "ok");
        assert_eq!(other.read("scratch.txt"), "untracked notes\n");
        assert_eq!(
            other.read("notes.txt"),
            if mode == "untracked" {
                "notes\n"
            } else {
                "local notes\n"
            }
        );
        assert_eq!(other.read("a.txt"), mode);
        let repo = git2::Repository::open(other.path()).unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), new);
        let status = repo.status_file(std::path::Path::new("notes.txt")).unwrap();
        assert_eq!(
            status.contains(git2::Status::INDEX_MODIFIED),
            mode == "staged"
        );
        assert_eq!(
            status.contains(git2::Status::WT_MODIFIED),
            mode == "unstaged"
        );
    }
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_pull_explains_when_checkout_succeeds_but_branch_update_fails() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "locked-ref");
    let repo = git2::Repository::open(other.path()).unwrap();
    std::fs::write(repo.path().join("refs/heads/master.lock"), "locked").unwrap();
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let error = core::group_update(other.path(), true)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("Checkout completed, but branch update failed"),
        "{error}"
    );
    assert!(error.contains(&old));
    assert!(error.contains(&new));
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), old);
    assert_eq!(other.read("a.txt"), "updated\n");
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_fetch_remote_prune_setting_overrides_global_setting() {
    for (global, remote, pruned) in [
        (true, Some(false), false),
        (false, Some(true), true),
        (true, None, true),
        (false, None, false),
    ] {
        let local = TempRepo::new();
        local.write("a.txt", "base\n");
        commit_all(&local, "base");
        let origin = bare_origin(&local);
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        let repo = git2::Repository::open(local.path()).unwrap();
        repo.branch(
            "obsolete",
            &repo.head().unwrap().peel_to_commit().unwrap(),
            false,
        )
        .unwrap();
        core::push(
            local.path(),
            "origin",
            Some("obsolete"),
            false,
            false,
            true,
            false,
        )
        .unwrap();
        let other = clone_of(&origin, &local, "prune");
        core::set_config(
            Some(other.path()),
            "fetch.prune",
            &global.to_string(),
            false,
        )
        .unwrap();
        if let Some(remote) = remote {
            core::set_config(
                Some(other.path()),
                "remote.origin.prune",
                &remote.to_string(),
                false,
            )
            .unwrap();
        }
        git2::Repository::open_bare(&origin)
            .unwrap()
            .find_reference("refs/heads/obsolete")
            .unwrap()
            .delete()
            .unwrap();
        let outcome = core::group_update(other.path(), false).unwrap();
        assert_eq!(outcome.status, "ok");
        let other_repo = git2::Repository::open(other.path()).unwrap();
        assert_eq!(
            other_repo
                .find_reference("refs/remotes/origin/obsolete")
                .is_err(),
            pruned
        );
        assert_eq!(
            outcome
                .changes
                .iter()
                .any(|change| change.name == "refs/remotes/origin/obsolete"
                    && change.new_oid.is_none()),
            pruned
        );
        std::fs::remove_dir_all(origin).unwrap();
    }
}

#[test]
fn group_cancel_reports_a_completed_checkout_before_acknowledging() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "cancel-checkout");
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let control = core::GroupUpdateControl::default();
    let outcome = core::group_update_controlled(other.path(), true, &control).unwrap();
    assert_eq!(outcome.status, "ok");
    let receipts = control.cancel_results().unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].path, other.path());
    assert_eq!(receipts[0].result.status, "ok");
    assert_eq!(
        receipts[0].result.changes[0].old_oid.as_deref(),
        Some(old.as_str())
    );
    assert_eq!(
        receipts[0].result.changes[0].new_oid.as_deref(),
        Some(new.as_str())
    );
    assert_eq!(other.read("a.txt"), "updated\n");
    assert!(control.is_cancelled());
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_pull_accepts_url_upstreams_without_leaving_temporary_refs() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "url-upstream");
    core::branch_create(other.path(), "work/topic", None, true).unwrap();
    core::set_config(
        Some(other.path()),
        "branch.work/topic.merge",
        "refs/heads/master",
        false,
    )
    .unwrap();
    let url = reqwest::Url::from_file_path(&origin).unwrap().to_string();
    core::set_config(Some(other.path()), "branch.work/topic.remote", &url, false).unwrap();
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let outcome = core::group_update(other.path(), true).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
    assert_eq!(other.read("a.txt"), "updated\n");
    let repo = git2::Repository::open(other.path()).unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), new);
    assert_eq!(
        repo.config()
            .unwrap()
            .get_string("branch.work/topic.remote")
            .unwrap(),
        url
    );
    assert!(repo
        .references_glob("refs/angkorgit/group-pull/*")
        .unwrap()
        .next()
        .is_none());
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "up_to_date"
    );
    core::set_config(
        Some(other.path()),
        "branch.work/topic.remote",
        origin.to_str().unwrap(),
        false,
    )
    .unwrap();
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "up_to_date"
    );
    git2::Repository::open_bare(&origin)
        .unwrap()
        .find_reference("refs/heads/master")
        .unwrap()
        .delete()
        .unwrap();
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "skipped"
    );
    assert!(repo
        .references_glob("refs/angkorgit/group-pull/*")
        .unwrap()
        .next()
        .is_none());
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_fetch_cancel_receipts_keep_successful_remotes_and_prior_errors() {
    for successful in [true, false] {
        let local = TempRepo::new();
        local.write("a.txt", "base\n");
        commit_all(&local, "base");
        let origin = bare_origin(&local);
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        let other = clone_of(&origin, &local, "cancel-partial");
        git2::Repository::open(other.path())
            .unwrap()
            .remote_delete("origin")
            .unwrap();
        if successful {
            core::remote_add(other.path(), "a-good", origin.to_str().unwrap()).unwrap();
        }
        core::remote_add(
            other.path(),
            "b-error",
            if successful {
                origin.to_str().unwrap()
            } else {
                "/nonexistent/angkorgit-remote.git"
            },
        )
        .unwrap();
        if successful {
            core::set_config(Some(other.path()), "remote.b-error.prune", "invalid", false).unwrap();
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        core::remote_add(
            other.path(),
            "c-stalled",
            &format!("http://{}/repo.git", listener.local_addr().unwrap()),
        )
        .unwrap();
        let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            drop(listener);
            accepted_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(30))
                .unwrap();
            drop(socket);
        });
        let control = std::sync::Arc::new(core::GroupUpdateControl::default());
        let worker_control = control.clone();
        let path = other.path().to_string();
        let worker = std::thread::spawn(move || {
            core::group_update_controlled(&path, false, &worker_control)
        });
        accepted_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let start = std::time::Instant::now();
        let receipts = control.cancel_results().unwrap();
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
        assert!(!worker.is_finished());
        assert_eq!(receipts.len(), 1);
        let result = &receipts[0].result;
        assert_eq!(result.status, if successful { "partial" } else { "failed" });
        assert!(result.message.contains("b-error"), "{}", result.message);
        assert!(result.message.contains("before cancellation"));
        assert_eq!(
            result
                .changes
                .iter()
                .any(|change| change.name == "refs/remotes/a-good/master"),
            successful
        );
        release_tx.send(()).unwrap();
        server.join().unwrap();
        let outcome = worker.join().unwrap().unwrap();
        assert_eq!(outcome.status, result.status);
        assert_eq!(outcome.message, result.message);
        std::fs::remove_dir_all(origin).unwrap();
    }
}

#[test]
fn group_pull_fetches_an_upstream_outside_the_remote_fetch_refspec() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    let old = commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "unmapped-upstream");
    let fetch = "+refs/heads/elsewhere:refs/remotes/origin/elsewhere";
    core::set_config(Some(other.path()), "remote.origin.fetch", fetch, false).unwrap();
    let repo = git2::Repository::open(other.path()).unwrap();
    assert_eq!(
        repo.branch_upstream_name("refs/heads/master")
            .err()
            .unwrap()
            .code(),
        git2::ErrorCode::NotFound
    );
    local.write("a.txt", "updated\n");
    let new = commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let outcome = core::group_update(other.path(), true).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), new);
    assert_eq!(other.read("a.txt"), "updated\n");
    assert_eq!(
        repo.config()
            .unwrap()
            .get_string("remote.origin.fetch")
            .unwrap(),
        fetch
    );
    assert_eq!(
        repo.find_reference("refs/remotes/origin/master")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        old
    );
    assert!(repo
        .references_glob("refs/angkorgit/group-pull/*")
        .unwrap()
        .next()
        .is_none());
    assert_eq!(
        core::group_update(other.path(), true).unwrap().status,
        "up_to_date"
    );
    git2::Repository::open_bare(&origin)
        .unwrap()
        .find_reference("refs/heads/master")
        .unwrap()
        .delete()
        .unwrap();
    let deleted = core::group_update(other.path(), true).unwrap();
    assert_eq!(deleted.status, "skipped");
    assert!(deleted.message.contains("missing on remote origin"));
    assert!(repo
        .references_glob("refs/angkorgit/group-pull/*")
        .unwrap()
        .next()
        .is_none());
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn group_cancel_preserves_other_receipts_when_a_fetch_repository_path_becomes_invalid() {
    let local = TempRepo::new();
    local.write("a.txt", "base\n");
    commit_all(&local, "base");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let other = clone_of(&origin, &local, "moved-fetch");
    local.write("a.txt", "updated\n");
    commit_all(&local, "updated");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    core::remote_add(
        other.path(),
        "z-stalled",
        &format!("http://{}/repo.git", listener.local_addr().unwrap()),
    )
    .unwrap();
    let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        drop(listener);
        accepted_tx.send(()).unwrap();
        let _ = release_rx.recv_timeout(std::time::Duration::from_secs(30));
        drop(socket);
    });
    let control = std::sync::Arc::new(core::GroupUpdateControl::default());
    let finished = TempRepo::new();
    assert_eq!(
        core::group_update_controlled(finished.path(), false, &control)
            .unwrap()
            .status,
        "skipped"
    );
    let alias = TempRepo::new();
    std::fs::remove_dir_all(alias.dir.join(".git")).unwrap();
    let gitdir = format!(
        "gitdir: {}\n",
        other
            .dir
            .join(".git")
            .display()
            .to_string()
            .replace('\\', "/")
    );
    alias.write(".git", &gitdir);
    let worker_control = control.clone();
    let path = alias.path().to_string();
    let worker_path = path.clone();
    let worker = std::thread::spawn(move || {
        core::group_update_controlled(&worker_path, false, &worker_control)
    });
    accepted_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    alias.write(".git", "gitdir: missing-repository\n");
    assert!(git2::Repository::open(alias.path()).is_err());
    let receipts = control.cancel_results().unwrap();
    assert!(control.is_cancelled());
    assert!(!worker.is_finished());
    assert_eq!(receipts.len(), 2);
    let unaffected = receipts
        .iter()
        .find(|receipt| receipt.path == finished.path())
        .unwrap();
    assert_eq!(unaffected.result.status, "skipped");
    let affected = receipts
        .iter()
        .find(|receipt| receipt.path == path)
        .unwrap();
    assert_eq!(affected.result.status, "partial");
    assert!(affected
        .result
        .message
        .contains("Fetched 1 of 2 remotes before cancellation"));
    assert!(affected
        .result
        .message
        .contains("Could not inspect moved refs"));
    alias.write(".git", &gitdir);
    release_tx.send(()).unwrap();
    server.join().unwrap();
    assert_eq!(worker.join().unwrap().unwrap().status, "partial");
    assert_eq!(other.read("a.txt"), "base\n");
    std::fs::remove_dir_all(origin).unwrap();
}

fn git_in(dir: &std::path::Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args([
            "-c",
            "protocol.file.allow=always",
            "-c",
            "core.autocrlf=false",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@angkorgit.dev",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct SubmoduleFixture {
    _library: TempRepo,
    _upstream: TempRepo,
    local: TempRepo,
    first: String,
    second: String,
    added: String,
}

impl SubmoduleFixture {
    fn new() -> Self {
        let library = TempRepo::new();
        library.write("lib.txt", "one\n");
        let first = commit_all(&library, "lib one");

        let upstream = TempRepo::new();
        upstream.write("README.md", "parent\n");
        commit_all(&upstream, "base");
        git_in(
            &upstream.dir,
            &[
                "submodule",
                "add",
                "-q",
                "--name",
                "library",
                library.path(),
                "deps/lib",
            ],
        );
        git_in(
            &upstream.dir.join("deps/lib"),
            &["config", "core.autocrlf", "false"],
        );
        git_in(&upstream.dir, &["commit", "-qm", "add lib"]);
        let added = git_in(&upstream.dir, &["rev-parse", "HEAD"]);

        let local = clone_of(&upstream.dir, &upstream, "local");
        git_in(&local.dir, &["submodule", "update", "--init", "-q"]);
        git_in(
            &local.dir.join("deps/lib"),
            &["config", "core.autocrlf", "false"],
        );

        library.write("lib.txt", "two\n");
        let second = commit_all(&library, "lib two");
        let upstream_lib = upstream.dir.join("deps/lib");
        git_in(&upstream_lib, &["fetch", "-q", "origin"]);
        git_in(&upstream_lib, &["checkout", "-q", &second]);
        git_in(&upstream.dir, &["add", "deps/lib"]);
        git_in(&upstream.dir, &["commit", "-qm", "bump lib"]);

        Self {
            _library: library,
            _upstream: upstream,
            local,
            first,
            second,
            added,
        }
    }

    fn local_sub(&self) -> PathBuf {
        self.local.dir.join("deps/lib")
    }

    fn checked_out(&self) -> String {
        git_in(&self.local_sub(), &["rev-parse", "HEAD"])
    }
}

#[test]
fn pull_moves_a_submodule_that_was_at_the_recorded_commit() {
    let fx = SubmoduleFixture::new();
    assert_eq!(fx.checked_out(), fx.first);

    let path = fx.local.path();
    core::submodule_synced(path, || core::pull(path, "origin", None)).unwrap();

    assert_eq!(fx.checked_out(), fx.second);
    assert_eq!(fx.local.read("deps/lib/lib.txt"), "two\n");
    assert!(core::status(path).unwrap().files.is_empty());
    assert_eq!(
        git_in(&fx.local.dir, &["status", "--porcelain"]),
        "",
        "git status agrees the submodule is at the recorded commit"
    );
}

#[test]
fn group_pull_moves_an_in_sync_submodule_like_the_toolbar_pull() {
    let fx = SubmoduleFixture::new();
    let result = core::group_update(fx.local.path(), true).unwrap();

    assert_eq!(result.status, "ok", "{}", result.message);
    assert_eq!(fx.checked_out(), fx.second);
    assert!(core::status(fx.local.path()).unwrap().files.is_empty());
}

#[test]
fn checkout_takes_an_in_sync_submodule_back_with_the_branch() {
    let fx = SubmoduleFixture::new();
    let path = fx.local.path();
    core::submodule_synced(path, || core::pull(path, "origin", None)).unwrap();
    core::branch_create(path, "before-bump", Some(&fx.added), false).unwrap();

    core::submodule_synced(path, || core::checkout_branch(path, "before-bump")).unwrap();

    assert_eq!(fx.checked_out(), fx.first);
    assert!(core::status(path).unwrap().files.is_empty());
}

#[test]
fn a_submodule_moved_on_purpose_stays_where_it_is() {
    let fx = SubmoduleFixture::new();
    git_in(
        &fx.local_sub(),
        &["commit", "-q", "--allow-empty", "-m", "local work"],
    );
    let work = fx.checked_out();

    let path = fx.local.path();
    core::submodule_synced(path, || core::pull(path, "origin", None)).unwrap();

    assert_eq!(fx.checked_out(), work);
}

#[test]
fn a_submodule_with_local_edits_stays_where_it_is() {
    let fx = SubmoduleFixture::new();
    fx.local.write("deps/lib/lib.txt", "edited\n");

    let path = fx.local.path();
    core::submodule_synced(path, || core::pull(path, "origin", None)).unwrap();

    assert_eq!(fx.checked_out(), fx.first);
    assert_eq!(fx.local.read("deps/lib/lib.txt"), "edited\n");
}

#[test]
fn status_reports_a_submodule_left_at_an_older_commit_and_discard_updates_it() {
    let fx = SubmoduleFixture::new();
    let path = fx.local.path();
    core::pull(path, "origin", None).unwrap();

    let status = core::status(path).unwrap();
    let entry = status.files.iter().find(|f| f.path == "deps/lib").unwrap();
    assert_eq!(entry.unstaged.as_deref(), Some("modified"));
    let commits = entry.submodule.as_ref().unwrap();
    assert_eq!(commits.recorded, fx.second);
    assert_eq!(commits.checked_out, fx.first);

    assert!(core::discard_file(path, "deps/lib").unwrap());
    assert_eq!(fx.checked_out(), fx.second);
    assert!(core::status(path).unwrap().files.is_empty());
}

#[test]
fn discard_all_and_update_bring_a_drifted_submodule_to_the_recorded_commit() {
    let fx = SubmoduleFixture::new();
    let path = fx.local.path();
    core::pull(path, "origin", None).unwrap();
    fx.local.write("README.md", "edited\n");

    let leftovers = core::discard_all(path).unwrap();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert_eq!(fx.checked_out(), fx.second);

    git_in(&fx.local_sub(), &["checkout", "-q", &fx.first]);
    let entry = core::status(path).unwrap().files.remove(0);
    assert_eq!(entry.submodule.unwrap().checked_out, fx.first);
    core::submodule_update(path, "deps/lib").unwrap();
    assert_eq!(fx.checked_out(), fx.second);
}

#[test]
fn a_submodule_with_only_edited_files_reports_no_commit_drift() {
    let fx = SubmoduleFixture::new();
    fx.local.write("deps/lib/lib.txt", "edited\n");

    let entry = core::status(fx.local.path()).unwrap().files.remove(0);
    assert_eq!(entry.path, "deps/lib");
    assert_eq!(entry.unstaged.as_deref(), Some("modified"));
    assert!(entry.submodule.is_none());
}

struct PullScene {
    local: TempRepo,
    other: TempRepo,
}

impl PullScene {
    fn new() -> Self {
        let local = TempRepo::new();
        local.write("a.txt", "one\ntwo\nthree\n");
        local.write("b.txt", "bee\n");
        commit_all(&local, "base");
        let origin = bare_origin(&local);
        core::push(local.path(), "origin", None, false, false, true, false).unwrap();
        let other = clone_of(&origin, &local, "other");
        Self { local, other }
    }

    fn upstream_commit(&self, file: &str, content: &str, message: &str) {
        self.local.write(file, content);
        commit_all(&self.local, message);
        core::push(self.local.path(), "origin", None, false, false, true, false).unwrap();
        core::fetch(self.other.path(), "origin", false, false).unwrap();
    }

    fn preview(&self) -> core::PullPreview {
        core::pull_preview(self.other.path(), "origin")
            .unwrap()
            .expect("a branch with an upstream has a preview")
    }

    fn untouched(&self) -> (String, Vec<String>) {
        let repo = git2::Repository::open(self.other.path()).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert!(!repo.path().join("rebase-merge").exists());
        assert!(!repo.path().join("MERGE_HEAD").exists());
        let head = repo.head().unwrap().target().unwrap().to_string();
        let files = core::status(self.other.path())
            .unwrap()
            .files
            .into_iter()
            .map(|f| f.path)
            .collect();
        (head, files)
    }
}

#[test]
fn pull_preview_is_empty_when_up_to_date_or_simply_behind() {
    let scene = PullScene::new();
    let preview = scene.preview();
    assert_eq!((preview.ahead, preview.behind), (0, 0));
    assert_eq!(preview.source, "origin/master");

    scene.upstream_commit("a.txt", "one\nTWO\nthree\n", "upstream edit");
    let preview = scene.preview();
    assert_eq!((preview.ahead, preview.behind), (0, 1));
    assert!(preview.conflicts.is_empty());
    assert!(preview.local_changes.is_empty());
}

#[test]
fn pull_preview_lists_uncommitted_files_the_pull_would_overwrite() {
    let scene = PullScene::new();
    scene.local.write("new.txt", "theirs\n");
    scene.upstream_commit("a.txt", "one\nTWO\nthree\n", "upstream edit");
    scene.other.write("a.txt", "one\ntwo\nmine\n");
    scene.other.write("new.txt", "mine too\n");
    scene.other.write("b.txt", "bee\n");
    scene.other.write("unrelated.txt", "left alone\n");

    let before = scene.untouched();
    let preview = scene.preview();
    assert_eq!(preview.local_changes, vec!["a.txt", "new.txt"]);
    assert!(preview.conflicts.is_empty());
    assert_eq!(scene.untouched(), before);

    assert!(core::pull(scene.other.path(), "origin", None).is_err());
}

#[test]
fn pull_preview_predicts_merge_conflicts_without_touching_the_repo() {
    let scene = PullScene::new();
    scene.upstream_commit("a.txt", "one\nTHEIRS\nthree\n", "upstream edit");
    scene.other.write("a.txt", "one\nOURS\nthree\n");
    scene.other.write("c.txt", "only here\n");
    commit_all(&scene.other, "local edit");
    scene.other.write("dirty.txt", "work in progress\n");

    let before = scene.untouched();
    let preview = scene.preview();
    assert_eq!((preview.ahead, preview.behind), (1, 1));
    assert!(!preview.rebase);
    assert_eq!(preview.conflicts, vec!["a.txt"]);
    assert!(preview.local_changes.is_empty());
    assert_eq!(scene.untouched(), before);

    std::fs::remove_file(scene.other.dir.join("dirty.txt")).unwrap();
    let outcome = core::pull(scene.other.path(), "origin", None).unwrap();
    assert_eq!(outcome.status, "conflicts", "{}", outcome.message);
    assert_eq!(
        core::conflict_list(scene.other.path()).unwrap(),
        vec!["a.txt"]
    );
}

#[test]
fn pull_preview_follows_pull_rebase_and_stops_at_the_first_conflicting_commit() {
    let scene = PullScene::new();
    scene.upstream_commit("a.txt", "one\nTHEIRS\nthree\n", "upstream edit");
    scene.other.write("b.txt", "bee two\n");
    commit_all(&scene.other, "clean local");
    scene.other.write("a.txt", "one\nOURS\nthree\n");
    commit_all(&scene.other, "conflicting local");
    core::set_config(Some(scene.other.path()), "pull.rebase", "true", false).unwrap();

    let before = scene.untouched();
    let preview = scene.preview();
    assert!(preview.rebase);
    assert_eq!((preview.ahead, preview.behind), (2, 1));
    assert_eq!(preview.conflicts, vec!["a.txt"]);
    assert_eq!(scene.untouched(), before);

    let outcome = core::pull(scene.other.path(), "origin", None).unwrap();
    assert_eq!(outcome.status, "conflicts", "{}", outcome.message);
}

#[test]
fn pull_preview_reports_no_conflict_for_edits_that_merge_cleanly() {
    let scene = PullScene::new();
    scene.upstream_commit("a.txt", "ONE\ntwo\nthree\n", "upstream edit");
    scene.other.write("a.txt", "one\ntwo\nTHREE\n");
    commit_all(&scene.other, "local edit");

    let preview = scene.preview();
    assert_eq!((preview.ahead, preview.behind), (1, 1));
    assert!(preview.conflicts.is_empty());

    core::set_config(Some(scene.other.path()), "pull.rebase", "true", false).unwrap();
    assert!(scene.preview().conflicts.is_empty());

    let outcome = core::pull(scene.other.path(), "origin", None).unwrap();
    assert_eq!(outcome.status, "ok", "{}", outcome.message);
}

#[test]
fn pull_preview_is_none_without_an_upstream_or_on_a_detached_head() {
    let scene = PullScene::new();
    core::branch_create(scene.other.path(), "solo", None, true).unwrap();
    assert!(core::pull_preview(scene.other.path(), "origin")
        .unwrap()
        .is_none());

    scene.other.write("solo.txt", "solo\n");
    let head = commit_all(&scene.other, "on solo");
    core::checkout_detached(scene.other.path(), &head).unwrap();
    assert!(core::pull_preview(scene.other.path(), "origin")
        .unwrap()
        .is_none());
}

#[test]
fn pull_preview_catches_a_rebase_conflict_that_a_merge_would_not_have() {
    let scene = PullScene::new();
    scene.upstream_commit("a.txt", "one\nTHEIRS\nthree\n", "upstream edit");
    scene.other.write("a.txt", "one\nTRIED\nthree\n");
    commit_all(&scene.other, "try something");
    scene.other.write("a.txt", "one\ntwo\nthree\n");
    commit_all(&scene.other, "put it back");

    assert!(scene.preview().conflicts.is_empty());

    core::set_config(Some(scene.other.path()), "pull.rebase", "true", false).unwrap();
    let before = scene.untouched();
    assert_eq!(scene.preview().conflicts, vec!["a.txt"]);
    assert_eq!(scene.untouched(), before);

    let outcome = core::pull(scene.other.path(), "origin", None).unwrap();
    assert_eq!(outcome.status, "conflicts", "{}", outcome.message);
}

fn write_hook(dir: &std::path::Path, name: &str, body: &str) {
    std::fs::create_dir_all(dir).unwrap();
    let hook = dir.join(name);
    std::fs::write(&hook, format!("#!/bin/sh\n{body}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn default_hooks(repo: &TempRepo) -> PathBuf {
    repo.dir.join(".git").join("hooks")
}

fn hooks_runnable() -> bool {
    if core::hook_runner_available() {
        return true;
    }
    eprintln!("skipping: git 2.36 or newer is not on PATH");
    false
}

fn head_message_at(path: &str) -> String {
    let repo = git2::Repository::open(path).unwrap();
    let commit = repo.head().unwrap().peel_to_commit().unwrap();
    commit.message().unwrap().to_string()
}

fn head_file(repo: &TempRepo, file: &str) -> String {
    let git = git2::Repository::open(repo.path()).unwrap();
    let tree = git.head().unwrap().peel_to_tree().unwrap();
    let blob = git
        .find_blob(tree.get_path(std::path::Path::new(file)).unwrap().id())
        .unwrap();
    String::from_utf8(blob.content().to_vec()).unwrap()
}

fn hook_failure(err: impl serde::Serialize) -> (String, String, String) {
    let payload = serde_json::to_value(&err).unwrap();
    (
        payload["code"].as_str().unwrap_or_default().to_string(),
        payload["message"].as_str().unwrap_or_default().to_string(),
        payload["detail"].as_str().unwrap_or_default().to_string(),
    )
}

#[test]
fn passing_pre_commit_hook_lets_the_commit_through() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    write_hook(
        &default_hooks(&repo),
        "pre-commit",
        "printf '%s' \"$GIT_INDEX_FILE\" > .git/pre-commit-index",
    );
    repo.write("a.txt", "one\n");
    core::stage_all(repo.path()).unwrap();

    let outcome = core::commit(repo.path(), "first", false).unwrap();
    assert_eq!(head_commit(&repo).0, outcome.oid);
    assert!(outcome.hook_warning.is_none());
    let seen = repo.read(".git/pre-commit-index");
    assert!(!seen.is_empty());
    #[cfg(unix)]
    {
        let index = git2::Repository::open(repo.path())
            .unwrap()
            .path()
            .join("index");
        assert_eq!(canonical(&seen), std::fs::canonicalize(index).unwrap());
    }
}

#[test]
fn failing_pre_commit_hook_blocks_the_commit_and_returns_its_output() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");
    write_hook(
        &default_hooks(&repo),
        "pre-commit",
        "echo 'lint: a.txt is not formatted'\necho 'second line' >&2\nexit 3",
    );
    repo.write("a.txt", "changed\n");
    core::stage_all(repo.path()).unwrap();

    let err = core::commit(repo.path(), "second", false).unwrap_err();
    let (code, message, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert_eq!(message, "The pre-commit hook failed (exit code 3).");
    assert!(detail.contains("lint: a.txt is not formatted"), "{detail}");
    assert!(detail.contains("second line"), "{detail}");
    assert_eq!(head_commit(&repo).0, base);
    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files[0].staged.as_deref(), Some("modified"));
}

#[test]
fn pre_commit_hook_that_restages_a_file_commits_the_new_content() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    write_hook(
        &default_hooks(&repo),
        "pre-commit",
        "printf 'formatted\\n' > a.txt\ngit add a.txt",
    );
    repo.write("a.txt", "raw\n");
    core::stage_all(repo.path()).unwrap();

    core::commit(repo.path(), "format on commit", false).unwrap();
    assert_eq!(head_file(&repo, "a.txt"), "formatted\n");
    assert!(core::status(repo.path()).unwrap().files.is_empty());
}

#[test]
fn commit_msg_hook_edits_the_message_that_gets_committed() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    write_hook(
        &default_hooks(&repo),
        "commit-msg",
        "printf '\\nSigned-off-by: Test User <test@angkorgit.dev>\\n' >> \"$1\"",
    );
    repo.write("a.txt", "one\n");
    core::stage_all(repo.path()).unwrap();

    core::commit(repo.path(), "feat: first\n\nBody line", false).unwrap();
    assert_eq!(
        head_message_at(repo.path()),
        "feat: first\n\nBody line\n\nSigned-off-by: Test User <test@angkorgit.dev>"
    );
    assert!(repo.dir.join(".git").join("COMMIT_EDITMSG").exists());
}

#[test]
fn commit_msg_hook_that_leaves_the_message_alone_keeps_it_byte_for_byte() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    write_hook(&default_hooks(&repo), "commit-msg", "exit 0");
    repo.write("a.txt", "one\n");
    core::stage_all(repo.path()).unwrap();

    core::commit(repo.path(), "keep  me  ", false).unwrap();
    assert_eq!(head_message_at(repo.path()), "keep  me  ");
}

#[test]
fn failing_commit_msg_hook_blocks_the_commit() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");
    write_hook(
        &default_hooks(&repo),
        "commit-msg",
        "echo 'subject must start with a type' >&2\nexit 1",
    );
    repo.write("a.txt", "changed\n");
    core::stage_all(repo.path()).unwrap();

    let err = core::commit(repo.path(), "no type here", false).unwrap_err();
    let (code, message, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert_eq!(message, "The commit-msg hook failed (exit code 1).");
    assert!(
        detail.contains("subject must start with a type"),
        "{detail}"
    );
    assert_eq!(head_commit(&repo).0, base);
}

#[test]
fn commit_msg_hook_that_empties_the_message_blocks_the_commit() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    let base = commit_all(&repo, "base");
    write_hook(&default_hooks(&repo), "commit-msg", ": > \"$1\"");
    repo.write("a.txt", "changed\n");
    core::stage_all(repo.path()).unwrap();

    let err = core::commit(repo.path(), "about to vanish", false).unwrap_err();
    assert!(err.to_string().contains("empty commit message"), "{err}");
    assert_eq!(head_commit(&repo).0, base);
}

#[test]
fn no_verify_skips_failing_commit_hooks() {
    let repo = TempRepo::new();
    write_hook(&default_hooks(&repo), "pre-commit", "exit 1");
    write_hook(&default_hooks(&repo), "commit-msg", "exit 1");
    repo.write("a.txt", "one\n");
    core::stage_all(repo.path()).unwrap();

    let outcome = core::commit(repo.path(), "skip the hooks", true).unwrap();
    assert!(outcome.hook_warning.is_none());
    assert_eq!(head_message_at(repo.path()), "skip the hooks");

    repo.write("a.txt", "two\n");
    core::stage_all(repo.path()).unwrap();
    core::amend(repo.path(), None, true).unwrap();
    assert_eq!(head_file(&repo, "a.txt"), "two\n");
}

#[test]
fn amend_runs_the_commit_hooks() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    let first = commit_all(&repo, "first");
    let hooks = default_hooks(&repo);
    write_hook(&hooks, "pre-commit", "echo 'tests failed'\nexit 1");
    repo.write("a.txt", "two\n");
    core::stage_all(repo.path()).unwrap();

    let err = core::amend(repo.path(), None, false).unwrap_err();
    let (code, message, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert_eq!(message, "The pre-commit hook failed (exit code 1).");
    assert!(detail.contains("tests failed"), "{detail}");
    assert_eq!(head_commit(&repo).0, first);

    write_hook(&hooks, "pre-commit", "exit 0");
    write_hook(
        &hooks,
        "commit-msg",
        "printf '\\nReviewed-by: Hook\\n' >> \"$1\"",
    );
    core::amend(repo.path(), None, false).unwrap();
    assert_eq!(head_message_at(repo.path()), "first\n\nReviewed-by: Hook");
    assert_eq!(head_file(&repo, "a.txt"), "two\n");

    write_hook(&hooks, "commit-msg", "printf 'fix: rewritten\\n' > \"$1\"");
    core::amend(repo.path(), Some("fix: typo"), false).unwrap();
    assert_eq!(head_message_at(repo.path()), "fix: rewritten");
    assert_eq!(head_commit(&repo).1, 0);
}

#[test]
fn commit_hooks_follow_core_hooks_path_and_ignore_samples_and_plain_files() {
    let repo = TempRepo::new();
    let default = default_hooks(&repo);
    write_hook(&default, "pre-commit.sample", "exit 1");
    #[cfg(unix)]
    std::fs::write(default.join("commit-msg"), "#!/bin/sh\nexit 1\n").unwrap();
    assert!(core::repo_hooks(repo.path()).unwrap().is_empty());
    repo.write("a.txt", "one\n");
    let base = commit_all(&repo, "base");

    core::set_config(Some(repo.path()), "core.hooksPath", ".githooks", false).unwrap();
    write_hook(&default, "pre-commit", "exit 0");
    write_hook(
        &repo.dir.join(".githooks"),
        "pre-commit",
        "echo 'from .githooks'\nexit 2",
    );
    assert_eq!(core::repo_hooks(repo.path()).unwrap(), vec!["pre-commit"]);
    if !hooks_runnable() {
        return;
    }
    repo.write("a.txt", "two\n");
    core::stage_file(repo.path(), "a.txt").unwrap();

    let err = core::commit(repo.path(), "second", false).unwrap_err();
    let (code, _, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert!(detail.contains("from .githooks"), "{detail}");
    assert_eq!(head_commit(&repo).0, base);
}

#[test]
fn commit_hooks_include_hooks_defined_in_config() {
    let repo = TempRepo::new();
    assert!(core::repo_hooks(repo.path()).unwrap().is_empty());
    core::set_config(Some(repo.path()), "hook.lint.event", "pre-commit", false).unwrap();
    assert_eq!(core::repo_hooks(repo.path()).unwrap(), vec!["pre-commit"]);
}

#[test]
fn commit_msg_hook_runs_in_a_linked_worktree() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "base\n");
    commit_all(&repo, "base");
    core::branch_create(repo.path(), "feature", None, false).unwrap();
    let (dir, _cleanup) = worktree_target(&repo, "hooks");
    let created = add_worktree(&repo, &dir, "feature", false);
    write_hook(
        &default_hooks(&repo),
        "commit-msg",
        "printf 'feat: from the worktree\\n' > \"$1\"",
    );
    std::fs::write(dir.join("b.txt"), "b\n").unwrap();
    core::stage_file(&created, "b.txt").unwrap();

    core::commit(&created, "wip", false).unwrap();
    assert_eq!(head_message_at(&created), "feat: from the worktree");
    let linked = git2::Repository::open(&created).unwrap();
    assert!(linked.path().join("COMMIT_EDITMSG").exists());
    assert!(!repo.dir.join(".git").join("COMMIT_EDITMSG").exists());
    assert_eq!(head_message_at(repo.path()), "base");
}

#[test]
fn commit_hooks_see_the_author_and_amend_keeps_the_original_one() {
    if !hooks_runnable() {
        return;
    }
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    commit_all(&repo, "first");
    let hooks = default_hooks(&repo);
    let record = |name: &str| {
        format!(
            "printf '%s|%s|%s' \"$GIT_AUTHOR_NAME\" \"$GIT_AUTHOR_EMAIL\" \"$GIT_AUTHOR_DATE\" > .git/{name}-author"
        )
    };
    write_hook(&hooks, "pre-commit", &record("pre-commit"));
    write_hook(&hooks, "commit-msg", &record("commit-msg"));
    let author_line = |path: &str| {
        let git = git2::Repository::open(path).unwrap();
        let author = git
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .author()
            .to_owned();
        let when = author.when();
        let offset = when.offset_minutes().abs();
        format!(
            "{}|{}|@{} {}{:02}{:02}",
            author.name().unwrap(),
            author.email().unwrap(),
            when.seconds(),
            when.sign(),
            offset / 60,
            offset % 60
        )
    };

    let original = author_line(repo.path());
    core::set_config(Some(repo.path()), "user.name", "Other Person", false).unwrap();
    core::set_config(
        Some(repo.path()),
        "user.email",
        "other@angkorgit.dev",
        false,
    )
    .unwrap();
    repo.write("a.txt", "two\n");
    core::stage_all(repo.path()).unwrap();
    core::amend(repo.path(), None, false).unwrap();
    assert!(original.starts_with("Test User|test@angkorgit.dev|@"));
    assert_eq!(author_line(repo.path()), original);
    assert_eq!(repo.read(".git/pre-commit-author"), original);
    assert_eq!(repo.read(".git/commit-msg-author"), original);

    repo.write("a.txt", "three\n");
    core::stage_all(repo.path()).unwrap();
    core::commit(repo.path(), "second", false).unwrap();
    let current = author_line(repo.path());
    assert!(current.starts_with("Other Person|other@angkorgit.dev|@"));
    assert_eq!(repo.read(".git/pre-commit-author"), current);
    assert_eq!(repo.read(".git/commit-msg-author"), current);
}

const ZERO_OID: &str = "0000000000000000000000000000000000000000";

fn recording_pre_push(repo: &TempRepo, tail: &str) {
    write_hook(
        &default_hooks(repo),
        "pre-push",
        &format!(
            "printf '%s\\n%s\\n' \"$1\" \"$2\" > .git/pre-push-args\ncat > .git/pre-push-stdin\n{tail}"
        ),
    );
}

fn pre_push_stdin(repo: &TempRepo) -> Vec<String> {
    let mut lines: Vec<String> = repo
        .read(".git/pre-push-stdin")
        .lines()
        .map(str::to_string)
        .collect();
    lines.sort();
    lines
}

fn ref_at(repo: &std::path::Path, name: &str) -> Option<String> {
    git2::Repository::open(repo)
        .unwrap()
        .find_reference(name)
        .ok()
        .and_then(|r| r.target())
        .map(|oid| oid.to_string())
}

fn object_id(repo: &TempRepo, rev: &str) -> String {
    git2::Repository::open(repo.path())
        .unwrap()
        .revparse_single(rev)
        .unwrap()
        .id()
        .to_string()
}

#[test]
fn passing_pre_push_hook_gets_the_remote_name_url_and_a_new_branch_line() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    recording_pre_push(&local, "exit 0");

    let outcome = core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(outcome.status, "ok");
    assert_eq!(ref_at(&origin, "refs/heads/master"), Some(first.clone()));
    assert_eq!(
        local.read(".git/pre-push-args"),
        format!("origin\n{}\n", origin.to_str().unwrap())
    );
    assert_eq!(
        pre_push_stdin(&local),
        vec![format!(
            "refs/heads/master {first} refs/heads/master {ZERO_OID}"
        )]
    );
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn failing_pre_push_hook_sends_nothing_and_returns_its_output() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    local.write("a.txt", "two\n");
    let second = commit_all(&local, "second");
    recording_pre_push(&local, "echo 'push blocked: tests failed'\nexit 1");

    let err = core::push(local.path(), "origin", None, false, false, true, false).unwrap_err();
    let (code, message, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert_eq!(message, "The pre-push hook failed (exit code 1).");
    assert!(detail.contains("push blocked: tests failed"), "{detail}");
    assert_eq!(ref_at(&origin, "refs/heads/master"), Some(first.clone()));
    let bare = git2::Repository::open(&origin).unwrap();
    assert!(bare
        .find_commit(git2::Oid::from_str(&second).unwrap())
        .is_err());
    assert_eq!(
        pre_push_stdin(&local),
        vec![format!(
            "refs/heads/master {second} refs/heads/master {first}"
        )]
    );
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_stdin_lists_every_ref_of_a_push_with_tags() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    local.write("a.txt", "two\n");
    let second = commit_all(&local, "second");
    core::tag_create(local.path(), "light", None, None).unwrap();
    core::tag_create(local.path(), "v1.0.0", None, Some("release 1.0.0")).unwrap();
    let annotated = object_id(&local, "refs/tags/v1.0.0");
    assert_ne!(annotated, second);
    recording_pre_push(&local, "exit 0");

    core::push(local.path(), "origin", None, false, true, true, false).unwrap();
    assert_eq!(
        pre_push_stdin(&local),
        vec![
            format!("refs/heads/master {second} refs/heads/master {first}"),
            format!("refs/tags/light {second} refs/tags/light {ZERO_OID}"),
            format!("refs/tags/v1.0.0 {annotated} refs/tags/v1.0.0 {ZERO_OID}"),
        ]
    );
    assert_eq!(ref_at(&origin, "refs/tags/v1.0.0"), Some(annotated));

    core::push(local.path(), "origin", None, false, true, true, false).unwrap();
    assert!(pre_push_stdin(&local).is_empty());
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_runs_for_a_tag_push() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    core::tag_create(local.path(), "v2", None, None).unwrap();
    recording_pre_push(&local, "exit 0");

    let outcome = core::push_tag(local.path(), "origin", "v2", false).unwrap();
    assert_eq!(outcome.message, "Pushed tag v2 to origin");
    assert_eq!(
        pre_push_stdin(&local),
        vec![format!("refs/tags/v2 {first} refs/tags/v2 {ZERO_OID}")]
    );
    assert_eq!(ref_at(&origin, "refs/tags/v2"), Some(first));
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_stdin_marks_a_deleted_remote_branch() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::branch_create(local.path(), "feature", None, false).unwrap();
    core::push(
        local.path(),
        "origin",
        Some("feature"),
        false,
        false,
        false,
        false,
    )
    .unwrap();
    assert_eq!(ref_at(&origin, "refs/heads/feature"), Some(first.clone()));
    recording_pre_push(&local, "exit 0");

    core::push_specs(
        local.path(),
        "origin",
        &[":refs/heads/feature".to_string()],
        false,
    )
    .unwrap();
    assert_eq!(
        pre_push_stdin(&local),
        vec![format!("(delete) {ZERO_OID} refs/heads/feature {first}")]
    );
    assert_eq!(ref_at(&origin, "refs/heads/feature"), None);
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_leaves_out_a_rejected_non_fast_forward_and_sees_the_remote_sha_on_force() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    local.write("a.txt", "two\n");
    let second = commit_all(&local, "second");
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    core::reset(local.path(), &first, "hard").unwrap();
    local.write("a.txt", "three\n");
    let rewritten = commit_all(&local, "rewritten");
    recording_pre_push(&local, "exit 0");

    assert!(core::push(local.path(), "origin", None, false, false, true, false).is_err());
    assert!(local.dir.join(".git").join("pre-push-args").exists());
    assert!(pre_push_stdin(&local).is_empty());
    assert_eq!(ref_at(&origin, "refs/heads/master"), Some(second.clone()));

    core::push(local.path(), "origin", None, true, false, true, false).unwrap();
    assert_eq!(
        pre_push_stdin(&local),
        vec![format!(
            "refs/heads/master {rewritten} refs/heads/master {second}"
        )]
    );
    assert_eq!(ref_at(&origin, "refs/heads/master"), Some(rewritten));
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_runs_with_empty_stdin_when_nothing_needs_pushing() {
    if !hooks_runnable() {
        return;
    }
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    recording_pre_push(&local, "exit 0");

    let outcome = core::push(local.path(), "origin", None, false, false, true, false).unwrap();
    assert_eq!(outcome.status, "up_to_date");
    assert!(local.dir.join(".git").join("pre-push-args").exists());
    assert!(pre_push_stdin(&local).is_empty());

    recording_pre_push(&local, "exit 1");
    let err = core::push(local.path(), "origin", None, false, false, true, false).unwrap_err();
    assert_eq!(hook_failure(err).0, "hook_failed");
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn no_verify_pushes_past_a_failing_pre_push_hook() {
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    let first = commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::tag_create(local.path(), "v1", None, None).unwrap();
    write_hook(&default_hooks(&local), "pre-push", "exit 1");

    let outcome = core::push(local.path(), "origin", None, false, false, true, true).unwrap();
    assert_eq!(outcome.status, "ok");
    assert_eq!(ref_at(&origin, "refs/heads/master"), Some(first.clone()));
    core::push_tag(local.path(), "origin", "v1", true).unwrap();
    assert_eq!(ref_at(&origin, "refs/tags/v1"), Some(first));
    std::fs::remove_dir_all(origin).unwrap();
}

#[test]
fn pre_push_follows_core_hooks_path() {
    let local = TempRepo::new();
    local.write("a.txt", "one\n");
    commit_all(&local, "first");
    let origin = bare_origin(&local);
    core::set_config(Some(local.path()), "core.hooksPath", ".githooks", false).unwrap();
    write_hook(&default_hooks(&local), "pre-push", "exit 0");
    write_hook(
        &local.dir.join(".githooks"),
        "pre-push",
        "echo 'from .githooks'\nexit 2",
    );
    assert_eq!(core::repo_hooks(local.path()).unwrap(), vec!["pre-push"]);
    if !hooks_runnable() {
        std::fs::remove_dir_all(origin).unwrap();
        return;
    }

    let err = core::push(local.path(), "origin", None, false, false, true, false).unwrap_err();
    let (code, _, detail) = hook_failure(err);
    assert_eq!(code, "hook_failed");
    assert!(detail.contains("from .githooks"), "{detail}");
    assert_eq!(ref_at(&origin, "refs/heads/master"), None);
    std::fs::remove_dir_all(origin).unwrap();
}
