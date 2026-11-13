import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

/**
 * The plugin sandbox has no web APIs of its own, so borrow them from a window. The hidden DOM
 * window only exists on macOS (asking for it throws on Windows and Linux), so fall back to
 * Zotero's main window.
 */
let borrowed: any;
function webWindow(): any {
  if (borrowed && !borrowed.closed) return borrowed;
  const finders: (() => any)[] = [
    () => (Services as any).appShell.hiddenDOMWindow,
    () => Zotero.getMainWindow(),
    () => (Services as any).wm.getMostRecentWindow("navigator:browser"),
  ];
  for (const find of finders) {
    try {
      const w = find();
      if (w && !w.closed) return (borrowed = w);
    } catch {
      /* this platform has no such window; try the next */
    }
  }
  throw new Error("No window is available yet for web APIs");
}

function shimWebGlobals() {
  for (const name of [
    "AbortController",
    "AbortSignal",
    "URL",
    "TextDecoder",
    "TextEncoder",
    "setTimeout",
    "clearTimeout",
  ]) {
    Object.defineProperty(_globalThis, name, {
      configurable: true,
      get() {
        const w = webWindow();
        const v = w[name];
        return name.endsWith("Timeout") ? v.bind(w) : v;
      },
    });
  }
}
shimWebGlobals();

// @ts-expect-error - Plugin instance is not typed
if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  // @ts-expect-error - Plugin instance is not typed
  Zotero[config.addonInstance] = addon;
}

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
