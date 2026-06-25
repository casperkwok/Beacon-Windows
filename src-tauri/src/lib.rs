mod appserver;
mod codex;
mod config;
pub mod proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(appserver::AppServerState::default())
        .manage(proxy::server::ProxyState::default())
        .invoke_handler(tauri::generate_handler![
            appserver::appserver_spawn,
            appserver::appserver_send,
            appserver::appserver_kill,
            proxy::server::proxy_start,
            proxy::server::proxy_stop,
            proxy::server::summarize_title,
            config::config_write_provider,
            config::config_activate_default,
            config::config_remove_provider,
            codex::codex_detect,
            codex::codex_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
