import { extractJson } from "./llm";

export interface SendFields {
  title: boolean;
  abstract: boolean;
  authors: boolean;
  journal: boolean;
  date: boolean;
  tags: boolean;
  doi: boolean;
  pdfText: boolean;
}
export const defaultSendFields: SendFields = {
  title: true,
  abstract: true,
  authors: true,
  journal: true,
  date: true,
  tags: true,
  doi: false,
  pdfText: false,
};
export interface PromptItem {
  id: number;
  title?: string;
  abstract?: string;
  authors?: string;
  journal?: string;
  date?: string;
  tags?: string[];
  doi?: string;
  pdfText?: string;
}
export interface TagPromptOptions {
  seeds: string[];
  onlySeeds: boolean;
  language: string;
  maxTags: number;
  libraryTags: string[];
  custom?: string;
}

export const DEFAULT_TAG_INSTRUCTIONS =
  "You are a careful research librarian. Assign short, reusable topic tags to each paper. Prefer established terminology. Do not invent facts that are not in the metadata.";

export function tagSystemPrompt(o: TagPromptOptions): string {
  const lines = [o.custom?.trim() || DEFAULT_TAG_INSTRUCTIONS];
  lines.push(`Return at most ${o.maxTags} tags per item.`);
  lines.push(`Write tags in ${o.language || "English"}.`);
  if (o.seeds.length)
    lines.push(
      o.onlySeeds
        ? `Only use tags from this list: ${o.seeds.join(", ")}.`
        : `Prefer these seed keywords when they fit: ${o.seeds.join(", ")}.`,
    );
  if (o.libraryTags.length)
    lines.push(
      `Reuse this existing vocabulary when a tag fits: ${o.libraryTags.join(", ")}.`,
    );
  lines.push(
    'Output only JSON: {"items":[{"id":<id>,"tags":["tag", ...]}]} with one entry per input item.',
  );
  return lines.join("\n");
}

export function tagUserPrompt(items: PromptItem[], f: SendFields): string {
  return JSON.stringify(
    items.map((i) => {
      const o: Record<string, unknown> = { id: i.id };
      if (f.title && i.title) o.title = i.title;
      if (f.abstract && i.abstract) o.abstract = i.abstract;
      if (f.authors && i.authors) o.authors = i.authors;
      if (f.journal && i.journal) o.journal = i.journal;
      if (f.date && i.date) o.date = i.date;
      if (f.tags && i.tags?.length) o.existingTags = i.tags;
      if (f.doi && i.doi) o.doi = i.doi;
      if (f.pdfText && i.pdfText) o.pdfText = i.pdfText;
      return o;
    }),
  );
}

export function parseTagReply(text: string): Map<number, string[]> {
  const j = extractJson(text);
  const arr: any[] = Array.isArray(j) ? j : (j.items ?? []);
  const out = new Map<number, string[]>();
  for (const r of arr)
    if (r && r.id != null && Array.isArray(r.tags))
      out.set(
        Number(r.id),
        r.tags.map((t: unknown) => String(t)).filter(Boolean),
      );
  return out;
}

export const MERGE_SYSTEM =
  'Group tags that mean the same thing (synonyms, abbreviations, spelling variants). Reply with JSON only: {"groups":[["tag","tag"],...]}. Groups of 2 or more. Copy tags exactly as given. Omit tags with no synonym.';

/** tag names only, one per line: the cheapest form the model can read */
export function mergeUserPrompt(names: string[]) {
  return names.join("\n");
}

/** Accepts {"groups":[["a","b"]]} and the older [{target, merge}] shape. */
export function parseMergeReply(text: string): string[][] {
  const j = extractJson(text);
  const groups: any[] = Array.isArray(j) ? j : (j.groups ?? []);
  return groups.map(asGroup).filter((g) => g.length > 1);
}

function asGroup(g: any): string[] {
  if (Array.isArray(g)) return g.map(String);
  if (g?.target && Array.isArray(g.merge))
    return [String(g.target), ...g.merge.map(String)];
  return [];
}

export const ROUTE_SYSTEM =
  'You file papers into a user\'s reference-manager collections. Given one paper and the list of collection names, return the best matches, most relevant first, at most 8. Output only JSON: [{"collection":"<exact name>","confidence":"high|medium|low"}].';
export function routeUserPrompt(
  p: { title: string; abstract?: string },
  names: string[],
) {
  return JSON.stringify({ paper: p, collections: names });
}

/** rough token estimate shown before an AI tag scan */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export const SUMMARY_NOTE_TITLE = "refwright summary";

export function summarySystem(language: string, sentences = 4): string {
  return `You summarize academic papers for a researcher's reference library. Write one plain-text paragraph of ${sentences} sentences or fewer in ${language || "English"}: the question, the method, the main result, and the main limitation if stated. Use only the supplied text. If the text does not support a point, leave it out. No headings, bullets, markdown, or preamble.`;
}
export function summaryUserPrompt(p: {
  title: string;
  authors?: string;
  date?: string;
  abstract?: string;
  pdfText?: string;
}): string {
  const parts = [`Title: ${p.title}`];
  if (p.authors) parts.push(`Authors: ${p.authors}`);
  if (p.date) parts.push(`Date: ${p.date}`);
  if (p.abstract) parts.push(`Abstract:\n${p.abstract}`);
  if (p.pdfText) parts.push(`Full text excerpt:\n${p.pdfText}`);
  return parts.join("\n\n");
}
/** strip fences, markdown marks and a leading label from a model summary */
export function cleanSummary(text: string): string {
  return text
    .replace(/```[a-z]*/gi, "")
    .replace(/^\s*(summary|tl;dr)\s*:\s*/i, "")
    .replace(/[*_#>`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const esc = (t: string) =>
  t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const summaryNoteHtml = (summary: string, source: string) =>
  `<h1>${SUMMARY_NOTE_TITLE}</h1><p>${esc(summary)}</p><p><i>${esc(source)}</i></p>`;
export const isSummaryNote = (html: string) =>
  html.includes(`<h1>${SUMMARY_NOTE_TITLE}</h1>`);

export const CLUSTER_NAME_SYSTEM =
  'You name groups of papers for a reference library. For each numbered group reply with one short collection name (2 to 4 words, Title case). Reply "" if the group is not one coherent topic. If a group clearly belongs in one of the existing collections, reply with that collection\'s exact name. Reply with JSON only: {"names":["...","..."]} in group order.';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** existing collection names, then each group's first few titles; the cheapest form the model can read */
export function clusterNameUserPrompt(
  groups: string[][],
  existing: string[],
  perGroup = 6,
): string {
  const have = existing.slice(0, 60).map((n) => clip(n, 40));
  const lines = [`Existing collections: ${have.join("; ") || "none"}`, ""];
  groups.forEach((titles, i) => {
    lines.push(`Group ${i + 1}:`);
    for (const t of titles.slice(0, perGroup)) lines.push(`- ${clip(t, 110)}`);
  });
  return lines.join("\n");
}

/** one entry per group: the name, "" for a rejected group, null when the reply had none */
export function parseClusterNames(text: string, n: number): (string | null)[] {
  const j = extractJson(text);
  const names: unknown[] = Array.isArray(j) ? j : (j.names ?? []);
  return Array.from({ length: n }, (_, i) =>
    typeof names[i] === "string" ? cleanName(names[i] as string) : null,
  );
}

const cleanName = (s: string) =>
  s
    .replace(/["*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
