// Reads and writes OpenAI Codex CLI configuration (~/.codex/config.toml).
// Activating a provider upserts a [model_providers.<slug>] block and repoints the
// top-level model / model_provider, preserving unrelated configuration. Ported
// from macOS Beacon's ConfigManager.swift (TOMLKit → toml_edit).

use std::path::PathBuf;

use toml_edit::{value, DocumentMut, Item, Table};

fn codex_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("CODEX_HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .unwrap_or_default();
    PathBuf::from(home).join(".codex")
}

fn config_path() -> PathBuf {
    codex_dir().join("config.toml")
}

fn read_doc() -> DocumentMut {
    let text = std::fs::read_to_string(config_path()).unwrap_or_default();
    text.parse::<DocumentMut>().unwrap_or_default()
}

fn write_doc(doc: &DocumentMut) -> Result<(), String> {
    let dir = codex_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = config_path();
    // Best-effort backup before overwriting.
    if path.exists() {
        let _ = std::fs::copy(&path, dir.join("config.toml.backup"));
    }
    std::fs::write(&path, doc.to_string()).map_err(|e| e.to_string())
}

/// Upsert a provider block and point Codex at it.
/// `base_url` is the effective URL Codex should call (the local proxy when bridged,
/// or the upstream directly otherwise). `bearer_token` is written verbatim.
#[tauri::command]
pub fn config_write_provider(
    slug: String,
    name: String,
    base_url: String,
    bearer_token: String,
    model: String,
    reasoning_effort: String,
) -> Result<(), String> {
    let mut doc = read_doc();

    if !doc.contains_key("model_providers") {
        doc["model_providers"] = Item::Table(Table::new());
    }
    let providers = doc["model_providers"]
        .as_table_mut()
        .ok_or("model_providers is not a table")?;

    let mut block = Table::new();
    block["name"] = value(&name);
    block["base_url"] = value(&base_url);
    block["wire_api"] = value("responses");
    if !bearer_token.is_empty() {
        block["experimental_bearer_token"] = value(&bearer_token);
    }
    providers[&slug] = Item::Table(block);

    doc["model_provider"] = value(&slug);
    if !model.is_empty() {
        doc["model"] = value(&model);
    }
    if !reasoning_effort.is_empty() {
        doc["model_reasoning_effort"] = value(&reasoning_effort);
    }

    write_doc(&doc)
}

/// Return Codex to its built-in `openai` provider.
#[tauri::command]
pub fn config_activate_default() -> Result<(), String> {
    let mut doc = read_doc();
    doc["model_provider"] = value("openai");
    doc.as_table_mut().remove("model");
    doc.as_table_mut().remove("model_reasoning_effort");
    write_doc(&doc)
}

/// Remove a provider block.
#[tauri::command]
pub fn config_remove_provider(slug: String) -> Result<(), String> {
    let mut doc = read_doc();
    if let Some(providers) = doc.get_mut("model_providers").and_then(Item::as_table_mut) {
        providers.remove(&slug);
    }
    write_doc(&doc)
}
