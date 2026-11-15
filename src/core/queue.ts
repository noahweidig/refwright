import { tokenize } from "./text";
import { TfIdf } from "./tfidf";
import { addTo, cosine, SVec } from "./vec";

export type ReadStatus = "unread" | "reading" | "done";
export const READ_TAGS: Record<ReadStatus, string> = {
  unread: "refwright:read:unread",
  reading: "refwright:read:reading",
  done: "refwright:read:done",
};

/** done beats reading beats unread when sync leaves several tags on one item */
export function statusOf(tags: string[]): ReadStatus | "" {
  const has = (s: ReadStatus) => tags.includes(READ_TAGS[s]);
  return has("done")
    ? "done"
    : has("reading")
      ? "reading"
      : has("unread")
        ? "unread"
        : "";
}

/** Sort order for the status column: reading, unread, done, then untracked. */
const ORDER: Record<ReadStatus | "", string> = {
  reading: "1",
  unread: "2",
  done: "3",
  "": "9",
};
export const statusSortKey = (s: ReadStatus | "") => `${ORDER[s]}:${s}`;
export const statusFromSortKey = (k: string): ReadStatus | "" =>
  (k.split(":")[1] as ReadStatus) || "";

const CHARS_PER_WORD = 6;
const CHARS_PER_PAGE = 3000;

/** Minutes to read a paper. Indexed text length is most exact; page count is the fallback. */
export function estimateMinutes(o: {
  chars?: number;
  pages?: number;
  wpm: number;
}): number | undefined {
  const chars =
    o.chars && o.chars > 0
      ? o.chars
      : o.pages && o.pages > 0
        ? o.pages * CHARS_PER_PAGE
        : 0;
  if (!chars || o.wpm <= 0) return undefined;
  return Math.max(1, Math.round(chars / CHARS_PER_WORD / o.wpm));
}

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
/** zero-padded so the column sorts as numbers */
export const minutesSortKey = (m: number) => String(m).padStart(6, "0");

export interface QueueDoc {
  id: number;
  text: string;
}
export interface Ranked {
  id: number;
  /** 0 to 100 */
  score: number;
}

/**
 * Rank candidates by similarity to a project profile: the summed TF-IDF vector of the
 * project's papers. IDF comes from every doc passed in, so common words count for little.
 */
export function rankForProject(
  docs: QueueDoc[],
  profileIds: Set<number>,
  candidateIds: Set<number>,
): Ranked[] {
  const toks = new Map(docs.map((d) => [d.id, tokenize(d.text)]));
  const model = new TfIdf([...toks.values()]);
  const vec = (id: number) => model.vector(toks.get(id) ?? []);
  const profile: SVec = new Map();
  for (const id of profileIds) if (toks.has(id)) addTo(profile, vec(id));
  if (!profile.size) return [];
  return [...candidateIds]
    .filter((id) => toks.has(id) && !profileIds.has(id))
    .map((id) => ({ id, score: Math.round(cosine(vec(id), profile) * 100) }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

/** Highest relevance first; ties go to the shorter read. */
export function nextUp(
  ranked: Ranked[],
  minutes: (id: number) => number | undefined,
): Ranked[] {
  return [...ranked].sort(
    (a, b) =>
      b.score - a.score ||
      (minutes(a.id) ?? 1e9) - (minutes(b.id) ?? 1e9) ||
      a.id - b.id,
  );
}
