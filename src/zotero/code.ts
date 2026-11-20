import { CODE_TAGS, CodeLink, collect, findLinks } from "../core/code";
import { pool } from "../core/http";
import { fieldsOf, regularItems, setStatusTags } from "./library";

const MAX_TEXT = 3_000_000;

export interface CodeResult {
  scanned: number;
  linked: number;
  links: number;
}

/** the item's indexed full text (Zotero's own cache), from its first PDF that has one */
async function fullText(item: Zotero.Item): Promise<string | undefined> {
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item | false;
    if (!a || !a.isPDFAttachment()) continue;
    try {
      const path = (Zotero.Fulltext as any).getItemCacheFile(a).path as string;
      if (!(await IOUtils.exists(path))) continue;
      return (await IOUtils.readUTF8(path)).slice(0, MAX_TEXT);
    } catch {
      /* not indexed */
    }
  }
}

/** canonical URLs already attached as links, so reruns add nothing */
function haveLinks(item: Zotero.Item): Set<string> {
  const have = new Set<string>();
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item | false;
    if (!a || !a.isAttachment()) continue;
    const u = String(a.getField("url") || "");
    for (const l of findLinks(u)) have.add(l.url.toLowerCase());
  }
  return have;
}

async function scanOne(item: Zotero.Item): Promise<CodeLink[]> {
  const f = fieldsOf(item);
  const links = collect(
    `${f.abstract}\n${f.extra}\n${f.url}`,
    await fullText(item),
  );
  const have = haveLinks(item);
  const fresh = links.filter((l) => !have.has(l.url.toLowerCase()));
  for (const l of fresh)
    await Zotero.Attachments.linkFromURL({
      url: l.url,
      parentItemID: item.id,
      title: l.title,
    } as any);
  const kinds = new Set(links.map((l) => l.kind));
  await setStatusTags(
    item,
    [
      ...(kinds.has("code") ? [CODE_TAGS.code] : []),
      ...(kinds.has("data") ? [CODE_TAGS.data] : []),
    ],
    [],
  );
  return fresh;
}

export async function findCodeLinks(
  input: Zotero.Item[],
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<CodeResult> {
  const items = regularItems(input);
  const res: CodeResult = { scanned: 0, linked: 0, links: 0 };
  let done = 0;
  await pool(
    items,
    6,
    async (item) => {
      const fresh = await scanOne(item);
      res.scanned++;
      if (fresh.length) {
        res.linked++;
        res.links += fresh.length;
      }
      if (++done % 10 === 0) progress(done, items.length);
    },
    signal,
  );
  progress(items.length, items.length);
  return res;
}
