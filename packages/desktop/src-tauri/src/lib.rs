use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// Google AI Mode, loaded directly as the window's content.
const AI_MODE_URL: &str = "https://www.google.com/?udm=50";

/// Spoof Chrome-on-macOS so Google serves the full experience instead of
/// downgrading for the underlying WKWebView (which would otherwise advertise
/// Safari). Keep the major version current — a stale one risks "update your
/// browser" nags or a degraded UI. 149 was confirmed to get the full AI Mode
/// experience against the live site; bump it periodically.
const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/// CSS/JS injected at document-start on every navigation to hide Google's
/// browser chrome so the window feels like a dedicated app.
const INIT_SCRIPT: &str = include_str!("inject.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // A single running instance; a second launch just re-summons the window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            // Global hotkey: Option+Space toggles the window from anywhere.
            // Only this one shortcut is ever registered, so the handler reacts
            // to any press without needing to match a specific shortcut.
            let hotkey = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            if let Some(w) = app.get_webview_window("main") {
                                let shown = w.is_visible().unwrap_or(false)
                                    && w.is_focused().unwrap_or(false);
                                if shown {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(),
            )?;
            app.global_shortcut().register(hotkey)?;

            // The window IS the webview, loading Google AI Mode directly. UA
            // spoofing and chrome-hiding are wired in here rather than in a
            // frontend, so there is no React/Vite layer at all.
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(AI_MODE_URL.parse().unwrap()),
            )
            .title("AI Mode")
            .inner_size(900.0, 720.0)
            .min_inner_size(420.0, 400.0)
            .user_agent(CHROME_UA)
            .initialization_script(INIT_SCRIPT)
            .transparent(true)
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::HudWindow],
                state: None,
                radius: None,
                color: None,
            })
            .build()?;

            // Restore the previous size/position (saved by window-state on exit).
            let _ = win.restore_state(StateFlags::all());

            // Closing (red traffic light) hides the window instead of quitting,
            // so the global hotkey can re-summon it. The app keeps running in
            // the background.
            let hide_target = win.clone();
            win.on_window_event(move |ev| {
                if let WindowEvent::CloseRequested { api, .. } = ev {
                    api.prevent_close();
                    let _ = hide_target.hide();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, _event| {
            // Clicking the Dock icon re-shows the hidden window (macOS).
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = &_event {
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
