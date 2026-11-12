import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

/**
 * The plugin sandbox has no web APIs of its own. Borrow them from the hidden
 * DOM window, which always exists, so every module can use them normally.
 */
function shimWebGlobals() {
  const win = () => (Services as any).appShell.hiddenDOMWindow as any;
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
        const v = win()[name];
        return name.endsWith("Timeout") ? v.bind(win()) : v;
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
