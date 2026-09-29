//! One-shot shell commands for Flow 3D "terminal" steps: run a command line,
//! wait for it (with a timeout) and return its output so the flow can pass it
//! to the next step. Interactive work goes through the PTY terminal instead.

use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    stdout: String,
    stderr: String,
    code: Option<i32>,
    timed_out: bool,
}

/// Output kept per stream; the rest is dropped (a step's data should stay small).
const MAX_OUTPUT: usize = 1024 * 1024;

fn shell_command(command: &str) -> Command {
    if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", command]);
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = Command::new(shell);
        cmd.args(["-c", command]);
        cmd
    }
}

fn read_limited(mut reader: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 8192];
        while let Ok(n) = reader.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if buffer.len() < MAX_OUTPUT {
                let take = n.min(MAX_OUTPUT - buffer.len());
                buffer.extend_from_slice(&chunk[..take]);
            }
        }
        String::from_utf8_lossy(&buffer).into_owned()
    })
}

pub fn run_command(
    command: &str,
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<CommandOutput, String> {
    let mut cmd = shell_command(command);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|d| !d.is_empty() && std::path::Path::new(d).is_dir()) {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar: {e}"))?;
    let stdout = read_limited(child.stdout.take().ok_or("sin stdout")?);
    let stderr = read_limited(child.stderr.take().ok_or("sin stderr")?);
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break None;
        }
        thread::sleep(Duration::from_millis(15));
    };
    Ok(CommandOutput {
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
        code: status.and_then(|s| s.code()),
        timed_out,
    })
}

#[tauri::command]
pub async fn flow_run_command(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CommandOutput, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(100, 600_000));
    tauri::async_runtime::spawn_blocking(move || run_command(&command, cwd.as_deref(), timeout))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn captures_output_and_exit_code() {
        let out = run_command(
            "echo hola; echo mal >&2; exit 3",
            None,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(out.stdout.trim(), "hola");
        assert_eq!(out.stderr.trim(), "mal");
        assert_eq!(out.code, Some(3));
        assert!(!out.timed_out);
    }

    #[test]
    #[cfg(unix)]
    fn kills_on_timeout() {
        let out = run_command("sleep 5", None, Duration::from_millis(200)).unwrap();
        assert!(out.timed_out);
    }
}
