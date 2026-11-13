import { normalizeTitle, tokenize } from "./text";
import { TfIdf } from "./tfidf";
import { cosine, SVec } from "./vec";

export interface DupDoc {
  id: number;
  title: string;
  abstract: string;
  /** first author's family name, lowercase */
  author: string;
  year?: number;
  doi: string;
  /** a preprint item, or a DOI from a preprint server */
  preprint: boolean;
}
export interface NearGroup {
  ids: number[];
  /** best title similarity in the group, 0 to 1 */
  score: number;
  reason: string;
}

interface Pair {
  a: DupDoc;
  b: DupDoc;
  ts: number;
  cs: number;
}

const yearsClose = (a: DupDoc, b: DupDoc) =>
  !a.year || !b.year || Math.abs(a.year - b.year) <= 3;
const sameAuthor = (a: DupDoc, b: DupDoc) =>
  !!a.author && a.author === b.author;

/** What Zotero's own duplicate finder already catches: same DOI or the same title. */
function zoteroSees(a: DupDoc, b: DupDoc) {
  if (a.doi && a.doi === b.doi) return true;
  return normalizeTitle(a.title) === normalizeTitle(b.title);
}

export function qualifies(p: Pair): boolean {
  const { a, b, ts, cs } = p;
  if (zoteroSees(a, b) || !yearsClose(a, b)) return false;
  if (ts >= 0.85) return true;
  return sameAuthor(a, b) && (ts >= 0.6 || cs >= 0.7);
}

export function reasonFor(p: Pair): string {
  if (p.a.preprint !== p.b.preprint) return "preprint and published version";
  return p.ts >= 0.85 ? "similar title" : "same author, similar content";
}

/** pairs sharing at least two uncommon title words */
function candidates(docs: DupDoc[], toks: string[][]): [number, number][] {
  const post = new Map<string, number[]>();
  toks.forEach((t, i) => {
    for (const w of new Set(t)) post.set(w, [...(post.get(w) ?? []), i]);
  });
  const shared = new Map<number, number>();
  for (const ids of post.values()) {
    if (ids.length > 40) continue;
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        const k = ids[x] * docs.length + ids[y];
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
  }
  return [...shared]
    .filter(([, n]) => n >= 2)
    .map(([k]) => [Math.floor(k / docs.length), k % docs.length]);
}

class Union {
  private parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    while (this.parent.get(x) !== x) x = this.parent.get(x)!;
    return x;
  }
  join(a: number, b: number) {
    this.parent.set(this.find(a), this.find(b));
  }
}

function groupsOf(pairs: Pair[]): NearGroup[] {
  const u = new Union();
  for (const p of pairs) u.join(p.a.id, p.b.id);
  const out = new Map<number, NearGroup>();
  for (const p of pairs) {
    const root = u.find(p.a.id);
    const g = out.get(root) ?? { ids: [], score: 0, reason: reasonFor(p) };
    for (const id of [p.a.id, p.b.id]) if (!g.ids.includes(id)) g.ids.push(id);
    g.score = Math.max(g.score, p.ts);
    out.set(root, g);
  }
  return [...out.values()].sort((x, y) => y.score - x.score);
}

/** Near-duplicate groups, found offline. Yields now and then so a caller can keep its UI responsive. */
export function* findNearDuplicates(
  docs: DupDoc[],
): Generator<void, NearGroup[]> {
  const tTok = docs.map((d) => tokenize(d.title));
  const aTok = docs.map((d) => tokenize(`${d.title} ${d.abstract}`));
  const tModel = new TfIdf(tTok);
  const aModel = new TfIdf(aTok);
  const tVec: SVec[] = tTok.map((t) => tModel.vector(t));
  const aVec: SVec[] = aTok.map((t) => aModel.vector(t));
  const pairs: Pair[] = [];
  let t0 = Date.now();
  for (const [i, j] of candidates(docs, tTok)) {
    const p = {
      a: docs[i],
      b: docs[j],
      ts: cosine(tVec[i], tVec[j]),
      cs: cosine(aVec[i], aVec[j]),
    };
    if (qualifies(p)) pairs.push(p);
    if (Date.now() - t0 > 12) {
      yield;
      t0 = Date.now();
    }
  }
  return groupsOf(pairs);
}

export function runToEnd<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
