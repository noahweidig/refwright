import { Cluster, clusterDocs } from "../core/cluster";
import { allRegularItems, fieldsOf } from "./library";
import { routeOptions } from "./routing";
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

export async function suggestClusters(
  libraryID: number,
): Promise<Suggestion[]> {
  const items = unfiled(await allRegularItems(libraryID));
  const byId = new Map(items.map((i) => [i.id, i]));
  const gen = clusterDocs(items.map((i) => ({ id: i.id, text: textOf(i) })));
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
