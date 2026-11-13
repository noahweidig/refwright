import { tokenize } from "./text";
import { TfIdf } from "./tfidf";
import { cosine, denseCosine } from "./vec";

export const embedText = (p: { title: string; abstract?: string }) =>
  `${p.title}\n${(p.abstract ?? "").slice(0, 1000)}`;

/** 3 decimals keep the cache file about a third of the size */
export const quantize = (v: number[]) =>
  v.map((x) => Math.round(x * 1000) / 1000);

export interface Scored {
  id: number;
  score: number;
}
export function rankRelated(
  target: number[],
  pool: { id: number; vec: number[] }[],
  exclude: Set<number>,
  top = 8,
): Scored[] {
  return pool
    .filter((p) => !exclude.has(p.id))
    .map((p) => ({ id: p.id, score: denseCosine(target, p.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

/** Offline ranking: TF-IDF cosine over each item's own words, no key needed. */
export function rankOffline(
  docs: { id: number; text: string }[],
  targetId: number,
  exclude: Set<number>,
  top = 8,
): Scored[] {
  const toks = new Map(docs.map((d) => [d.id, tokenize(d.text)]));
  const model = new TfIdf([...toks.values()]);
  const target = model.vector(toks.get(targetId) ?? []);
  if (!target.size) return [];
  return docs
    .filter((d) => !exclude.has(d.id))
    .map((d) => ({
      id: d.id,
      score: cosine(target, model.vector(toks.get(d.id)!)),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}
