use std::process::Stdio;
use tempfile::NamedTempFile;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, Command};

use std::io::Write as IoWrite;

const RUNNER_SRC: &str = include_str!("../../../runner/runner.ts");

pub struct Sandbox {
    child: Child,
    pub reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    pub writer: BufWriter<tokio::process::ChildStdin>,
    _runner_file: NamedTempFile,
}

impl Sandbox {
    pub fn spawn() -> Result<Self, String> {
        // Write runner.ts to a temp file
        let mut runner_file =
            NamedTempFile::with_suffix(".ts").map_err(|e| format!("tempfile: {e}"))?;
        runner_file
            .write_all(RUNNER_SRC.as_bytes())
            .map_err(|e| format!("write runner: {e}"))?;

        let runner_path = runner_file.path().to_str().unwrap().to_string();

        // deno is on PATH (provided by gun-with-tools wrapper)
        let mut child = Command::new("deno")
            .args(deno_args(&runner_path))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn deno: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;

        Ok(Self {
            child,
            reader: BufReader::new(stdout).lines(),
            writer: BufWriter::new(stdin),
            _runner_file: runner_file,
        })
    }

    pub async fn send(&mut self, line: &str) -> Result<(), String> {
        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("write: {e}"))?;
        self.writer
            .write_all(b"\n")
            .await
            .map_err(|e| format!("write newline: {e}"))?;
        self.writer.flush().await.map_err(|e| format!("flush: {e}"))?;
        Ok(())
    }

    pub async fn recv(&mut self) -> Result<Option<String>, String> {
        self.reader
            .next_line()
            .await
            .map_err(|e| format!("read: {e}"))
    }

    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Defense-in-depth Deno flags. The arg list is the sandbox's security
/// contract — sandnix provides OS-level isolation, these are the runtime
/// constraints layered on top.
fn deno_args(runner_path: &str) -> Vec<String> {
    vec![
        "run".into(),
        "--no-prompt".into(),
        "--deny-ffi".into(),
        "--deny-env".into(),
        "--allow-run".into(),
        format!("--allow-read={runner_path},/nix/store"),
        "--v8-flags=--max-old-space-size=256".into(),
        runner_path.into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runner_src_is_embedded() {
        assert!(!RUNNER_SRC.is_empty(), "runner.ts must be embedded");
    }

    #[test]
    fn runner_src_contains_protocol_markers() {
        // If these markers disappear, the runner's wire contract with gun has
        // drifted — regenerate the tests along with the runner.
        assert!(
            RUNNER_SRC.contains("tool/call"),
            "runner must speak tool/call method"
        );
        assert!(
            RUNNER_SRC.contains("execute/result"),
            "runner must speak execute/result method"
        );
    }

    #[test]
    fn runner_src_exposes_exec_global() {
        assert!(
            RUNNER_SRC.contains("exec"),
            "runner must expose exec() global"
        );
    }

    #[test]
    fn deno_args_deny_ffi() {
        let args = deno_args("/tmp/runner.ts");
        assert!(
            args.iter().any(|a| a == "--deny-ffi"),
            "sandbox must deny FFI: {args:?}"
        );
    }

    #[test]
    fn deno_args_deny_env() {
        let args = deno_args("/tmp/runner.ts");
        assert!(
            args.iter().any(|a| a == "--deny-env"),
            "sandbox must deny env access: {args:?}"
        );
    }

    #[test]
    fn deno_args_no_prompt() {
        let args = deno_args("/tmp/runner.ts");
        assert!(
            args.iter().any(|a| a == "--no-prompt"),
            "sandbox must disable interactive prompts: {args:?}"
        );
    }

    #[test]
    fn deno_args_allow_run_present() {
        // --allow-run is required for exec() to work. If this is removed,
        // the entire product breaks — fail loudly.
        let args = deno_args("/tmp/runner.ts");
        assert!(
            args.iter().any(|a| a == "--allow-run"),
            "sandbox must allow subprocess via exec(): {args:?}"
        );
    }

    #[test]
    fn deno_args_allow_read_restricted_to_runner_and_nix_store() {
        let args = deno_args("/tmp/my-runner.ts");
        let read_flag = args
            .iter()
            .find(|a| a.starts_with("--allow-read="))
            .expect("--allow-read must be present");
        assert_eq!(read_flag, "--allow-read=/tmp/my-runner.ts,/nix/store");
    }

    #[test]
    fn deno_args_never_allow_read_wildcard() {
        let args = deno_args("/tmp/runner.ts");
        // Hard fail if anyone ever passes bare --allow-read (no value = all paths).
        assert!(
            !args.iter().any(|a| a == "--allow-read"),
            "unrestricted --allow-read is a sandbox escape: {args:?}"
        );
        assert!(
            !args.iter().any(|a| a.starts_with("--allow-all")),
            "--allow-all is a sandbox escape: {args:?}"
        );
    }

    #[test]
    fn deno_args_never_allow_net() {
        let args = deno_args("/tmp/runner.ts");
        assert!(
            !args.iter().any(|a| a.starts_with("--allow-net")),
            "sandbox must not grant network: {args:?}"
        );
        assert!(
            !args.iter().any(|a| a.starts_with("--allow-write")),
            "sandbox must not grant write: {args:?}"
        );
    }

    #[test]
    fn deno_args_v8_memory_limit_enforced() {
        let args = deno_args("/tmp/runner.ts");
        let v8_flag = args
            .iter()
            .find(|a| a.starts_with("--v8-flags="))
            .expect("--v8-flags must be present");
        assert!(
            v8_flag.contains("max-old-space-size"),
            "memory limit must be set: {v8_flag}"
        );
    }

    #[test]
    fn deno_args_runner_path_is_last() {
        let args = deno_args("/tmp/my-runner.ts");
        assert_eq!(
            args.last().map(String::as_str),
            Some("/tmp/my-runner.ts"),
            "runner path must be last positional arg"
        );
    }
}
