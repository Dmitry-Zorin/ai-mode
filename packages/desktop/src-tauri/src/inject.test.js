import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

function runInject({ elements = [] } = {}) {
  const listeners = [];
  const context = {
    DOMException,
    MutationObserver: class {
      observe() {}
    },
    location: {
      hostname: "www.google.com",
      assignCalls: [],
      assign(url) {
        this.assignCalls.push(url);
      },
    },
    navigator: {},
    window: {},
    document: {
      documentElement: {},
      head: {
        children: [],
        appendChild(node) {
          this.children.push(node);
        },
      },
      addEventListener(type, handler, capture) {
        listeners.push({ type, handler, capture });
      },
      createElement(tagName) {
        return { tagName, textContent: "", id: "" };
      },
      getElementById() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === "textarea") return [];

        return elements.filter((element) => element.matches(selector));
      },
    },
  };
  context.window.window = context.window;

  new Script(readFileSync("packages/desktop/src-tauri/src/inject.js", "utf8")).runInContext(
    createContext(context)
  );

  return { context, listeners };
}

test("Cmd+N clicks the visible New thread button instead of navigating", () => {
  let clicks = 0;
  const newThreadButton = {
    offsetParent: {},
    click() {
      clicks += 1;
    },
    getAttribute(name) {
      return name === "aria-label" ? "New thread" : null;
    },
    matches(selector) {
      return selector.includes("button");
    },
  };

  const { context, listeners } = runInject({ elements: [newThreadButton] });
  const keydown = listeners.find((listener) => listener.type === "keydown");
  let prevented = false;

  keydown.handler({
    altKey: false,
    ctrlKey: false,
    key: "n",
    metaKey: true,
    preventDefault() {
      prevented = true;
    },
    shiftKey: false,
  });

  expect(prevented).toBe(true);
  expect(clicks).toBe(1);
  expect(context.location.assignCalls).toHaveLength(0);
});
