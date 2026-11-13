import { STOPWORDS, stem, tokenize, words } from "./text";
import { TfIdf } from "./tfidf";
import { addTo, norm, SVec } from "./vec";

export interface Cluster {
  ids: number[];
  /** suggested collection name from the cluster's strongest words */
  name: string;
}
export interface ClusterOptions {
  /** cosine a paper needs to join a cluster */
  threshold: number;
  minSize: number;
  maxClusters: number;
}
export const defaultClusterOptions: ClusterOptions = {
  threshold: 0.25,
  minSize: 4,
  maxClusters: 30,
};

interface Centroid {
  sum: SVec;
  norm: number;
  members: number[];
}

/** stem -> the plain word seen most often, so names read as words, not stems */
export function surfaceForms(texts: string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const t of texts)
    for (const w of words(t)) {
      if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      const m = counts.get(stem(w)) ?? new Map<string, number>();
      m.set(w, (m.get(w) ?? 0) + 1);
      counts.set(stem(w), m);
    }
  const out = new Map<string, string>();
  for (const [s, m] of counts)
    out.set(
      s,
      [...m].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0],
    );
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function nameFor(sum: SVec, forms: Map<string, string>, n = 2): string {
  const top = [...sum]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([s]) => forms.get(s) ?? s);
  return capital(top.join(" "));
}

/** runs of consecutive content words in a title; stop words and short words end a run */
function runs(title: string): string[][] {
  const out: string[][] = [[]];
  for (const w of words(title)) {
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) out.push([]);
    else out[out.length - 1].push(w);
  }
  return out.filter((r) => r.length >= 2);
}

/**
 * The 2 to 3 word phrase that the most titles in a cluster share, such as
 * "wildland urban interface". Needs at least a quarter of the titles (and 2).
 */
export function phraseFor(titles: string[]): string | undefined {
  const df = new Map<string, number>();
  for (const t of titles) {
    const seen = new Set<string>();
    for (const r of runs(t))
      for (let n = 2; n <= Math.min(3, r.length); n++)
        for (let i = 0; i + n <= r.length; i++)
          seen.add(r.slice(i, i + n).join(" "));
    for (const p of seen) df.set(p, (df.get(p) ?? 0) + 1);
  }
  const need = Math.max(2, Math.ceil(titles.length / 4));
  const best = [...df]
    .filter(([, n]) => n >= need)
    .sort(
      (a, b) =>
        b[1] * 1.5 ** b[0].split(" ").length -
        a[1] * 1.5 ** a[0].split(" ").length,
    )[0];
  return best ? capital(best[0]) : undefined;
}

function best(vec: SVec, cents: Centroid[]): [number, number] {
  let bi = -1;
  let bs = 0;
  cents.forEach((c, i) => {
    const d = c.norm * norm(vec);
    const s = d ? dotNorm(vec, c.sum) / d : 0;
    if (s > bs) [bi, bs] = [i, s];
  });
  return [bi, bs];
}

function dotNorm(a: SVec, b: SVec) {
  let s = 0;
  for (const [k, v] of a) s += v * (b.get(k) ?? 0);
  return s;
}

function assign(vecs: SVec[], order: number[], th: number, seed: Centroid[]) {
  const cents = seed;
  for (const i of order) {
    const [ci, s] = best(vecs[i], cents);
    if (ci >= 0 && s >= th) {
      addTo(cents[ci].sum, vecs[i]);
      cents[ci].norm = norm(cents[ci].sum);
      cents[ci].members.push(i);
    } else {
      const sum: SVec = new Map(vecs[i]);
      cents.push({ sum, norm: norm(sum), members: [i] });
    }
  }
  return cents;
}

/** Fresh centroids from a pass's members, to reassign everyone against settled centres. */
function settle(vecs: SVec[], cents: Centroid[]): Centroid[] {
  return cents
    .filter((c) => c.members.length > 1)
    .map((c) => {
      const sum: SVec = new Map();
      for (const i of c.members) addTo(sum, vecs[i]);
      return { sum, norm: norm(sum), members: [] };
    });
}

/**
 * Leader clustering over TF-IDF: a paper joins the closest cluster if it is close enough, else starts
 * one. A second pass reassigns everyone against the settled centres. Yields now and then.
 */
export function* clusterDocs(
  docs: { id: number; text: string; title?: string }[],
  opt: ClusterOptions = defaultClusterOptions,
): Generator<void, Cluster[]> {
  const toks = docs.map((d) => tokenize(d.text));
  const model = new TfIdf(toks);
  const vecs = toks.map((t) => model.vector(t));
  const order = docs
    .map((_, i) => i)
    .sort((a, b) => toks[b].length - toks[a].length);
  let cents = assign(vecs, order, opt.threshold, []);
  yield;
  cents = assign(vecs, order, opt.threshold, settle(vecs, cents));
  const forms = surfaceForms(docs.map((d) => d.text));
  return cents
    .filter((c) => c.members.length >= opt.minSize)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, opt.maxClusters)
    .map((c) => ({
      ids: c.members.map((i) => docs[i].id),
      name:
        phraseFor(c.members.map((i) => docs[i].title ?? "")) ??
        nameFor(c.sum, forms),
    }));
}
