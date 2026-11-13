import { denseCosine } from "./vec";

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
