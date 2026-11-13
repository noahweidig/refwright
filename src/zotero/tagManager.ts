import {
  findDuplicates,
  findDuplicatesAsync,
  findFormatting,
  TagCount,
  DupGroup,
  pickTarget,
} from "../core/tagDedupe";
import {
  MERGE_SYSTEM,
  mergeUserPrompt,
  parseMergeReply,
  estimateTokens,
} from "../core/prompts";
import { isReserved } from "../core/tags";
import { tagKey } from "../core/tagCleaner";
import { chat, aiReady } from "./ai";
import { tagCounts } from "./library";
import { cleanOptions } from "./tagging";
import { S, saveState, TagUndo } from "./state";
import { getPref } from "../utils/prefs";

const g = (k: string) => getPref(k as any) as any;

export const loadCounts = (libraryID: number) => tagCounts(libraryID);
export const scanDuplicates = (tags: TagCount[]): Promise<DupGroup[]> =>
  findDuplicatesAsync(tags, () => Zotero.Promise.delay(0) as Promise<void>);
export const scanFormatting = (tags: TagCount[]) =>
  findFormatting(tags, cleanOptions());

interface Candidates {
  /** what the model sees: one tag per local duplicate group, minus rarely used tags */
  send: TagCount[];
  /** a sent tag -> everything the local scan already groups with it */
  expand: Map<string, TagCount[]>;
}

/** Tags worth sending. Local duplicates collapse to one representative, so no tokens go to what a free scan already found. */
function candidates(tags: TagCount[]): Candidates {
  const min = Math.max(1, Number(g("tm.minUses")) || 1);
  const usable = tags.filter(
    (t) =>
      !isReserved(t.name) && !S().tmChecked[tagKey(t.name)] && t.count >= min,
  );
  const expand = new Map<string, TagCount[]>();
  const hidden = new Set<string>();
  for (const grp of findDuplicates(usable)) {
    expand.set(grp.target, grp.tags);
    for (const t of grp.tags) if (t.name !== grp.target) hidden.add(t.name);
  }
  return { send: usable.filter((t) => !hidden.has(t.name)), expand };
}

/** Output room: a reply is a few short groups, so a small cap is enough and keeps small rate limits happy. */
const outputCap = (n: number) =>
  Number(g("ai.maxTokens")) || Math.min(2048, Math.max(512, n * 6));

export function estimateScan(tags: TagCount[]) {
  const { send } = candidates(tags);
  const per = Math.max(20, Number(g("tm.perRequest")) || 150);
  const reqs = Math.min(
    Math.max(1, Number(g("tm.requests")) || 3),
    Math.ceil(send.length / per),
  );
  const batch = send.slice(0, per * reqs);
  return {
    tags: batch.length,
    requests: Math.ceil(batch.length / per),
    tokens:
      estimateTokens(mergeUserPrompt(batch.map((t) => t.name))) +
      70 * reqs +
      Math.min(outputCap(per), 300) * reqs,
  };
}

const RATE = /HTTP (413|429|5\d\d)/;

type Attempt =
  { groups: string[][] } | { error: string; reply: string; limited: boolean };

async function attempt(
  names: string[],
  signal: AbortSignal,
  jsonMode: boolean,
): Promise<Attempt> {
  const cap = outputCap(names.length);
  const opts = {
    jsonMode,
    maxTokens: jsonMode ? cap : Math.min(cap * 2, 4096),
    lowEffort: true,
  };
  let reply = "";
  try {
    reply = await chat(MERGE_SYSTEM, mergeUserPrompt(names), signal, opts);
    return { groups: parseMergeReply(reply) };
  } catch (e: any) {
    if (signal.aborted) throw e;
    const error = String(e?.message ?? e);
    return { error, reply, limited: RATE.test(error) };
  }
}

/** JSON mode first; retry once in plain mode only for a bad reply, never after a rate limit. */
async function askMerge(names: string[], signal: AbortSignal) {
  const first = await attempt(names, signal, true);
  if ("groups" in first) return first.groups;
  if (first.limited)
    throw new Error(
      `${first.error}. Lower "AI scan: tags per request" or raise "only tags used at least" in settings.`,
    );
  const second = await attempt(names, signal, false); // NOSONAR: retry only after a failure
  if ("groups" in second) return second.groups;
  throw new Error(
    second.reply.trim()
      ? `${second.error}. Reply began: ${second.reply.trim().slice(0, 120)}`
      : `${second.error}. The model returned an empty reply (try another model or raise Max tokens in settings).`,
  );
}

/** Similar meaning (AI): sends tag names only. */
export async function scanSimilar(
  tags: TagCount[],
  signal: AbortSignal,
): Promise<DupGroup[]> {
  if (!aiReady())
    throw new Error("Add an API key and model in RefWright settings > AI");
  const { send, expand } = candidates(tags);
  const per = Math.max(20, Number(g("tm.perRequest")) || 150);
  const reqs = Math.max(1, Number(g("tm.requests")) || 3);
  const byName = new Map(send.map((t) => [t.name, t]));
  const groups: DupGroup[] = [];
  for (let i = 0; i < reqs && i * per < send.length; i++) {
    if (signal.aborted) throw new Error("Cancelled");
    const batch = send.slice(i * per, (i + 1) * per);
    const names = batch.map((t) => t.name);
    const replies = await askMerge(names, signal); // NOSONAR: sequential (rate limits)
    for (const names of replies) {
      const members = new Map<string, TagCount>();
      for (const n of names)
        for (const t of expand.get(n) ??
          (byName.has(n) ? [byName.get(n)!] : []))
          members.set(t.name, t);
      if (members.size > 1) {
        const m = [...members.values()];
        groups.push({
          reason: "similar meaning",
          tags: m,
          target: pickTarget(m),
        });
      }
    }
    for (const t of batch) S().tmChecked[tagKey(t.name)] = Date.now();
  }
  saveState();
  return groups;
}
export function forgetChecked() {
  S().tmChecked = {};
  saveState();
}

async function itemsOf(libraryID: number, tag: string): Promise<Zotero.Item[]> {
  const s = new Zotero.Search({ libraryID } as any);
  s.addCondition("tag", "is", tag);
  return Zotero.Items.getAsync(await s.search());
}

/** Merge/rename: move every item carrying `from` to `to`. `to` may be "" to delete. */
export async function mergeTags(
  libraryID: number,
  from: string[],
  to: string,
  batch?: number,
): Promise<number> {
  const rec: TagUndo = {
    at: Date.now(),
    libraryID,
    from,
    to,
    fromItems: {},
    hadTo: [],
    type: 0,
    batch,
  };
  let n = 0;
  const hadTo = to
    ? new Set((await itemsOf(libraryID, to)).map((i) => i.id))
    : new Set<number>();
  rec.hadTo = [...hadTo];
  await Zotero.DB.executeTransaction(async () => {
    for (const f of from.filter((x) => x !== to)) {
      const items = await itemsOf(libraryID, f); // NOSONAR: inside one DB transaction
      rec.fromItems[f] = items.map((i) => i.id);
      for (const item of items) {
        const t = item.getTags().find((x) => x.tag === f);
        const type = t?.type ?? 0;
        rec.type = type;
        if (to && !item.hasTag(to)) item.addTag(to, type);
        item.removeTag(f);
        await item.save();
        n++;
      }
    }
    await Zotero.Tags.purge(); // needs the open transaction
  });
  S().tmUndo.push(rec);
  S().tmUndo = S().tmUndo.slice(-50);
  saveState();
  return n;
}

async function undoOne(rec: TagUndo) {
  const had = new Set(rec.hadTo);
  await Zotero.DB.executeTransaction(async () => {
    for (const [f, ids] of Object.entries(rec.fromItems))
      for (const id of ids) {
        const item = Zotero.Items.get(id) as Zotero.Item;
        if (!item) continue;
        if (!item.hasTag(f)) item.addTag(f, rec.type);
        if (rec.to && !had.has(id)) item.removeTag(rec.to);
        await item.save();
      }
  });
}

/** Undoes the last change; a Merge all undoes every merge it made. */
export async function undoLast(): Promise<boolean> {
  const first = S().tmUndo.pop();
  if (!first) return false;
  const recs = [first];
  while (first.batch && S().tmUndo.at(-1)?.batch === first.batch)
    recs.push(S().tmUndo.pop()!);
  for (const rec of recs) await undoOne(rec); // NOSONAR: one transaction at a time
  saveState();
  return true;
}
