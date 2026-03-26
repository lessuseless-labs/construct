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

        // Resolve deno — PATH first, then nix store
        let deno_bin = which_or_nix("deno")?;

        let runner_path = runner_file.path().to_str().unwrap().to_string();
        let mut child = Command::new(&deno_bin)
            .args([
                "run",
                "--no-prompt",
                // Permission lockdown — defense in depth
                "--deny-net",
                "--deny-env",
                "--deny-run",
                "--deny-write",
                "--deny-ffi",
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

fn which_or_nix(name: &str) -> Result<String, String> {
    // Check PATH
    if let Ok(path) = which::which(name) {
        return Ok(path.to_string_lossy().into_owned());
    }

    // Try nix path-info
    let output = std::process::Command::new("nix")
        .args(["path-info", &format!("nixpkgs#{name}")])
        .output()
        .map_err(|e| format!("nix path-info: {e}"))?;

    if output.status.success() {
        let store_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(format!("{store_path}/bin/{name}"))
    } else {
        Err(format!("{name} not found on PATH or in nix store"))
    }
}
