import { cleanArxiv, cleanDoi } from "./ids";
import { isPreprintDoi, isPreprintUrl } from "./health";
import {
  fetchRecord,
  plausible,
  PubRecord,
  searchByTitle,
  Want,
} from "./metadata";
import { Ctx } from "./sources";

export interface PreprintQuery extends Want {
  /** DOI of the preprint, or the arXiv DOI built from its id */
  doi?: string;
}
export type Via = "Crossref link" | "OpenAlex" | "title and author";
export interface Published {
  record: PubRecord;
  via: Via;
}

/** An item that is a preprint: its type, DOI or URL says so, and it has no journal. */
export function isPreprintItem(d: {
  type: string;
  doi?: string;
  url?: string;
  journal?: string;
}): boolean {
  if (d.journal) return false;
  return (
    d.type === "preprint" ||
    isPreprintDoi(cleanDoi(d.doi)) ||
    isPreprintUrl(d.url)
  );
}

/** the DOI to look up: the item's own, else arXiv's from the id in the URL or Extra */
export function preprintDoi(f: {
  doi?: string;
  url?: string;
  extra?: string;
}): string | undefined {
  const own = cleanDoi(f.doi) ?? cleanDoi(f.url);
  if (own) return own;
  const ax = cleanArxiv(f.url) ?? cleanArxiv(f.extra);
  return ax ? `10.48550/arxiv.${ax.toLowerCase()}` : undefined;
}

const enc = encodeURIComponent;

async function json(c: Ctx, url: string, headers?: Record<string, string>) {
  const r = await c.http({
    url,
    headers: { Accept: "application/json", ...headers },
    signal: c.signal,
  });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Crossref lists the journal version on a bioRxiv or medRxiv record as relation "is-preprint-of". */
export function relatedPublishedDoi(message: any): string | undefined {
  const rel: any[] = message?.relation?.["is-preprint-of"] ?? [];
  const hit = rel.find((r) => r["id-type"] === "doi") ?? rel[0];
  return cleanDoi(hit?.id);
}

async function crossrefLink(doi: string, c: Ctx) {
  const d = await json(
    c,
    `https://api.crossref.org/works/${doi}?mailto=${enc(c.email)}`,
  );
  return relatedPublishedDoi(d?.message);
}

/** OpenAlex merges a preprint and its journal version into one work whose DOI is the journal's. */
async function openAlexDoi(doi: string, c: Ctx) {
  const h = c.keys.openalex
    ? { Authorization: `Bearer ${c.keys.openalex}` }
    : undefined;
  const d = await json(
    c,
    `https://api.openalex.org/works/doi:${doi}?mailto=${enc(c.email)}`,
    h,
  );
  const other = cleanDoi(d?.doi);
  return other && other !== doi && !isPreprintDoi(other) ? other : undefined;
}

/**
 * The journal version of a preprint. A DOI link from Crossref is trusted. An OpenAlex match is
 * checked against the preprint's title, author and year. A title search needs the same check.
 */
export async function findPublished(
  q: PreprintQuery,
  c: Ctx,
): Promise<Published | null> {
  const attempt = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (c.signal?.aborted) throw e;
      return undefined;
    }
  };
  if (q.doi) {
    const linked = await attempt(() => crossrefLink(q.doi!, c));
    if (linked) {
      const record = await attempt(() => fetchRecord(linked, c));
      if (record) return { record, via: "Crossref link" };
    }
    const oa = await attempt(() => openAlexDoi(q.doi!, c));
    if (oa) {
      const record = await attempt(() => fetchRecord(oa, c));
      if (record && plausible(q, record, [-1, 6]))
        return { record, via: "OpenAlex" };
    }
  }
  const found = await attempt(() =>
    searchByTitle(q, c, { journalOnly: true, years: [0, 4] }),
  );
  return found ? { record: found, via: "title and author" } : null;
}

export interface Upgrade {
  type: "journalArticle" | "conferencePaper";
  fields: Record<string, string>;
  /** replace the creator list with the published one */
  replaceCreators: boolean;
  extraLines: string[];
}

/** What changes on the preprint item. Existing values stay when the record has none. */
export function planUpgrade(
  now: {
    abstract: string;
    extra: string;
    arxivId?: string;
    preprintDoi?: string;
    creators: { last: string }[];
  },
  rec: PubRecord,
): Upgrade {
  const conference = rec.type === "proceedings-article";
  const fields: Record<string, string> = {
    title: rec.title,
    [conference ? "proceedingsTitle" : "publicationTitle"]: rec.journal,
    volume: rec.volume,
    issue: rec.issue,
    pages: rec.pages,
    date: rec.date,
    DOI: rec.doi,
    ISSN: rec.issn,
    url: `https://doi.org/${rec.doi}`,
  };
  if (!now.abstract.trim() && rec.abstract) fields.abstractNote = rec.abstract;
  for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
  const extraLines: string[] = [];
  const has = (label: string) =>
    new RegExp(`^\\s*${label}\\s*:`, "im").test(now.extra);
  if (now.preprintDoi && !has("Preprint DOI"))
    extraLines.push(`Preprint DOI: ${now.preprintDoi}`);
  if (now.arxivId && !has("arXiv")) extraLines.push(`arXiv: ${now.arxivId}`);
  const fam = (s: string) => s.toLowerCase();
  const first = now.creators[0]?.last;
  const replaceCreators =
    rec.authors.length >= now.creators.length &&
    rec.authors.length > 0 &&
    (!first || fam(first) === fam(rec.authors[0].last));
  return {
    type: conference ? "conferencePaper" : "journalArticle",
    fields,
    replaceCreators,
    extraLines,
  };
}
