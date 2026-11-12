import { levenshtein, words } from "./text";
import { tagKey } from "./tagCleaner";

export interface Learned {
  removed: Record<string, number>; // net removals (removals - keeps)
  swaps: Record<string, { to: string; n: number }>;
}
export const emptyLearned = (): Learned => ({ removed: {}, swaps: {} });

const initials = (t: string) =>
  words(t)
    .map((w) => w[0])
    .join("");

function related(a: string, b: string) {
  const ka = tagKey(a),
    kb = tagKey(b);
  const shared = words(a).filter((w) => words(b).includes(w)).length;
  return (
    shared * 3 +
    (initials(b) === a.toLowerCase() || initials(a) === b.toLowerCase()
      ? 5
      : 0) -
    levenshtein(ka, kb) / Math.max(ka.length, kb.length, 1)
  );
}

/** Learn from one reviewed item. Whole-item deselect/dismiss: do not call. */
export function learnFromEdit(
  state: Learned,
  suggested: string[],
  final: string[],
): Learned {
  const s = new Map(suggested.map((t) => [tagKey(t), t]));
  const f = new Map(final.map((t) => [tagKey(t), t]));
  const removed = [...s].filter(([k]) => !f.has(k)).map(([, t]) => t);
  const added = [...f].filter(([k]) => !s.has(k)).map(([, t]) => t);
  const kept = [...s].filter(([k]) => f.has(k)).map(([, t]) => t);
  const next: Learned = JSON.parse(JSON.stringify(state));
  for (const t of kept) {
    const k = tagKey(t);
    if (next.removed[k]) next.removed[k] = Math.max(0, next.removed[k] - 1);
  }
  const pool = [...added];
  for (const t of removed) {
    const k = tagKey(t);
    next.removed[k] = (next.removed[k] ?? 0) + 1;
    if (!pool.length) continue;
    const best = pool.reduce((m, c) => (related(t, c) > related(t, m) ? c : m));
    if (removed.length === 1 || related(t, best) > 0) {
      const cur = next.swaps[k];
      next.swaps[k] =
        cur && tagKey(cur.to) === tagKey(best)
          ? { to: best, n: cur.n + 1 }
          : { to: best, n: 1 };
      if (removed.length > 1) pool.splice(pool.indexOf(best), 1);
    }
  }
  return next;
}

/** hide tags removed twice net; apply swaps made twice */
export function applyLearned(state: Learned, tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const k = tagKey(t);
    const sw = state.swaps[k];
    if (sw && sw.n >= 2) {
      out.push(sw.to);
      continue;
    }
    if ((state.removed[k] ?? 0) >= 2) continue;
    out.push(t);
  }
  return out;
}
