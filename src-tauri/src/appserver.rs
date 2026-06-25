// M0 spike (chat path): drive the real `codex` agent via its `app-server`
// protocol over stdio. Rust stays a thin transport — newline-delimited JSON
// framing in/out — and all protocol orchestration lives in the frontend, where
// the 562 generated TypeScript bindings already exist.
//
// Wire format (verified against codex 0.140.0):
//   - newline-delimited JSON, one object per line
//   - JSON-RPC style: requests {id, method, params}, responses {id, result|error},
//     notifications {method, params}; the `jsonrpc` field is optional.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AppServerState {
    inner: Mutex<Option<Session>>,
}

struct Session {
    child: Child,
    stdin: ChildStdin,
}

/// Spawn `codex app-server` and start pumping its stdout/stderr to the frontend.
/// Each stdout line is emitted verbatim as `appserver://message`.
#[tauri::command]
pub fn appserver_spawn(
    app: AppHandle,
    state: State<'_, AppServerState>,
    program: String,
    cwd: String,
) -> Result<(), String> {
    {
        // Replace any existing session.
        let mut guard = state.inner.lock().unwrap();
        if let Some(mut s) = guard.take() {
            let _ = s.child.kill();
        }
    }

    let mut cmd = Command::new(&program);
    cmd.arg("app-server").arg("--stdio");
    if !cwd.is_empty() {
        cmd.current_dir(&cwd);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Suppress the console window that Windows would otherwise pop up.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // stdout reader: one JSON object per line → frontend.
    let app_out = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    let _ = app_out.emit("appserver://message", l);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = app_out.emit("appserver://closed", ());
    });

    // stderr reader: surface diagnostics as a separate channel.
    let app_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    let _ = app_err.emit("appserver://stderr", l);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    let mut guard = state.inner.lock().unwrap();
    *guard = Some(Session { child, stdin });
    Ok(())
}

/// Write one JSON-RPC message (already serialized) to the app-server stdin,
/// appending the newline frame delimiter.
#[tauri::command]
pub fn appserver_send(state: State<'_, AppServerState>, json: String) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    let session = guard.as_mut().ok_or("app-server not running")?;
    session
        .stdin
        .write_all(json.as_bytes())
        .map_err(|e| e.to_string())?;
    session.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    session.stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn appserver_kill(state: State<'_, AppServerState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    if let Some(mut s) = guard.take() {
        let _ = s.child.kill();
    }
    Ok(())
}
