export const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just may me might more most must my no nor not now of off on once only or other our out over own same shall she should so some such than that the their them then there these they this those through to too under until up us use used using very was we were what when where which while who whom why will with within without would you your via vs et al towards toward based new study analysis approach method methods results case review`.split(
    /\s+/,
  ),
);

const CJK = /[㐀-鿿豈-﫿]/;

export function foldAccents(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** casefold, no accents, no punctuation, single spaces */
export function normalizeTitle(s: string): string {
  return foldAccents(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stem(w0: string): string {
  let w = w0;
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (/(x|ch|sh|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is")
  )
    w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  return w;
}

/** words (stemmed, stopword-free); CJK runs become character pairs */
export function tokenize(text: string, keepStop = false): string[] {
  const out: string[] = [];
  const t = foldAccents(text || "").toLowerCase();
  for (const run of t.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    if (CJK.test(run)) {
      const chars = [...run].filter((c) => CJK.test(c));
      if (chars.length === 1) out.push(chars[0]);
      for (let i = 0; i < chars.length - 1; i++)
        out.push(chars[i] + chars[i + 1]);
      continue;
    }
    const w = run.replace(/^[-']+|[-']+$/g, "");
    if (w.length < 2 || /^\d+$/.test(w)) continue;
    if (!keepStop && STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

export function words(text: string): string[] {
  return (foldAccents(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[n];
}
