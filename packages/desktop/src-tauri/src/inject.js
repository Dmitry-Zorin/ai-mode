// Injected at document-start on every navigation (see lib.rs INIT_SCRIPT).
// Four jobs: hide Google's browser chrome, auto-focus the "Ask anything" box,
// provide app-local keyboard shortcuts, and keep Google sign-in away from
// WebAuthn/passkey flows that WKWebView cannot complete reliably. Everything
// here is web-layer only (CSS, focus, navigation) so it needs no native IPC on
// the remote page.
//
// Selectors verified against the live AI Mode DOM (google.com/?udm=50) on
// 2026-06-15. AI Mode's UI uses obfuscated, unstable class names, so we target
// tags and ARIA roles instead. To re-tune: open devtools (right-click ->
// Inspect, enabled by the `devtools` Cargo feature) and prefer a tag/role/aria
// selector over a class. The AI Mode page has no <footer>, so none is hidden.
//
// Deliberately NOT hidden:
//   - the left "AI Mode history" rail (a plain <div>, no nav role);
//   - #gb, the top-right account bar -- it holds the "Sign in" button / avatar,
//     so hiding it would make logging in impossible.
(function () {
  function disableBrokenPasskeyFlow() {
    if (location.hostname !== "accounts.google.com") return;

    try {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
    } catch (e) {}

    if (!navigator.credentials) return;

    try {
      var get = navigator.credentials.get
        ? navigator.credentials.get.bind(navigator.credentials)
        : null;

      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: function (options) {
          if (options && options.publicKey) {
            return Promise.reject(
              new DOMException("Passkeys are disabled in AI Mode.", "NotSupportedError")
            );
          }

          if (get) return get(options);

          return Promise.reject(
            new DOMException("Credential Management is unavailable.", "NotSupportedError")
          );
        },
      });
    } catch (e) {}
  }

  disableBrokenPasskeyFlow();

  var css = [
    // Top-left Google logo header. :not(#gb) keeps the account / Sign-in bar,
    // which is also a <header>, visible.
    "header:not(#gb)",
    // The "AI Mode / All / Images / Videos / News / More" search-vertical tab
    // strip. role="navigation" is unique to it here; the left history rail is
    // a plain <div>, so it survives.
    '[role="navigation"]',
  ].join(", ") + " { display: none !important; }";

  // The composer is the single visible <textarea> (its placeholder is
  // localized, so we match the tag, not the text).
  function visibleTextarea() {
    var list = document.querySelectorAll("textarea");
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) return list[i];
    }
    return null;
  }

  // Exposed so the native side can refocus the box when the window is summoned
  // (see lib.rs WindowEvent::Focused). No-op if the box isn't there yet.
  window.__aimodeFocusInput = function () {
    var ta = visibleTextarea();
    if (ta) {
      ta.focus();
      try {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (e) {}
    }
    return !!ta;
  };

  var didInitialFocus = false;

  function injectStyle() {
    if (document.getElementById("ai-mode-chrome")) return;
    var style = document.createElement("style");
    style.id = "ai-mode-chrome";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // Focus the box once, as soon as it exists, so the cursor is ready on open.
  function maybeInitialFocus() {
    if (!didInitialFocus && window.__aimodeFocusInput()) {
      didInitialFocus = true;
    }
  }

  function visibleNewThreadButton() {
    var list = document.querySelectorAll(
      'button[aria-label], button[title], [role="button"][aria-label], [role="button"][title]'
    );

    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent === null) continue;

      var label = list[i].getAttribute("aria-label") || list[i].getAttribute("title") || "";
      if (label.trim().toLowerCase() === "new thread") return list[i];
    }

    return null;
  }

  // App-local keyboard shortcuts. Capture phase so we win over Google's own
  // handlers. Add more cases here -- anything reachable via focus/click works
  // without native IPC.
  if (!window.__aimodeKeys) {
    window.__aimodeKeys = true;
    document.addEventListener(
      "keydown",
      function (e) {
        if (!e.metaKey || e.ctrlKey || e.altKey) return;
        var k = e.key.toLowerCase();
        if (k === "n" && !e.shiftKey) {
          // Cmd+N -> new chat via Google's own New thread button.
          e.preventDefault();
          var newThread = visibleNewThreadButton();
          if (newThread) newThread.click();
        }
      },
      true
    );
  }

  function tick() {
    injectStyle();
    maybeInitialFocus();
  }

  tick();

  // Google rehydrates the DOM after load, so re-apply whenever it mutates.
  new MutationObserver(tick).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
