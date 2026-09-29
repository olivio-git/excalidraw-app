//! Extension host process (runs VS Code extensions, see `extension-host/`).
//!
//! The host speaks newline-delimited JSON on stdin/stdout. This module only
//! transports lines: each stdout line is emitted as an `exthost:message`
//! event, `exthost_send` writes a line to stdin, stderr lines become
//! `exthost:log` events and process exit an `exthost:exit` event.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

struct Running {
    child: Child,
    stdin: ChildStdin,
    generation: u64,
}

#[derive(Default)]
pub struct ExtHostState {
    running: Arc<Mutex<Option<Running>>>,
    generation: Mutex<u64>,
}

impl Drop for ExtHostState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.running.lock() {
            if let Some(mut running) = guard.take() {
                let _ = running.child.kill();
                let _ = running.child.wait();
            }
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtHostInfo {
    pid: u32,
    runtime: String,
    already_running: bool,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    code: Option<i32>,
    generation: u64,
}

/// How to launch the host: a JS runtime plus the entry script.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Launch {
    program: PathBuf,
    args: Vec<String>,
    env: Vec<(String, String)>,
    label: String,
}

pub(crate) fn find_in_path(program: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{program}.exe"), format!("{program}.cmd"), program.to_string()]
    } else {
        vec![program.to_string()]
    };
    std::env::split_paths(&paths)
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
}

/// Picks the runtime: `QORI_NODE_PATH`, then `node` on PATH, then the bundled
/// gateway binary (a Bun executable) acting as a JS runtime (`BUN_BE_BUN=1`).
pub(crate) fn resolve_launch(script: &Path, gateway: Option<PathBuf>) -> Result<Launch, String> {
    let script_arg = script.to_string_lossy().to_string();
    if let Ok(custom) = std::env::var("QORI_NODE_PATH") {
        let path = PathBuf::from(&custom);
        if path.is_file() {
            return Ok(Launch {
                program: path,
                args: vec![script_arg],
                env: vec![],
                label: format!("node ({custom})"),
            });
        }
    }
    if let Some(node) = find_in_path("node") {
        return Ok(Launch {
            label: format!("node ({})", node.display()),
            program: node,
            args: vec![script_arg],
            env: vec![],
        });
    }
    if let Some(bun) = gateway.filter(|p| p.is_file()) {
        return Ok(Launch {
            label: "bun (runtime integrado)".into(),
            program: bun,
            args: vec![script_arg],
            env: vec![("BUN_BE_BUN".into(), "1".into())],
        });
    }
    Err("No se encontró Node.js. Instala Node.js (https://nodejs.org) para ejecutar extensiones con código.".into())
}

fn host_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Failed to resolve project root")?
            .to_path_buf();
        Ok(root.join("extension-host").join("src").join("main.cjs"))
    }
    #[cfg(not(debug_assertions))]
    {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        Ok(resources.join("extension-host").join("main.cjs"))
    }
}

fn gateway_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(crate::target_gateway_binary_name()));
        candidates.push(dir.join("qori-llm-gateway"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(crate::target_gateway_binary_name()));
            candidates.push(dir.join("qori-llm-gateway"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn spawn(launch: &Launch) -> Result<Child, String> {
    let mut command = Command::new(&launch.program);
    command
        .args(&launch.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &launch.env {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|e| format!("No se pudo iniciar el Extension Host con {}: {e}", launch.label))
}

#[tauri::command]
pub fn exthost_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExtHostState>,
) -> Result<ExtHostInfo, String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(running) = guard.as_mut() {
        if running.child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
            return Ok(ExtHostInfo {
                pid: running.child.id(),
                runtime: String::new(),
                already_running: true,
            });
        }
        guard.take();
    }

    let script = host_script(&app)?;
    if !script.is_file() {
        return Err(format!("No se encontró el Extension Host en {}", script.display()));
    }
    let launch = resolve_launch(&script, gateway_binary(&app))?;
    let mut child = spawn(&launch)?;
    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;
    let pid = child.id();

    let generation = {
        let mut g = state.generation.lock().map_err(|e| e.to_string())?;
        *g += 1;
        *g
    };

    let message_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let _ = message_app.emit("exthost:message", line);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    let log_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    let _ = log_app.emit("exthost:log", line);
                }
                Err(_) => break,
            }
        }
    });

    // Reap the process and report the exit, unless a newer host replaced it.
    let running = state.running.clone();
    let exit_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let mut guard = match running.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(current) = guard.as_mut() else { return };
        if current.generation != generation {
            return;
        }
        match current.child.try_wait() {
            Ok(Some(status)) => {
                guard.take();
                let _ = exit_app.emit("exthost:exit", ExitPayload { code: status.code(), generation });
                return;
            }
            Ok(None) => {}
            Err(_) => return,
        }
    });

    *guard = Some(Running {
        child,
        stdin,
        generation,
    });
    Ok(ExtHostInfo {
        pid,
        runtime: launch.label,
        already_running: false,
    })
}

#[tauri::command]
pub fn exthost_send(state: tauri::State<'_, ExtHostState>, message: String) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    let running = guard.as_mut().ok_or("El Extension Host no está en ejecución")?;
    let mut line = message.replace('\n', " ");
    line.push('\n');
    running
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| running.stdin.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn exthost_stop(state: tauri::State<'_, ExtHostState>) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(mut running) = guard.take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_node_on_path() {
        let script = PathBuf::from("/tmp/main.cjs");
        if find_in_path("node").is_some() {
            let launch = resolve_launch(&script, None).unwrap();
            assert!(launch.label.starts_with("node"));
            assert_eq!(launch.args, vec!["/tmp/main.cjs".to_string()]);
            assert!(launch.env.is_empty());
        }
    }

    #[test]
    fn host_script_exists_in_dev() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        assert!(root.join("extension-host/src/main.cjs").is_file());
    }

    #[test]
    fn spawned_host_answers_over_stdio() {
        let Some(_) = find_in_path("node") else { return };
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        let launch = resolve_launch(&root.join("extension-host/src/main.cjs"), None).unwrap();
        let mut child = spawn(&launch).unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let ready = lines.next().unwrap().unwrap();
        assert!(ready.contains("\"ready\""));
        writeln!(stdin, r#"{{"type":"req","id":1,"method":"getActivatedExtensions","params":{{}}}}"#).unwrap();
        let response = lines.next().unwrap().unwrap();
        assert!(response.contains(r#""id":1"#) && response.contains(r#""result":[]"#));
        drop(stdin);
        let status = child.wait().unwrap();
        assert!(status.success());
    }
}
