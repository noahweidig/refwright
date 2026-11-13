import {
  embedText,
  offlineRanker,
  quantize,
  rankRelated,
} from "../core/related";
import { embedTexts } from "./ai";
import { fieldsOf } from "./library";
import { S, saveState } from "./state";
import { getPref } from "../utils/prefs";

const sigOf = (t: string) =>
  `${t.length}:${[...t].reduce((a, ch) => (a * 31 + (ch.codePointAt(0) ?? 0)) % 2147483647, 7)}`;

export interface RelatedHit {
  item: Zotero.Item;
  score: number;
}
export interface RelatedResult {
  hits: RelatedHit[];
  note?: string;
}

async function libraryItems(libraryID: number) {
  return ((await Zotero.Items.getAll(libraryID, true)) as Zotero.Item[]).filter(
    (i) => i.isRegularItem() && !i.deleted,
  );
}

function linkedIds(item: Zotero.Item): Set<number> {
  const out = new Set<number>([item.id]);
  for (const key of item.relatedItems) {
    const r = Zotero.Items.getByLibraryAndKey(item.libraryID, key);
    if (r) out.add((r as Zotero.Item).id);
  }
  return out;
}

type Ranker = (item: Zotero.Item) => RelatedHit[];

/** Title (weighted), abstract, tags and venue, compared locally. */
function offlineFor(all: Zotero.Item[], top: number): Ranker {
  const byId = new Map(all.map((i) => [i.id, i]));
  const rank = offlineRanker(
    all.map((i) => {
      const f = fieldsOf(i);
      const tags = i
        .getTags()
        .map((t) => t.tag)
        .join(" ");
      return {
        id: i.id,
        text: `${f.title} ${f.title} ${f.abstract} ${tags} ${f.journal}`,
      };
    }),
  );
  return (item) =>
    rank(item.id, linkedIds(item), top).map((s) => ({
      item: byId.get(s.id)!,
      score: s.score,
    }));
}

/** Embeds the library once (cached, resumable); the returned ranker is then instant. */
async function embeddedFor(
  all: Zotero.Item[],
  top: number,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Ranker> {
  const prov = String(getPref("ai.embedProvider" as any));
  const rows = all
    .map((i) => {
      const f = fieldsOf(i);
      return {
        item: i,
        text: embedText({ title: f.title, abstract: f.abstract }),
        k: `rel:${prov}:${i.libraryID}/${i.key}`,
      };
    })
    .filter((r) => r.text.trim());
  const cache = S().embeddings;
  const need = rows.filter((r) => cache[r.k]?.sig !== sigOf(r.text));
  for (let i = 0; i < need.length; i += 64) {
    if (signal.aborted) throw new Error("Cancelled");
    progress(i, need.length);
    const chunk = need.slice(i, i + 64);
    const texts = chunk.map((r) => r.text);
    const vecs = await embedTexts(texts, signal); // NOSONAR: sequential (rate limits)
    chunk.forEach(
      (r, n) => (cache[r.k] = { sig: sigOf(r.text), vec: quantize(vecs[n]) }),
    );
    saveState();
  }
  progress(need.length, need.length);
  const byId = new Map(rows.map((r) => [r.item.id, r.item]));
  const pool = rows
    .filter((r) => cache[r.k])
    .map((r) => ({ id: r.item.id, vec: cache[r.k].vec }));
  return (item) => {
    const mine = cache[`rel:${prov}:${item.libraryID}/${item.key}`];
    if (!mine) return [];
    return rankRelated(mine.vec, pool, linkedIds(item), top).map((s) => ({
      item: byId.get(s.id)!,
      score: s.score,
    }));
  };
}

export interface RelatedBatch {
  results: Map<number, RelatedHit[]>;
  note?: string;
}

/**
 * Suggestions for several items at once. The library is indexed a single time.
 * Offline by default; embeddings when chosen, with an offline fallback if the provider fails.
 */
export async function relatedForMany(
  items: Zotero.Item[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
  top = 8,
): Promise<RelatedBatch> {
  if (!items.length) return { results: new Map() };
  const all = await libraryItems(items[0].libraryID);
  let rank: Ranker;
  let note: string | undefined;
  if (getPref("related.mode" as any) === "embedding") {
    try {
      rank = await embeddedFor(all, top, signal, progress);
    } catch (e: any) {
      if (signal.aborted) throw e;
      note = `${String(e?.message ?? e)}. Showing offline matches.`;
      rank = offlineFor(all, top);
    }
  } else rank = offlineFor(all, top);
  return { results: new Map(items.map((i) => [i.id, rank(i)])), note };
}

export async function relatedFor(
  item: Zotero.Item,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<RelatedResult> {
  const b = await relatedForMany([item], signal, progress);
  return { hits: b.results.get(item.id) ?? [], note: b.note };
}

export async function linkRelated(a: Zotero.Item, b: Zotero.Item) {
  a.addRelatedItem(b);
  b.addRelatedItem(a);
  await a.saveTx();
  await b.saveTx();
}

/** Links every item in one pass: relations first, then one save per item. */
export async function linkAllRelated(a: Zotero.Item, others: Zotero.Item[]) {
  for (const b of others) {
    a.addRelatedItem(b);
    b.addRelatedItem(a);
  }
  await Promise.all([a, ...others].map((i) => i.saveTx()));
}

/** Links many pairs at once: all relations first, then one save per touched item. */
export async function linkMany(
  links: { item: Zotero.Item; others: Zotero.Item[] }[],
) {
  const touched = new Map<number, Zotero.Item>();
  for (const { item, others } of links)
    for (const b of others) {
      item.addRelatedItem(b);
      b.addRelatedItem(item);
      touched.set(item.id, item);
      touched.set(b.id, b);
    }
  await Promise.all([...touched.values()].map((i) => i.saveTx()));
  return links.reduce((n, l) => n + l.others.length, 0);
}
