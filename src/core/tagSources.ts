import { Ctx, Hit } from "./sources";
import { Proposal } from "./tagSuggest";

const enc = encodeURIComponent;
const json = async (c: Ctx, url: string) => {
  const r = await c.http({
    url,
    headers: { Accept: "application/json" },
    signal: c.signal,
  });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** keywords above a min score plus the broad subfield; all disciplines */
export async function openAlexTags(
  doi: string,
  c: Ctx,
  minScore = 0.4,
): Promise<Proposal[]> {
  const d = await json(
    c,
    `https://api.openalex.org/works/doi:${doi}?mailto=${enc(c.email)}&select=keywords,primary_topic`,
  );
  if (!d) return [];
  const out: Proposal[] = [];
  const sub = d.primary_topic?.subfield?.display_name;
  for (const k of d.keywords ?? [])
    if ((k.score ?? 0) >= minScore && k.display_name)
      out.push({ tag: k.display_name, source: "OpenAlex", score: k.score });
  if (sub) out.push({ tag: sub, source: "OpenAlex" });
  return out;
}

/** MeSH headings + author keywords (biomedical only) */
export async function pubmedTags(doi: string, c: Ctx): Promise<Proposal[]> {
  const tool = `tool=refwright&email=${enc(c.email)}`;
  const s = await json(
    c,
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(doi + "[AID]")}&retmode=json&${tool}`,
  );
  const pmid = s?.esearchresult?.idlist?.[0];
  if (!pmid) return [];
  const r = await c.http({
    url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&${tool}`,
    signal: c.signal,
  });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return parsePubmedXml(r.text());
}
export function parsePubmedXml(xml: string): Proposal[] {
  const dec = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  const out: Proposal[] = [];
  for (const m of xml.matchAll(
    /<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g,
  ))
    out.push({ tag: dec(m[1]), source: "PubMed MeSH" });
  for (const m of xml.matchAll(/<Keyword[^>]*>([^<]+)<\/Keyword>/g))
    out.push({ tag: dec(m[1]), source: "PubMed keywords" });
  return out;
}

/** journal subject categories: often empty */
export async function crossrefTags(doi: string, c: Ctx): Promise<Proposal[]> {
  const d = await json(
    c,
    `https://api.crossref.org/works/${doi}?mailto=${enc(c.email)}`,
  );
  return ((d?.message?.subject ?? []) as string[]).map((t) => ({
    tag: t,
    source: "Crossref",
  }));
}
export type { Hit };
