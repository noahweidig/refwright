import { STATUS_TAGS as T } from "../core/tags";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import * as A from "./actions";
import { hasUsablePdf } from "./library";
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

/* ---------- item pane ---------- */
export function registerSection() {
  if (!getPref("ui.itemSection")) return;
  Zotero.ItemPaneManager.registerSection({
    paneID: "refwright",
    pluginID: pluginID(),
    header: { l10nID: getLocaleID("section-header"), icon: icon() },
    sidenav: {
      l10nID: getLocaleID("section-sidenav"),
      icon: icon("refwright-20.svg"),
    },
    onItemChange: ({ item, setEnabled }) => {
      setEnabled(!!item?.isRegularItem());
      return true;
    },
    onRender: ({ body, item }) => draw(body, item, undefined),
    onAsyncRender: async ({ body, item }) =>
      draw(body, item, await hasUsablePdf(item)),
  });
}

function draw(body: HTMLElement, item: Zotero.Item, pdf: boolean | undefined) {
  const doc = body.ownerDocument!;
  const wrap = el(doc, "div", "refwright-pane");
  const row = (
    label: string,
    state: "" | "bad" | "warn",
    text: string,
    btn?: [string, () => void],
    icn?: string,
  ) => {
    const r = el(doc, "div", "refwright-row");
    r.append(el(doc, "span", "k", label));
    const v = el(doc, "span", `v ${state}`);
    if (icn) {
      const i = el(doc, "span", "refwright-icon red");
      i.style.backgroundImage = `url(${icn})`;
      v.append(i);
    }
    v.append(el(doc, "span", "t", text));
    r.append(v);
    if (btn) {
      const b = el(doc, "button", "", btn[0]);
      b.addEventListener("click", btn[1]);
      r.append(b);
    } else r.append(el(doc, "span"));
    wrap.append(r);
  };
  const has = (t: string) => item.hasTag(t);
  const pdfText =
    pdf === undefined
      ? "…"
      : has(T.pdfCheck)
        ? getString("column-check")
        : pdf
          ? getString("column-pdf")
          : has(T.pdfMissing)
            ? getString("status-pdf-missing")
            : getString("column-no-pdf");
  row(
    getString("section-row-fulltext"),
    has(T.pdfCheck) ? "warn" : "",
    pdfText,
    [getString("menu-find-pdfs"), () => A.runTask("pdf", [item])],
  );
  const ret = has(T.retracted)
    ? ["bad", getString("column-retracted")]
    : has(T.notRetracted)
      ? ["", getString("status-not-retracted")]
      : has(T.retractionCheck)
        ? ["warn", getString("status-retraction-check")]
        : ["", "—"];
  row(
    getString("section-row-integrity"),
    ret[0] as any,
    ret[1],
    [getString("menu-full-check"), () => A.runTask("full", [item])],
    has(T.retracted)
      ? "chrome://zotero/skin/16/universal/retracted.svg"
      : undefined,
  );
  const cite = has(T.citeOk)
    ? ["", getString("status-cite-ok")]
    : has(T.citeIncomplete)
      ? [
          "warn",
          getString("status-cite-incomplete", { args: { fields: "" } }).replace(
            /:\s*$/,
            "",
          ),
        ]
      : has(T.citeMismatch)
        ? [
            "warn",
            getString("status-cite-mismatch", { args: { fields: "" } }).replace(
              /:\s*$/,
              "",
            ),
          ]
        : has(T.citeCheck)
          ? ["warn", getString("status-cite-check")]
          : ["", "—"];
  row("", cite[0] as any, cite[1]);
  const n = item
    .getTags()
    .filter(
      (t) => !/^(fulltext|retraction|citation|refwright):/i.test(t.tag),
    ).length;
  row(getString("section-row-tags"), "", String(n), [
    getString("section-suggest"),
    () => A.suggestTagsAction([item], false),
  ]);
  const c = item.getCollections().length;
  row(getString("section-row-collections"), "", String(c), [
    getString("section-file"),
    () => A.fileAction([item]),
  ]);
  body.replaceChildren(wrap);
}

/* ---------- menus ---------- */
export function registerMenus() {
  const I = icon();
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
