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
    core::commit(repo.path(), message).unwrap()
}

#[test]
fn stage_commit_and_history() {
    let repo = TempRepo::new();
    repo.write("a.txt", "hello\n");
    core::stage_file(repo.path(), "a.txt").unwrap();

    let status = core::status(repo.path()).unwrap();
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].staged.as_deref(), Some("new"));

    let oid = core::commit(repo.path(), "feat: initial commit").unwrap();
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
    core::amend(repo.path(), Some("first (amended)")).unwrap();
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
    core::commit(repo.path(), "merge other").unwrap();
    assert_eq!(repo.read("a.txt"), "resolved content\n");
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
    core::stash_create(repo.path(), Some("wip"), true).unwrap();
    assert_eq!(repo.read("a.txt"), "committed\n");
    assert_eq!(core::stash_list(repo.path()).unwrap().len(), 1);

    core::stash_pop(repo.path(), 0).unwrap();
    assert_eq!(repo.read("a.txt"), "dirty\n");
    assert_eq!(core::stash_list(repo.path()).unwrap().len(), 0);
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
    let outcome = core::cherry_pick(repo.path(), &picked_oid).unwrap();
    assert_eq!(outcome.status, "ok");
    assert!(repo.dir.join("picked.txt").exists());
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
    core::commit(repo.path(), "resolved by hand").unwrap();
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
    core::commit(repo.path(), &message).unwrap();
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
    core::amend(repo.path(), Some("feat: amended")).unwrap();

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
    let err = core::commit(repo.path(), "second").unwrap_err();
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
