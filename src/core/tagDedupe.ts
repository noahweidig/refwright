import { levenshtein, words } from "./text";
import { tagKey } from "./tagCleaner";
import { CleanOptions, cleanTag } from "./tagCleaner";
import { isReserved } from "./tags";

export interface TagCount {
  name: string;
  count: number;
}
export type DupReason =
  "case/plural" | "word order" | "typo" | "abbreviation" | "similar meaning";
export interface DupGroup {
  reason: DupReason;
  tags: TagCount[];
  target: string;
}

export function pickTarget(tags: TagCount[]): string {
  return [...tags].sort(
    (a, b) =>
      b.count - a.count ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  )[0].name;
}

const acronym = (t: string) =>
  words(t)
    .map((w) => w[0])
    .join("");

/** Local duplicate scan. Reserved status tags are never touched. */
export function findDuplicates(all: TagCount[]): DupGroup[] {
  const it = scanDuplicates(all);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Same scan, but hands control back to the event loop so the UI stays live. */
export async function findDuplicatesAsync(
  all: TagCount[],
  yieldNow: () => Promise<void>,
): Promise<DupGroup[]> {
  const it = scanDuplicates(all);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await yieldNow(); // NOSONAR: each slice must finish before the next starts
  }
}

class Groups {
  private parent = new Map<string, string>();
  private reason = new Map<string, DupReason>();
  constructor(names: string[]) {
    for (const n of names) this.parent.set(n, n);
  }
  find(x: string): string {
    while (this.parent.get(x) !== x) x = this.parent.get(x)!;
    return x;
  }
  union(a: string, b: string, r: DupReason) {
    const ra = this.find(a),
      rb = this.find(b);
    if (ra === rb) return;
    this.parent.set(ra, rb);
    if (!this.reason.has(rb)) this.reason.set(rb, r);
  }
  reasonOf(root: string): DupReason {
    return this.reason.get(root) ?? "case/plural";
  }
}

function sameKey(tags: TagCount[], g: Groups) {
  const byKey = new Map<string, string>();
  for (const t of tags) {
    const k = tagKey(t.name);
    const hit = byKey.get(k);
    if (hit) g.union(t.name, hit, "case/plural");
    else byKey.set(k, t.name);
  }
}

function sameWords(tags: TagCount[], g: Groups) {
  const byOrder = new Map<string, string>();
  for (const t of tags) {
    const ws = words(t.name);
    if (ws.length < 2) continue;
    const k = [...ws].sort().join(" ");
    const hit = byOrder.get(k);
    if (hit && tagKey(hit) !== tagKey(t.name))
      g.union(t.name, hit, "word order");
    else byOrder.set(k, t.name);
  }
}

/** every variant of a key with up to two characters removed (one for short keys) */
function* deletions(k: string): Generator<string> {
  for (let x = 0; x < k.length; x++) {
    const d1 = k.slice(0, x) + k.slice(x + 1);
    yield d1;
    if (k.length > 10)
      for (let y = x; y < d1.length; y++)
        yield d1.slice(0, y) + d1.slice(y + 1);
  }
}

const typoLimit = (a: string, b: string) =>
  Math.max(a.length, b.length) > 12 ? 2 : 1;

/**
 * Typos via deletion neighbourhoods: strings within edit distance k share a
 * variant with at most k characters removed, so only bucket-mates are compared.
 * Buckets over 40 hold unrelated tags that share words, not typos.
 */
function* typos(tags: TagCount[], g: Groups): Generator<void> {
  const keys = tags
    .map((t) => [t.name, tagKey(t.name)] as const)
    .filter(([, k]) => k.length >= 6);
  const buckets = new Map<string, number[]>();
  const add = (v: string, i: number) => {
    const b = buckets.get(v);
    if (!b) buckets.set(v, [i]);
    else if (b.at(-1) !== i) b.push(i);
  };
  let t0 = Date.now();
  const tick = () => {
    if (Date.now() - t0 <= 12) return false;
    t0 = Date.now();
    return true;
  };
  for (let i = 0; i < keys.length; i++) {
    add(keys[i][1], i);
    for (const v of deletions(keys[i][1])) add(v, i);
    if (tick()) yield;
  }
  const seen = new Set<number>();
  for (const b of buckets.values()) {
    if (b.length > 1 && b.length <= 40) comparePairs(b, keys, seen, g);
    if (tick()) yield;
  }
}

function comparePairs(
  b: number[],
  keys: (readonly [string, string])[],
  seen: Set<number>,
  g: Groups,
) {
  for (let x = 0; x < b.length; x++)
    for (let y = x + 1; y < b.length; y++) {
      const i = Math.min(b[x], b[y]),
        j = Math.max(b[x], b[y]);
      const id = i * keys.length + j;
      if (seen.has(id)) continue;
      seen.add(id);
      const [na, ka] = keys[i],
        [nb, kb] = keys[j];
      if (ka === kb || Math.abs(ka.length - kb.length) > 2) continue;
      if (levenshtein(ka, kb) <= typoLimit(ka, kb)) g.union(na, nb, "typo");
    }
}

function abbreviations(tags: TagCount[], g: Groups) {
  const singles = new Map(
    tags
      .filter((t) => words(t.name).length === 1)
      .map((t) => [t.name.toLowerCase(), t.name]),
  );
  for (const t of tags) {
    if (words(t.name).length < 2) continue;
    const a = singles.get(acronym(t.name));
    if (a && a.length >= 2) g.union(t.name, a, "abbreviation");
  }
}

function collect(tags: TagCount[], g: Groups): DupGroup[] {
  const groups = new Map<string, TagCount[]>();
  for (const t of tags) {
    const r = g.find(t.name);
    groups.set(r, [...(groups.get(r) ?? []), t]);
  }
  return [...groups.entries()]
    .filter(([, m]) => m.length > 1)
    .map(([root, m]) => ({
      reason: g.reasonOf(root),
      tags: m,
      target: pickTarget(m),
    }))
    .sort((a, b) => b.tags.length - a.tags.length);
}

function* scanDuplicates(all: TagCount[]): Generator<void, DupGroup[]> {
  const tags = all.filter((t) => !isReserved(t.name));
  const g = new Groups(tags.map((t) => t.name));
  sameKey(tags, g);
  sameWords(tags, g);
  yield* typos(tags, g);
  abbreviations(tags, g);
  return collect(tags, g);
}

/** tags that violate the cleanup settings, with their cleaned form ("" = drop) */
export function findFormatting(all: TagCount[], o: CleanOptions) {
  return all
    .filter((t) => !isReserved(t.name))
    .map((t) => ({ ...t, fixed: cleanTag(t.name, o) }))
    .filter((t) => t.fixed !== t.name);
}
