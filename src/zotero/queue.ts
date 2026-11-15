import { isReserved } from "../core/tags";
import {
  estimateMinutes,
  nextUp,
  rankForProject,
  READ_TAGS,
  ReadStatus,
  statusOf,
} from "../core/queue";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { fieldsOf, setStatusTags } from "./library";

const g = (k: string) => getPref(k as any) as any;
const ALL = Object.values(READ_TAGS);

export const readStatus = (item: Zotero.Item) =>
  item.isRegularItem() ? statusOf(item.getTags().map((t) => t.tag)) : "";

function toast(text: string) {
  new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: 3500,
  })
    .createLine({ text, type: "default", progress: 100 })
    .show();
}
function refreshTree() {
  try {
    (
      Zotero.getActiveZoteroPane() as any
    )?.itemsView?.refreshAndMaintainSelection?.();
  } catch {
    /* tree not ready */
  }
}

/* ---------- read time ---------- */
const stats = new Map<number, { chars: number; pages: number }>();

/** Text length and page count Zotero already stored when it indexed each PDF. */
export async function loadTextStats() {
  try {
    const rows = await Zotero.DB.queryAsync(
      `SELECT A.parentItemID AS pid,
              COALESCE(F.totalChars, F.indexedChars) AS chars,
              COALESCE(F.totalPages, F.indexedPages) AS pages
       FROM fulltextItems F JOIN itemAttachments A ON A.itemID = F.itemID
       WHERE A.parentItemID IS NOT NULL AND A.contentType = 'application/pdf'`,
    );
    stats.clear();
    for (const r of rows ?? [])
      stats.set(Number(r.pid), {
        chars: Number(r.chars) || 0,
        pages: Number(r.pages) || 0,
      });
    refreshTree();
  } catch (e) {
    ztoolkit.log("read-time stats failed", e);
  }
}

export function minutesOf(item: Zotero.Item): number | undefined {
  if (!item.isRegularItem()) return undefined;
  const s = stats.get(item.id);
  let pages = s?.pages;
  if (!pages) {
    try {
      pages = parseInt(item.getField("numPages") as string, 10) || 0;
    } catch {
      pages = 0;
    }
  }
  return estimateMinutes({
    chars: s?.chars,
    pages,
    wpm: Number(g("queue.wpm")) || 150,
  });
}

/* ---------- status ---------- */
export async function setReadStatus(
  items: Zotero.Item[],
  status: ReadStatus | "",
  quiet = false,
) {
  const regular = items.filter((i) => i.isRegularItem());
  for (const i of regular)
    await setStatusTags(i, status ? [READ_TAGS[status]] : [], ALL);
  invalidateQueue();
  if (!quiet)
    toast(
      getString("queue-marked" as any, {
        args: { count: regular.length, status: status || "none" },
      }),
    );
}

/* ---------- relevance to the project (the selected collection) ---------- */
interface Scope {
  lib: number;
  coll: number;
}
let cache: { key: string; rel: Map<number, number> } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let building = false;

const scopeNow = (): Scope => {
  const p = Zotero.getActiveZoteroPane();
  return {
    lib: p?.getSelectedLibraryID() || Zotero.Libraries.userLibraryID,
    coll: (p?.getSelectedCollection() as any)?.id ?? 0,
  };
};
const keyOf = (s: Scope) => `${s.lib}/${s.coll}`;

async function scopeItems(s: Scope): Promise<Zotero.Item[]> {
  const items = s.coll
    ? ((Zotero.Collections.get(s.coll) as any).getChildItems(
        false,
      ) as Zotero.Item[])
    : ((await Zotero.Items.getAll(s.lib, true)) as Zotero.Item[]);
  return items.filter((i) => i.isRegularItem() && !i.deleted);
}

function textOf(i: Zotero.Item) {
  const f = fieldsOf(i);
  const tags = i
    .getTags()
    .map((t) => t.tag)
    .filter((t) => !isReserved(t))
    .join(" ");
  return `${f.title} ${f.title} ${f.abstract} ${tags} ${f.journal}`;
}

/** Unread items in the scope, best match for the project first. */
export async function rankQueue(s: Scope) {
  const items = await scopeItems(s);
  const status = new Map(items.map((i) => [i.id, readStatus(i)]));
  const started = items.filter((i) =>
    ["reading", "done"].includes(status.get(i.id)!),
  );
  const profile = started.length
    ? started
    : items.filter((i) => status.get(i.id) === "");
  const ranked = rankForProject(
    items.map((i) => ({ id: i.id, text: textOf(i) })),
    new Set(profile.map((i) => i.id)),
    new Set(
      items.filter((i) => status.get(i.id) === "unread").map((i) => i.id),
    ),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  return nextUp(ranked, (id) => minutesOf(byId.get(id)!)).map((r) => ({
    ...r,
    item: byId.get(r.id)!,
  }));
}

export const invalidateQueue = () => {
  cache = null;
};

function schedule(s: Scope) {
  if (building) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    building = true;
    try {
      const ranked = await rankQueue(s);
      cache = {
        key: keyOf(s),
        rel: new Map(ranked.map((r) => [r.id, r.score])),
      };
    } catch (e) {
      ztoolkit.log("queue rank failed", e);
      cache = { key: keyOf(s), rel: new Map() };
    } finally {
      building = false;
    }
    refreshTree();
  }, 400);
}

/** 0 to 100, for unread items only; empty while the ranking is still being built. */
export function relevanceOf(item: Zotero.Item): number | undefined {
  if (readStatus(item) !== "unread") return undefined;
  const s = scopeNow();
  if (cache?.key !== keyOf(s)) {
    schedule(s);
    return undefined;
  }
  return cache.rel.get(item.id);
}

/** Select the best unread paper for the current collection. */
export async function selectNextUp() {
  const top = (await rankQueue(scopeNow()))[0];
  if (!top) return toast(getString("queue-none" as any));
  await (Zotero.getActiveZoteroPane() as any).selectItem(top.id);
  const m = minutesOf(top.item);
  toast(
    getString("queue-next" as any, {
      args: {
        title: fieldsOf(top.item).title,
        score: top.score,
        minutes: m ?? 0,
      },
    }),
  );
}
