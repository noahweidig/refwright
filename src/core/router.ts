import { tokenize } from "./text";
import { TfIdf } from "./tfidf";
import { SVec, addTo, cosine, dot, norm } from "./vec";

export interface RItem {
  id: number;
  title: string;
  abstract?: string;
  tags?: string[];
  venue?: string;
  collections: number[];
}
export interface RColl {
  id: number;
  name: string;
  parent?: number | null;
}
export interface RouteOptions {
  ignore: string[]; // words; name containing any => never suggested / no evidence
  minConfidence: number; // 0 = auto
  maxPicks: number;
  neighbors: number;
  rejected?: Record<number, number>; // collId -> reject count
  excludeSelf?: boolean;
}
export const defaultRouteOptions: RouteOptions = {
  ignore: ["inbox"],
  minConfidence: 0,
  maxPicks: 4,
  neighbors: 10,
  excludeSelf: true,
};
export type Confidence = "high" | "medium" | "low";
export interface Suggestion {
  collectionId: number;
  score: number;
  confidence: Confidence;
  already: boolean;
  why: { words: string[]; papers: string[] };
}

export const itemText = (i: RItem) =>
  tokenize(
    [i.title, i.title, i.abstract, (i.tags ?? []).join(" "), i.venue]
      .filter(Boolean)
      .join(" "),
  );

export function confidenceOf(score: number): Confidence {
  return score >= 0.5 ? "high" : score >= 0.3 ? "medium" : "low";
}

/** Collection profiles + neighbour search, built once, queried many times. */
export class RouterIndex {
  private tfidf: TfIdf;
  private vecs = new Map<number, SVec>();
  private items = new Map<number, RItem>();
  private sums = new Map<number, SVec>();
  private counts = new Map<number, number>();
  private collById = new Map<number, RColl>();
  private ignored = new Set<number>();
  private nameTokens = new Map<number, string[]>();
  private median = 1;

  constructor(
    colls: RColl[],
    items: RItem[],
    private opts: RouteOptions = defaultRouteOptions,
  ) {
    const ign = opts.ignore.map((w) => w.toLowerCase()).filter(Boolean);
    for (const c of colls) {
      this.collById.set(c.id, c);
      this.nameTokens.set(c.id, tokenize(c.name));
      if (ign.some((w) => c.name.toLowerCase().includes(w)))
        this.ignored.add(c.id);
    }
    const toks = new Map<number, string[]>();
    for (const it of items) {
      toks.set(it.id, itemText(it));
      this.items.set(it.id, it);
    }
    this.tfidf = new TfIdf([...toks.values()]);
    for (const it of items) {
      const ev = it.collections.filter(
        (c) => this.collById.has(c) && !this.ignored.has(c),
      );
      if (!ev.length) continue; // filed only in ignored collections: no evidence
      const v = this.tfidf.vector(toks.get(it.id)!);
      this.vecs.set(it.id, v);
      for (const c of ev) {
        const s = this.sums.get(c) ?? new Map();
        addTo(s, v);
        this.sums.set(c, s);
        this.counts.set(c, (this.counts.get(c) ?? 0) + 1);
      }
    }
    const sizes = [...this.counts.values()].sort((a, b) => a - b);
    this.median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 1;
  }

  rank(paper: RItem): Suggestion[] {
    const o = this.opts;
    const pv = this.tfidf.vector(itemText(paper));
    const self = o.excludeSelf !== false;
    // neighbours
    const sims: [number, number][] = [];
    for (const [id, v] of this.vecs) {
      if (self && id === paper.id) continue;
      const s = cosine(pv, v);
      if (s > 0) sims.push([id, s]);
    }
    sims.sort((a, b) => b[1] - a[1]);
    const top = sims.slice(0, o.neighbors);
    const topSum = top.reduce((a, [, s]) => a + s, 0) || 1;
    const topMax = top[0]?.[1] ?? 0;
    const pTokens = new Set(itemText(paper));
    const out: Suggestion[] = [];
    for (const [cid, sum] of this.sums) {
      if (this.ignored.has(cid)) continue;
      let prof = sum;
      let n = this.counts.get(cid) ?? 0;
      if (self && this.vecs.has(paper.id) && this.isMember(paper.id, cid)) {
        prof = new Map(sum);
        addTo(prof, this.vecs.get(paper.id)!, -1);
        n--;
      }
      if (n <= 0 && !this.nameTokens.get(cid)?.length) continue;
      const profSim = n > 0 ? dot(pv, prof) / (norm(pv) * norm(prof) || 1) : 0;
      let nb = 0;
      const papers: string[] = [];
      for (const [id, s] of top) {
        if (this.isMember(id, cid)) {
          nb += s;
          if (papers.length < 3) papers.push(this.items.get(id)!.title);
        }
      }
      nb = (nb / topSum) * Math.min(1, topMax * 2);
      const nt = this.nameTokens.get(cid) ?? [];
      const nm = nt.length
        ? nt.filter((t) => pTokens.has(t)).length / nt.length
        : 0;
      let score = 0.55 * Math.min(1, profSim * 1.6) + 0.3 * nb + 0.15 * nm;
      if (n > 3 * this.median && n > 20)
        score *= Math.sqrt((3 * this.median) / n);
      const rej = o.rejected?.[cid] ?? 0;
      if (rej) score *= Math.pow(0.5, rej);
      if (score <= 0) continue;
      const words = [...pTokens]
        .map((t) => [t, (prof.get(t) ?? 0) * this.tfidf.idf(t)] as const)
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);
      out.push({
        collectionId: cid,
        score,
        confidence: confidenceOf(score),
        already: paper.collections.includes(cid),
        why: { words, papers },
      });
    }
    out.sort((a, b) => b.score - a.score);
    return this.finish(out);
  }

  private isMember(itemId: number, cid: number) {
    return this.items.get(itemId)?.collections.includes(cid) ?? false;
  }

  /** hierarchy, thresholds, cap */
  finish(sorted: Suggestion[]): Suggestion[] {
    const o = this.opts;
    const byId = new Map(sorted.map((s) => [s.collectionId, s]));
    const top = sorted[0]?.score ?? 0;
    const min =
      o.minConfidence > 0 ? o.minConfidence : Math.max(0.12, top * 0.35);
    const kept = sorted.filter((s) => {
      if (s.already) return true;
      if (s.score < min) return false;
      const p = this.collById.get(s.collectionId)?.parent;
      const ps = p != null ? byId.get(p) : undefined;
      if (ps && ps.confidence === "high" && ps.score >= s.score) return false;
      return true;
    });
    return kept;
  }

  /** pre-selected picks for the dialogs */
  picks(s: Suggestion[]): number[] {
    const fresh = s.filter((x) => !x.already);
    const already = s.filter((x) => x.already).map((x) => x.collectionId);
    const room = Math.max(0, this.opts.maxPicks - already.length);
    return [
      ...already,
      ...fresh
        .filter((x) => x.confidence !== "low")
        .slice(0, room)
        .map((x) => x.collectionId),
    ];
  }
}

/** embedding mode: cosine + depth/specificity penalty on top of dense vectors */
export function rankEmbeddings(
  paper: number[],
  colls: { id: number; vec: number[]; depth: number }[],
  cos: (a: number[], b: number[]) => number,
): { collectionId: number; score: number }[] {
  return colls
    .map((c) => ({
      collectionId: c.id,
      score: Math.max(0, cos(paper, c.vec)) * (1 - 0.03 * Math.min(c.depth, 5)),
    }))
    .sort((a, b) => b.score - a.score);
}

/** parse "Name | high" / JSON arrays from an LLM ranking */
export function parseLlmRanking(
  text: string,
  names: Map<string, number>,
): { collectionId: number; confidence: Confidence }[] {
  const out: { collectionId: number; confidence: Confidence }[] = [];
  const seen = new Set<number>();
  const push = (name: string, conf: string) => {
    const id = names.get(name.trim().toLowerCase());
    if (id == null || seen.has(id)) return;
    seen.add(id);
    const c = conf.toLowerCase();
    out.push({
      collectionId: id,
      confidence: c.startsWith("h")
        ? "high"
        : c.startsWith("m")
          ? "medium"
          : "low",
    });
  };
  const json = text.match(/\[[\s\S]*\]/)?.[0];
  if (json) {
    try {
      for (const r of JSON.parse(json))
        push(
          String(r.collection ?? r.name ?? ""),
          String(r.confidence ?? "low"),
        );
      if (out.length) return out;
    } catch {
      /* fall through to line parsing */
    }
  }
  for (const line of text.split("\n")) {
    const m = line
      .replace(/^[\s\-*\d.)]+/, "")
      .match(/^(.*?)[|:,-]\s*(high|medium|low)\b/i);
    if (m) push(m[1].replace(/^["'`]|["'`]$/g, ""), m[2]);
  }
  return out;
}
