import {
  Bookmark,
  BOOKMARK_TAG,
  bookmarkPayload,
  latest,
  onPage,
  PageBox,
  step,
} from "../core/bookmarks";
import { getString } from "../utils/locale";

const s = (k: string, args?: Record<string, any>) =>
  getString(k as any, { args: args ?? {} });
const ref = () => addon.data.config.addonRef;
const pluginID = () => addon.data.config.addonID;
export const bookmarkIcon = () =>
  `chrome://${ref()}/content/icons/bookmark.svg`;

function toast(
  text: string,
  type: "success" | "default" | "error" = "default",
) {
  new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: 2500,
  })
    .createLine({ text, type, progress: 100 })
    .show();
}

/* ---------- reading ---------- */
function toBookmark(a: Zotero.Item): Bookmark | undefined {
  if (!a.isAnnotation() || a.annotationType !== "note") return;
  if (!a.hasTag(BOOKMARK_TAG)) return;
  try {
    const pos = JSON.parse(a.annotationPosition);
    return {
      id: a.id,
      attachmentID: a.parentItemID as number,
      pageIndex: Number(pos.pageIndex),
      pageLabel: a.annotationPageLabel,
      comment: a.annotationComment,
      modified: Date.parse(String(a.dateModified)) || 0,
    };
  } catch {
    return;
  }
}

export function bookmarksOf(attachment: Zotero.Item): Bookmark[] {
  try {
    return attachment
      .getAnnotations()
      .map(toBookmark)
      .filter((b): b is Bookmark => !!b);
  } catch {
    return [];
  }
}

/** across all of an item's PDFs */
export function bookmarksForItem(item: Zotero.Item): Bookmark[] {
  const out: Bookmark[] = [];
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item | false;
    if (a && a.isPDFAttachment()) out.push(...bookmarksOf(a));
  }
  return out;
}

/* ---------- the open PDF ---------- */
function pdfApp(reader: _ZoteroTypes.ReaderInstance): any {
  try {
    const view = (reader as any)._internalReader?._primaryView;
    return view?._iframeWindow?.wrappedJSObject?.PDFViewerApplication;
  } catch {
    return undefined;
  }
}
function pageBox(
  reader: _ZoteroTypes.ReaderInstance,
  i: number,
): PageBox | undefined {
  try {
    const v = pdfApp(reader)?.pdfViewer?.getPageView?.(i)?.pdfPage?.view;
    if (v && v[2] > 0 && v[3] > 0)
      return { width: v[2] - v[0], height: v[3] - v[1] };
  } catch {
    /* viewer internals changed: use the default page size */
  }
  return undefined;
}
const viewStats = (reader: _ZoteroTypes.ReaderInstance): any => {
  try {
    return (reader as any)._internalReader?._state?.primaryViewStats;
  } catch {
    return undefined;
  }
};
const isPage = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0;

/**
 * The page on screen. The viewer's own page number is live; the reader's stats and view state
 * are debounced copies. All are logged so a wrong page can be traced from the Debug Output.
 */
function pageOf(reader: _ZoteroTypes.ReaderInstance): number {
  let viewer: number | undefined;
  try {
    const n = Number(pdfApp(reader)?.pdfViewer?.currentPageNumber);
    viewer = Number.isFinite(n) ? n - 1 : undefined;
  } catch {
    /* viewer internals changed */
  }
  const stats = viewStats(reader)?.pageIndex;
  const view = (reader as any).getPrimaryViewState?.()?.pageIndex;
  const old = reader.state?.pageIndex;
  ztoolkit.log("bookmark: page sources", { viewer, stats, view, old });
  return [viewer, stats, view, old].find(isPage) ?? 0;
}

/** The page's own label (it can differ from the page number, e.g. a journal's 772 for page 1). */
function pageLabel(
  reader: _ZoteroTypes.ReaderInstance,
  i: number,
): string | undefined {
  try {
    const st = viewStats(reader);
    if (st?.pageIndex === i && st.pageLabel) return String(st.pageLabel);
    return pdfApp(reader)?.pdfViewer?._pageLabels?.[i] || undefined;
  } catch {
    return undefined;
  }
}

const attachmentOf = (reader: _ZoteroTypes.ReaderInstance) =>
  (reader as any)._item ??
  (reader.itemID
    ? (Zotero.Items.get(reader.itemID) as Zotero.Item)
    : undefined);

async function addBookmark(reader: _ZoteroTypes.ReaderInstance) {
  const att = attachmentOf(reader);
  if (!att?.isPDFAttachment()) return;
  if (!(Zotero.Libraries.get(att.libraryID) as any)?.editable)
    return toast(s("bookmark-readonly"), "error");
  const i = pageOf(reader);
  const label = pageLabel(reader, i) ?? String(i + 1);
  if (onPage(bookmarksOf(att), i))
    return toast(s("bookmark-exists", { page: label }));
  const json = bookmarkPayload({
    key: (Zotero as any).DataObjectUtilities.generateKey(),
    pageIndex: i,
    pageLabel: label,
    comment: s("bookmark-comment"),
    page: pageBox(reader, i),
  });
  const a = await Zotero.Annotations.saveFromJSON(att, json as any);
  a.addTag(BOOKMARK_TAG, 1);
  await a.saveTx();
  toast(s("bookmark-added", { page: label }), "success");
}

async function jump(reader: _ZoteroTypes.ReaderInstance, dir: 1 | -1) {
  const att = attachmentOf(reader);
  if (!att) return;
  const b = step(bookmarksOf(att), pageOf(reader), dir);
  if (!b) return toast(s("bookmark-none"));
  await reader.navigate({ pageIndex: b.pageIndex });
}

/** Open a PDF at a bookmark from outside the reader (item pane, item menu). */
export async function openBookmark(b: Bookmark) {
  await Zotero.getActiveZoteroPane()?.viewPDF(b.attachmentID, {
    pageIndex: b.pageIndex,
  });
}

export async function openLastBookmark(items: Zotero.Item[]) {
  for (const it of items) {
    const item = it.isRegularItem() ? it : it.parentItem;
    const b = item && latest(bookmarksForItem(item));
    if (b) return openBookmark(b);
  }
  toast(s("bookmark-none"));
}

/* ---------- reader UI ---------- */
const STYLE = `
.refwright-bookmark-btn { display: inline-flex; align-items: center; justify-content: center; }
.refwright-bookmark-btn:focus-visible { outline: 2px solid var(--accent-blue, #4072e5); outline-offset: -2px; }
.refwright-bookmark-btn svg { width: 16px; height: 16px; pointer-events: none; fill: currentColor; }
`;

/** Inline, because the reader is a content page that may not load a plugin's chrome:// files. */
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_PATH =
  "M4 1.5h8A1.5 1.5 0 0 1 13.5 3v11.2a.5.5 0 0 1-.8.4L8 11.1l-4.7 3.5a.5.5 0 0 1-.8-.4V3A1.5 1.5 0 0 1 4 1.5Z";
function icon(doc: Document) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATH);
  svg.append(path);
  return svg;
}

const styled = new WeakSet<Document>();
function button(doc: Document, reader: _ZoteroTypes.ReaderInstance) {
  if (!styled.has(doc)) {
    styled.add(doc);
    const st = doc.createElement("style");
    st.textContent = STYLE;
    (doc.head ?? doc.documentElement)?.append(st);
  }
  const b = doc.createElement("button");
  b.className = "toolbar-button toolbarButton refwright-bookmark-btn";
  b.title = s("bookmark-add");
  b.setAttribute("aria-label", s("bookmark-add"));
  b.tabIndex = -1;
  b.append(icon(doc));
  b.addEventListener("click", () => {
    ztoolkit.log("bookmark: click", reader.itemID, pageOf(reader));
    void run(() => addBookmark(reader));
  });
  return b;
}

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e: any) {
    Zotero.logError(e);
    toast(String(e?.message ?? e), "error");
  }
}

/** The reader may not know its type yet when the toolbar renders; only skip a known non-PDF. */
const maybePdf = (reader: _ZoteroTypes.ReaderInstance) => {
  const t = (reader as any).type ?? (reader as any)._type;
  return !t || t === "pdf";
};

const onToolbar: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> = ({
  reader,
  doc,
  append,
}) => {
  ztoolkit.log("bookmark: renderToolbar", reader.type, reader.itemID);
  if (maybePdf(reader)) append(button(doc, reader));
};
const onViewMenu: _ZoteroTypes.Reader.EventHandler<"createViewContextMenu"> = ({
  reader,
  append,
}) => {
  if (!maybePdf(reader)) return;
  append({
    label: s("bookmark-add"),
    onCommand: () => void run(() => addBookmark(reader)),
  });
  append({
    label: s("bookmark-next"),
    onCommand: () => void run(() => jump(reader, 1)),
  });
  append({
    label: s("bookmark-prev"),
    onCommand: () => void run(() => jump(reader, -1)),
  });
};

export function registerReaderHooks() {
  ztoolkit.log("bookmark: registering reader hooks");
  Zotero.Reader.registerEventListener("renderToolbar", onToolbar, pluginID());
  Zotero.Reader.registerEventListener(
    "createViewContextMenu",
    onViewMenu,
    pluginID(),
  );
}
export function unregisterReaderHooks() {
  Zotero.Reader.unregisterEventListener("renderToolbar", onToolbar);
  Zotero.Reader.unregisterEventListener("createViewContextMenu", onViewMenu);
}
