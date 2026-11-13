/** OpenAlex citation counts, fetched in batches by DOI. */
export const CITE_BATCH = 50;

export const normDoi = (d: string) =>
  d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
/** filter syntax uses , and | as separators, so DOIs holding them are skipped */
export const usableDoi = (d: string) => {
  const n = normDoi(d);
  return /^10\.\S+$/.test(n) && !/[,|]/.test(n);
};

export function citationUrl(dois: string[], email: string): string {
  const f = dois.map((d) => encodeURIComponent(normDoi(d))).join("|");
  return `https://api.openalex.org/works?filter=doi:${f}&select=doi,cited_by_count&per-page=${dois.length}&mailto=${encodeURIComponent(email)}`;
}

/** doi (lowercase, bare) -> cited_by_count */
export function parseCounts(j: any): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of j?.results ?? [])
    if (w?.doi && Number.isFinite(w.cited_by_count))
      out.set(normDoi(String(w.doi)), Number(w.cited_by_count));
  return out;
}

/** zero-padded so the item tree's string sort orders numerically */
export const sortKey = (n: number) => String(n).padStart(10, "0");
