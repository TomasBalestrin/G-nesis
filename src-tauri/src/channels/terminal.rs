//! Interactive PTY channel — backs the in-app terminal surface.
//!
//! Unlike the orchestrator's `Channel` trait (one-shot subprocess that
//! returns stdout/stderr/exit), this is a long-lived bidirectional
//! session: the frontend (`xterm.js`) types into a master writer; the
//! reader spawns a thread that streams bytes back via `terminal:data`
//! events.
//!
//! Sessions are tracked in `TerminalRegistry` (a `Mutex<HashMap>` of
//! `session_id -> Session`); the Tauri commands at the bottom marshal
//! IPC requests onto that map.
//!
//! Security (docs/security.md):
//!   - The shell launched is the user's `$SHELL` (fallback `/bin/bash`),
//!     never `sh -c "..."`. The user already has shell access locally;
//!     the PTY is just a UX wrapper.
//!   - The session id is a UUID v4, generated server-side. The
//!     frontend can't choose it.
//!   - Output is forwarded as raw bytes (Vec<u8>) without sanitisation —
//!     escape sequences are *expected* (xterm parses them). The frontend
//!     must not eval payloads as anything other than terminal data.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::channels::bash::child_env_overrides;

/// One live PTY pair + the spawned shell child. Owned by the registry;
/// `take_writer` consumes a handle so we hold both the master (for
/// resize) and the writer (for stdin) on the session.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child_killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, Serialize)]
struct TerminalDataEvent {
    session_id: String,
    /// Raw bytes from the PTY master. Frontend builds a Uint8Array and
    /// passes it to `term.write()` (xterm handles UTF-8 sequencing).
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct TerminalExitEvent {
    session_id: String,
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Spawn a fresh PTY + shell. Returns the session id for use by subsequent
/// `terminal_write` / `terminal_resize` / `terminal_kill` calls.
#[tauri::command]
pub async fn terminal_spawn(
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty falhou: {e}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.arg("-l"); // login shell so rc files run + PATH is rich
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    } else if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }
    // Lift the same login-shell env we use for skill subprocesses so the
    // PTY shares Homebrew/asdf/npm-global PATH with the rest of the app.
    for (k, v) in child_env_overrides(&[]) {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell falhou: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader falhou: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer falhou: {e}"))?;
    let child_killer = child.clone_killer();

    let session_id = uuid::Uuid::new_v4().to_string();
    let session = Session {
        master: pair.master,
        writer,
        child_killer,
    };

    registry
        .sessions
        .lock()
        .map_err(|_| "lock envenenado".to_string())?
        .insert(session_id.clone(), session);

    // Reader runs on a blocking thread — portable-pty's reader is sync.
    // Each chunk is forwarded as a `terminal:data` event. When read returns
    // 0 (EOF) the shell exited; emit `terminal:exit` and clean up the row.
    let app_for_reader = app.clone();
    let session_id_for_reader = session_id.clone();
    let registry_handle = registry.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app_for_reader.emit(
                        "terminal:data",
                        TerminalDataEvent {
                            session_id: session_id_for_reader.clone(),
                            data: buf[..n].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_for_reader.emit(
            "terminal:exit",
            TerminalExitEvent {
                session_id: session_id_for_reader.clone(),
            },
        );
        if let Ok(mut sessions) = registry_handle.lock() {
            sessions.remove(&session_id_for_reader);
        }
    });

    // Reap the child in a separate task so its exit is observed (frees
    // OS resources). The reader EOF detection above is what drives the UI.
    let _ = std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    Ok(session_id)
}

/// Write user keystrokes (or a paste) into the PTY master. Bytes pass
/// through unmodified — xterm.js sends control sequences for arrow keys,
/// resize sequences, etc. as part of its normal output.
#[tauri::command]
pub async fn terminal_write(
    session_id: String,
    data: Vec<u8>,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| "lock envenenado".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("session `{session_id}` não encontrada"))?;
    session
        .writer
        .write_all(&data)
        .map_err(|e| format!("falha ao escrever na sessão: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("falha ao flush: {e}"))?;
    Ok(())
}

/// Inform the PTY master of a new viewport size — the kernel propagates
/// `SIGWINCH` to the slave, and TUI apps (vim, htop, etc.) re-layout.
#[tauri::command]
pub async fn terminal_resize(
    session_id: String,
    rows: u16,
    cols: u16,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "lock envenenado".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("session `{session_id}` não encontrada"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize falhou: {e}"))?;
    Ok(())
}

/// Tear down the session — kills the child shell, closes the PTY, and
/// removes the row. The reader thread observes EOF and exits naturally.
#[tauri::command]
pub async fn terminal_kill(
    session_id: String,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| "lock envenenado".to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child_killer.kill();
    }
    Ok(())
}
