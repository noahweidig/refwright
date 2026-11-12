import { STATUS_TAGS as T } from "../core/tags";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import * as A from "./actions";
import { S } from "./state";

const NS = "http://www.w3.org/1999/xhtml";
const ref = () => addon.data.config.addonRef;
const icon = (n = "refwright.svg") => `chrome://${ref()}/content/icons/${n}`;
const pluginID = () => addon.data.config.addonID;

type Doc = Document;
function el(doc: Doc, tag: string, cls = "", text = ""): HTMLElement {
  const e = doc.createElementNS(NS, tag) as HTMLElement;
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/* ---------- status derivation, shared by column and item pane ---------- */
export type Flag = "retracted" | "check" | "pdf" | "nopdf" | "";

export function flagOf(item: Zotero.Item): Flag {
  if (!item.isRegularItem()) return "";
  if (item.hasTag(T.retracted)) return "retracted";
  if (
    item.hasTag(T.pdfCheck) ||
    item.hasTag(T.retractionCheck) ||
    item.hasTag(T.citeMismatch)
  )
    return "check";
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item;
    if (a && a.isPDFAttachment()) {
      return "pdf";
    }
  }
  return "nopdf";
}

export async function registerColumn() {
  if (!getPref("ui.column")) return;
  await Zotero.ItemTreeManager.registerColumns({
    pluginID: pluginID(),
    dataKey: "refwright",
    label: "refwright",
    iconPath: icon(),
    flex: 0,
    width: "86",
    staticWidth: false,
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item) => {
      const f = flagOf(item);
      return f
        ? getString(("column-" + (f === "nopdf" ? "no-pdf" : f)) as any)
        : "";
    },
    renderCell: (_i, data, column, _first, doc) => {
      const f =
        Object.entries({
          [getString("column-retracted")]: "bad",
          [getString("column-check")]: "warn",
          [getString("column-pdf")]: "ok",
          [getString("column-no-pdf")]: "ok",
        }).find(([k]) => k === data)?.[1] ?? "";
      const span = doc.createElement("span");
      span.className = `cell ${column.className}`;
      if (data) {
        const inner = doc.createElement("span");
        inner.className = `refwright-cell ${f}`;
        inner.textContent = data;
        span.append(inner);
      }
      return span;
    },
  });
}

/* ---------- menus ---------- */
export function registerMenus() {
  const I = icon("refwright-menu.svg");
  const D = icon("refwright-menu-dark.svg");
  const items = () => A.selected();
  Zotero.MenuManager.registerMenu({
    menuID: `${ref()}-item`,
    pluginID: pluginID(),
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-root"),
        icon: I,
        darkIcon: D,
        menus: [
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-find-pdfs"),
            onCommand: () => A.runTask("pdf", items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-preview"),
            onCommand: () => A.runTask("preview", items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-retractions"),
            onCommand: () => A.runTask("retraction", items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-citations"),
            onCommand: () => A.runTask("citation", items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-full-check"),
            onCommand: () => A.runTask("full", items()),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-suggest-tags"),
            onCommand: () => A.suggestTagsAction(items(), false),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-suggest-tags-ai"),
            onCommand: () => A.suggestTagsAction(items(), true),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-file"),
            onCommand: () => A.fileAction(items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-undo-filing"),
            onShowing: (_e: Event, ctx: any) => ctx.setVisible(!!S().filing),
            onCommand: () => A.undoFilingAction(),
          },
        ],
      },
    ],
  } as any);
  Zotero.MenuManager.registerMenu({
    menuID: `${ref()}-collection`,
    pluginID: pluginID(),
    target: "main/library/collection",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menu-collection-tag"),
        icon: I,
        darkIcon: D,
        onCommand: () => A.collectionTagAction(),
      },
    ],
  } as any);
  Zotero.MenuManager.registerMenu({
    menuID: `${ref()}-tools`,
    pluginID: pluginID(),
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-root"),
        icon: I,
        darkIcon: D,
        menus: [
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-find-tagged"),
            onCommand: () => A.runTagged("pdf"),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-retract-tagged"),
            onCommand: () => A.runTagged("retraction"),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-cite-tagged"),
            onCommand: () => A.runTagged("citation"),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-tag-manager"),
            onCommand: () => A.openTagManager(),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-export-missing"),
            onCommand: () => A.exportMissing(items()),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-audit"),
            onCommand: () => A.showAudit(),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tools-settings"),
            onCommand: () =>
              Zotero.Utilities.Internal.openPreferences(`${ref()}`),
          },
        ],
      },
    ],
  } as any);
}

export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: pluginID(),
    id: ref(),
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: icon(),
    helpURL: addon.data.config.addonRef
      ? "https://github.com/noahweidig/refwright#readme"
      : undefined,
  } as any);
}

export function injectStyles(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  if (doc.getElementById(`${ref()}-css`)) return;
  const link = doc.createElement("link");
  link.id = `${ref()}-css`;
  link.rel = "stylesheet";
  link.href = `chrome://${ref()}/content/refwright.css`;
  doc.documentElement?.appendChild(link);
}
