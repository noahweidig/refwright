import { STATUS_TAGS as T, isReserved } from "../core/tags";
import { learnFromEdit } from "../core/learning";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import * as A from "./actions";
import { guard } from "./guard";
import { hasUsablePdf } from "./library";
import { invalidateRouter, routeItems, ItemRoute } from "./routing";
import { S, saveState } from "./state";
import { suggestTags, TagChoice } from "./tagging";
import { linkAllRelated, linkRelated, relatedFor, RelatedHit } from "./related";

const NS = "http://www.w3.org/1999/xhtml";
const ref = () => addon.data.config.addonRef;
/** Zotero's own icons: themed by Zotero itself, identical to the rest of the UI */
const Z = (n: string) =>
  n.startsWith("chrome://") ? n : `chrome://zotero/skin/16/universal/${n}.svg`;

type Kids = (Node | string | null | false | undefined)[];
function el(doc: Document, tag: string, cls = "", ...kids: Kids): HTMLElement {
  const e = doc.createElementNS(NS, tag) as HTMLElement;
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}
function glyph(doc: Document, name: string, cls = ""): HTMLElement {
  const i = el(doc, "span", `refwright-glyph ${cls}`);
  i.style.backgroundImage = `url(${Z(name)})`;
  return i;
}
function button(
  doc: Document,
  label: string,
  onClick: () => void,
  opts: { glyph?: string; title?: string } = {},
) {
  const b = el(doc, "button", "refwright-btn");
  if (opts.glyph) b.append(glyph(doc, opts.glyph));
  b.append(label);
  if (opts.title) b.title = opts.title;
  b.addEventListener("click", guard(onClick));
  return b;
}
function chip(
  doc: Document,
  text: string,
  o: {
    dot?: string;
    title?: string;
    onClick?: () => void;
    onRemove?: () => void;
    muted?: boolean;
    plus?: boolean;
  },
) {
  const c = el(
    doc,
    "span",
    `refwright-chip${o.onClick ? " action" : ""}${o.muted ? " muted" : ""}`,
  );
  if (o.title) c.title = o.title;
  if (o.dot) c.append(el(doc, "span", `refwright-dot ${o.dot}`));
  if (o.plus) c.append(el(doc, "span", "plus", "+"));
  c.append(el(doc, "span", "label", text));
  if (o.onClick) {
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    const go = guard(o.onClick);
    c.addEventListener("click", go);
    c.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  }
  if (o.onRemove) {
    const x = el(doc, "button", "refwright-x", "×");
    x.title = "Reject";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      guard(o.onRemove!)();
    });
    c.append(x);
  }
  return c;
}
const card = (doc: Document, ...kids: Kids) =>
  el(doc, "div", "refwright-card", ...kids);
const row = (doc: Document, cls: string, ...kids: Kids) =>
  el(doc, "div", `refwright-line ${cls}`, ...kids);

const hostOf = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/* ============================ PDFs ============================ */
async function drawPdf(body: HTMLElement, item: Zotero.Item, pdf?: boolean) {
  const doc = body.ownerDocument!;
  const has = (t: string) => item.hasTag(t);
  let host = "";
  if (pdf) {
    for (const id of item.getAttachments()) {
      const a = Zotero.Items.get(id) as Zotero.Item;
      if (a && a.isPDFAttachment()) {
        host = hostOf(String(a.getField("url") || ""));
        break;
      }
    }
  }
  const state = has(T.retracted)
    ? "bad"
    : has(T.pdfCheck)
      ? "warn"
      : pdf
        ? "good"
        : "";
  const headline =
    pdf === undefined
      ? getString("pdf-working")
      : pdf
        ? getString("pdf-has")
        : getString("pdf-none");
  const sub = has(T.pdfCheck)
    ? getString("pdf-check-sub")
    : pdf
      ? host
        ? getString("pdf-from", { args: { host } })
        : ""
      : has(T.pdfMissing)
        ? getString("pdf-missing-sub")
        : "";
  const hero = row(
    doc,
    `hero ${state}`,
    el(
      doc,
      "div",
      "text",
      el(doc, "div", "title", headline),
      sub && el(doc, "div", "sub", sub),
    ),
  );

  const badges = row(doc, "badges");
  const badge = (text: string, kind: string) =>
    el(doc, "span", `refwright-badge ${kind}`, text);
  badges.append(
    has(T.retracted)
      ? badge(getString("badge-retracted"), "bad")
      : has(T.notRetracted)
        ? badge(getString("badge-not-retracted"), "good")
        : badge(
            getString("badge-retraction-check"),
            has(T.retractionCheck) ? "warn" : "idle",
          ),
    has(T.citeOk)
      ? badge(getString("badge-cite-ok"), "good")
      : has(T.citeIncomplete)
        ? badge(getString("badge-cite-incomplete"), "warn")
        : has(T.citeMismatch)
          ? badge(getString("badge-cite-mismatch"), "bad")
          : badge(
              getString("badge-cite-check"),
              has(T.citeCheck) ? "warn" : "idle",
            ),
  );
  const actions = row(
    doc,
    "actions",
    button(doc, getString("btn-find-pdf"), () => A.runTask("pdf", [item]), {
      glyph: "attachment",
    }),
    button(doc, getString("btn-preview"), () => A.runTask("preview", [item])),
    button(doc, getString("btn-full-check"), () => A.runTask("full", [item])),
  );
  body.replaceChildren(el(doc, "div", "refwright-pane", hero, badges, actions));
}

/* ============================ Tags ============================ */
const tagState = new WeakMap<
  HTMLElement,
  { busy: boolean; list: TagChoice[] | null }
>();

function userTagCount(item: Zotero.Item) {
  return item.getTags().filter((t) => !isReserved(t.tag)).length;
}

async function addTag(item: Zotero.Item, tag: string) {
  if (!item.hasTag(tag)) {
    item.addTag(tag, getPref("tag.automatic" as any) ? 1 : 0);
    await item.saveTx();
  }
}

function drawTags(body: HTMLElement, item: Zotero.Item) {
  const doc = body.ownerDocument!;
  const st = tagState.get(body) ?? { busy: false, list: null };
  tagState.set(body, st);
  const redraw = () => drawTags(body, item);

  const head = row(
    doc,
    "summary",
    el(
      doc,
      "div",
      "text",
      el(
        doc,
        "div",
        "title",
        getString("tags-count", { args: { count: userTagCount(item) } }),
      ),
      el(
        doc,
        "div",
        "sub",
        st.busy
          ? getString("tags-looking")
          : st.list
            ? ""
            : getString("tags-hint"),
      ),
    ),
  );

  const run = async (ai: boolean) => {
    st.busy = true;
    redraw();
    try {
      const res = await suggestTags(
        [item],
        ai ? "ai" : "free",
        () => {},
        new AbortController().signal,
      );
      st.list = (res[0]?.tags ?? []).map((t) => ({ ...t }));
    } finally {
      st.busy = false;
      redraw();
    }
  };
  const actions = row(
    doc,
    "actions",
    button(doc, getString("btn-suggest"), () => run(false), {
      glyph: "tag",
    }),
    button(doc, getString("btn-suggest-ai"), () => run(true)),
    button(doc, getString("btn-review"), () =>
      A.suggestTagsAction([item], false),
    ),
  );

  const kids: Kids = [head, actions];
  if (st.list) {
    const area = row(doc, "chips");
    if (!st.list.length)
      area.append(el(doc, "span", "refwright-muted", getString("tags-none")));
    for (const t of st.list) {
      area.append(
        chip(doc, t.tag, {
          plus: true,
          title: t.source,
          onClick: async () => {
            await addTag(item, t.tag);
            st.list = st.list!.filter((x) => x !== t);
            redraw();
          },
          onRemove: () => {
            S().learned = learnFromEdit(S().learned, [t.tag], []);
            saveState();
            st.list = st.list!.filter((x) => x !== t);
            redraw();
          },
        }),
      );
    }
    kids.push(area);
    if (st.list.length) {
      kids.push(
        row(
          doc,
          "actions",
          button(doc, getString("btn-add-all"), async () => {
            for (const t of st.list!)
              if (!item.hasTag(t.tag))
                item.addTag(t.tag, getPref("tag.automatic" as any) ? 1 : 0);
            await item.saveTx();
            st.list = [];
            redraw();
          }),
          button(doc, getString("btn-dismiss"), () => {
            st.list = null;
            redraw();
          }),
        ),
      );
    }
  }
  body.replaceChildren(el(doc, "div", "refwright-pane", ...kids));
}

/* ========================= Related ========================= */
const relState = new WeakMap<
  HTMLElement,
  { busy: string; list: RelatedHit[] | null; err?: string; note?: string }
>();

function drawRelated(body: HTMLElement, item: Zotero.Item) {
  const doc = body.ownerDocument!;
  const st = relState.get(body) ?? { busy: "", list: null };
  relState.set(body, st);
  const redraw = () => drawRelated(body, item);
  const head = row(
    doc,
    "summary",
    el(
      doc,
      "div",
      "text",
      el(
        doc,
        "div",
        "title",
        getString("related-count", {
          args: { count: item.relatedItems.length },
        }),
      ),
      el(
        doc,
        "div",
        "sub",
        st.err ??
          (st.busy || st.note || (st.list ? "" : getString("related-hint"))),
      ),
    ),
  );
  const run = async () => {
    st.busy = getString("related-looking", { args: { done: 0, total: 0 } });
    st.err = undefined;
    redraw();
    try {
      const r = await relatedFor(item, new AbortController().signal, (d, t) => {
        st.busy = getString("related-looking", { args: { done: d, total: t } });
        redraw();
      });
      st.list = r.hits;
      st.note = r.note;
    } catch (e: any) {
      st.err = String(e?.message ?? e);
    } finally {
      st.busy = "";
      redraw();
    }
  };
  const kids: Kids = [
    head,
    row(
      doc,
      "actions",
      button(doc, getString("related-find"), run, { glyph: "related" }),
    ),
  ];
  if (st.list) {
    const area = row(doc, "chips");
    if (!st.list.length)
      area.append(
        el(doc, "span", "refwright-muted", getString("related-none")),
      );
    for (const h of st.list) {
      area.append(
        chip(doc, (h.item.getField("title") as string) || "(untitled)", {
          plus: true,
          title: `${Math.round(h.score * 100)}%`,
          onClick: async () => {
            await linkRelated(item, h.item);
            st.list = st.list!.filter((x) => x !== h);
            redraw();
          },
        }),
      );
    }
    kids.push(area);
    if (st.list.length)
      kids.push(
        row(
          doc,
          "actions",
          button(doc, getString("related-add-all"), async () => {
            await linkAllRelated(
              item,
              st.list!.map((h) => h.item),
            );
            st.list = [];
            redraw();
          }),
          button(doc, getString("btn-dismiss"), () => {
            st.list = null;
            redraw();
          }),
        ),
      );
  }
  body.replaceChildren(el(doc, "div", "refwright-pane", ...kids));
}

/* ========================= Collections ========================= */
const collState = new WeakMap<
  HTMLElement,
  { busy: boolean; route: ItemRoute | null; last?: string }
>();

async function fileInto(item: Zotero.Item, id: number) {
  if (item.inCollection(id)) return;
  item.addToCollection(id);
  await item.saveTx();
  S().filing = {
    kind: "filing",
    at: Date.now(),
    added: [{ itemID: item.id, collectionID: id }],
    removed: [],
  };
  saveState();
  invalidateRouter();
}

function drawColl(body: HTMLElement, item: Zotero.Item) {
  const doc = body.ownerDocument!;
  const st = collState.get(body) ?? { busy: false, route: null };
  collState.set(body, st);
  const redraw = () => drawColl(body, item);
  const names = (id: number) =>
    (Zotero.Collections.get(id) as Zotero.Collection | false) || null;

  const mine = item.getCollections();
  const head = row(
    doc,
    "summary",
    el(
      doc,
      "div",
      "text",
      el(
        doc,
        "div",
        "title",
        getString("route-filed", { args: { count: mine.length } })
          .replace(/^Filed /, "In ")
          .replace(
            / items?$/,
            mine.length === 1 ? " collection" : " collections",
          ),
      ),
      el(
        doc,
        "div",
        "sub",
        st.busy
          ? getString("coll-working")
          : (st.last ?? (st.route ? "" : getString("coll-hint"))),
      ),
    ),
  );
  const kids: Kids = [head];

  if (mine.length) {
    const inRow = row(doc, "chips");
    for (const id of mine) {
      const c = names(id);
      if (c)
        inRow.append(
          chip(doc, c.name, {
            dot: "in",
            title: getString("coll-in"),
            onClick: () =>
              (
                Zotero.getActiveZoteroPane() as any
              )?.collectionsView?.selectByID?.(c.treeViewID ?? "C" + c.id),
          }),
        );
    }
    kids.push(inRow);
  }
  if (st.route) {
    const fresh = st.route.choices
      .filter((c) => !mine.includes(c.id))
      .slice(0, 6);
    kids.push(el(doc, "div", "refwright-sub-h", getString("coll-best")));
    const area = row(doc, "chips");
    if (!fresh.length)
      area.append(el(doc, "span", "refwright-muted", getString("tags-none")));
    for (const c of fresh)
      area.append(
        chip(doc, c.name, {
          dot: c.confidence,
          plus: true,
          title: [
            c.path,
            c.why.words.length ? c.why.words.join(", ") : "",
            `${c.score.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join("\n"),
          onClick: async () => {
            await fileInto(item, c.id);
            st.last = getString("coll-filed", { args: { name: c.name } });
            redraw();
          },
        }),
      );
    kids.push(area);
  }
  const run = async () => {
    st.busy = true;
    redraw();
    try {
      const r = await routeItems([item]);
      st.route = r.routes[0] ?? null;
      st.last = undefined;
    } finally {
      st.busy = false;
      redraw();
    }
  };
  kids.push(
    row(
      doc,
      "actions",
      button(doc, getString("btn-suggest"), run, {
        glyph: "new-collection",
      }),
      button(doc, getString("btn-review"), () => A.fileAction([item])),
      S().filing &&
        button(doc, getString("btn-undo"), async () => {
          await A.undoFilingAction();
          st.last = undefined;
          redraw();
        }),
    ),
  );
  body.replaceChildren(el(doc, "div", "refwright-pane", ...kids));
  // offline ranking is cheap: rank once when the section first shows
  if (
    !st.route &&
    !st.busy &&
    String(getPref("route.mode" as any) || "offline") === "offline" &&
    !(st as any).auto
  ) {
    (st as any).auto = true;
    void run().catch(() => {});
  }
}

/* ========================= registration ========================= */
export function registerSections() {
  if (!getPref("ui.itemSection" as any)) return;
  const pluginID = addon.data.config.addonID;
  const common = (id: string, key: string, glyphName: string) => ({
    paneID: `${ref()}-${id}`,
    pluginID,
    header: {
      l10nID: getLocaleID(`section-${key}-header` as any),
      icon: `chrome://zotero/skin/itempane/16/${glyphName}.svg`,
    },
    sidenav: {
      l10nID: getLocaleID(`section-${key}-sidenav` as any),
      icon: `chrome://zotero/skin/itempane/20/${glyphName}.svg`,
    },
    onItemChange: ({ item, setEnabled }: any) => {
      setEnabled(!!item?.isRegularItem());
      return true;
    },
  });
  Zotero.ItemPaneManager.registerSection({
    ...common("pdf", "pdf", "attachments"),
    onRender: ({ body, item }: any) => void drawPdf(body, item),
    onAsyncRender: async ({ body, item }: any) =>
      drawPdf(body, item, await hasUsablePdf(item)),
  } as any);
  Zotero.ItemPaneManager.registerSection({
    ...common("tags", "tags", "tags"),
    onRender: ({ body, item }: any) => drawTags(body, item),
  } as any);
  Zotero.ItemPaneManager.registerSection({
    ...common("related", "related", "related"),
    onRender: ({ body, item }: any) => drawRelated(body, item),
  } as any);
  Zotero.ItemPaneManager.registerSection({
    ...common("collections", "coll", "libraries-collections"),
    onRender: ({ body, item }: any) => drawColl(body, item),
  } as any);
}
