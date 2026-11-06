use std::path::Path;

use angkorgit_lib::test_api as core;

fn shell_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn head_of(path: &Path) -> String {
    git2::Repository::open(path)
        .unwrap()
        .head()
        .unwrap()
        .target()
        .unwrap()
        .to_string()
}

#[test]
fn post_checkout_runs_after_clone_with_a_zero_previous_head() {
    let root = std::env::temp_dir().join(format!(
        "angkorgit-clone-hooks-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = root.join("home");
    let hooks = root.join("hooks");
    let log = root.join("post-checkout.log");
    std::fs::create_dir_all(&home).unwrap();
    let global = home.join(".gitconfig");
    std::fs::write(
        &global,
        format!(
            "[core]\n\thooksPath = {}\n\tautocrlf = false\n[user]\n\tname = Test User\n\temail = \
             test@angkorgit.dev\n[commit]\n\tgpgsign = false\n",
            shell_path(&hooks)
        ),
    )
    .unwrap();
    std::env::set_var("HOME", &home);
    std::env::set_var("GIT_CONFIG_GLOBAL", &global);
    std::env::set_var("XDG_CONFIG_HOME", home.join(".config"));
    if !core::hook_runner_available() {
        eprintln!("skipping: git 2.36 or newer is not on PATH");
        let _ = std::fs::remove_dir_all(&root);
        return;
    }
    std::fs::create_dir_all(&hooks).unwrap();
    let hook = hooks.join("post-checkout");
    std::fs::write(
        &hook,
        format!(
            "#!/bin/sh\necho \"post-checkout $*\" >> '{}'\n",
            shell_path(&log)
        ),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    let source = root.join("source");
    core::init(source.to_str().unwrap()).unwrap();
    std::fs::write(source.join("a.txt"), "one\n").unwrap();
    core::stage_all(source.to_str().unwrap()).unwrap();
    let head = core::commit(source.to_str().unwrap(), "one", false)
        .unwrap()
        .oid;

    let into = root.join("clone");
    let cloned = core::post_hooks::clone(
        source.to_str().unwrap(),
        into.to_str().unwrap(),
        None,
        |_| {},
        false,
    )
    .unwrap();
    assert!(cloned.warnings.is_empty());
    assert_eq!(head_of(&into), head);
    assert_eq!(
        std::fs::read_to_string(&log).unwrap(),
        format!("post-checkout {} {head} 1\n", "0".repeat(40))
    );

    std::fs::remove_file(&log).unwrap();
    core::post_hooks::clone(
        source.to_str().unwrap(),
        root.join("clone-without-hooks").to_str().unwrap(),
        None,
        |_| {},
        true,
    )
    .unwrap();
    assert!(!log.exists());

    let empty = root.join("empty");
    core::init(empty.to_str().unwrap()).unwrap();
    core::post_hooks::clone(
        empty.to_str().unwrap(),
        root.join("clone-of-empty").to_str().unwrap(),
        None,
        |_| {},
        false,
    )
    .unwrap();
    assert!(!log.exists());

    let _ = std::fs::remove_dir_all(&root);
}
