import { cleanDoi, cleanArxiv } from "./ids";
import { foldAccents } from "./text";

export interface HCreator {
  first: string;
  last: string;
  /** single-field name (institution) */
  single: boolean;
}
export interface HDoc {
  id: number;
  type: string;
  title: string;
  abstract: string;
  doi: string;
  /** the item type has a DOI field */
  doiField: boolean;
  url: string;
  journal: string;
  extra: string;
  creators: HCreator[];
}

const SCHOLARLY = new Set(["journalArticle", "conferencePaper", "preprint"]);
const ABSTRACT_TYPES = new Set([...SCHOLARLY, "thesis"]);

/** preprint server DOI prefixes: arXiv, bioRxiv/medRxiv, OSF, SSRN, Research Square, Preprints.org, PsyArXiv */
export const PREPRINT_DOI =
  /^10\.(48550|1101|31219|21203|2139|20944|31234|31222|31223|31235)\//i;
const PREPRINT_HOST =
  /^https?:\/\/(?:www\.)?(arxiv\.org|(?:bio|med|chem|psyc|socarx|eartharx)rxiv\.org|osf\.io\/preprints|papers\.ssrn\.com|preprints\.org|researchsquare\.com)/i;

export const isPreprintDoi = (doi?: string) => !!doi && PREPRINT_DOI.test(doi);
export const isPreprintUrl = (url?: string) => !!url && PREPRINT_HOST.test(url);

export const hasDoi = (d: HDoc) =>
  !!(
    cleanDoi(d.doi) ||
    cleanDoi(d.extra.match(/^\s*DOI\s*:\s*(\S+)/im)?.[1]) ||
    cleanDoi(d.url)
  );

export const missingDoi = (d: HDoc): boolean =>
  d.doiField && SCHOLARLY.has(d.type) && !hasDoi(d) && !!d.title;

export const missingAbstract = (d: HDoc): boolean =>
  ABSTRACT_TYPES.has(d.type) && !d.abstract.trim() && !!d.title;

export interface Retype {
  to: string;
  reason: string;
}

/** An item whose data says it is a different type than it is filed as. */
export function mistyped(d: HDoc): Retype | undefined {
  const doi = cleanDoi(d.doi);
  const preprintish =
    isPreprintDoi(doi) || isPreprintUrl(d.url) || !!cleanArxiv(d.url);
  if (
    preprintish &&
    (d.type === "document" ||
      d.type === "webpage" ||
      d.type === "manuscript" ||
      d.type === "report" ||
      (d.type === "journalArticle" && !d.journal))
  )
    return { to: "preprint", reason: "preprint server DOI or URL" };
  if (
    d.type === "preprint" &&
    doi &&
    !isPreprintDoi(doi) &&
    !isPreprintUrl(d.url)
  )
    return { to: "journalArticle", reason: "DOI is not a preprint server's" };
  if (
    (d.type === "webpage" || d.type === "document") &&
    doi &&
    !isPreprintDoi(doi)
  )
    return { to: "journalArticle", reason: "has a publisher DOI" };
  return undefined;
}

/* ---------- author name variants ---------- */

export interface AuthorForm {
  first: string;
  last: string;
  count: number;
  itemIDs: number[];
}
export interface AuthorGroup {
  canonical: AuthorForm;
  /** forms to rewrite to the canonical one */
  variants: AuthorForm[];
}

const key = (s: string) =>
  foldAccents(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const givenTokens = (first: string) =>
  key(first)
    .split(/[\s-]+/)
    .filter(Boolean);

/** every token equal, or one an initial of the other; extra trailing tokens (middle names) are fine */
export function compatibleGiven(a: string, b: string): boolean {
  const x = givenTokens(a),
    y = givenTokens(b);
  if (!x.length || !y.length) return false;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const [p, q] = [x[i], y[i]];
    if (p === q) continue;
    if (p.length === 1 && q.startsWith(p)) continue;
    if (q.length === 1 && p.startsWith(q)) continue;
    return false;
  }
  return true;
}

const fullTokens = (first: string) =>
  givenTokens(first).filter((t) => t.length > 1).length;
const isMixed = (s: string) => /[a-z]/.test(s) && /[A-Z]/.test(s);
const hasAccent = (s: string) => s !== foldAccents(s);

function better(a: AuthorForm, b: AuthorForm): number {
  const score = (f: AuthorForm): number[] => [
    fullTokens(f.first),
    isMixed(f.first) && isMixed(f.last) ? 1 : 0,
    hasAccent(f.first + f.last) ? 1 : 0,
    f.count,
    f.first.length,
  ];
  const [x, y] = [score(a), score(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}

/** Same person written differently across the library: "J. Smith", "John Smith", "SMITH, John", "José García" and "Jose Garcia". */
export function authorVariants(docs: HDoc[]): AuthorGroup[] {
  const forms = new Map<string, AuthorForm>();
  for (const d of docs)
    for (const c of d.creators) {
      if (c.single || !c.last.trim() || !c.first.trim()) continue;
      const k = `${c.last}|${c.first}`;
      const f = forms.get(k) ?? {
        first: c.first,
        last: c.last,
        count: 0,
        itemIDs: [],
      };
      f.count++;
      if (!f.itemIDs.includes(d.id)) f.itemIDs.push(d.id);
      forms.set(k, f);
    }
  const buckets = new Map<string, AuthorForm[]>();
  for (const f of forms.values()) {
    const k = `${key(f.last)}|${givenTokens(f.first)[0]?.[0] ?? ""}`;
    buckets.set(k, [...(buckets.get(k) ?? []), f]);
  }
  const out: AuthorGroup[] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const clusters: AuthorForm[][] = [];
    for (const f of [...list].sort(better)) {
      const c = clusters.find((cl) => compatibleGiven(cl[0].first, f.first));
      if (c) c.push(f);
      else clusters.push([f]);
    }
    for (const cl of clusters)
      if (cl.length > 1) out.push({ canonical: cl[0], variants: cl.slice(1) });
  }
  return out.sort(
    (a, b) =>
      b.variants.reduce((n, v) => n + v.count, 0) -
        a.variants.reduce((n, v) => n + v.count, 0) ||
      a.canonical.last.localeCompare(b.canonical.last),
  );
}
