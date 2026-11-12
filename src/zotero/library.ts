import { IdFields, extractIds, Ids } from "../core/ids";
import { RColl, RItem } from "../core/router";
import { CiteFields } from "../core/integrity";

const f = (item: Zotero.Item, name: string): string => {
  try {
    return String(item.getField(name) ?? "");
  } catch {
    return "";
  }
};

export interface Fields {
  title: string;
  abstract: string;
  year?: number;
  date: string;
  doi: string;
  extra: string;
  url: string;
  journal: string;
  authors: string;
  cite: CiteFields;
  ids: Ids;
}

export function fieldsOf(item: Zotero.Item): Fields {
  const doi = f(item, "DOI");
  const extra = f(item, "extra");
  const url = f(item, "url");
  const date = f(item, "date");
  const y = Zotero.Date.strToDate(date).year;
  const creators = item.getCreators();
  const first = creators[0];
  const j =
    f(item, "publicationTitle") ||
    f(item, "proceedingsTitle") ||
    f(item, "bookTitle");
  const base = { doi, extra, url } as IdFields;
  return {
    title: f(item, "title"),
    abstract: f(item, "abstractNote"),
    year: y ? Number(y) : undefined,
    date,
    doi,
    extra,
    url,
    journal: j,
    authors: creators
      .map(
        (c) =>
          [c.firstName, c.lastName].filter(Boolean).join(" ") ||
          (c as any).name ||
          "",
      )
      .join("; "),
    cite: {
      title: f(item, "title") || undefined,
      year: y ? Number(y) : undefined,
      journal: j || undefined,
      volume: f(item, "volume") || undefined,
      issue: f(item, "issue") || undefined,
      pages: f(item, "pages") || undefined,
      firstAuthor: first
        ? first.lastName || (first as any).name || undefined
        : undefined,
    },
    ids: extractIds(base),
  };
}

/** child items resolve to their parent; only regular items; deduped */
export function regularItems(items: Zotero.Item[]): Zotero.Item[] {
  const out = new Map<number, Zotero.Item>();
  for (const it of items) {
    const r = it.isRegularItem() ? it : it.parentItem;
    if (r?.isRegularItem()) out.set(r.id, r);
  }
  return [...out.values()];
}

export async function hasUsablePdf(item: Zotero.Item): Promise<boolean> {
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item | false;
    if (a && a.isPDFAttachment() && (await a.fileExists())) return true;
  }
  return false;
}

export function hasTag(item: Zotero.Item, tag: string) {
  return item.hasTag(tag);
}

/** replace one family of status tags (automatic) and save once */
export async function setStatusTags(
  item: Zotero.Item,
  add: string[],
  remove: string[],
) {
  let changed = false;
  for (const t of remove)
    if (!add.includes(t) && item.hasTag(t)) {
      item.removeTag(t);
      changed = true;
    }
  for (const t of add)
    if (!item.hasTag(t)) {
      item.addTag(t, 1);
      changed = true;
    }
  if (changed) await item.saveTx();
}

export async function itemsWithTag(
  tag: string,
  libraryID: number,
): Promise<Zotero.Item[]> {
  const s = new Zotero.Search({ libraryID } as any);
  s.addCondition("tag", "is", tag);
  s.addCondition("noChildren", "true");
  const ids = await s.search();
  return Zotero.Items.getAsync(ids);
}

export async function allRegularItems(
  libraryID: number,
): Promise<Zotero.Item[]> {
  const s = new Zotero.Search({ libraryID } as any);
  s.addCondition("itemType", "isNot", "attachment");
  s.addCondition("itemType", "isNot", "note");
  s.addCondition("itemType", "isNot", "annotation");
  s.addCondition("noChildren", "false");
  const ids = await s.search();
  const items = await Zotero.Items.getAsync(ids);
  await Zotero.Items.loadDataTypes(items, [
    "primaryData",
    "itemData",
    "creators",
    "tags",
    "collections",
  ] as any);
  return items.filter((i) => i.isRegularItem() && !i.deleted);
}

export async function routerData(libraryID: number) {
  const colls = Zotero.Collections.getByLibrary(libraryID, true);
  const rcolls: RColl[] = colls.map((c) => ({
    id: c.id,
    name: c.name,
    parent: c.parentID || null,
  }));
  const items = await allRegularItems(libraryID);
  const ritems: RItem[] = items.map((i) => toRItem(i));
  return {
    colls: rcolls,
    items: ritems,
    signature: `${colls.length}:${items.length}:${items.reduce((a, i) => a + i.getCollections().length + i.getTags().length, 0)}`,
  };
}

export function toRItem(i: Zotero.Item): RItem {
  const fl = fieldsOf(i);
  return {
    id: i.id,
    title: fl.title,
    abstract: fl.abstract,
    tags: i.getTags().map((t) => t.tag),
    venue: fl.journal,
    collections: i.getCollections(),
  };
}

export async function tagCounts(
  libraryID: number,
): Promise<{ name: string; count: number }[]> {
  const rows = await Zotero.DB.queryAsync(
    `SELECT T.name AS name, COUNT(*) AS count FROM itemTags IT JOIN tags T USING(tagID) JOIN items I USING(itemID)
     WHERE I.libraryID=? AND I.itemID NOT IN (SELECT itemID FROM deletedItems) GROUP BY T.tagID`,
    [libraryID],
  );
  return (rows ?? []).map((r: any) => ({
    name: r.name as string,
    count: r.count as number,
  }));
}

export const currentLibraryID = (): number => {
  try {
    return (
      Zotero.getActiveZoteroPane()?.getSelectedLibraryID() ||
      Zotero.Libraries.userLibraryID
    );
  } catch {
    return Zotero.Libraries.userLibraryID;
  }
};
