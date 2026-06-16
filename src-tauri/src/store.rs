// Tiny JSON-on-disk store for the one thing that should survive a relaunch but
// isn't window geometry: the zoom factor. (Window bounds are handled by
// tauri-plugin-window-state.) Kept dependency-free on purpose -- the whole app
// is meant to stay thin.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
struct Stored {
    zoom: f64,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("state.json"))
}

/// Last saved zoom factor, clamped to the supported range, or 1.0 on any error.
pub fn load_zoom(app: &AppHandle) -> f64 {
    file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Stored>(&s).ok())
        .map(|v| v.zoom.clamp(0.5, 2.0))
        .unwrap_or(1.0)
}

/// Best effort; losing the zoom level across a relaunch is harmless.
pub fn save_zoom(app: &AppHandle, zoom: f64) {
    if let Some(path) = file(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&Stored { zoom }) {
            let _ = fs::write(path, json);
        }
    }
}
