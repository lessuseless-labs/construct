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
            .args([
                "run",
                "--no-prompt",
                // Defense-in-depth flags — sandnix provides OS-level isolation,
                // these are additional Deno-level constraints
                "--deny-ffi",
                "--deny-env",
                "--allow-run",
                &format!("--allow-read={runner_path},/nix/store"),
                // Memory limit
                "--v8-flags=--max-old-space-size=256",
                &runner_path,
            ])
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
