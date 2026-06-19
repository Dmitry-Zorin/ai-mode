// Injected at document-start on every navigation into the Google AI Mode
// webview (see lib.rs INIT_SCRIPT). Web-layer only -- it never needs Tauri IPC,
// and Tauri deliberately does not expose IPC to this remote page. Three jobs:
//
//   1. Hide Google's browser chrome so the window reads as a dedicated app.
//   2. Auto-focus the composer once it appears (and expose a hook so the native
//      side can re-focus it when the window is summoned).
//   3. Keep Google sign-in away from the WebAuthn/passkey step that WKWebView
//      cannot complete -- the "sign-in hack", carried over verbatim.
//
// Keyboard shortcuts and zoom are handled natively (menu accelerators + the
// WKWebView page zoom driven from Rust), so there is no key handling here.
//
// AI Mode's DOM uses obfuscated, unstable class names, so selectors target tags
// and ARIA roles. To re-tune: right-click -> Inspect (the `devtools` Cargo
// feature is on) and prefer a tag/role/aria selector over a class.
(function () {
  // --- sign-in hack ---------------------------------------------------------
  // Google offers a passkey/WebAuthn step during sign-in/reauth. WKWebView has
  // no platform authenticator it can drive here, so the step dead-ends and
  // Google can escalate to a hard block. Hide WebAuthn on accounts.google.com
  // so Google never offers it and falls back to password / other methods.
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
              new DOMException(
                "Passkeys are disabled in AI Mode.",
                "NotSupportedError",
              ),
            );
          }
          if (get) return get(options);
          return Promise.reject(
            new DOMException(
              "Credential Management is unavailable.",
              "NotSupportedError",
            ),
          );
        },
      });
    } catch (e) {}
  }

  disableBrokenPasskeyFlow();

  // --- hide chrome ----------------------------------------------------------
  // display:none (not visibility:hidden) so hidden elements collapse with no
  // empty band. We KEEP (not hide): the Google logo and the active "AI Mode"
  // tab -- both rewired below to reload instead of navigating -- and the account
  // avatar. We hide:
  //   - the other search-vertical tabs. Each is a [role=listitem]: All/Images/
  //     Videos/News hold a real-href link, "More" holds a [role=button]. The
  //     active AI Mode tab holds neither (or only an empty-href <a> on thread
  //     pages), so the :not([href=""]) guard keeps it.
  //   - #gbwa, the Google-apps waffle (the avatar beside it stays for sign-in/out).
  var CSS =
    [
      '[role="navigation"] [role="listitem"]:has(a[href]:not([href=""]))',
      '[role="navigation"] [role="listitem"]:has([role="button"])',
      "#gbwa",
    ].join(", ") + " { display: none !important; }";

  function injectStyle() {
    if (document.getElementById("ai-mode-chrome")) return;
    var style = document.createElement("style");
    style.id = "ai-mode-chrome";
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // --- composer focus -------------------------------------------------------
  // The composer is the single visible input -- today a <textarea> (its
  // placeholder is localized, so match the tag, not the text). Try the textarea
  // first so current behavior is unchanged, then fall back to a contenteditable
  // / role=textbox so a future composer redesign still focuses instead of
  // silently no-op'ing.
  function visibleComposer() {
    var selectors = ["textarea", '[contenteditable="true"]', '[role="textbox"]'];
    for (var s = 0; s < selectors.length; s++) {
      var list = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < list.length; i++) {
        if (list[i].offsetParent !== null) return list[i];
      }
    }
    return null;
  }

  // Exposed so the native side can refocus the box when the window is summoned
  // (see lib.rs WindowEvent::Focused). No-op if the box isn't there yet.
  window.__aimodeFocusInput = function () {
    var el = visibleComposer();
    if (el) {
      el.focus();
      // setSelectionRange/value exist on <textarea> only; skip for contenteditable.
      try {
        if (typeof el.setSelectionRange === "function") {
          el.setSelectionRange(el.value.length, el.value.length);
        }
      } catch (e) {}
    }
    return !!el;
  };

  // Exposed so the native side can drop a canned prompt into the composer and
  // send it in one shot (see lib.rs fact_check). The composer is React-
  // controlled, so a plain `ta.value = text` is silently reverted on the next
  // render -- we must go through the prototype's native value setter and fire a
  // bubbling "input" event so React's onChange commits the new value to state.
  // Submitting is then a synthetic Enter sequence (AI Mode's composer sends on
  // Enter), deferred a tick so React has committed the value the handler reads.
  //
  // A short cooldown swallows an accidental double-fire -- a double-click, or
  // the prompt being triggered again before the first submit has landed -- so
  // the canned prompt isn't sent twice back-to-back.
  var lastSendAt = 0;
  window.__aimodeSendPrompt = function (text) {
    var el = visibleComposer();
    if (!el) {
      // Match the loud-failure convention the other hooks follow (NEW_THREAD_JS,
      // selfCheck): a missing composer means either the visibleComposer()
      // selectors went stale or there's simply no composer on this page (e.g.
      // sign-in). Warn so it surfaces as a greppable "[AI Mode]" message in
      // devtools instead of the header button silently doing nothing.
      console.warn(
        "[AI Mode] Fact-check: composer not found -- visibleComposer() " +
          "selectors in inject.js may be stale, or there is no composer on " +
          "this page (e.g. sign-in).",
      );
      return false;
    }
    // Cooldown check sits after the composer lookup so a stale-selector miss
    // still warns every time, and a failed attempt never starts the cooldown.
    var now = Date.now();
    if (now - lastSendAt < 1000) return false;
    lastSendAt = now;
    el.focus();
    if (el.tagName === "TEXTAREA") {
      // React-controlled <textarea>: go through the prototype's native value
      // setter and fire a bubbling "input" so React commits the new value.
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        el.setSelectionRange(text.length, text.length);
      } catch (e) {}
    } else {
      // contenteditable composer: insertText keeps the framework's input
      // handler, selection and undo stack sane; fall back to textContent.
      try {
        document.execCommand("insertText", false, text);
      } catch (e) {
        el.textContent = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    setTimeout(function () {
      ["keydown", "keypress", "keyup"].forEach(function (type) {
        el.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }, 0);
    return true;
  };

  var didInitialFocus = false;

  function tick() {
    injectStyle();
    // Focus the box once, as soon as it exists, so the cursor is ready on open.
    if (!didInitialFocus && window.__aimodeFocusInput()) {
      didInitialFocus = true;
    }
  }

  tick();

  // Google rehydrates the DOM after load, so re-apply whenever it mutates.
  new MutationObserver(tick).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // --- logo / AI Mode tab -> reload ----------------------------------------
  // Left alone, the Google logo navigates to the Google home page (leaving AI
  // Mode), and the active "AI Mode" tab is a dead/empty-href label. Make both
  // reload the current page instead. One capture-phase delegated listener
  // survives Google's DOM rehydration, so it never needs re-binding.
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // The Google logo: the only link inside the non-account header.
      if (t.closest("header:not(#gb) a")) {
        e.preventDefault();
        e.stopPropagation();
        location.reload();
        return;
      }
      // The active "AI Mode" tab: a [role=listitem] with no real-href link and
      // no button (mirrors the keep-condition in the hide CSS above).
      var item = t.closest('[role="navigation"] [role="listitem"]');
      if (
        item &&
        !item.querySelector('a[href]:not([href=""])') &&
        !item.querySelector('[role="button"]')
      ) {
        e.preventDefault();
        e.stopPropagation();
        location.reload();
      }
    },
    true,
  );

  // --- self-check -----------------------------------------------------------
  // Every selector above is a bet against Google's obfuscated, server-driven
  // DOM; when Google reshapes the page they stop matching SILENTLY -- the chrome
  // reappears, focus stops working, no error anywhere. Once the page has had
  // time to hydrate, verify each anchor still matches and warn loudly (devtools
  // is on) so a stale hook surfaces as a greppable "[AI Mode]" message. Scoped
  // to the AI Mode surface only -- sign-in (accounts.google.com) has neither the
  // chrome nor the composer, so checking there would only cry wolf.
  function selfCheck() {
    if (location.hostname !== "www.google.com") return;
    var problems = [];
    if (!document.querySelector("header:not(#gb) a")) {
      problems.push(
        "Google logo link not found -- header changed (logo reload hook stale)",
      );
    }
    if (!document.querySelector('[role="navigation"] [role="listitem"]')) {
      problems.push(
        "search-vertical tabs not found -- the tab-hiding selectors are stale",
      );
    }
    if (!visibleComposer()) {
      problems.push(
        "composer not found -- focus + New Thread hooks may be stale",
      );
    }
    if (problems.length) {
      console.warn(
        "[AI Mode] DOM self-check found stale hooks:\n  - " +
          problems.join("\n  - ") +
          "\nRe-tune the selectors in inject.js (right-click -> Inspect).",
      );
    }
  }

  // One-shot, after Google has had a few seconds to finish hydrating.
  setTimeout(selfCheck, 4000);
})();
