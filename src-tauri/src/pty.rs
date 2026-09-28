//! Integrated terminal backend: pseudo-terminals (PTY) driven from the webview.
//!
//! The frontend spawns a shell with `pty_spawn`, forwards keystrokes with
//! `pty_write` and resizes with `pty_resize`. Output is streamed back as
//! `pty:data` events and process termination as a `pty:exit` event, both
//! tagged with the session id so several terminals can run at once.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
}

impl Drop for PtyState {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.killer.kill();
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnOptions {
    /// Executable to run; the user's default shell when omitted.
    shell: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
}

#[derive(Serialize, Clone)]
struct PtyDataPayload {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExitPayload {
    id: u32,
    code: Option<u32>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    /// Human readable name, e.g. "PowerShell" or "bash".
    name: String,
    path: String,
    #[serde(default)]
    args: Vec<String>,
    is_default: bool,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Decode as much valid UTF-8 as possible, keeping an incomplete trailing
/// sequence in `carry` so multi-byte characters split across reads survive.
pub(crate) fn decode_utf8_chunk(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    let mut out = String::with_capacity(carry.len());
    let mut rest: &[u8] = carry;
    loop {
        match std::str::from_utf8(rest) {
            Ok(valid) => {
                out.push_str(valid);
                rest = &[];
                break;
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                // SAFETY: from_utf8 guarantees the prefix is valid UTF-8.
                out.push_str(unsafe { std::str::from_utf8_unchecked(&rest[..valid_up_to]) });
                match err.error_len() {
                    // Invalid bytes: replace them and keep going.
                    Some(len) => {
                        out.push('\u{FFFD}');
                        rest = &rest[valid_up_to + len..];
                    }
                    // Incomplete sequence at the end: wait for more bytes.
                    None => {
                        rest = &rest[valid_up_to..];
                        break;
                    }
                }
            }
        }
    }
    let leftover = rest.to_vec();
    *carry = leftover;
    out
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        if find_in_path("pwsh.exe").is_some() {
            return "pwsh.exe".into();
        }
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/sh".into())
    }
}

fn find_in_path(program: &str) -> Option<PathBuf> {
    let candidate = Path::new(program);
    if candidate.is_absolute() {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(program))
        .find(|path| path.is_file())
}

fn shell_display_name(path: &str) -> String {
    let file = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_lowercase();
    match file.as_str() {
        "pwsh" => "PowerShell".into(),
        "powershell" => "Windows PowerShell".into(),
        "cmd" => "Command Prompt".into(),
        "bash" => "bash".into(),
        "zsh" => "zsh".into(),
        "fish" => "fish".into(),
        other => other.to_string(),
    }
}

/// Shells installed on this machine, deduplicated by display name.
pub(crate) fn detect_shells() -> Vec<ShellInfo> {
    let default = default_shell();
    let default_resolved = find_in_path(&default).map(|p| p.to_string_lossy().to_string());
    let mut candidates: Vec<String> = vec![default.clone()];

    #[cfg(windows)]
    candidates.extend(
        ["pwsh.exe", "powershell.exe", "cmd.exe", "bash.exe", "wsl.exe"]
            .iter()
            .map(|s| s.to_string()),
    );

    #[cfg(not(windows))]
    {
        if let Ok(content) = std::fs::read_to_string("/etc/shells") {
            candidates.extend(
                content
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .map(String::from),
            );
        }
        candidates.extend(["bash", "zsh", "fish", "pwsh", "sh"].iter().map(|s| s.to_string()));
    }

    let mut seen_names = std::collections::HashSet::new();
    let mut shells = Vec::new();
    for candidate in candidates {
        let Some(resolved) = find_in_path(&candidate) else { continue };
        let path = resolved.to_string_lossy().to_string();
        let name = shell_display_name(&path);
        if !seen_names.insert(name.clone()) {
            continue;
        }
        let is_default = default_resolved.as_deref() == Some(path.as_str());
        shells.push(ShellInfo {
            name,
            path,
            args: Vec::new(),
            is_default,
        });
    }
    // Default first, the rest in detection order.
    shells.sort_by_key(|s| !s.is_default);
    shells
}

#[tauri::command]
pub fn pty_list_shells() -> Vec<ShellInfo> {
    detect_shells()
}

#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyState>,
    options: PtySpawnOptions,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(size(options.cols, options.rows))
        .map_err(|e| format!("Could not open a pseudo-terminal: {e}"))?;

    let shell = options.shell.filter(|s| !s.is_empty()).unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&options.args);
    let cwd = options
        .cwd
        .filter(|dir| Path::new(dir).is_dir())
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| std::env::var("USERPROFILE").ok());
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "QoriApp");
    for (key, value) in &options.env {
        cmd.env(key, value);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Could not start '{shell}': {e}"))?;
    // The slave end belongs to the child now; keeping it open would prevent
    // EOF on the reader once the shell exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            killer,
        },
    );

    let data_app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = decode_utf8_chunk(&mut carry, &buf[..n]);
                    if !data.is_empty() {
                        let _ = data_app.emit("pty:data", PtyDataPayload { id, data });
                    }
                }
            }
        }
    });

    let sessions = state.sessions.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        if let Ok(mut map) = sessions.lock() {
            map.remove(&id);
        }
        let _ = app.emit("pty:exit", PtyExitPayload { id, code });
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("Terminal session not found")?;
    session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ascii_directly() {
        let mut carry = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut carry, b"hello"), "hello");
        assert!(carry.is_empty());
    }

    #[test]
    fn keeps_split_multibyte_sequences() {
        let bytes = "ñá€".as_bytes();
        let mut carry = Vec::new();
        let mut out = String::new();
        for byte in bytes {
            out.push_str(&decode_utf8_chunk(&mut carry, std::slice::from_ref(byte)));
        }
        assert_eq!(out, "ñá€");
        assert!(carry.is_empty());
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut carry = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut carry, b"a\xFFb"), "a\u{FFFD}b");
    }

    #[test]
    fn detects_at_least_one_shell() {
        let shells = detect_shells();
        #[cfg(unix)]
        assert!(!shells.is_empty());
        let defaults = shells.iter().filter(|s| s.is_default).count();
        assert!(defaults <= 1);
    }

    #[cfg(unix)]
    #[test]
    fn spawned_pty_echoes_output() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf 'qori-ok'"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 1024];
        let mut carry = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            out.push_str(&decode_utf8_chunk(&mut carry, &buf[..n]));
            if out.contains("qori-ok") {
                break;
            }
        }
        child.wait().unwrap();
        assert!(out.contains("qori-ok"));
    }
}
