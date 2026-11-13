import { embedText, quantize, rankOffline, rankRelated } from "../core/related";
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

async function libraryItems(item: Zotero.Item) {
  return (
    (await Zotero.Items.getAll(item.libraryID, true)) as Zotero.Item[]
  ).filter((i) => i.isRegularItem() && !i.deleted);
}

function linkedIds(item: Zotero.Item): Set<number> {
  const out = new Set<number>([item.id]);
  for (const key of item.relatedItems) {
    const r = Zotero.Items.getByLibraryAndKey(item.libraryID, key);
    if (r) out.add((r as Zotero.Item).id);
  }
  return out;
}

/** Title (weighted), abstract, tags and venue, compared locally. */
function relatedOffline(item: Zotero.Item, all: Zotero.Item[]): RelatedHit[] {
  const byId = new Map(all.map((i) => [i.id, i]));
  const docs = all.map((i) => {
    const f = fieldsOf(i);
    const tags = i
      .getTags()
      .map((t) => t.tag)
      .join(" ");
    return {
      id: i.id,
      text: `${f.title} ${f.title} ${f.abstract} ${tags} ${f.journal}`,
    };
  });
  return rankOffline(docs, item.id, linkedIds(item)).map((s) => ({
    item: byId.get(s.id)!,
    score: s.score,
  }));
}

/** Offline by default; embeddings when chosen, with an offline fallback if the provider fails. */
export async function relatedFor(
  item: Zotero.Item,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<RelatedResult> {
  const all = await libraryItems(item);
  if (getPref("related.mode" as any) !== "embedding")
    return { hits: relatedOffline(item, all) };
  try {
    return { hits: await relatedEmbedded(item, all, signal, progress) };
  } catch (e: any) {
    if (signal.aborted) throw e;
    return {
      hits: relatedOffline(item, all),
      note: `${String(e?.message ?? e)}. Showing offline matches.`,
    };
  }
}

/** Embeds the library once (cached, resumable), then ranks by cosine similarity. */
async function relatedEmbedded(
  item: Zotero.Item,
  all: Zotero.Item[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<RelatedHit[]> {
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
  const me = rows.find((r) => r.item.id === item.id);
  if (!me || !cache[me.k]) return [];
  const exclude = linkedIds(item);
  const byId = new Map(rows.map((r) => [r.item.id, r.item]));
  return rankRelated(
    cache[me.k].vec,
    rows
      .filter((r) => cache[r.k])
      .map((r) => ({ id: r.item.id, vec: cache[r.k].vec })),
    exclude,
  ).map((s) => ({ item: byId.get(s.id)!, score: s.score }));
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
