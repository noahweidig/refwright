import { pool } from "../core/http";
import {
  authorVariants,
  AuthorGroup,
  HDoc,
  mistyped,
  missingAbstract,
  missingDoi,
} from "../core/health";
import { fetchAbstract, searchByTitle } from "../core/metadata";
import { getString } from "../utils/locale";
import { newCtx } from "./engine";
import { FixRow, FixSection, Job } from "./fixlist";
import { allRegularItems, fieldsOf } from "./library";

const s = (k: string, args?: Record<string, any>) =>
  getString(k as any, { args: args ?? {} });

function docOf(item: Zotero.Item): HDoc {
  const f = fieldsOf(item);
  const typeID = item.itemTypeID;
  const doiID = Zotero.ItemFields.getID("DOI");
  return {
    id: item.id,
    type: Zotero.ItemTypes.getName(typeID),
    title: f.title,
    abstract: f.abstract,
    doi: f.doi,
    doiField: !!doiID && Zotero.ItemFields.isValidForType(doiID, typeID),
    url: f.url,
    journal: f.journal,
    extra: f.extra,
    creators: item.getCreators().map((c: any) => ({
      first: c.firstName ?? "",
      last: c.lastName ?? c.name ?? "",
      single: c.fieldMode === 1,
    })),
  };
}

const titleOf = (item: Zotero.Item) =>
  (item.getField("title") as string) || s("lbl-untitled");

/** fields that have a value and do not exist on the target type */
function lostFields(item: Zotero.Item, type: string): string[] {
  const typeID = Zotero.ItemTypes.getID(type) as number;
  const gone: number[] | false = (item as any).getFieldsNotInType(typeID, true);
  if (!gone) return [];
  return gone
    .filter((id) => String(item.getField(id) ?? "").trim())
    .map((id) => Zotero.ItemFields.getName(id));
}

async function attachments(libraryID: number): Promise<Zotero.Item[]> {
  const q = new Zotero.Search({ libraryID } as any);
  q.addCondition("itemType", "is", "attachment");
  const items = await Zotero.Items.getAsync(await q.search());
  await Zotero.Items.loadDataTypes(items, ["primaryData", "itemData"] as any);
  return items.filter((a) => !a.deleted && !(a.parentItem?.deleted ?? false));
}

/** A stored file that Zotero's file sync has not downloaded yet is not broken. */
async function awaitingDownload(a: Zotero.Item): Promise<boolean> {
  const L = (Zotero as any).Sync?.Storage?.Local;
  if (!L?.getSyncState) return false;
  try {
    return (await L.getSyncState(a.id)) === L.SYNC_STATE_TO_DOWNLOAD;
  } catch {
    return false;
  }
}

type Fix = () => Promise<string>;

export async function scanHealth(libraryID: number): Promise<Job> {
  const items = await allRegularItems(libraryID);
  const byId = new Map(items.map((i) => [i.id, i]));
  const docs = items.map(docOf);
  const fixes = new Map<string, (ctx: ReturnType<typeof newCtx>) => Fix>();
  const rows: Record<string, FixRow[]> = {
    type: [],
    doi: [],
    abs: [],
    att: [],
    orph: [],
    auth: [],
  };
  const row = (
    sec: string,
    key: string,
    item: Zotero.Item | undefined,
    title: string,
    lines: string[],
    fixable = true,
  ) =>
    rows[sec].push({
      key,
      title,
      itemType: item ? Zotero.ItemTypes.getName(item.itemTypeID) : undefined,
      lines,
      fixable,
    });

  for (const d of docs) {
    const item = byId.get(d.id)!;
    const t = mistyped(d);
    if (t) {
      const lost = lostFields(item, t.to);
      const key = `type:${d.id}`;
      row(
        "type",
        key,
        item,
        titleOf(item),
        [
          s("health-retype", { from: d.type, to: t.to }),
          lost.length
            ? s("health-retype-loss", { fields: lost.join(", ") })
            : "",
        ].filter(Boolean),
        !lost.length,
      );
      fixes.set(key, () => async () => {
        item.setType(Zotero.ItemTypes.getID(t.to) as number);
        await item.saveTx();
        return s("health-done-retype", { to: t.to });
      });
    }
    if (missingDoi(d)) {
      const key = `doi:${d.id}`;
      row("doi", key, item, titleOf(item), [s("health-doi-lookup")]);
      fixes.set(key, (ctx) => async () => {
        const f = fieldsOf(item);
        const rec = await searchByTitle(
          {
            title: f.title,
            author: item.getCreators()[0]?.lastName,
            year: f.year,
          },
          ctx,
          { years: [-1, 1] },
        );
        if (!rec) throw new Error(s("health-no-match"));
        item.setField("DOI", rec.doi);
        await item.saveTx();
        return rec.doi;
      });
    }
    if (missingAbstract(d)) {
      const key = `abs:${d.id}`;
      row("abs", key, item, titleOf(item), [s("health-abs-lookup")]);
      fixes.set(key, (ctx) => async () => {
        const f = fieldsOf(item);
        let text = f.ids.doi ? await fetchAbstract(f.ids.doi, ctx) : "";
        if (!text && !f.ids.doi) {
          const rec = await searchByTitle(
            {
              title: f.title,
              author: item.getCreators()[0]?.lastName,
              year: f.year,
            },
            ctx,
            { years: [-1, 1] },
          );
          text = rec?.abstract ?? "";
        }
        if (!text) throw new Error(s("health-no-abstract"));
        item.setField("abstractNote", text);
        await item.saveTx();
        return s("health-done-abstract", { count: text.length });
      });
    }
  }

  const groups: AuthorGroup[] = authorVariants(docs);
  groups.forEach((g, n) => {
    const key = `auth:${n}`;
    const name = (x: { first: string; last: string }) =>
      `${x.last}, ${x.first}`;
    const ids = new Set(g.variants.flatMap((v) => v.itemIDs));
    row(
      "auth",
      key,
      undefined,
      s("health-author-to", { name: name(g.canonical) }),
      [
        g.variants.map((v) => `${name(v)} (${v.count})`).join(" · "),
        s("health-author-items", { count: ids.size }),
      ],
    );
    fixes.set(key, () => async () => {
      let n = 0;
      for (const v of g.variants)
        for (const id of v.itemIDs) {
          const item = byId.get(id);
          if (!item) continue;
          let changed = false;
          const next = item.getCreators().map((c: any) => {
            if (
              c.fieldMode === 1 ||
              c.firstName !== v.first ||
              c.lastName !== v.last
            )
              return c;
            changed = true;
            return {
              ...c,
              firstName: g.canonical.first,
              lastName: g.canonical.last,
            };
          });
          if (!changed) continue;
          item.setCreators(next);
          await item.saveTx();
          n++;
        }
      return s("health-done-authors", { count: n });
    });
  });

  const files = await attachments(libraryID);
  const missing: Zotero.Item[] = [];
  await pool(
    files.filter((a) => a.isFileAttachment()),
    16,
    async (a) => {
      if (await a.fileExists()) return;
      if (await awaitingDownload(a)) return;
      missing.push(a);
    },
  );
  for (const a of missing) {
    const key = `att:${a.id}`;
    const parent = a.parentItem;
    row("att", key, parent ?? a, parent ? titleOf(parent) : titleOf(a), [
      `${titleOf(a)} · ${(a.attachmentPath || "").replace(/^storage:/, "")}`,
      s("health-att-trash"),
    ]);
    fixes.set(key, () => async () => {
      a.deleted = true;
      await a.saveTx();
      return s("health-done-trashed");
    });
  }
  for (const a of files) {
    if (a.parentItemID || !a.isPDFAttachment() || missing.includes(a)) continue;
    const key = `orph:${a.id}`;
    row("orph", key, a, titleOf(a), [s("health-orphan-recognize")]);
  }

  const sections: FixSection[] = (
    [
      ["type", "health-sec-type"],
      ["doi", "health-sec-doi"],
      ["abs", "health-sec-abs"],
      ["att", "health-sec-att"],
      ["orph", "health-sec-orph"],
      ["auth", "health-sec-auth"],
    ] as const
  )
    .map(([id, label]) => ({ id, label: s(label), rows: rows[id] }))
    .filter((x) => x.rows.length);

  return {
    sections,
    async run(keys, _opts, report, signal) {
      const ctx = newCtx(signal);
      const orphans = keys.filter((k) => k.startsWith("orph:"));
      await pool(
        keys.filter((k) => !k.startsWith("orph:")),
        3,
        async (key) => {
          try {
            report(key, true, await fixes.get(key)!(ctx)());
          } catch (e: any) {
            if (signal.aborted) return;
            report(key, false, String(e?.message ?? e));
          }
        },
        signal,
      );
      if (!orphans.length || signal.aborted) return;
      const rec = (Zotero as any).RecognizeDocument;
      const list = orphans.map(
        (k) => Zotero.Items.get(Number(k.slice(5))) as Zotero.Item,
      );
      if (!rec?.autoRecognizeItems) {
        for (const k of orphans) report(k, false, s("health-no-recognizer"));
        return;
      }
      try {
        await rec.autoRecognizeItems(list);
        for (const k of orphans) {
          const a = Zotero.Items.get(Number(k.slice(5))) as Zotero.Item;
          report(
            k,
            !!a.parentItemID,
            a.parentItemID
              ? s("health-done-recognized")
              : s("health-not-recognized"),
          );
        }
      } catch (e: any) {
        for (const k of orphans) report(k, false, String(e?.message ?? e));
      }
    },
  };
}
