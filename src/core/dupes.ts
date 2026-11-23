export type MasterPolicy = "oldest" | "newest" | "modified" | "complete";
export type DupAction = "ask" | "keepNew" | "keepOld" | "keepAll";

export interface DupCand {
  id: number;
  key: string;
  added: string;
  modified: string;
  /** count of non-empty fields */
  filled: number;
  attachments: number;
  notes: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function pickMaster(items: DupCand[], policy: MasterPolicy): number {
  const s = [...items];
  if (policy === "newest")
    s.sort((a, b) => cmp(b.added, a.added) || b.id - a.id);
  else if (policy === "modified")
    s.sort((a, b) => cmp(b.modified, a.modified) || a.id - b.id);
  else if (policy === "complete")
    s.sort(
      (a, b) =>
        b.attachments * 3 +
          b.notes +
          b.filled -
          (a.attachments * 3 + a.notes + a.filled) ||
        cmp(a.added, b.added) ||
        a.id - b.id,
    );
  else s.sort((a, b) => cmp(a.added, b.added) || a.id - b.id);
  return s[0].id;
}

/** Fields the master lacks that a duplicate has. First duplicate with a value wins. */
export function smartFill(
  master: Record<string, string>,
  others: Record<string, string>[],
  allowed: (field: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of others)
    for (const [k, v] of Object.entries(o)) {
      if (!v || master[k] || out[k] || !allowed(k)) continue;
      out[k] = v;
    }
  return out;
}

/** order-free key for a non-duplicate pair */
export const pairKey = (libraryID: number, a: string, b: string) =>
  `${libraryID}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;

export interface NonDupFile {
  version: 1;
  pairs: { libraryID: number; a: string; b: string }[];
}

export function exportNonDups(keys: string[]): NonDupFile {
  return {
    version: 1,
    pairs: keys.map((k) => {
      const [lib, rest] = k.split(":");
      const [a, b] = rest.split("|");
      return { libraryID: Number(lib), a, b };
    }),
  };
}

/** Additive. Returns keys to add; malformed rows are skipped. */
export function importNonDups(data: unknown): string[] {
  const pairs = (data as NonDupFile)?.pairs;
  if (!Array.isArray(pairs)) throw new Error("not a non-duplicates file");
  return pairs
    .filter(
      (p) =>
        p &&
        Number.isInteger(p.libraryID) &&
        typeof p.a === "string" &&
        typeof p.b === "string" &&
        p.a &&
        p.b &&
        p.a !== p.b,
    )
    .map((p) => pairKey(p.libraryID, p.a, p.b));
}

/** Splits a duplicate set into groups where no two members are marked as non-duplicates. Greedy, keeps order. */
export function splitByNonDups(
  keys: string[],
  isNonDup: (a: string, b: string) => boolean,
): string[][] {
  const groups: string[][] = [];
  for (const k of keys) {
    const g = groups.find((g) => g.every((m) => !isNonDup(m, k)));
    if (g) g.push(k);
    else groups.push([k]);
  }
  return groups.filter((g) => g.length > 1);
}
