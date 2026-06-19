use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, Theme, TitleBarStyle,
    WebviewUrl, Window, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{StateFlags, WindowExt};

mod store;

// --- Configuration -----------------------------------------------------------

/// Google AI Mode, loaded into the embedded Google webview.
const AI_MODE_URL: &str = "https://www.google.com/?udm=50";

/// Present a current desktop Safari/WebKit UA. We genuinely ARE WebKit here
/// (WKWebView), so this UA is self-consistent -- the whole reason for choosing
/// Tauri over Electron: a coherent fingerprint is the best shot at passing
/// Google's "this browser may not be secure" sign-in gate.
const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
(KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/// CSS/JS injected at document-start on every navigation into the Google view.
/// Included from OUT_DIR (build.rs copies it there) so edits to inject.js
/// reliably trigger a rebuild -- see build.rs for why.
const INIT_SCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/inject.js"));

/// Height of the native header bar, in logical px. The header webview is sized
/// to exactly this by the layout pass and header.css fills it (`#bar` is 100%
/// tall), so this constant is the single source of truth -- no CSS value to sync.
const HEADER_HEIGHT: f64 = 40.0;

const DEFAULT_WIDTH: f64 = 980.0;
const DEFAULT_HEIGHT: f64 = 760.0;
const MIN_WIDTH: f64 = 420.0;
const MIN_HEIGHT: f64 = 480.0;

const ZOOM_MIN: f64 = 0.5;
const ZOOM_MAX: f64 = 2.0;
const ZOOM_STEP: f64 = 0.05;

/// Click AI Mode's own left-rail "new chat" control, which starts a fresh
/// thread in-app (no reload). Google obfuscates class names and localizes the
/// aria-label, so we bind to the stable jsaction token ("DEynzb") Google's own
/// code dispatches on, with the compose-icon path as a second structural
/// signal. The button is disabled on a fresh thread, so we skip it then.
/// Deliberately no URL-reload fallback: if both signals miss, Cmd+N is a no-op
/// -- but it warns to the (enabled) devtools console so a stale token surfaces
/// as a greppable "[AI Mode]" message instead of mystifying silence.
const NEW_THREAD_JS: &str = r#"(() => {
  const isNewChat = (b) =>
    (b.getAttribute("jsaction") || "").includes("DEynzb") ||
    !!b.querySelector('svg path[d^="M200-120"]');
  const buttons = document.querySelectorAll("button");
  let disabledMatch = false;
  for (const b of buttons) {
    if (!isNewChat(b)) continue;
    if (b.disabled) { disabledMatch = true; continue; } // already a fresh thread
    if (b.offsetParent === null) continue;
    b.click();
    return true;
  }
  // A disabled match means we're already on a blank thread -- not a failure.
  if (!disabledMatch) {
    console.warn(
      "[AI Mode] New Thread: no control matched the DEynzb token / compose " +
      "icon. The selector in lib.rs NEW_THREAD_JS is likely stale -- re-tune " +
      "it (right-click -> Inspect the new-chat button)."
    );
  }
  return false;
})();"#;

/// Hook exposed by inject.js: focus the composer and drop the caret at the end.
const FOCUS_JS: &str = "window.__aimodeFocusInput && window.__aimodeFocusInput()";

/// Canned prompt the header's template button injects into the composer and
/// sends in one shot. Edit src/template-prompt.md to change what the button
/// asks -- it's embedded from OUT_DIR (build.rs copies it there) for the same
/// rebuild-reliability reason as inject.js. JSON-encoded before being handed to
/// inject.js's __aimodeSendPrompt hook, so newlines, quotes and Unicode are all
/// safe; the file's trailing newline is trimmed at the send site.
const TEMPLATE_PROMPT: &str = include_str!(concat!(env!("OUT_DIR"), "/template-prompt.md"));

/// Hosts that load *inside* the app instead of the system browser. AI Mode pulls
/// in sign-in, reCAPTCHA and ad-traffic-quality (SODAR) frames on Google's own
/// infra domains; those navigations must stay in-app -- the navigation handler
/// fires for subframes too, so externalizing them spawns a browser tab AND
/// cancels the frame (which also kills Google's bot-detection signal, inviting
/// the "browser may not be secure" gate). `.google` is a Google-operated brand
/// gTLD (e.g. adtrafficquality.google), so the whole TLD is Google's. Anything
/// NOT matched here is treated as a genuine off-site link (a citation) and
/// handed to the system browser.
fn is_in_app_host(host: &str) -> bool {
    const GOOGLE_SUFFIXES: &[&str] = &[
        "google.com",
        "google", // the .google brand gTLD: adtrafficquality.google, etc.
        "gstatic.com",
        "googleapis.com",
        "googleusercontent.com",
        "googlesyndication.com",
        "doubleclick.net",
        "recaptcha.net",
        "withgoogle.com",
    ];
    GOOGLE_SUFFIXES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

// --- State -------------------------------------------------------------------

/// Zoom factor is owned here (single source of truth) so the menu accelerators,
/// the header buttons, and the persisted value never disagree.
struct AppState {
    zoom: Mutex<f64>,
}

// --- Layout ------------------------------------------------------------------

/// Tile the two child webviews from explicit logical dimensions: header across
/// the top HEADER_HEIGHT, Google filling the rest. Child frames are in logical
/// px, so callers convert from whatever physical size/scale they hold.
fn layout_logical(app: &AppHandle, w: f64, h: f64) {
    if let Some(header) = app.get_webview("header") {
        let _ = header.set_position(LogicalPosition::new(0.0, 0.0));
        let _ = header.set_size(LogicalSize::new(w, HEADER_HEIGHT));
    }
    if let Some(google) = app.get_webview("google") {
        let _ = google.set_position(LogicalPosition::new(0.0, HEADER_HEIGHT));
        let _ = google.set_size(LogicalSize::new(w, (h - HEADER_HEIGHT).max(0.0)));
    }
}

/// Tile the two child webviews using the window's current size. Mirrors
/// Electron's WebContentsView layout pass.
fn layout(window: &Window, app: &AppHandle) {
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    layout_logical(app, size.width as f64 / scale, size.height as f64 / scale);
}

// --- Zoom --------------------------------------------------------------------

fn apply_zoom(app: &AppHandle) {
    if let Some(google) = app.get_webview("google") {
        let zoom = *app.state::<AppState>().zoom.lock().unwrap();
        let _ = google.set_zoom(zoom);
    }
}

fn set_zoom(app: &AppHandle, next: f64) {
    let clamped = (next.clamp(ZOOM_MIN, ZOOM_MAX) * 100.0).round() / 100.0;
    {
        let state = app.state::<AppState>();
        let mut zoom = state.zoom.lock().unwrap();
        if (*zoom - clamped).abs() < f64::EPSILON {
            return;
        }
        *zoom = clamped;
    }
    apply_zoom(app);
    store::save_zoom(app, clamped);
    let _ = app.emit("zoom", clamped); // header reflects the new %
}

// --- Window ------------------------------------------------------------------

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let shown = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
        if shown {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Vertically center the native close/minimize/zoom buttons inside our 40px
/// header. With `TitleBarStyle::Overlay`, macOS positions them for a standard
/// ~28px title bar, so in our taller header they sit ~6px high. This is wry's
/// own `inset_traffic_lights` algorithm -- wry wires it up only for
/// single-webview windows, but our multiwebview `WindowBuilder` never receives
/// it. `INSET_X` is the first button's left inset; `INSET_Y` is added to the
/// button height to size the title-bar container, which is what drops the row
/// into the bar's vertical center. macOS resets these positions on resize and
/// fullscreen transitions, so the window-event handler re-applies on `Resized`
/// (which also fires on fullscreen toggle), `Focused(true)` and DPI changes.
#[cfg(target_os = "macos")]
fn center_traffic_lights(window: &Window) {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

    const INSET_X: f64 = 19.0;
    const INSET_Y: f64 = 22.0;

    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }

    // SAFETY: ns_window() yields this window's live NSWindow. We only run on the
    // main thread (setup and the window-event handler both do) and only read and
    // set AppKit view frames -- the exact operations wry performs internally.
    unsafe {
        let ns_window: &NSWindow = &*ptr.cast::<NSWindow>();

        let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
        else {
            return;
        };
        let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

        // close button -> the button row -> the title-bar container view.
        let Some(row) = close.superview() else {
            return;
        };
        let Some(container) = row.superview() else {
            return;
        };

        let close_rect = NSView::frame(&close);
        let bar_height = close_rect.size.height + INSET_Y;
        let mut container_rect = NSView::frame(&container);
        container_rect.size.height = bar_height;
        container_rect.origin.y = ns_window.frame().size.height - bar_height;
        container.setFrame(container_rect);

        let spacing = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;

        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }
        for (i, button) in buttons.into_iter().enumerate() {
            let mut rect = NSView::frame(&button);
            rect.origin.x = INSET_X + i as f64 * spacing;
            button.setFrameOrigin(rect.origin);
        }
    }
}

// --- Commands (driven by the header bar) -------------------------------------

#[tauri::command]
fn zoom_in(app: AppHandle) {
    let z = *app.state::<AppState>().zoom.lock().unwrap();
    set_zoom(&app, z + ZOOM_STEP);
}

#[tauri::command]
fn zoom_out(app: AppHandle) {
    let z = *app.state::<AppState>().zoom.lock().unwrap();
    set_zoom(&app, z - ZOOM_STEP);
}

#[tauri::command]
fn zoom_reset(app: AppHandle) {
    set_zoom(&app, 1.0);
}

#[tauri::command]
fn get_zoom(app: AppHandle) -> f64 {
    *app.state::<AppState>().zoom.lock().unwrap()
}

#[tauri::command]
fn go_back(app: AppHandle) {
    if let Some(g) = app.get_webview("google") {
        let _ = g.eval("window.history.back()");
    }
}

#[tauri::command]
fn go_forward(app: AppHandle) {
    if let Some(g) = app.get_webview("google") {
        let _ = g.eval("window.history.forward()");
    }
}

#[tauri::command]
fn new_thread(app: AppHandle) {
    if let Some(g) = app.get_webview("google") {
        let _ = g.eval(NEW_THREAD_JS);
    }
}

#[tauri::command]
fn send_template(app: AppHandle) {
    if let Some(g) = app.get_webview("google") {
        // JSON-encode so any quotes/newlines in TEMPLATE_PROMPT stay safe inside
        // the eval'd call; serializing a &str never fails. trim_end drops the
        // embedded file's final newline so the sent prompt ends cleanly.
        let arg = serde_json::to_string(TEMPLATE_PROMPT.trim_end()).unwrap();
        let _ = g.eval(format!(
            "window.__aimodeSendPrompt && window.__aimodeSendPrompt({arg})"
        ));
    }
}

fn reload(app: &AppHandle) {
    if let Some(g) = app.get_webview("google") {
        let _ = g.eval("window.location.reload()");
    }
}

fn toggle_devtools(app: &AppHandle) {
    if let Some(g) = app.get_webview("google") {
        if g.is_devtools_open() {
            g.close_devtools();
        } else {
            g.open_devtools();
        }
    }
}

// --- Menu (accelerators) -----------------------------------------------------

/// macOS app menu. The custom items carry accelerators (Cmd+N / zoom / nav),
/// which fire regardless of which webview has focus -- the same focus-
/// independent path Electron used, and the reason none of this needs the remote
/// Google page to run any key handling or reach Tauri IPC.
///
/// Returns the built menu plus the Window submenu, which the caller registers
/// as the macOS Window menu (see `set_as_windows_menu_for_nsapp` at the call
/// site) so the system can hang its standard window/tiling items off it.
fn build_menu(app: &AppHandle) -> tauri::Result<(tauri::menu::Menu<Wry>, Submenu<Wry>)> {
    let app_menu = SubmenuBuilder::new(app, "AI Mode")
        .item(&PredefinedMenuItem::about(app, Some("About AI Mode"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new-thread", "New Thread")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Edit menu carries the standard clipboard accelerators -- essential so the
    // composer's Cmd+V / Cmd+A / Cmd+Z work.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        // Also catch Cmd+Shift+= (the "+" key) for zoom in.
        .item(
            &MenuItemBuilder::with_id("zoom-in-plus", "Zoom In")
                .accelerator("CmdOrCtrl+Shift+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom-reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go-back", "Back")
                .accelerator("CmdOrCtrl+[")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-forward", "Forward")
                .accelerator("CmdOrCtrl+]")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("reload", "Reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("devtools", "Toggle Developer Tools")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    Ok((menu, window_menu))
}

// --- App ---------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A single running instance; a second launch just re-summons the window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            zoom_in, zoom_out, zoom_reset, get_zoom, go_back, go_forward, new_thread,
            send_template
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let zoom = store::load_zoom(&handle);
            app.manage(AppState {
                zoom: Mutex::new(zoom),
            });

            let (menu, window_menu) = build_menu(&handle)?;
            app.set_menu(menu)?;
            // Register our "Window" submenu as the macOS Window menu. macOS then
            // hangs its standard window items off it -- and on Sequoia that
            // includes the "Move & Resize" tiling commands and their keyboard
            // shortcuts (^⌥<arrow>, etc.). Without a registered Window menu the
            // OS has nowhere to inject them, so native window tiling is absent.
            // Done after set_menu so swapping the main menu can't orphan it.
            #[cfg(target_os = "macos")]
            window_menu.set_as_windows_menu_for_nsapp()?;
            #[cfg(not(target_os = "macos"))]
            let _ = window_menu;

            // The window hosts two tiled child webviews and no webview of its
            // own. Overlay title-bar style hides the bar chrome but keeps the
            // traffic lights, which float over the header's reserved left
            // padding -- like Electron's hidden title bar. Forcing the dark
            // theme keeps the bar matching AI Mode's dark UI.
            let window = WindowBuilder::new(app, "main")
                .title("AI Mode")
                .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
                .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .theme(Some(Theme::Dark))
                .build()?;

            // Header bar: our local Vite/TS app, hosts the drag region.
            window.add_child(
                WebviewBuilder::new("header", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(DEFAULT_WIDTH, HEADER_HEIGHT),
            )?;

            // Google AI Mode: remote page, so Tauri injects no IPC into it. UA
            // spoofing, chrome-hiding, the passkey sign-in hack, external-link
            // handling and zoom re-application are all wired here.
            window.add_child(
                WebviewBuilder::new(
                    "google",
                    WebviewUrl::External(AI_MODE_URL.parse().unwrap()),
                )
                .user_agent(SAFARI_UA)
                .initialization_script(INIT_SCRIPT)
                .devtools(true)
                // wry installs a native drag-and-drop handler on the WKWebView
                // that swallows OS file drops before the page sees them, so
                // dropping a screenshot onto AI Mode's composer never fires the
                // page's HTML5 drag/drop -- no image upload. Disabling it lets
                // native drops pass straight through to WKWebView and reach
                // Google's own drop target.
                .disable_drag_drop_handler()
                .on_navigation(|url| {
                    let host = url.host_str().unwrap_or("");
                    // Empty host = about:blank/data: frames; keep those in-app too.
                    if host.is_empty() || is_in_app_host(host) {
                        return true; // sign-in, reCAPTCHA, SODAR, ads -- all in-app
                    }
                    // Citations and other external links open in the system browser
                    // -- but only http(s). The URL is page-controlled, so a file://
                    // or custom app scheme must never reach `open`, which would hand
                    // the OS an arbitrary protocol handler to launch.
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
                    }
                    false
                })
                .on_page_load(|webview, payload| {
                    // WKWebView page zoom can reset across full navigations;
                    // re-assert the owned factor once each page settles.
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        let zoom = *webview.state::<AppState>().zoom.lock().unwrap();
                        let _ = webview.set_zoom(zoom);
                    }
                }),
                LogicalPosition::new(0.0, HEADER_HEIGHT),
                LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT - HEADER_HEIGHT),
            )?;

            // Keep the webviews tiled on resize; hide (not quit) on close so the
            // global hotkey can re-summon; refocus the composer on focus.
            let win_for_events = window.clone();
            let app_for_events = handle.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_) => {
                    layout(&win_for_events, &app_for_events);
                    // Resized also fires on fullscreen enter/exit, where macOS
                    // resets the button positions -- so re-center here too.
                    #[cfg(target_os = "macos")]
                    center_traffic_lights(&win_for_events);
                }
                // Dragging the window across monitors with different DPI changes
                // the scale factor without necessarily emitting a Resized; the
                // payload carries the authoritative new size, so retile straight
                // from it (no racy re-read of inner_size mid-transition).
                WindowEvent::ScaleFactorChanged {
                    scale_factor,
                    new_inner_size,
                    ..
                } => {
                    layout_logical(
                        &app_for_events,
                        new_inner_size.width as f64 / scale_factor,
                        new_inner_size.height as f64 / scale_factor,
                    );
                    #[cfg(target_os = "macos")]
                    center_traffic_lights(&win_for_events);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = win_for_events.hide();
                }
                WindowEvent::Focused(true) => {
                    if let Some(g) = app_for_events.get_webview("google") {
                        let _ = g.eval(FOCUS_JS);
                    }
                    #[cfg(target_os = "macos")]
                    center_traffic_lights(&win_for_events);
                }
                _ => {}
            });

            // Menu accelerators and header buttons share the same handlers.
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "new-thread" => new_thread(app.clone()),
                "zoom-in" | "zoom-in-plus" => zoom_in(app.clone()),
                "zoom-out" => zoom_out(app.clone()),
                "zoom-reset" => zoom_reset(app.clone()),
                "go-back" => go_back(app.clone()),
                "go-forward" => go_forward(app.clone()),
                "reload" => reload(app),
                "devtools" => toggle_devtools(app),
                _ => {}
            });

            // Restore last size/position (saved by window-state on exit), then tile.
            // Exclude VISIBLE: the red light hides (not closes) the window, so the
            // plugin can persist visible=false; restoring that would relaunch to an
            // invisible window (just the menu bar). Always start shown.
            let _ = window.restore_state(StateFlags::all() & !StateFlags::VISIBLE);
            layout(&window, &handle);
            // First placement of the traffic lights; the window-event handler
            // re-applies whenever macOS resets them (resize/fullscreen/focus).
            #[cfg(target_os = "macos")]
            center_traffic_lights(&window);

            // Open AI Mode from anywhere: Option+Space toggles the window. Only
            // this one shortcut is registered, so the handler reacts to any press.
            let hotkey = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            handle.plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            toggle_main(app);
                        }
                    })
                    .build(),
            )?;
            // Non-fatal: if another app already holds Option+Space, the rest of the
            // app should still run -- but warn so the conflict is diagnosable (the
            // window is still reachable via the Dock icon and relaunch).
            if let Err(e) = app.global_shortcut().register(hotkey) {
                eprintln!(
                    "[AI Mode] Could not register the Option+Space global shortcut \
                     (already in use?): {e}"
                );
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Clicking the Dock icon re-shows the hidden window (macOS).
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = &_event {
                show_main(_app);
            }
        });
}
