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
function pageLabel(
  reader: _ZoteroTypes.ReaderInstance,
  i: number,
): string | undefined {
  try {
    return pdfApp(reader)?.pdfViewer?._pageLabels?.[i] || undefined;
  } catch {
    return undefined;
  }
}

const attachmentOf = (reader: _ZoteroTypes.ReaderInstance) =>
  reader.itemID ? (Zotero.Items.get(reader.itemID) as Zotero.Item) : undefined;
const pageOf = (reader: _ZoteroTypes.ReaderInstance) =>
  Number(reader.state?.pageIndex) || 0;

async function addBookmark(reader: _ZoteroTypes.ReaderInstance) {
  const att = attachmentOf(reader);
  if (!att || reader.type !== "pdf") return;
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
.refwright-bookmark-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: inherit; cursor: default;
}
.refwright-bookmark-btn:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
.refwright-bookmark-btn:active { background: color-mix(in srgb, currentColor 20%, transparent); }
.refwright-bookmark-btn:focus-visible { outline: 2px solid var(--accent-blue, #4072e5); outline-offset: -2px; }
.refwright-bookmark-btn img {
  width: 16px; height: 16px; pointer-events: none;
  -moz-context-properties: fill, fill-opacity; fill: currentColor; fill-opacity: .8;
}`;

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
  const img = doc.createElement("img");
  img.src = bookmarkIcon();
  img.alt = "";
  b.append(img);
  b.addEventListener("click", () => void run(() => addBookmark(reader)));
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

const onToolbar: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> = ({
  reader,
  doc,
  append,
}) => {
  if (reader.type === "pdf") append(button(doc, reader));
};
const onViewMenu: _ZoteroTypes.Reader.EventHandler<"createViewContextMenu"> = ({
  reader,
  append,
}) => {
  if (reader.type !== "pdf") return;
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
