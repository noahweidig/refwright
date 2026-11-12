import { Ctx } from "./sources";
import { normalizeTitle, levenshtein } from "./text";

export type RetractionStatus = "retracted" | "none" | "check-needed";
export interface RetractionResult {
  status: RetractionStatus;
  source?: string;
  note?: string;
}

const enc = encodeURIComponent;
const getJson = async (c: Ctx, url: string) => {
  const r = await c.http({
    url,
    headers: { Accept: "application/json" },
    signal: c.signal,
  });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** PubMed publication type first, then Crossref (incl. Retraction Watch updates). */
export async function checkRetraction(
  ids: { doi?: string; pmid?: string },
  c: Ctx,
): Promise<RetractionResult> {
  let reached = false;
  let pmid = ids.pmid;
  const tool = `tool=refwright&email=${enc(c.email)}`;
  try {
    if (!pmid && ids.doi) {
      const s = await getJson(
        c,
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(ids.doi + "[AID]")}&retmode=json&${tool}`,
      );
      pmid = s?.esearchresult?.idlist?.[0];
    }
    if (pmid) {
      const s = await getJson(
        c,
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(pmid + '[uid] AND "Retracted Publication"[pt]')}&retmode=json&${tool}`,
      );
      reached = true;
      if (Number(s?.esearchresult?.count) > 0)
        return { status: "retracted", source: "PubMed" };
    }
  } catch (e) {
    if (c.signal?.aborted) throw e;
  }
  if (ids.doi) {
    try {
      const d = await getJson(
        c,
        `https://api.crossref.org/works/${ids.doi}?mailto=${enc(c.email)}`,
      );
      reached = true;
      const m = d?.message;
      const upd: any[] = [...(m?.["updated-by"] ?? [])];
      const hit = upd.find(
        (u) =>
          /retraction/i.test(u.type ?? "") || /retract/i.test(u.label ?? ""),
      );
      if (hit)
        return {
          status: "retracted",
          source: "Crossref",
          note:
            hit.source === "retraction-watch" ? "Retraction Watch" : undefined,
        };
      if (/^\s*(retracted|retraction)\b/i.test(m?.title?.[0] ?? ""))
        return { status: "retracted", source: "Crossref" };
    } catch (e) {
      if (c.signal?.aborted) throw e;
    }
  }
  return reached ? { status: "none" } : { status: "check-needed" };
}

export interface CiteFields {
  title?: string;
  year?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  firstAuthor?: string;
}
export type CiteStatus = "ok" | "incomplete" | "mismatch" | "check-needed";
export interface CiteResult {
  status: CiteStatus;
  missing: string[];
  differs: string[];
}

const norm = (s?: string) => normalizeTitle(s ?? "");
const similar = (a?: string, b?: string) => {
  const x = norm(a),
    y = norm(b);
  if (!x || !y) return true;
  if (x === y) return true;
  return levenshtein(x, y) / Math.max(x.length, y.length) < 0.2;
};
const firstPage = (p?: string) =>
  (p ?? "").split(/[-–—]/)[0].trim().toLowerCase();

export function compareCitation(item: CiteFields, ref: CiteFields): CiteResult {
  const missing: string[] = [],
    differs: string[] = [];
  const need: [keyof CiteFields, string][] = [
    ["title", "title"],
    ["year", "year"],
    ["journal", "journal"],
    ["volume", "volume"],
    ["issue", "issue"],
    ["pages", "pages"],
    ["firstAuthor", "first author"],
  ];
  for (const [k, label] of need) {
    const mine = item[k];
    const theirs = ref[k];
    if (mine == null || mine === "") {
      if (theirs != null && theirs !== "") missing.push(label);
      continue;
    }
    if (theirs == null || theirs === "") continue;
    const ok =
      k === "year"
        ? Number(mine) === Number(theirs)
        : k === "pages"
          ? firstPage(String(mine)) === firstPage(String(theirs))
          : k === "firstAuthor"
            ? norm(String(mine)) === norm(String(theirs))
            : k === "volume" || k === "issue"
              ? String(mine).trim() === String(theirs).trim()
              : similar(String(mine), String(theirs));
    if (!ok) differs.push(label);
  }
  return {
    status: differs.length ? "mismatch" : missing.length ? "incomplete" : "ok",
    missing,
    differs,
  };
}

export async function checkCitation(
  doi: string | undefined,
  item: CiteFields,
  c: Ctx,
): Promise<CiteResult> {
  if (!doi) return { status: "check-needed", missing: [], differs: [] };
  try {
    const d = await getJson(
      c,
      `https://api.crossref.org/works/${doi}?mailto=${enc(c.email)}`,
    );
    const m = d?.message;
    if (!m)
      return { status: "mismatch", missing: [], differs: ["doi not found"] };
    const ref: CiteFields = {
      title: m.title?.[0],
      year: m.issued?.["date-parts"]?.[0]?.[0],
      journal: m["container-title"]?.[0],
      volume: m.volume,
      issue: m.issue,
      pages: m.page,
      firstAuthor: m.author?.[0]?.family,
    };
    return compareCitation(item, ref);
  } catch (e) {
    if (c.signal?.aborted) throw e;
    return { status: "check-needed", missing: [], differs: [] };
  }
}
