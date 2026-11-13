import {
  findDuplicates,
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
export const scanDuplicates = (tags: TagCount[]): DupGroup[] =>
  findDuplicates(tags);
export const scanFormatting = (tags: TagCount[]) =>
  findFormatting(tags, cleanOptions());

export function estimateScan(tags: TagCount[]) {
  const usable = tags.filter(
    (t) => !isReserved(t.name) && !S().tmChecked[tagKey(t.name)],
  );
  const per = Math.max(20, Number(g("tm.perRequest")) || 150);
  const reqs = Math.min(
    Math.max(1, Number(g("tm.requests")) || 3),
    Math.ceil(usable.length / per),
  );
  const batch = usable.slice(0, per * reqs);
  return {
    tags: batch.length,
    requests: Math.ceil(batch.length / per),
    tokens:
      estimateTokens(JSON.stringify(batch.map((t) => [t.name, t.count]))) +
      300 * reqs,
  };
}

/** JSON mode first; if the reply is unusable, retry once in plain mode with more room. */
async function askMerge(
  batch: TagCount[],
  targets: string[],
  signal: AbortSignal,
) {
  const user = mergeUserPrompt(batch, targets);
  const room = Math.max(Number(g("ai.maxTokens")) || 0, 4096);
  let last = "";
  for (const jsonMode of [true, false]) {
    try {
      last = await chat(MERGE_SYSTEM, user, signal, {
        jsonMode,
        maxTokens: room * (jsonMode ? 1 : 2),
      });
      return parseMergeReply(last);
    } catch (e: any) {
      if (signal.aborted) throw e;
      if (!jsonMode)
        throw new Error(
          last.trim()
            ? `${e.message}. Reply began: ${last.trim().slice(0, 120)}`
            : `${e.message}. The model returned an empty reply (try another model or raise Max tokens in settings).`,
          { cause: e },
        );
    }
  }
  return [];
}

/** Similar meaning (AI): sends tag names and counts only. */
export async function scanSimilar(
  tags: TagCount[],
  signal: AbortSignal,
): Promise<DupGroup[]> {
  if (!aiReady())
    throw new Error("Add an API key and model in refwright settings > AI");
  const usable = tags.filter(
    (t) => !isReserved(t.name) && !S().tmChecked[tagKey(t.name)],
  );
  const per = Math.max(20, Number(g("tm.perRequest")) || 150);
  const reqs = Math.max(1, Number(g("tm.requests")) || 3);
  const targets = [...usable]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((t) => t.name);
  const byName = new Map(tags.map((t) => [t.name, t]));
  const groups: DupGroup[] = [];
  for (let i = 0; i < reqs && i * per < usable.length; i++) {
    if (signal.aborted) throw new Error("Cancelled");
    const batch = usable.slice(i * per, (i + 1) * per);
    for (const gr of await askMerge(batch, targets, signal)) {
      const members = [gr.target, ...gr.merge]
        .map((n) => byName.get(n))
        .filter(Boolean) as TagCount[];
      if (members.length > 1)
        groups.push({
          reason: "similar meaning",
          tags: members,
          target: byName.has(gr.target) ? gr.target : pickTarget(members),
        });
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
): Promise<number> {
  const rec: TagUndo = {
    at: Date.now(),
    libraryID,
    from,
    to,
    fromItems: {},
    hadTo: [],
    type: 0,
  };
  let n = 0;
  const hadTo = to
    ? new Set((await itemsOf(libraryID, to)).map((i) => i.id))
    : new Set<number>();
  rec.hadTo = [...hadTo];
  await Zotero.DB.executeTransaction(async () => {
    for (const f of from.filter((x) => x !== to)) {
      const items = await itemsOf(libraryID, f);
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
  });
  await Zotero.Tags.purge();
  S().tmUndo.push(rec);
  S().tmUndo = S().tmUndo.slice(-50);
  saveState();
  return n;
}

export async function undoLast(): Promise<boolean> {
  const rec = S().tmUndo.pop();
  if (!rec) return false;
  const had = new Set(rec.hadTo);
  await Zotero.DB.executeTransaction(async () => {
    for (const [f, ids] of Object.entries(rec.fromItems))
      for (const id of ids) {
        const item = Zotero.Items.get(id) as Zotero.Item;
        if (!item) continue;
        if (!item.hasTag(f)) item.addTag(f, rec.type);
        if (rec.to && !had.has(id)) {
          item.removeTag(rec.to);
        }
        await item.save();
      }
  });
  saveState();
  return true;
}
