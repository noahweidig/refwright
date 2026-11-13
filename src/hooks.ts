import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { loadState, flushState } from "./zotero/state";
import {
  injectStyles,
  registerColumn,
  registerCitedColumn,
  registerMenus,
  registerPrefs,
} from "./zotero/ui";
import { registerSections } from "./zotero/sections";
import { registerEndpoints } from "./zotero/writeback";
import { invalidateRouter, warmRouter } from "./zotero/routing";

let notifierID: string | undefined;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  await loadState();
  registerPrefs();
  registerEndpoints();
  await registerColumn();
  await registerCitedColumn();
  registerSections();
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: async (event: string, type: string) => {
        if (!addon?.data.alive) return;
        if (
          ["item", "collection", "collection-item", "item-tag"].includes(
            type,
          ) ||
          type === "tag"
        )
          invalidateRouter();
        void event;
      },
    },
    ["item", "collection", "collection-item", "item-tag", "tag"],
    "refwright",
  );
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  addon.data.initialized = true;
  Zotero.Promise.delay(8000).then(() => {
    if (addon?.data.alive) void warmRouter();
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  injectStyles(win);
  if (!addon.data.menusRegistered) {
    registerMenus();
    addon.data.menusRegistered = true;
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  /* menus, columns and sections are removed by pluginID on shutdown */
}

async function onShutdown() {
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  await flushState();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") registerPrefsScripts(data.window);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
