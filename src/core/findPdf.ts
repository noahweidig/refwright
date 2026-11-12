import { Ids } from "./ids";
import { embeddedDoi, validatePdf, wrongPaper } from "./pdfCheck";
import {
  Candidate,
  Ctx,
  Hit,
  Query,
  Source,
  titleMatches,
  waybackFor,
} from "./sources";

export type PdfOutcome =
  | {
      status: "found";
      source: string;
      url: string;
      bytes?: Uint8Array;
      foundDoi?: string;
      openalexId?: string;
      notes: string[];
    }
  | { status: "missing"; notes: string[]; foundDoi?: string }
  | {
      status: "check-needed";
      reason: string;
      pdfDoi?: string;
      notes: string[];
      foundDoi?: string;
    };

export interface FindDeps {
  ctx: Ctx;
  sources: Source[];
  titleLookup: boolean;
  internetArchive: boolean;
  /** download one candidate; null when unreachable */
  download(c: Candidate): Promise<Uint8Array | null>;
  /** last resort (landing pages via Zotero's own downloader); attaches itself */
  fallback?: () => Promise<boolean>;
  preview?: boolean;
}

export async function findPdf(q0: Query, d: FindDeps): Promise<PdfOutcome> {
  const q: Query = { ...q0, ids: { ...q0.ids } };
  const notes: string[] = [];
  const failed = new Set<string>();
  let foundDoi: string | undefined;
  let openalexId: string | undefined;
  const tried = new Set<string>();
  const dead: Candidate[] = [];
  let mismatch: string | undefined;
  let extraRun = 0,
    extraFailed = 0;

  const safe = async (s: Source, query: Query): Promise<Hit[] | null> => {
    try {
      return await s.run(query, d.ctx);
    } catch (e) {
      if (d.ctx.signal?.aborted) throw e;
      if (!failed.has(s.id)) {
        failed.add(s.id);
        notes.push(`${s.label} unavailable`);
      }
      return null;
    }
  };

  if (!q.ids.doi && q.title && d.titleLookup) {
    for (const s of d.sources.filter((x) => x.byTitle)) {
      const hits = await safe(s, q);
      const m = hits?.find((h) => h.doi && titleMatches(q, h));
      if (m) {
        q.ids.doi = foundDoi = m.doi;
        break;
      }
    }
  }
  const titleOnly = !q.ids.doi && !q.ids.pmid && !q.ids.arxiv;

  const attempt = async (
    c: Candidate,
    source: string,
  ): Promise<PdfOutcome | undefined> => {
    if (tried.has(c.url)) return;
    tried.add(c.url);
    if (d.preview)
      return { status: "found", source, url: c.url, foundDoi, notes };
    const bytes = await d.download(c);
    if (!bytes || !validatePdf(bytes).ok) {
      dead.push(c);
      return;
    }
    const pdfDoi = embeddedDoi(bytes);
    if (wrongPaper(q.ids.doi, pdfDoi) === "mismatch") {
      mismatch = pdfDoi;
      return;
    }
    return {
      status: "found",
      source,
      url: c.url,
      bytes,
      foundDoi,
      openalexId,
      notes,
    };
  };

  for (const s of d.sources) {
    if (d.ctx.signal?.aborted) throw new Error("Cancelled");
    const hits = await safe(s, q);
    if (!s.alwaysOn) {
      extraRun++;
      if (hits === null) extraFailed++;
    }
    for (const h of hits ?? []) {
      if (h.openalexId) openalexId ??= h.openalexId;
      if (titleOnly && !titleMatches(q, h)) continue;
      for (const c of h.candidates) {
        const r = await attempt(c, s.label);
        if (r) return r;
      }
    }
  }
  if (d.internetArchive && !d.preview) {
    for (const c of dead.splice(0)) {
      const w = await waybackFor(c.url, d.ctx).catch(() => undefined);
      if (!w) {
        dead.push(c);
        continue;
      }
      const r = await attempt(w, "Internet Archive");
      if (r) return r;
    }
  }
  if (d.fallback && !d.preview && (await d.fallback()))
    return {
      status: "found",
      source: "publisher page",
      url: "",
      foundDoi,
      notes,
    };
  if (mismatch)
    return {
      status: "check-needed",
      reason: "wrong paper",
      pdfDoi: mismatch,
      notes,
      foundDoi,
    };
  if (dead.length)
    return {
      status: "check-needed",
      reason: "link would not download",
      notes,
      foundDoi,
    };
  if (extraRun > 0 && extraFailed === extraRun)
    return {
      status: "check-needed",
      reason: "sources unavailable",
      notes,
      foundDoi,
    };
  return { status: "missing", notes, foundDoi };
}

export const idKey = (i: Ids) =>
  i.doi ?? (i.pmid ? `pmid:${i.pmid}` : i.pmcid ? `pmc:${i.pmcid}` : "");
