import { embedText, quantize, rankRelated } from "../core/related";
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

/** Embeds the library once (cached, resumable), then ranks by cosine similarity. */
export async function relatedFor(
  item: Zotero.Item,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<RelatedHit[]> {
  const prov = String(getPref("ai.embedProvider" as any));
  const all = (
    (await Zotero.Items.getAll(item.libraryID, true)) as Zotero.Item[]
  ).filter((i) => i.isRegularItem() && !i.deleted);
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
  const exclude = new Set<number>([item.id]);
  for (const key of item.relatedItems) {
    const r = Zotero.Items.getByLibraryAndKey(item.libraryID, key);
    if (r) exclude.add((r as Zotero.Item).id);
  }
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
