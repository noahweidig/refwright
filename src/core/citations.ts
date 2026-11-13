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
  return `https://api.openalex.org/works?filter=doi:${f}&select=doi,cited_by_count,open_access&per-page=${dois.length}&mailto=${encodeURIComponent(email)}`;
}

export interface WorkInfo {
  n: number;
  /** OpenAlex oa_status: gold, green, hybrid, bronze, diamond or closed */
  oa?: string;
}

/** doi (lowercase, bare) -> citation count and open-access status */
export function parseWorks(j: any): Map<string, WorkInfo> {
  const out = new Map<string, WorkInfo>();
  for (const w of j?.results ?? [])
    if (w?.doi && Number.isFinite(w.cited_by_count))
      out.set(normDoi(String(w.doi)), {
        n: Number(w.cited_by_count),
        oa: w.open_access?.oa_status
          ? String(w.open_access.oa_status)
          : undefined,
      });
  return out;
}

/** zero-padded so the item tree's string sort orders numerically */
export const sortKey = (n: number) => String(n).padStart(10, "0");
