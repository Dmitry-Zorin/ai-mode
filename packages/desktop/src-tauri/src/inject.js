// Injected at document-start on every navigation (see lib.rs INIT_SCRIPT).
// Hides Google's browser chrome so the window feels like a dedicated app.
//
// Selectors verified against the live AI Mode DOM (google.com/?udm=50) on
// 2026-06-15. AI Mode's top bar is built from semantic elements, not stable
// class names (Google's classes are obfuscated and change), so we target tags
// and ARIA roles. To re-tune: open devtools (right-click -> Inspect, enabled by
// the `devtools` Cargo feature), find the element, and prefer a tag/role/aria
// selector over a class. The AI Mode page has no <footer>, so none is hidden.
//
// Deliberately NOT hidden: the left "AI Mode history" rail (it has no nav role)
// and the empty top band that remains -- the band leaves room for the macOS
// overlay title bar (traffic lights / drag region; see TitleBarStyle::Overlay).
(function () {
  var css = [
    // Top-left Google logo header and the top-right account / apps-grid bar
    // (#gb) -- both are <header> elements.
    "header",
    "#gb",
    // The "AI Mode / All / Images / Videos / News / More" search-vertical tab
    // strip. role="navigation" is unique to it here; the left history rail is
    // a plain <div>, so it survives.
    '[role="navigation"]',
  ].join(", ") + " { display: none !important; }";

  function inject() {
    if (document.getElementById("ai-mode-chrome")) return;
    var style = document.createElement("style");
    style.id = "ai-mode-chrome";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  inject();

  // Google rehydrates the DOM after load, so re-apply whenever it mutates.
  new MutationObserver(inject).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
