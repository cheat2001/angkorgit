use std::ffi::OsStr;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
pub fn hidden<S: AsRef<OsStr>>(program: S) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
pub fn hidden<S: AsRef<OsStr>>(program: S) -> Command {
    Command::new(program)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn rust_sources(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read src dir").flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_sources(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn every_spawn_goes_through_hidden() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_sources(&src, &mut files);
        let mut offenders = Vec::new();
        for file in files {
            if file.file_name().is_some_and(|name| name == "proc.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&file).expect("read source");
            for (index, line) in text.lines().enumerate() {
                if line.contains("Command::new(") {
                    offenders.push(format!("{}:{}", file.display(), index + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "spawn without proc::hidden (flashes a console window on Windows): {}",
            offenders.join(", ")
        );
    }
}
