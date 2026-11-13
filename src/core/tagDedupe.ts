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
    await yieldNow();
  }
}

function* scanDuplicates(all: TagCount[]): Generator<void, DupGroup[]> {
  const tags = all.filter((t) => !isReserved(t.name));
  const parent = new Map<string, string>();
  const reason = new Map<string, DupReason>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  tags.forEach((t) => parent.set(t.name, t.name));
  const union = (a: string, b: string, r: DupReason) => {
    const ra = find(a),
      rb = find(b);
    if (ra === rb) return;
    parent.set(ra, rb);
    if (!reason.has(rb)) reason.set(rb, r);
  };
  const byKey = new Map<string, string>();
  const byOrder = new Map<string, string>();
  for (const t of tags) {
    const k = tagKey(t.name);
    if (byKey.has(k)) union(t.name, byKey.get(k)!, "case/plural");
    else byKey.set(k, t.name);
  }
  for (const t of tags) {
    const ws = words(t.name);
    if (ws.length < 2) continue;
    const k = [...ws].sort().join(" ");
    if (byOrder.has(k) && tagKey(byOrder.get(k)!) !== tagKey(t.name))
      union(t.name, byOrder.get(k)!, "word order");
    else byOrder.set(k, t.name);
  }
  const keys = tags
    .map((t) => [t.name, tagKey(t.name)] as const)
    .filter(([, k]) => k.length >= 6);
  // deletion neighbourhoods: strings within edit distance k share a variant
  // with at most k characters removed, so only bucket-mates need comparing
  const buckets = new Map<string, number[]>();
  const add = (v: string, i: number) => {
    const b = buckets.get(v);
    if (b) {
      if (b[b.length - 1] !== i) b.push(i);
    } else buckets.set(v, [i]);
  };
  let t0 = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i][1];
    add(k, i);
    for (let x = 0; x < k.length; x++) {
      const d1 = k.slice(0, x) + k.slice(x + 1);
      add(d1, i);
      if (k.length > 10)
        for (let y = x; y < d1.length; y++)
          add(d1.slice(0, y) + d1.slice(y + 1), i);
    }
    if (Date.now() - t0 > 12) {
      yield;
      t0 = Date.now();
    }
  }
  const seen = new Set<number>();
  for (const b of buckets.values()) {
    if (b.length < 2 || b.length > 40) continue;
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
        if (
          levenshtein(ka, kb) <= (Math.max(ka.length, kb.length) > 12 ? 2 : 1)
        )
          union(na, nb, "typo");
      }
    if (Date.now() - t0 > 12) {
      yield;
      t0 = Date.now();
    }
  }
  const singles = new Map(
    tags
      .filter((t) => words(t.name).length === 1)
      .map((t) => [t.name.toLowerCase(), t.name]),
  );
  for (const t of tags) {
    if (words(t.name).length < 2) continue;
    const a = singles.get(acronym(t.name));
    if (a && a.length >= 2) union(t.name, a, "abbreviation");
  }
  const groups = new Map<string, TagCount[]>();
  for (const t of tags) {
    const r = find(t.name);
    groups.set(r, [...(groups.get(r) ?? []), t]);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([root, g]) => ({
      reason: reason.get(root) ?? "case/plural",
      tags: g,
      target: pickTarget(g),
    }))
    .sort((a, b) => b.tags.length - a.tags.length);
}

/** tags that violate the cleanup settings, with their cleaned form ("" = drop) */
export function findFormatting(all: TagCount[], o: CleanOptions) {
  return all
    .filter((t) => !isReserved(t.name))
    .map((t) => ({ ...t, fixed: cleanTag(t.name, o) }))
    .filter((t) => t.fixed !== t.name);
}
