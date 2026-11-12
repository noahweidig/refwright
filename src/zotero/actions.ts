import { startRun, Task } from "./engine";
import { suggestTags, applyTags, ItemSuggestion } from "./tagging";
import { applyFiling, routeItems, undoFiling, ItemRoute } from "./routing";
import * as TM from "./tagManager";
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
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
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
    title: `refwright — ${task === "pdf" ? getString("task-pdf") : task === "preview" ? getString("task-preview") : task === "retraction" ? getString("task-retraction") : task === "citation" ? getString("task-citation") : getString("task-full")}`,
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
  opts: { tags: "free" | "ai" | false; collections: boolean },
) {
  const items = regularItems(input);
  if (!items.length) return toast(getString("tags-none-selected"));
  const abort = new AbortController();
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
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
      undone: getString("tm-undone"),
      nothing: getString("tm-nothing"),
    },
    load: () => TM.loadCounts(libraryID),
    duplicates: (t: any) => TM.scanDuplicates(t),
    formatting: (t: any) => TM.scanFormatting(t),
    estimate: (t: any) => TM.estimateScan(t),
    similar: (t: any) => TM.scanSimilar(t, abort.signal),
    forget: () => TM.forgetChecked(),
    merge: (from: string[], to: string) => TM.mergeTags(libraryID, from, to),
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
export const undoFilingAction = guard(_undoFilingAction);
export const collectionTagAction = guard(_collectionTagAction);
export const exportMissing = guard(_exportMissing);
export const openTagManager = guard(_openTagManager);
export const showAudit = guard(_showAudit);
