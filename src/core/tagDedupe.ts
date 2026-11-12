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
  const keys = tags.map((t) => [t.name, tagKey(t.name)] as const);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const [a, ka] = keys[i],
        [b, kb] = keys[j];
      if (ka === kb || Math.min(ka.length, kb.length) < 6) continue;
      if (Math.abs(ka.length - kb.length) > 2) continue;
      if (levenshtein(ka, kb) <= (Math.max(ka.length, kb.length) > 12 ? 2 : 1))
        union(a, b, "typo");
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
