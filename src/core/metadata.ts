import { cleanDoi } from "./ids";
import { Ctx } from "./sources";
import { foldAccents, levenshtein, normalizeTitle } from "./text";

export interface PubAuthor {
  first: string;
  last: string;
  single: boolean;
}
export interface PubRecord {
  doi: string;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  /** ISO date, as complete as the source gives it */
  date: string;
  year?: number;
  issn: string;
  abstract: string;
  type: string;
  authors: PubAuthor[];
}

const enc = encodeURIComponent;

async function getJson(c: Ctx, url: string, headers?: Record<string, string>) {
  const r = await c.http({
    url,
    headers: { Accept: "application/json", ...headers },
    signal: c.signal,
  });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Crossref abstracts are JATS XML: drop the tags and the leading "Abstract" label. */
export function abstractFromJats(s?: string): string {
  if (!s) return "";
  const t = decodeEntities(
    s
      .replace(/<\/(jats:)?(p|title|sec)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " "),
  )
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t.replace(/^abstract[\s:.\-–—]*\n?/i, "").trim();
}

/** OpenAlex stores abstracts as word -> positions. */
export function abstractFromInverted(idx?: Record<string, number[]>): string {
  if (!idx) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.filter((w) => w != null).join(" ");
}

const dateOf = (parts?: number[]): string =>
  (parts ?? [])
    .filter((n) => n != null)
    .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0")))
    .join("-");

export function recordFromCrossref(m: any): PubRecord {
  const parts: number[] | undefined = (m.issued ??
    m["published-print"] ??
    m["published-online"])?.["date-parts"]?.[0];
  const date = dateOf(parts);
  return {
    doi: cleanDoi(m.DOI) ?? "",
    title: String(m.title?.[0] ?? "").trim(),
    journal: String(m["container-title"]?.[0] ?? "").trim(),
    volume: m.volume ?? "",
    issue: m.issue ?? "",
    pages: m.page ?? m["article-number"] ?? "",
    date,
    year: parts?.[0] ? Number(parts[0]) : undefined,
    issn: m.ISSN?.[0] ?? "",
    abstract: abstractFromJats(m.abstract),
    type: m.type ?? "",
    authors: (m.author ?? []).map((a: any) =>
      a.family
        ? { first: a.given ?? "", last: a.family, single: false }
        : { first: "", last: a.name ?? "", single: true },
    ),
  };
}

export async function fetchRecord(
  doi: string,
  c: Ctx,
): Promise<PubRecord | null> {
  const d = await getJson(
    c,
    `https://api.crossref.org/works/${doi}?mailto=${enc(c.email)}`,
  );
  return d?.message ? recordFromCrossref(d.message) : null;
}

/** Abstract for a DOI: Crossref first, then OpenAlex. Empty when neither has one. */
export async function fetchAbstract(doi: string, c: Ctx): Promise<string> {
  try {
    const r = await fetchRecord(doi, c);
    if (r?.abstract) return r.abstract;
  } catch (e) {
    if (c.signal?.aborted) throw e;
  }
  const h = c.keys.openalex
    ? { Authorization: `Bearer ${c.keys.openalex}` }
    : undefined;
  const d = await getJson(
    c,
    `https://api.openalex.org/works/doi:${doi}?mailto=${enc(c.email)}`,
    h,
  );
  return abstractFromInverted(d?.abstract_inverted_index);
}

export interface Want {
  title: string;
  /** first author's family name */
  author?: string;
  year?: number;
}

const titleDistance = (a: string, b: string) => {
  const x = normalizeTitle(a),
    y = normalizeTitle(b);
  if (!x || !y) return 1;
  return levenshtein(x, y) / Math.max(x.length, y.length);
};
const sameFamily = (a?: string, b?: string) =>
  !!a && !!b && foldAccents(a).toLowerCase() === foldAccents(b).toLowerCase();

/**
 * Is the record the same paper? An exact title always counts. Otherwise the first author must match
 * and the title be close, because a preprint's title often changes a little before publication.
 */
export function plausible(
  want: Want,
  rec: PubRecord,
  years: [number, number] = [-1, 4],
): boolean {
  const dist = titleDistance(want.title, rec.title);
  if (want.year != null && rec.year != null) {
    const dy = rec.year - want.year;
    if (dy < years[0] || dy > years[1]) return false;
  }
  if (dist === 0) return true;
  const author = sameFamily(want.author, rec.authors[0]?.last);
  return author && dist <= 0.3;
}

/** Crossref title search; the best plausible journal-article or proceedings record. */
export async function searchByTitle(
  want: Want,
  c: Ctx,
  opt: { journalOnly?: boolean; years?: [number, number] } = {},
): Promise<PubRecord | null> {
  if (!want.title) return null;
  const q = [
    `query.bibliographic=${enc(want.title)}`,
    want.author ? `query.author=${enc(want.author)}` : "",
    "rows=5",
    `mailto=${enc(c.email)}`,
    opt.journalOnly ? "filter=type:journal-article" : "",
  ]
    .filter(Boolean)
    .join("&");
  const d = await getJson(c, `https://api.crossref.org/works?${q}`);
  const items: any[] = d?.message?.items ?? [];
  for (const m of items) {
    const rec = recordFromCrossref(m);
    if (!rec.doi || !/^(journal-article|proceedings-article)$/.test(rec.type))
      continue;
    if (/^10\.(48550|1101)\//.test(rec.doi)) continue;
    if (plausible(want, rec, opt.years)) return rec;
  }
  return null;
}
