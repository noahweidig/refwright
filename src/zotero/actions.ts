import { startRun, Task } from "./engine";
import { suggestTags, applyTags, ItemSuggestion } from "./tagging";
import { applyFiling, routeItems, undoFiling, ItemRoute } from "./routing";
import * as TM from "./tagManager";
import { summarizeItems } from "./summarize";
import { updateCitations } from "./citations";
import { linkMany, relatedForMany } from "./related";
import { mergeNearGroups, scanNearDuplicates } from "./nearDup";
import { createFromSuggestions, suggestClusters } from "./clusters";
import { clearQueue, pending } from "./inbox";
import {
  currentLibraryID,
  hasUsablePdf,
  itemsWithTag,
  fieldsOf,
  regularItems,
} from "./library";
import { openRefwrightWindow, reviewLabels } from "./windows";
import { getString } from "../utils/locale";
import { guard } from "./guard";
import { aiReady } from "./ai";
import { getPref } from "../utils/prefs";
import { S, saveState } from "./state";
import { STATUS_TAGS as T } from "../core/tags";
import { toCsv } from "../core/csv";

const g = (k: string) => getPref(k as any) as any;
const pane = () => Zotero.getActiveZoteroPane();
export const selected = (): Zotero.Item[] =>
  (pane()?.getSelectedItems() as Zotero.Item[]) ?? [];

function toast(
  text: string,
  type: "success" | "default" | "error" = "default",
) {
  new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: 3500,
  })
    .createLine({ text, type, progress: 100 })
    .show();
}

const reportLabels = () => ({
  item: getString("lbl-item"),
  result: getString("lbl-result"),
  cancel: getString("progress-cancel"),
  close: getString("progress-close"),
});

async function _runTask(task: Task, items: Zotero.Item[]) {
  const regular = regularItems(items);
  if (!regular.length) return toast(getString("tags-none-selected"));
  if (regular.length > 60) {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      getString("progress-title"),
      getString("progress-confirm-many", { args: { count: regular.length } }),
    );
    if (!ok) return;
  }
  const run = startRun(task, regular);
  openRefwrightWindow("report.xhtml", {
    title: `RefWright — ${task === "pdf" ? getString("task-pdf") : task === "preview" ? getString("task-preview") : task === "retraction" ? getString("task-retraction") : task === "citation" ? getString("task-citation") : getString("task-full")}`,
    labels: reportLabels(),
    rows: run.rows,
    finished: () => run.finished,
    subscribe: (cb: () => void) => run.listeners.add(cb),
    cancel: () => run.abort.abort(),
    onClose: () => run.abort.abort(),
    select: (id: number) => pane()?.selectItem(id),
  });
  await run.done;
}

async function _runTagged(task: Task) {
  const tag = String(g("batchTag") || "refwright");
  const items = await itemsWithTag(tag, currentLibraryID());
  if (!items.length) return toast(getString("tagged-none", { args: { tag } }));
  return runTask(task, items);
}

/** Unified review: tags (free or AI), collections, or both. */
async function _reviewAction(
  input: Zotero.Item[],
  opts: {
    tags: "free" | "ai" | false;
    collections: boolean;
    onApplied?: () => void;
  },
) {
  const items = regularItems(input);
  if (!items.length) return toast(getString("tags-none-selected"));
  const abort = new AbortController();
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: getString("tags-suggesting"),
      type: "default",
      progress: 10,
    })
    .show();
  let tagRes: ItemSuggestion[] = [];
  let routes: ItemRoute[] = [];
  let note: string | undefined;
  try {
    if (opts.tags)
      tagRes = await suggestTags(
        items,
        opts.tags,
        (d, t) => pw.changeLine({ progress: 10 + (80 * d) / t }),
        abort.signal,
      );
    if (opts.collections) {
      const r = await routeItems(items, abort.signal);
      routes = r.routes;
      note = r.note;
    }
  } catch (e: any) {
    pw.close();
    if (e?.message === "no-collections")
      return toast(getString("route-no-collections"), "error");
    return toast(String(e?.message ?? e), "error");
  }
  pw.close();
  const byId = new Map<number, any>();
  for (const it of items)
    byId.set(it.id, {
      itemID: it.id,
      title: (it.getField("title") as string) || "(untitled)",
      on: false,
    });
  for (const t of tagRes)
    Object.assign(byId.get(t.itemID), {
      tags: t.tags,
      suggested: t.suggested,
      on: t.on,
    });
  for (const r of routes)
    Object.assign(
      byId.get(r.itemID),
      {
        coll: {
          choices: r.choices,
          preselected: r.preselected,
          already: r.already,
        },
      },
      { on: byId.get(r.itemID).on || r.on },
    );
  const single = items.length === 1 && opts.collections && !opts.tags;
  const ctrl = {
    single,
    items: [...byId.values()],
    note,
    labels: reviewLabels(),
    topN: 5,
    retry: single
      ? async () => {
          const cur = ctrl.items[0];
          const rej = (S().rejected[items[0].key] ??= {});
          for (const id of cur.coll.preselected)
            if (!cur.coll.choices.find((c: any) => c.id === id)?.on)
              rej[id] = (rej[id] ?? 0) + 1;
          saveState();
          const r = await routeItems(items);
          const out = [
            {
              itemID: items[0].id,
              title: cur.title,
              on: r.routes[0].on,
              coll: {
                choices: r.routes[0].choices,
                preselected: r.routes[0].preselected,
                already: r.routes[0].already,
              },
            },
          ];
          ctrl.items = out;
          return out;
        }
      : undefined,
    apply: async (results: any[]) => {
      let tagsAdded = 0;
      let filed = 0;
      if (opts.tags)
        tagsAdded = await applyTags(
          results.map((r) => ({
            itemID: r.itemID,
            on: r.on,
            tags: r.tags,
            suggested: r.suggested,
          })),
        );
      if (opts.collections)
        filed = await applyFiling(
          results.map((r) => ({
            itemID: r.itemID,
            on: r.on,
            collections: r.collections,
            preselected: r.preselected,
          })),
        );
      const parts = [];
      if (opts.tags)
        parts.push(getString("tags-added", { args: { count: tagsAdded } }));
      if (opts.collections)
        parts.push(getString("route-filed", { args: { count: filed } }));
      toast(parts.join(" · "), "success");
      opts.onApplied?.();
    },
  };
  openRefwrightWindow("review.xhtml", ctrl);
}

export const suggestTagsAction = (items: Zotero.Item[], ai: boolean) =>
  reviewAction(items, {
    tags: ai ? "ai" : g("tag.method") === "ai" ? "ai" : "free",
    collections: false,
  });
export const fileAction = (items: Zotero.Item[]) =>
  reviewAction(items, { tags: false, collections: true });

async function _summarizeAction(input: Zotero.Item[]) {
  const items = regularItems(input);
  if (!items.length) return toast(getString("tags-none-selected"));
  if (!aiReady()) return toast(getString("tm-need-ai"), "error");
  if (items.length > 20) {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      getString("progress-title"),
      getString("progress-confirm-many", { args: { count: items.length } }),
    );
    if (!ok) return;
  }
  const abort = new AbortController();
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("summary-working"),
      type: "default",
      progress: 5,
    })
    .show();
  try {
    const r = await summarizeItems(
      items,
      (d, t) => pw.changeLine({ progress: 5 + (90 * d) / t }),
      abort.signal,
    );
    pw.close();
    const text = getString("summary-done", {
      args: { made: r.made, skipped: r.skipped, failed: r.failed },
    });
    toast(
      r.error ? `${text}: ${r.error}` : text,
      r.failed ? "error" : "success",
    );
  } catch (e: any) {
    pw.close();
    toast(String(e?.message ?? e), "error");
  }
}

async function _citationsAction(input: Zotero.Item[]) {
  const items = regularItems(input);
  if (!items.length) return toast(getString("tags-none-selected"));
  const abort = new AbortController();
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("cites-working"),
      type: "default",
      progress: 5,
    })
    .show();
  try {
    const r = await updateCitations(
      items,
      (d, t) => pw.changeLine({ progress: 5 + (90 * d) / Math.max(1, t) }),
      abort.signal,
    );
    pw.close();
    toast(
      getString("cites-done", {
        args: { updated: r.updated, missing: r.notFound, nodoi: r.noDoi },
      }),
      "success",
    );
  } catch (e: any) {
    pw.close();
    toast(String(e?.message ?? e), "error");
  }
}

async function _citationsAllAction() {
  const all = (await Zotero.Items.getAll(
    currentLibraryID(),
    true,
  )) as Zotero.Item[];
  return citationsAction(all.filter((i) => i.isRegularItem() && !i.deleted));
}

async function _relatedBatchAction(input: Zotero.Item[]) {
  const items = regularItems(input);
  if (!items.length) return toast(getString("tags-none-selected"));
  const abort = new AbortController();
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("related-batch-working"),
      type: "default",
      progress: 10,
    })
    .show();
  let batch;
  try {
    batch = await relatedForMany(
      items,
      abort.signal,
      (d, t) => pw.changeLine({ progress: 10 + (80 * d) / Math.max(1, t) }),
      5,
    );
  } catch (e: any) {
    pw.close();
    return toast(String(e?.message ?? e), "error");
  }
  pw.close();
  const title = (i: Zotero.Item) =>
    (i.getField("title") as string) || "(untitled)";
  openRefwrightWindow("related.xhtml", {
    note: batch.note,
    labels: {
      title: getString("related-batch-title"),
      apply: getString("related-batch-apply"),
      cancel: getString("review-cancel"),
      threshold: getString("related-batch-threshold"),
      selectNone: getString("related-batch-none"),
      selected: getString("related-batch-selected", {
        args: { count: "{count}" },
      }),
      none: getString("related-none"),
      empty: getString("review-no-items"),
    },
    items: items.map((it) => ({
      itemID: it.id,
      title: title(it),
      hits: (batch.results.get(it.id) ?? []).map((h) => ({
        itemID: h.item.id,
        title: title(h.item),
        score: h.score,
        on: false,
      })),
    })),
    apply: async (links: { itemID: number; others: number[] }[]) => {
      const n = await linkMany(
        links.map((l) => ({
          item: Zotero.Items.get(l.itemID) as Zotero.Item,
          others: l.others.map((id) => Zotero.Items.get(id) as Zotero.Item),
        })),
      );
      toast(
        getString("related-batch-linked", { args: { count: n } }),
        "success",
      );
    },
  });
}

function progressLine(text: string) {
  return new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({ text, type: "default", progress: 50 })
    .show();
}

async function _nearDupAction() {
  const pw = progressLine(getString("neardup-working"));
  let groups;
  try {
    groups = await scanNearDuplicates(currentLibraryID());
  } finally {
    pw.close();
  }
  if (!groups.length) return toast(getString("neardup-none"));
  openRefwrightWindow("nearduplicates.xhtml", {
    groups,
    labels: {
      title: getString("neardup-title"),
      apply: getString("neardup-apply"),
      cancel: getString("review-cancel"),
      selectAll: getString("select-all"),
      selectNone: getString("related-batch-none"),
      selected: getString("related-batch-selected", {
        args: { count: "{count}" },
      }),
      mergeGroup: getString("neardup-merge-group"),
      keep: getString("neardup-keep"),
      confirm: getString("neardup-confirm", { args: { count: "{count}" } }),
      attachments: getString("neardup-attachments", {
        args: { count: "{count}" },
      }),
      attachment: getString("neardup-attachment", {
        args: { count: "{count}" },
      }),
      preprint: getString("neardup-preprint"),
      empty: getString("neardup-none"),
    },
    apply: async (picks: { masterID: number; otherIDs: number[] }[]) => {
      const n = await mergeNearGroups(picks);
      toast(getString("neardup-merged", { args: { count: n } }), "success");
    },
  });
}

async function runNewCollections(ai: boolean) {
  if (ai && !aiReady()) return toast(getString("tm-need-ai"), "error");
  const pw = progressLine(getString("clusters-working"));
  let found;
  try {
    found = await suggestClusters(
      currentLibraryID(),
      ai,
      new AbortController().signal,
    );
  } finally {
    pw.close();
  }
  if (!found.items.length) return toast(getString("clusters-none"));
  openRefwrightWindow("collections-suggest.xhtml", {
    items: found.items,
    note: found.note,
    labels: {
      title: getString("clusters-title"),
      apply: getString("clusters-apply"),
      cancel: getString("review-cancel"),
      selectAll: getString("select-all"),
      selectNone: getString("related-batch-none"),
      selected: getString("related-batch-selected", {
        args: { count: "{count}" },
      }),
      papers: getString("clusters-papers", { args: { count: "{count}" } }),
      more: getString("clusters-more", { args: { count: "{count}" } }),
      empty: getString("clusters-none"),
    },
    apply: async (picks: { name: string; ids: number[] }[]) => {
      const n = await createFromSuggestions(currentLibraryID(), picks);
      toast(getString("clusters-created", { args: { count: n } }), "success");
    },
  });
}

const _newCollectionsAction = () => runNewCollections(false);
const _newCollectionsAiAction = () => runNewCollections(true);

/** One review window of tag and collection suggestions for everything the new-items queue collected. */
async function _reviewNewAction() {
  const items = pending();
  if (!items.length) return toast(getString("inbox-none"));
  return reviewAction(items, {
    tags: g("tag.method") === "ai" ? "ai" : "free",
    collections: true,
    onApplied: () => clearQueue(items.map((i) => i.id)),
  });
}

async function _undoFilingAction() {
  toast(
    (await undoFiling())
      ? getString("route-undone")
      : getString("route-nothing-to-undo"),
  );
}

async function _collectionTagAction() {
  const col = pane()?.getSelectedCollection();
  if (!col) return;
  const items = col.getChildItems(false) as Zotero.Item[];
  return suggestTagsAction(items, g("tag.method") === "ai");
}

function _openTagManager() {
  const libraryID = currentLibraryID();
  const abort = new AbortController();
  openRefwrightWindow("tagmanager.xhtml", {
    labels: {
      title: getString("tm-title"),
      allTags: getString("tm-all-tags"),
      duplicates: getString("tm-duplicates"),
      formatting: getString("tm-formatting"),
      similar: getString("tm-similar"),
      search: getString("tm-search"),
      mostUsed: getString("tm-most-used"),
      az: getString("tm-az"),
      leastUsed: getString("tm-least-used"),
      all: getString("tm-all"),
      usedOnce: getString("tm-used-once"),
      usedMany: getString("tm-used-many"),
      target: getString("tm-target"),
      merge: getString("tm-merge"),
      rename: getString("tm-rename"),
      del: getString("tm-delete"),
      confirmDelete: getString("tm-confirm-delete"),
      merged: getString("tm-merged"),
      mergeInto: getString("tm-merge-into"),
      mergeAll: getString("tm-merge-all"),
      confirmMergeAll: getString("tm-confirm-merge-all", {
        args: { count: "{count}" },
      }),
      estimate: getString("tm-estimate", {
        args: { tags: "{tags}", requests: "{requests}", tokens: "{tokens}" },
      }),
      run: getString("tm-run"),
      forget: getString("tm-forget"),
      needAi: getString("tm-need-ai"),
      none: getString("tm-none"),
      working: getString("tm-working"),
      fix: getString("tm-fix"),
      fixAll: getString("tm-fix-all"),
      dropped: getString("tm-dropped"),
      undo: getString("tm-undo"),
      total: getString("tm-total"),
      close: getString("progress-close"),
      undone: getString("tm-undone"),
      nothing: getString("tm-nothing"),
      scanning: getString("tm-scanning"),
    },
    load: () => TM.loadCounts(libraryID),
    duplicates: (t: any) => TM.scanDuplicates(t),
    formatting: (t: any) => TM.scanFormatting(t),
    estimate: (t: any) => TM.estimateScan(t),
    similar: (t: any) => TM.scanSimilar(t, abort.signal),
    forget: () => TM.forgetChecked(),
    merge: (from: string[], to: string, batch?: number) =>
      TM.mergeTags(libraryID, from, to, batch),
    undo: () => TM.undoLast(),
    aiReady: () => aiReady(),
    cancel: () => abort.abort(),
  });
}

async function _exportMissing(items?: Zotero.Item[]) {
  let list = items?.length ? regularItems(items) : [];
  if (!list.length) {
    const lib = currentLibraryID();
    const set = new Map<number, Zotero.Item>();
    for (const t of [T.pdfMissing, T.pdfCheck])
      for (const i of await itemsWithTag(t, lib)) set.set(i.id, i);
    list = [...set.values()];
  }
  const rows: string[][] = [];
  for (const i of list) {
    const fl = fieldsOf(i);
    const status = i.hasTag(T.pdfCheck)
      ? "check-needed"
      : (await hasUsablePdf(i))
        ? "has-pdf"
        : "pdf-missing";
    rows.push([
      status,
      fl.title,
      fl.authors,
      String(fl.year ?? ""),
      fl.journal,
      fl.ids.doi ?? "",
      fl.ids.pmid ?? "",
      fl.url,
    ]);
  }
  const csv = toCsv(
    ["status", "title", "authors", "year", "journal", "doi", "pmid", "url"],
    rows,
  );
  const path = await new ztoolkit.FilePicker(
    getString("export-title"),
    "save",
    [["CSV", "*.csv"]],
    "refwright-missing-pdfs.csv",
  ).open();
  if (!path) return;
  await IOUtils.writeUTF8(path, csv);
  toast(getString("export-done", { args: { count: rows.length } }), "success");
}

function _showAudit() {
  const rows = S()
    .audit.slice(-500)
    .reverse()
    .map((a, i) => ({
      itemID: i,
      title: `${a.itemKey}  ${a.tag}`,
      text: `${new Date(a.at).toLocaleString()} · ${a.op}${a.dryRun ? " (dry run)" : ""}${a.undone ? " · undone" : ""}`,
      status: "ok",
    }));
  openRefwrightWindow("report.xhtml", {
    title: getString("audit-title"),
    labels: {
      item: getString("audit-tag"),
      result: getString("audit-op"),
      cancel: getString("progress-cancel"),
      close: getString("progress-close"),
    },
    rows: rows.length
      ? rows
      : [
          {
            itemID: 0,
            title: getString("audit-empty"),
            text: "",
            status: "skip",
          },
        ],
    finished: () => true,
    subscribe: () => {},
  });
}

export const runTask = guard(_runTask);
export const runTagged = guard(_runTagged);
export const reviewAction = guard(_reviewAction);
export const citationsAction = guard(_citationsAction);
export const citationsAllAction = guard(_citationsAllAction);
export const relatedBatchAction = guard(_relatedBatchAction);
export const nearDupAction = guard(_nearDupAction);
export const newCollectionsAction = guard(_newCollectionsAction);
export const newCollectionsAiAction = guard(_newCollectionsAiAction);
export const reviewNewAction = guard(_reviewNewAction);
export const summarizeAction = guard(_summarizeAction);
export const undoFilingAction = guard(_undoFilingAction);
export const collectionTagAction = guard(_collectionTagAction);
export const exportMissing = guard(_exportMissing);
export const openTagManager = guard(_openTagManager);
export const showAudit = guard(_showAudit);
