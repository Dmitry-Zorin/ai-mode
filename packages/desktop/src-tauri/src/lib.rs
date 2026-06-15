use tauri::{Manager, RunEvent, Theme, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// Google AI Mode, loaded directly as the window's content.
const AI_MODE_URL: &str = "https://www.google.com/?udm=50";

/// Present a current desktop Safari/WebKit UA. Google sign-in rejects some
/// embedded-browser fingerprints as unsafe; claiming to be Chrome while running
/// inside WKWebView makes that fingerprint less coherent than Safari/WebKit.
const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
(KHTML, like Gecko) Version/18.5 Safari/605.1.15";

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
            .user_agent(SAFARI_UA)
            .initialization_script(INIT_SCRIPT)
            // A slim native title bar (traffic lights only, no title text) so the
            // window is reliably draggable. The previous overlay style let the
            // WKWebview cover and eat title-bar drags, and a remote page (Google)
            // can't host a Tauri drag region. Forcing the dark theme keeps the
            // bar matching AI Mode's dark UI regardless of the system appearance.
            .hidden_title(true)
            .theme(Some(Theme::Dark))
            .build()?;

            // Restore the previous size/position (saved by window-state on exit).
            let _ = win.restore_state(StateFlags::all());

            // Closing (red traffic light) hides the window instead of quitting,
            // so the global hotkey can re-summon it. The app keeps running in
            // the background. On focus (open / hotkey / Dock re-summon), drop
            // the cursor straight into the "Ask anything" box.
            let win_events = win.clone();
            win.on_window_event(move |ev| match ev {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = win_events.hide();
                }
                WindowEvent::Focused(true) => {
                    let _ =
                        win_events.eval("window.__aimodeFocusInput && window.__aimodeFocusInput()");
                }
                _ => {}
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
