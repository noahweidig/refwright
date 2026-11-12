import { stem, foldAccents } from "./text";
import { isReserved } from "./tags";

export interface CleanOptions {
  removeSlashes: boolean;
  removeWeird: boolean;
  mergeDuplicates: boolean;
  reuseExisting: boolean;
  letterCase: "keep" | "lower" | "snake" | "kebab" | "title";
  separator: "keep" | "space" | "underscore" | "hyphen";
  maxTags: number;
  maxWords: number;
  maxLength: number;
  prefix: string;
  blacklist: string[];
  replacements: [string, string][];
}
export const defaultCleanOptions: CleanOptions = {
  removeSlashes: true,
  removeWeird: true,
  mergeDuplicates: true,
  reuseExisting: true,
  letterCase: "lower",
  separator: "keep",
  maxTags: 8,
  maxWords: 4,
  maxLength: 40,
  prefix: "",
  blacklist: [],
  replacements: [],
};

/** key under which two spellings count as the same tag */
export function tagKey(t: string): string {
  return foldAccents(t)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem)
    .join("");
}

const TITLE_SMALL = new Set(
  "a an and as at but by for in of on or the to vs".split(" "),
);

function applyCase(t: string, c: CleanOptions["letterCase"]): string {
  switch (c) {
    case "lower":
      return t.toLowerCase();
    case "snake":
      return t.toLowerCase().replace(/[\s-]+/g, "_");
    case "kebab":
      return t.toLowerCase().replace(/[\s_]+/g, "-");
    case "title":
      return t
        .split(/(\s+)/)
        .map((w, i) =>
          /^\s+$/.test(w) || (i > 0 && TITLE_SMALL.has(w.toLowerCase()))
            ? w.toLowerCase()
            : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join("");
    default:
      return t;
  }
}

function applySeparator(t: string, s: CleanOptions["separator"]): string {
  if (s === "keep") return t;
  const sep = s === "space" ? " " : s === "underscore" ? "_" : "-";
  return t.replace(/[\s_-]+/g, sep);
}

/** Clean one tag. Returns "" when it should be dropped. */
export function cleanTag(raw: string, o: CleanOptions): string {
  if (isReserved(raw)) return raw;
  let t = raw.trim().replace(/\s+/g, " ");
  for (const [from, to] of o.replacements)
    if (tagKey(t) === tagKey(from)) t = to;
  if (o.removeSlashes) t = t.replace(/[\\/]+/g, " ");
  if (o.removeWeird)
    t = t
      .replace(/[^\p{L}\p{N}\s\-_'’.+#&:()]/gu, " ")
      .replace(/^[\s\-_.:]+|[\s\-_.:]+$/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = applySeparator(t, o.separator);
  t = applyCase(t, o.letterCase);
  if (o.maxWords > 0 && t.split(/[\s_-]+/).filter(Boolean).length > o.maxWords)
    return "";
  if (o.maxLength > 0 && t.length > o.maxLength) return "";
  const k = tagKey(t);
  if (o.blacklist.some((b) => tagKey(b) === k)) return "";
  return t;
}

/** Full pipeline for one item's suggestions. */
export function cleanTags(
  tags: string[],
  o: CleanOptions,
  libraryTags: string[] = [],
  existing: string[] = [],
): string[] {
  const lib = new Map<string, string>();
  if (o.reuseExisting)
    for (const t of libraryTags) if (!lib.has(tagKey(t))) lib.set(tagKey(t), t);
  const have = new Set(existing.map(tagKey));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    let t = cleanTag(raw, o);
    if (!t) continue;
    const k = tagKey(t);
    if (!k || isReserved(t)) {
      continue;
    }
    if (o.reuseExisting && lib.has(k)) t = lib.get(k)!;
    if (have.has(k)) continue;
    if (o.mergeDuplicates && seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (o.maxTags > 0 && out.length >= o.maxTags) break;
  }
  return o.prefix ? out.map((t) => o.prefix + t) : out;
}

/** "ML -> machine learning" lines to pairs */
export function parseReplacements(s: string): [string, string][] {
  return s
    .split("\n")
    .map((l) => l.split(/\s*(?:->|=>|→)\s*/))
    .filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
    .map((p) => [p[0].trim(), p[1].trim()] as [string, string]);
}
