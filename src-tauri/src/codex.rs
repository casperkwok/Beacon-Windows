// Detects and auto-installs the standalone `codex` binary so non-technical users
// need zero setup. Beacon manages its own copy under the app data dir and calls
// it by full path — avoiding the npm `.cmd` shim problem on Windows.

use std::io::Write;
use std::path::PathBuf;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const RELEASE_BASE: &str = "https://github.com/openai/codex/releases/latest/download";
// China-friendly GitHub accelerators, tried before the direct GitHub URL.
const MIRRORS: &[&str] = &["https://ghfast.top/", "https://gh-proxy.com/"];

fn beacon_bin_dir() -> PathBuf {
    // Windows: %LOCALAPPDATA%\Beacon\bin ; macOS: ~/Library/Application Support/Beacon/bin
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support")
    } else {
        let home = std::env::var_os("HOME").unwrap_or_default();
        PathBuf::from(home).join(".local/share")
    };
    base.join("Beacon").join("bin")
}

fn managed_path() -> PathBuf {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    beacon_bin_dir().join(name)
}

/// Release asset for this OS/arch. All platforms use the compressed tar.gz
/// (the raw Windows .exe is ~320MB vs ~90MB compressed).
fn asset_name() -> Option<&'static str> {
    let arch = std::env::consts::ARCH; // "x86_64" | "aarch64"
    match (std::env::consts::OS, arch) {
        ("windows", "x86_64") => Some("codex-x86_64-pc-windows-msvc.exe.tar.gz"),
        ("windows", "aarch64") => Some("codex-aarch64-pc-windows-msvc.exe.tar.gz"),
        ("macos", "x86_64") => Some("codex-x86_64-apple-darwin.tar.gz"),
        ("macos", "aarch64") => Some("codex-aarch64-apple-darwin.tar.gz"),
        ("linux", "x86_64") => Some("codex-x86_64-unknown-linux-musl.tar.gz"),
        ("linux", "aarch64") => Some("codex-aarch64-unknown-linux-musl.tar.gz"),
        _ => None,
    }
}

fn version_of(path: &str) -> Option<String> {
    let mut cmd = std::process::Command::new(path);
    cmd.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[derive(Serialize)]
pub struct CodexStatus {
    pub found: bool,
    pub path: String,
    pub version: String,
    pub source: String, // "managed" | "path" | ""
}

/// Resolve a usable codex: prefer Beacon's managed copy, then PATH.
#[tauri::command]
pub fn codex_detect() -> CodexStatus {
    let managed = managed_path();
    if managed.exists() {
        if let Some(v) = version_of(&managed.to_string_lossy()) {
            return CodexStatus {
                found: true,
                path: managed.to_string_lossy().into_owned(),
                version: v,
                source: "managed".into(),
            };
        }
    }
    if let Some(v) = version_of("codex") {
        return CodexStatus {
            found: true,
            path: "codex".into(),
            version: v,
            source: "path".into(),
        };
    }
    CodexStatus {
        found: false,
        path: String::new(),
        version: String::new(),
        source: String::new(),
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    phase: String, // "download" | "extract" | "done"
    downloaded: u64,
    total: u64,
}

/// Download (and extract) the codex binary into Beacon's managed bin dir.
/// Emits `codex://install-progress`. Returns the installed binary path.
#[tauri::command]
pub async fn codex_install(app: AppHandle) -> Result<String, String> {
    let asset = asset_name().ok_or("当前系统/架构暂不支持自动安装 codex")?;
    let gh = format!("{RELEASE_BASE}/{asset}");
    let dir = beacon_bin_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = managed_path();

    let client = reqwest::Client::builder()
        .user_agent("Beacon")
        .build()
        .map_err(|e| e.to_string())?;

    // Try China mirrors first, then direct GitHub.
    let mut candidates: Vec<String> = MIRRORS.iter().map(|m| format!("{m}{gh}")).collect();
    candidates.push(gh.clone());
    let mut resp = None;
    let mut last_err = String::from("无可用下载源");
    for url in &candidates {
        match client.get(url).send().await {
            Ok(r) if r.status().is_success() => {
                resp = Some(r);
                break;
            }
            Ok(r) => last_err = format!("HTTP {}", r.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    let resp = resp.ok_or(format!("下载失败：{last_err}"))?;
    let total = resp.content_length().unwrap_or(0);

    // Stream to memory with progress (binaries are ~20-40MB).
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "codex://install-progress",
            Progress { phase: "download".into(), downloaded, total },
        );
    }

    if asset.ends_with(".tar.gz") {
        let _ = app.emit(
            "codex://install-progress",
            Progress { phase: "extract".into(), downloaded, total },
        );
        extract_first_file(&buf, &dest)?;
    } else {
        // direct .exe — write as-is
        std::fs::write(&dest, &buf).map_err(|e| e.to_string())?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }

    // Verify it runs.
    let path = dest.to_string_lossy().into_owned();
    version_of(&path).ok_or("已下载但无法运行 codex")?;
    let _ = app.emit(
        "codex://install-progress",
        Progress { phase: "done".into(), downloaded, total },
    );
    Ok(path)
}

/// Extract the single binary entry from a .tar.gz into `dest`.
fn extract_first_file(gz: &[u8], dest: &std::path::Path) -> Result<(), String> {
    let tar = flate2::read::GzDecoder::new(gz);
    let mut archive = tar::Archive::new(tar);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let is_file = entry.header().entry_type().is_file();
        if is_file {
            let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            out.flush().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("压缩包内未找到可执行文件".into())
}
