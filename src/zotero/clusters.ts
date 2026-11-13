import { Cluster, clusterDocs } from "../core/cluster";
import { aiReady, chatParsed } from "./ai";
import {
  CLUSTER_NAME_SYSTEM,
  clusterNameUserPrompt,
  parseClusterNames,
} from "../core/prompts";
import { allRegularItems, fieldsOf } from "./library";
import { itemsThatFit, routeOptions } from "./routing";
import { S, saveState } from "./state";

export interface Suggestion {
  name: string;
  ids: number[];
  titles: string[];
}

/** Items in no collection, or only in an ignored one such as an inbox. */
function unfiled(items: Zotero.Item[]): Zotero.Item[] {
  const ign = routeOptions().ignore.map((w) => w.toLowerCase());
  const ignored = (id: number) => {
    const name = (
      (Zotero.Collections.get(id) as any)?.name ?? ""
    ).toLowerCase();
    return ign.some((w) => name.includes(w));
  };
  return items.filter((i) => i.getCollections().every(ignored));
}

const textOf = (i: Zotero.Item) => {
  const f = fieldsOf(i);
  const tags = i
    .getTags()
    .map((t) => t.tag)
    .join(" ");
  return `${f.title} ${f.title} ${f.abstract} ${tags} ${f.journal}`;
};

/** Papers no existing collection fits: unfiled, and not a good match for any collection already there. */
async function strays(libraryID: number): Promise<Zotero.Item[]> {
  const loose = unfiled(await allRegularItems(libraryID));
  const fit = await itemsThatFit(loose);
  return loose.filter((i) => !fit.has(i.id));
}

async function offlineClusters(libraryID: number): Promise<Suggestion[]> {
  const items = await strays(libraryID);
  const byId = new Map(items.map((i) => [i.id, i]));
  const gen = clusterDocs(
    items.map((i) => ({ id: i.id, text: textOf(i), title: fieldsOf(i).title })),
  );
  let clusters: Cluster[];
  for (;;) {
    const r = gen.next();
    if (r.done) {
      clusters = r.value;
      break;
    }
    await Zotero.Promise.delay(0);
  }
  return clusters.map((c) => ({
    name: c.name,
    ids: c.ids,
    titles: c.ids.map((id) => fieldsOf(byId.get(id)!).title || "(untitled)"),
  }));
}

const AI_BATCH = 8;

/** Names for one batch of groups; null keeps the offline name, "" rejects the group. */
async function aiNames(
  batch: Suggestion[],
  existing: string[],
  signal: AbortSignal,
): Promise<(string | null)[]> {
  return chatParsed(
    CLUSTER_NAME_SYSTEM,
    clusterNameUserPrompt(
      batch.map((s) => s.titles),
      existing,
    ),
    signal,
    Math.min(1024, 200 + 30 * batch.length),
    (reply) => parseClusterNames(reply, batch.length),
  );
}

/** Applies AI names to the offline groups. Groups the model calls incoherent are dropped. */
async function nameWithAi(
  groups: Suggestion[],
  libraryID: number,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const existing = Zotero.Collections.getByLibrary(libraryID).map(
    (c: any) => c.name as string,
  );
  const out: Suggestion[] = [];
  for (let i = 0; i < groups.length; i += AI_BATCH) {
    const batch = groups.slice(i, i + AI_BATCH);
    const names = await aiNames(batch, existing, signal); // NOSONAR: one request at a time (rate limits)
    batch.forEach((g, k) => {
      if (names[k] !== "") out.push({ ...g, name: names[k] ?? g.name });
    });
  }
  return out;
}

export interface Suggested {
  items: Suggestion[];
  /** set when the AI step failed and offline names are shown */
  note?: string;
}

/** Offline grouping; with ai, a provider then names the groups (titles of a few papers per group are sent). */
export async function suggestClusters(
  libraryID: number,
  ai: boolean,
  signal: AbortSignal,
): Promise<Suggested> {
  const groups = await offlineClusters(libraryID);
  if (!ai || !groups.length) return { items: groups };
  if (!aiReady())
    throw new Error("Add an API key and model in refwright settings > AI");
  try {
    return { items: await nameWithAi(groups, libraryID, signal) };
  } catch (e: any) {
    if (signal.aborted) throw e;
    return {
      items: groups,
      note: `${String(e?.message ?? e)}. Showing the offline names.`,
    };
  }
}

/** Reuses a top-level collection with the same name, else creates one. */
async function collectionFor(libraryID: number, name: string): Promise<number> {
  const same = Zotero.Collections.getByLibrary(libraryID).find(
    (c: any) => !c.parentID && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (same) return same.id;
  const col = new Zotero.Collection({ libraryID, name } as any);
  return (await col.saveTx()) as number;
}

/** Creates the collections and files the papers; "Undo Last Filing" takes the papers back out. */
export async function createFromSuggestions(
  libraryID: number,
  picks: { name: string; ids: number[] }[],
): Promise<number> {
  const added: { itemID: number; collectionID: number }[] = [];
  for (const p of picks) {
    const collectionID = await collectionFor(libraryID, p.name); // NOSONAR: one collection at a time
    await Zotero.DB.executeTransaction(async () => {
      for (const id of p.ids) {
        const item = Zotero.Items.get(id) as Zotero.Item;
        if (!item || item.inCollection(collectionID)) continue;
        item.addToCollection(collectionID);
        await item.save();
        added.push({ itemID: id, collectionID });
      }
    });
  }
  S().filing = { kind: "filing", at: Date.now(), added, removed: [] };
  saveState();
  return picks.length;
}
