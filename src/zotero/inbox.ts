import { startRun } from "./engine";
import { regularItems } from "./library";
import { S, saveState } from "./state";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";

const g = (k: string) => getPref(k as any) as any;
const QUIET_MS = 20_000;
/** more than this at once looks like an import, not someone adding papers */
const BURST = 100;
/** an item counts as new if it was added in the last two minutes (synced items keep their old date) */
const FRESH_MS = 120_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
const burst = new Set<number>();

function toast(text: string) {
  new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: 9000,
  })
    .createLine({ text, type: "default", progress: 100 })
    .show();
}

const isNew = (item: Zotero.Item | false) =>
  !!item &&
  item.isRegularItem() &&
  item.libraryID === Zotero.Libraries.userLibraryID &&
  Date.now() - Date.parse(`${item.dateAdded.replace(" ", "T")}Z`) < FRESH_MS;

/** Called for every item add. Waits for a quiet moment, then queues the batch. */
export function onItemsAdded(ids: number[]) {
  if (!g("auto.enabled")) return;
  for (const id of ids) if (isNew(Zotero.Items.get(id))) burst.add(id);
  if (!burst.size) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), QUIET_MS);
}

async function flush() {
  const ids = [...burst];
  burst.clear();
  if (ids.length > BURST)
    return toast(getString("inbox-skipped", { args: { count: ids.length } }));
  const have = new Set(S().inbox.map((q) => q.id));
  for (const id of ids) if (!have.has(id)) S().inbox.push({ id, pdf: false });
  saveState();
  await lookUpPdfs();
}

/** PDF lookup for queued items (an ordinary Find PDFs run), then a note that they are ready to review. */
async function lookUpPdfs() {
  if (busy) return;
  busy = true;
  try {
    const todo = S().inbox.filter((q) => !q.pdf);
    const items = regularItems(
      todo.map((q) => Zotero.Items.get(q.id)).filter(Boolean) as Zotero.Item[],
    );
    if (g("auto.pdf") && items.length) await startRun("pdf", items).done;
    for (const q of todo) q.pdf = true;
    saveState();
    toast(getString("inbox-ready", { args: { count: pending().length } }));
  } finally {
    busy = false;
  }
}

/** Queued items that still exist and are not in the trash. */
export function pending(): Zotero.Item[] {
  return S()
    .inbox.map((q) => Zotero.Items.get(q.id) as Zotero.Item | false)
    .filter((i): i is Zotero.Item => !!i && !i.deleted && i.isRegularItem());
}

export function clearQueue(ids?: number[]) {
  const drop = new Set(ids ?? S().inbox.map((q) => q.id));
  S().inbox = S().inbox.filter((q) => !drop.has(q.id));
  saveState();
}
