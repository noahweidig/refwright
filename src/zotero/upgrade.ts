import { isPreprintDoi } from "../core/health";
import { pool } from "../core/http";
import {
  findPublished,
  isPreprintItem,
  planUpgrade,
  preprintDoi,
  Published,
} from "../core/preprint";
import { STATUS_TAGS as T } from "../core/tags";
import { getString } from "../utils/locale";
import { attachFinalPdf, newCtx } from "./engine";
import { FixRow, Job } from "./fixlist";
import { allRegularItems, fieldsOf } from "./library";
import { S, saveState } from "./state";

const s = (k: string, args?: Record<string, any>) =>
  getString(k as any, { args: args ?? {} });
const WEEK = 7 * 24 * 3600 * 1000;

const cite = (r: Published["record"]) =>
  [
    r.journal,
    r.volume && (r.issue ? `${r.volume}(${r.issue})` : r.volume),
    r.pages && `:${r.pages}`,
    r.year && `(${r.year})`,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(" :", ":");

export async function scanPreprints(
  libraryID: number,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
  only?: Zotero.Item[],
): Promise<Job> {
  const all = await allRegularItems(libraryID);
  const inLibrary = new Map<string, number>();
  for (const i of all) {
    const d = fieldsOf(i).ids.doi;
    if (d) inLibrary.set(d, i.id);
  }
  const pool0 = only?.length ? only : all;
  const items = pool0.filter((i) => {
    const f = fieldsOf(i);
    return isPreprintItem({
      type: Zotero.ItemTypes.getName(i.itemTypeID),
      doi: f.doi,
      url: f.url,
      journal: f.journal,
    });
  });
  const ctx = newCtx(signal);
  const found = new Map<number, Published>();
  let n = 0;
  await pool(
    items,
    3,
    async (item) => {
      const f = fieldsOf(item);
      const doi = preprintDoi(f);
      const key = doi ?? `title:${f.title.toLowerCase()}`;
      const miss = S().upgradeMiss[key];
      if (!only?.length && miss && Date.now() - miss < WEEK) return;
      try {
        const p = await findPublished(
          {
            doi,
            title: f.title,
            author: item.getCreators()[0]?.lastName,
            year: f.year,
          },
          ctx,
        );
        if (p) found.set(item.id, p);
        else S().upgradeMiss[key] = Date.now();
      } finally {
        progress(++n, items.length);
      }
    },
    signal,
  );
  saveState();

  const rows: FixRow[] = [];
  const meta = new Map<string, Published>();
  for (const item of items) {
    const p = found.get(item.id);
    if (!p) continue;
    const dupe = inLibrary.get(p.record.doi);
    const key = `pp:${item.id}`;
    meta.set(key, p);
    const f = fieldsOf(item);
    rows.push({
      key,
      title: f.title || s("lbl-untitled"),
      itemType: "preprint",
      lines: [
        `${cite(p.record)} · ${p.record.doi} · ${s("upgrade-via", { via: p.via })}`,
        dupe && dupe !== item.id ? s("upgrade-already") : "",
        p.record.title && p.record.title !== f.title ? p.record.title : "",
      ].filter(Boolean),
      fixable: !(dupe && dupe !== item.id),
    });
  }

  return {
    sections: rows.length
      ? [{ id: "published", label: s("upgrade-sec"), rows }]
      : [],
    options: [{ id: "pdf", label: s("upgrade-opt-pdf"), on: true }],
    async run(keys, opts, report, signal2) {
      await pool(
        keys,
        2,
        async (key) => {
          const p = meta.get(key)!;
          const item = Zotero.Items.get(Number(key.slice(3))) as Zotero.Item;
          try {
            const f = fieldsOf(item);
            const plan = planUpgrade(
              {
                abstract: f.abstract,
                extra: f.extra,
                arxivId: f.ids.arxiv,
                preprintDoi: isPreprintDoi(f.ids.doi) ? f.ids.doi : undefined,
                creators: item
                  .getCreators()
                  .map((c: any) => ({ last: c.lastName ?? c.name ?? "" })),
              },
              p.record,
            );
            item.setType(Zotero.ItemTypes.getID(plan.type) as number);
            const typeID = item.itemTypeID;
            for (const [k, v] of Object.entries(plan.fields)) {
              const id = Zotero.ItemFields.getID(k);
              if (id && Zotero.ItemFields.isValidForType(id, typeID))
                item.setField(k, v);
            }
            if (plan.extraLines.length)
              item.setField(
                "extra",
                [f.extra, ...plan.extraLines].filter(Boolean).join("\n"),
              );
            if (plan.replaceCreators) {
              const keep = item
                .getCreators()
                .filter((c: any) => c.creatorTypeID !== undefined)
                .filter(
                  (c: any) =>
                    Zotero.CreatorTypes.getName(c.creatorTypeID) !== "author",
                );
              item.setCreators([
                ...p.record.authors.map((a) =>
                  a.single
                    ? { name: a.last, fieldMode: 1, creatorType: "author" }
                    : {
                        firstName: a.first,
                        lastName: a.last,
                        creatorType: "author",
                      },
                ),
                ...keep,
              ] as any);
            }
            item.addTag(T.upgraded, 1);
            await item.saveTx();
            let text = s("upgrade-done");
            if (opts.pdf && !signal2.aborted) {
              const r = await attachFinalPdf(item, newCtx(signal2));
              text += ` · ${r.ok ? s("upgrade-pdf-ok") : s("upgrade-pdf-none")}`;
            }
            report(key, true, text);
          } catch (e: any) {
            if (signal2.aborted) return;
            report(key, false, String(e?.message ?? e));
          }
        },
        signal2,
      );
    },
  };
}
