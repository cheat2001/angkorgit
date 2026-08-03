//! Git integration tests: exercise the core engine against real temporary
//! repositories. Run with `cargo test` inside `apps/desktop/src-tauri`.

use std::path::PathBuf;
use std::process::Command;

use angkorgit_lib::test_api as core;

struct TempRepo {
    dir: PathBuf,
}

impl TempRepo {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "angkorgit-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap();
        core::init(path).unwrap();
        core::set_config(Some(path), "user.name", "Test User", false).unwrap();
        core::set_config(Some(path), "user.email", "test@angkorgit.dev", false).unwrap();
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
    let outcome = core::merge(repo.path(), "feature").unwrap();
    assert_eq!(outcome.status, "fast_forward");
    assert!(repo.dir.join("b.txt").exists());

    // diverge for a real merge commit
    core::branch_create(repo.path(), "topic", None, true).unwrap();
    repo.write("c.txt", "topic\n");
    commit_all(&repo, "topic work");
    core::checkout_branch(repo.path(), "master").unwrap();
    repo.write("d.txt", "master\n");
    commit_all(&repo, "master work");
    let outcome = core::merge(repo.path(), "topic").unwrap();
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

    let outcome = core::merge(repo.path(), "other").unwrap();
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

    // Whole-file mode: huge context pulls every line into the hunk.
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

/// Ensures the repo also works via the plain `git` CLI the user may mix in.
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
