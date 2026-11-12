export interface IdFields {
  doi?: string;
  url?: string;
  extra?: string;
  pmid?: string;
  pmcid?: string;
  arxiv?: string;
}
export interface Ids {
  doi?: string;
  pmid?: string;
  pmcid?: string;
  arxiv?: string;
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

export function cleanDoi(s?: string): string | undefined {
  if (!s) return;
  const m = decodeURIComponentSafe(s).match(DOI_RE);
  if (!m) return;
  return m[1].replace(/[.,;:)\]}]+$/, "").toLowerCase();
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function cleanArxiv(s?: string): string | undefined {
  if (!s) return;
  const m =
    s.match(/arxiv\.org\/(?:abs|pdf)\/([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5})/i) ||
    s.match(/\barxiv:\s*([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5})/i);
  return m?.[1];
}

export function extractIds(f: IdFields): Ids {
  const ids: Ids = {};
  const extra = f.extra ?? "";
  const line = (k: string) =>
    extra.match(new RegExp(`^\\s*${k}\\s*:\\s*(\\S+)`, "im"))?.[1];
  ids.doi =
    cleanDoi(f.doi) || cleanDoi(line("DOI")) || cleanDoi(f.url) || undefined;
  const pm =
    f.pmid ||
    line("PMID") ||
    f.url?.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1];
  if (pm && /^\d+$/.test(pm.trim())) ids.pmid = pm.trim();
  const pmc =
    f.pmcid || line("PMCID") || f.url?.match(/\/(PMC\d+)/i)?.[1] || undefined;
  if (pmc) ids.pmcid = "PMC" + pmc.replace(/^PMC/i, "");
  ids.arxiv =
    cleanArxiv(f.arxiv) ||
    cleanArxiv(f.url) ||
    cleanArxiv(extra) ||
    (f.doi ? f.doi.match(/10\.48550\/arxiv\.(.+)/i)?.[1] : undefined);
  for (const k of Object.keys(ids) as (keyof Ids)[]) if (!ids[k]) delete ids[k];
  return ids;
}

export const sameWork = (a: Ids, b: Ids) =>
  !!(
    (a.doi && a.doi === b.doi) ||
    (a.pmid && a.pmid === b.pmid) ||
    (a.pmcid && a.pmcid === b.pmcid)
  );
