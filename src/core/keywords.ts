import { STOPWORDS, words } from "./text";

/** Offline keyword phrases: repeated or title-borne 1-3 word phrases. */
export function extractKeywords(
  title: string,
  abstract = "",
  limit = 6,
): string[] {
  const score = new Map<string, number>();
  const bump = (p: string, w: number) => score.set(p, (score.get(p) ?? 0) + w);
  const scan = (text: string, weight: number) => {
    const runs = text.split(/[.;:!?()[\],\n]+/);
    for (const run of runs) {
      const ws = words(run);
      for (let n = 1; n <= 3; n++)
        for (let i = 0; i + n <= ws.length; i++) {
          const g = ws.slice(i, i + n);
          if (STOPWORDS.has(g[0]) || STOPWORDS.has(g[n - 1])) continue;
          if (g.some((w) => /^\d+$/.test(w) || w.length < 3)) continue;
          if (g.some((w) => STOPWORDS.has(w) && n === 3 && g[1] !== w))
            continue;
          bump(g.join(" "), weight * (n === 1 ? 0.6 : n === 2 ? 1.4 : 1.6));
        }
    }
  };
  scan(title, 1.5);
  scan(abstract, 1);
  const cands = [...score.entries()].filter(
    ([p, s]) => s >= 2.4 || (p.includes(" ") && s >= 2.8),
  );
  cands.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: string[] = [];
  for (const [p] of cands) {
    if (out.some((o) => o.includes(p) || p.includes(o))) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
