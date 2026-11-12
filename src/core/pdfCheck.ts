import { cleanDoi } from "./ids";

export const MIN_PDF = 10 * 1024;
export const MAX_PDF = 100 * 1024 * 1024;

/** bytes start with %PDF- and size is plausible */
export function validatePdf(b: Uint8Array): { ok: boolean; reason?: string } {
  if (b.length < MIN_PDF) return { ok: false, reason: "too small" };
  if (b.length > MAX_PDF) return { ok: false, reason: "too large" };
  const head = String.fromCharCode(...b.slice(0, 5));
  if (head !== "%PDF-") return { ok: false, reason: "not a PDF" };
  return { ok: true };
}

/** DOI found in the first pages of raw PDF bytes (metadata or visible text) */
export function embeddedDoi(b: Uint8Array): string | undefined {
  const n = Math.min(b.length, 400_000);
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]);
  const m = s.match(
    /(?:doi[:\s/]*|doi\.org\/)\s*(10\.\d{4,9}\/[^\s"<>()\\]+)/i,
  );
  return cleanDoi(m?.[1]);
}

export type PaperCheck = "ok" | "mismatch";
/** preprint DOIs inside published items' PDFs are tolerated; no DOI inside = ok */
export function wrongPaper(
  itemDoi: string | undefined,
  pdfDoi: string | undefined,
): PaperCheck {
  if (!itemDoi || !pdfDoi) return "ok";
  if (itemDoi === pdfDoi) return "ok";
  if (
    /^10\.(48550|1101|31234|31219|31222|31223|31235|5281|6084|7287|2139)\//.test(
      pdfDoi,
    )
  )
    return "ok";
  return "mismatch";
}
