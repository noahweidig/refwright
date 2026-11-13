import { polite } from "../core/http";
import {
  CITE_BATCH,
  citationUrl,
  normDoi,
  parseCounts,
  sortKey,
  usableDoi,
} from "../core/citations";
import { contactEmail } from "./engine";
import { regularItems } from "./library";
import { zoteroHttp } from "./net";
import { S, saveState } from "./state";
import { getPref } from "../utils/prefs";

export const citeKey = (i: Zotero.Item) => `${i.libraryID}/${i.key}`;

/** value the "Cited" column sorts and renders from */
export function citedData(item: Zotero.Item): string {
  const c = S().cites[citeKey(item)];
  return c ? sortKey(c.n) : "";
}

export interface CiteResult {
  updated: number;
  notFound: number;
  noDoi: number;
}

function groupByDoi(items: Zotero.Item[], res: CiteResult) {
  const byDoi = new Map<string, Zotero.Item[]>();
  for (const it of items) {
    const doi = String(it.getField("DOI") || "");
    if (!usableDoi(doi)) {
      res.noDoi++;
      continue;
    }
    const k = normDoi(doi);
    byDoi.set(k, [...(byDoi.get(k) ?? []), it]);
  }
  return byDoi;
}

function store(
  batch: string[],
  byDoi: Map<string, Zotero.Item[]>,
  counts: Map<string, number>,
  res: CiteResult,
) {
  for (const d of batch)
    for (const it of byDoi.get(d) ?? []) {
      const n = counts.get(d);
      if (n == null) {
        res.notFound++;
        continue;
      }
      S().cites[citeKey(it)] = { n, at: Date.now() };
      res.updated++;
    }
}

export async function updateCitations(
  input: Zotero.Item[],
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<CiteResult> {
  const res: CiteResult = { updated: 0, notFound: 0, noDoi: 0 };
  const byDoi = groupByDoi(regularItems(input), res);
  const http = polite(zoteroHttp, {
    delayMs: Number(getPref("delayMs")) || 400,
    restMs: 60_000,
    retries: 1,
  });
  const key = (getPref("key.openalex") as string) || "";
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const email = contactEmail() || "refwright@users.noreply.github.com";
  const dois = [...byDoi.keys()];
  for (let i = 0; i < dois.length; i += CITE_BATCH) {
    if (signal.aborted) throw new Error("Cancelled");
    progress(i, dois.length);
    const batch = dois.slice(i, i + CITE_BATCH);
    const req = { url: citationUrl(batch, email), headers, signal };
    const r = await http(req); // NOSONAR: sequential on purpose (polite spacing)
    if (r.status >= 300) throw new Error(`OpenAlex: HTTP ${r.status}`);
    store(batch, byDoi, parseCounts(r.json()), res);
  }
  progress(dois.length, dois.length);
  saveState();
  (
    Zotero.getActiveZoteroPane() as any
  )?.itemsView?.refreshAndMaintainSelection?.();
  return res;
}
