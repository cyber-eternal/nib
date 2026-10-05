use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct Updates {
    enabled: bool,
    pending: Mutex<Option<Update>>,
}

impl Updates {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            pending: Mutex::new(None),
        }
    }
}

/// tauri-plugin-updater fails app start-up without a pubkey and endpoints, so it is only registered for
/// builds whose config (or `tauri build --config`) supplies both.
pub fn configured(config: &tauri::Config) -> bool {
    config.plugins.0.get("updater").is_some_and(|updater| {
        let pubkey = updater.get("pubkey").and_then(|k| k.as_str());
        let endpoints = updater.get("endpoints").and_then(|e| e.as_array());
        pubkey.is_some_and(|k| !k.trim().is_empty()) && endpoints.is_some_and(|e| !e.is_empty())
    })
}

/// On Linux the updater can only replace an AppImage; .deb and .rpm installs update through their
/// package manager.
pub fn can_install() -> bool {
    #[cfg(target_os = "linux")]
    return std::env::var_os("APPIMAGE").is_some();
    #[cfg(not(target_os = "linux"))]
    true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    if !app.state::<Updates>().enabled {
        return Err("Updates are not configured for this build.".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *app.state::<Updates>().pending.lock().unwrap() = update;
    Ok(info)
}

/// Downloads and installs the update found by the last check. The webview relaunches afterwards, once its
/// unsaved-changes guard allows it.
#[tauri::command]
pub async fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let update = app
        .state::<Updates>()
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "Check for updates first.".to_string())?;
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn relaunch_app<R: Runtime>(app: AppHandle<R>) {
    // request_restart, unlike restart, runs RunEvent::Exit, which is where the window frame is saved
    app.request_restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(plugins: serde_json::Value) -> tauri::Config {
        let mut config: tauri::Config = serde_json::from_value(serde_json::json!({
            "identifier": "app.nib.test"
        }))
        .unwrap();
        config.plugins = serde_json::from_value(plugins).unwrap();
        config
    }

    #[test]
    fn updater_needs_both_a_pubkey_and_an_endpoint() {
        assert!(!configured(&config_with(serde_json::json!({}))));
        assert!(!configured(&config_with(serde_json::json!({
            "updater": { "pubkey": "", "endpoints": ["https://example.com/latest.json"] }
        }))));
        assert!(!configured(&config_with(serde_json::json!({
            "updater": { "pubkey": "key", "endpoints": [] }
        }))));
        assert!(configured(&config_with(serde_json::json!({
            "updater": { "pubkey": "key", "endpoints": ["https://example.com/latest.json"] }
        }))));
    }
}
