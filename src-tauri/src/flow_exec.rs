//! One-shot shell commands for Flow 3D "terminal" steps and the agent's
//! `terminal_run`: run a command line, wait for it (with a timeout) and return
//! its output so the caller can pass it on. With a run id the output is also
//! streamed as `exec:data` events while it runs, and `exec_kill` stops it
//! together with everything it started. Interactive work goes through the PTY
//! terminal instead.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    stdout: String,
    stderr: String,
    code: Option<i32>,
    timed_out: bool,
    /// Stopped with `exec_kill`.
    killed: bool,
}

/// Output kept (and streamed) per stream; the rest is dropped (a step's data should stay small).
const MAX_OUTPUT: usize = 1024 * 1024;
/// How long to keep reading once the command exits: a process it left running
/// in the background may hold the output open for as long as it lives.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Receives the output while the command runs: (`"stdout"` | `"stderr"`, text).
pub type OutputSink = Arc<dyn Fn(&'static str, &str) + Send + Sync>;

/// Stop flags of the commands started with a run id.
#[derive(Default)]
pub struct ExecState {
    runs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ExecState {
    /// The run's stop flag. A stop that arrives before the run registers is kept for it.
    fn flag(&self, id: &str) -> Arc<AtomicBool> {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        runs.entry(id.to_string()).or_default().clone()
    }

    fn forget(&self, id: &str) {
        self.runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }
}

fn shell_command(command: &str) -> Command {
    #[cfg_attr(windows, allow(unused_mut))]
    let mut cmd = if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", command]);
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = Command::new(shell);
        cmd.args(["-c", command]);
        cmd
    };
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so stopping the command stops what it started too.
        cmd.process_group(0);
    }
    cmd
}

/// Stop the command and every process it started, then reap it.
fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    // SAFETY: plain syscall; the child leads its own process group (see `shell_command`)
    // and is not reaped yet, so the group id cannot have been reused.
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Text of `pending` that is ready to show; the bytes of a character cut at
/// the end of the chunk stay in `pending` for the next one.
fn take_text(pending: &mut Vec<u8>) -> String {
    let cut = match std::str::from_utf8(pending) {
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        _ => pending.len(),
    };
    let rest = pending.split_off(cut);
    let text = String::from_utf8_lossy(pending).into_owned();
    *pending = rest;
    text
}

/// Read a stream until it closes: keep up to MAX_OUTPUT and pass it to `sink` as it arrives.
fn read_stream(
    mut reader: impl Read + Send + 'static,
    stream: &'static str,
    sink: Option<OutputSink>,
    kept: Arc<Mutex<Vec<u8>>>,
    done: mpsc::Sender<()>,
) {
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        let mut pending = Vec::new();
        let mut total = 0usize;
        while let Ok(n) = reader.read(&mut chunk) {
            if n == 0 {
                break;
            }
            let take = n.min(MAX_OUTPUT.saturating_sub(total));
            total += n;
            if take == 0 {
                continue;
            }
            kept.lock()
                .unwrap_or_else(|e| e.into_inner())
                .extend_from_slice(&chunk[..take]);
            if let Some(sink) = &sink {
                pending.extend_from_slice(&chunk[..take]);
                let text = take_text(&mut pending);
                if !text.is_empty() {
                    sink(stream, &text);
                }
                if total >= MAX_OUTPUT {
                    sink(stream, "\n[salida recortada]\n");
                }
            }
        }
        if let Some(sink) = &sink {
            if !pending.is_empty() {
                sink(stream, &String::from_utf8_lossy(&pending));
            }
        }
        let _ = done.send(());
    });
}

pub fn run_command(
    command: &str,
    cwd: Option<&str>,
    timeout: Duration,
    sink: Option<OutputSink>,
    stop: Option<Arc<AtomicBool>>,
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
    let stdout = Arc::new(Mutex::new(Vec::new()));
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let (done, finished) = mpsc::channel();
    let out = child.stdout.take().ok_or("sin stdout")?;
    let err = child.stderr.take().ok_or("sin stderr")?;
    read_stream(out, "stdout", sink.clone(), stdout.clone(), done.clone());
    read_stream(err, "stderr", sink, stderr.clone(), done);
    let started = Instant::now();
    let mut timed_out = false;
    let mut killed = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        killed = stop.as_ref().is_some_and(|s| s.load(Ordering::SeqCst));
        timed_out = !killed && started.elapsed() >= timeout;
        if killed || timed_out {
            kill_tree(&mut child);
            break None;
        }
        thread::sleep(Duration::from_millis(15));
    };
    // Each reader reports once its stream closes; don't wait on a background process for ever.
    let deadline = Instant::now() + DRAIN_GRACE;
    for _ in 0..2 {
        let left = deadline.saturating_duration_since(Instant::now());
        if finished.recv_timeout(left).is_err() {
            break;
        }
    }
    let text = |kept: &Mutex<Vec<u8>>| {
        String::from_utf8_lossy(&kept.lock().unwrap_or_else(|e| e.into_inner())).into_owned()
    };
    Ok(CommandOutput {
        stdout: text(&stdout),
        stderr: text(&stderr),
        code: status.and_then(|s| s.code()),
        timed_out,
        killed,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExecChunk<'a> {
    run_id: &'a str,
    stream: &'a str,
    data: &'a str,
}

/// Run a command line. With `run_id`, its output arrives as `exec:data`
/// events while it runs and `exec_kill(run_id)` stops it.
#[tauri::command]
pub async fn flow_run_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExecState>,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    run_id: Option<String>,
) -> Result<CommandOutput, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(100, 600_000));
    let stop = run_id.as_deref().map(|id| state.flag(id));
    let sink = run_id.clone().map(|id| -> OutputSink {
        Arc::new(move |stream, data| {
            let _ = app.emit(
                "exec:data",
                ExecChunk {
                    run_id: &id,
                    stream,
                    data,
                },
            );
        })
    });
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_command(&command, cwd.as_deref(), timeout, sink, stop)
    })
    .await
    .map_err(|e| e.to_string());
    if let Some(id) = &run_id {
        state.forget(id);
    }
    result?
}

/// Stop a command started with `run_id`, and everything it started.
#[tauri::command]
pub fn exec_kill(state: tauri::State<'_, ExecState>, run_id: String) {
    state.flag(&run_id).store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(command: &str, timeout: Duration) -> CommandOutput {
        run_command(command, None, timeout, None, None).unwrap()
    }

    #[test]
    #[cfg(unix)]
    fn captures_output_and_exit_code() {
        let out = run("echo hola; echo mal >&2; exit 3", Duration::from_secs(5));
        assert_eq!(out.stdout.trim(), "hola");
        assert_eq!(out.stderr.trim(), "mal");
        assert_eq!(out.code, Some(3));
        assert!(!out.timed_out);
        assert!(!out.killed);
    }

    #[test]
    #[cfg(unix)]
    fn kills_on_timeout() {
        let out = run("sleep 5", Duration::from_millis(200));
        assert!(out.timed_out);
        assert!(!out.killed);
    }

    #[test]
    #[cfg(unix)]
    fn streams_output_while_running() {
        let seen = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        let sink: OutputSink = {
            let seen = seen.clone();
            Arc::new(move |stream, data| {
                seen.lock()
                    .unwrap()
                    .push((stream.to_string(), data.to_string()))
            })
        };
        let out = run_command(
            "echo uno; sleep 0.1; echo dos >&2",
            None,
            Duration::from_secs(5),
            Some(sink),
            None,
        )
        .unwrap();
        assert_eq!(out.code, Some(0));
        let seen = seen.lock().unwrap();
        assert!(seen.contains(&("stdout".into(), "uno\n".into())));
        assert!(seen.contains(&("stderr".into(), "dos\n".into())));
    }

    #[test]
    #[cfg(unix)]
    fn stop_kills_the_command_and_what_it_started() {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let stop = stop.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                stop.store(true, Ordering::SeqCst);
            });
        }
        let started = Instant::now();
        let out = run_command(
            "(sleep 10; echo tarde) & echo empezado; wait",
            None,
            Duration::from_secs(20),
            None,
            Some(stop),
        )
        .unwrap();
        assert!(out.killed);
        assert!(!out.timed_out);
        assert_eq!(out.stdout.trim(), "empezado");
        // A surviving `sleep` would keep the output open until DRAIN_GRACE.
        assert!(started.elapsed() < Duration::from_millis(1500));
    }

    #[test]
    #[cfg(unix)]
    fn does_not_wait_for_background_processes() {
        let started = Instant::now();
        let out = run("sleep 5 & echo listo", Duration::from_secs(20));
        assert_eq!(out.stdout.trim(), "listo");
        assert_eq!(out.code, Some(0));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn keeps_a_cut_character_for_the_next_chunk() {
        let bytes = "año".as_bytes();
        let mut pending = bytes[..2].to_vec(); // "a" + first byte of "ñ"
        assert_eq!(take_text(&mut pending), "a");
        pending.extend_from_slice(&bytes[2..]);
        assert_eq!(take_text(&mut pending), "ño");
        assert!(pending.is_empty());
    }
}
