import { DupDoc, findNearDuplicates } from "../core/nearDup";
import { allRegularItems, fieldsOf } from "./library";

/** DOI prefixes of arXiv, bioRxiv/medRxiv, OSF, Research Square, SSRN and similar preprint servers */
const PREPRINT_DOI = /^10\.(48550|1101|31219|21203|2139|20944|31234)\//i;

const isPreprint = (item: Zotero.Item, doi: string) =>
  item.itemType === "preprint" || PREPRINT_DOI.test(doi);

function docOf(item: Zotero.Item): DupDoc {
  const f = fieldsOf(item);
  return {
    id: item.id,
    title: f.title,
    abstract: f.abstract,
    author: (item.getCreators()[0]?.lastName ?? "").toLowerCase(),
    year: f.year,
    doi: f.doi.toLowerCase(),
    preprint: isPreprint(item, f.doi),
  };
}

export interface NearItem {
  id: number;
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  attachments: number;
  preprint: boolean;
}
export interface NearReviewGroup {
  score: number;
  reason: string;
  items: NearItem[];
  /** suggested item to keep */
  masterID: number;
}

function infoOf(item: Zotero.Item): NearItem {
  const f = fieldsOf(item);
  const names = item
    .getCreators()
    .map((c) => c.lastName || (c as any).name || "");
  return {
    id: item.id,
    title: f.title || "(untitled)",
    authors: names.length > 2 ? `${names[0]} et al.` : names.join(", "),
    year: f.year ? String(f.year) : "",
    venue: f.journal,
    doi: f.doi,
    attachments: item.numAttachments(),
    preprint: isPreprint(item, f.doi),
  };
}

/** The published version with the most attachments and the most complete record. */
export function bestToKeep(items: NearItem[]): number {
  const score = (i: NearItem) =>
    (i.preprint ? 0 : 4) +
    i.attachments * 2 +
    (i.doi ? 1 : 0) +
    (i.venue ? 1 : 0);
  return [...items].sort((a, b) => score(b) - score(a) || a.id - b.id)[0].id;
}

export async function scanNearDuplicates(
  libraryID: number,
): Promise<NearReviewGroup[]> {
  const items = await allRegularItems(libraryID);
  const byId = new Map(items.map((i) => [i.id, i]));
  const gen = findNearDuplicates(items.map(docOf));
  let groups;
  for (;;) {
    const r = gen.next();
    if (r.done) {
      groups = r.value;
      break;
    }
    await Zotero.Promise.delay(0);
  }
  return groups.map((g) => {
    const infos = g.ids.map((id) => infoOf(byId.get(id)!));
    return {
      score: g.score,
      reason: g.reason,
      items: infos,
      masterID: bestToKeep(infos),
    };
  });
}

/** Zotero's own merge: notes, attachments, tags, collections and relations move to the kept item; the others go to the trash. */
export async function mergeNearGroups(
  groups: { masterID: number; otherIDs: number[] }[],
): Promise<number> {
  let n = 0;
  for (const g of groups) {
    const master = Zotero.Items.get(g.masterID) as Zotero.Item;
    const others = g.otherIDs.map((id) => Zotero.Items.get(id) as Zotero.Item);
    await (Zotero.Items as any).merge(master, others); // NOSONAR: one merge transaction at a time
    n += others.length;
  }
  return n;
}
