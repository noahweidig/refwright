import { findPdf, idKey } from "../core/findPdf";
import { checkCitation, checkRetraction } from "../core/integrity";
import { Http, pool, polite } from "../core/http";
import { ALL_SOURCES, Candidate, Ctx, Source } from "../core/sources";
import { STATUS_TAGS as T } from "../core/tags";
import { memoGet, zoteroHttp } from "./net";
import {
  fieldsOf,
  hasUsablePdf,
  regularItems,
  setStatusTags,
  Fields,
} from "./library";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { S, saveState } from "./state";

export type Task = "pdf" | "preview" | "retraction" | "citation" | "full";
export type RowStatus =
  "pending" | "running" | "ok" | "warn" | "error" | "skip" | "cancelled";
export interface Row {
  itemID: number;
  title: string;
  text: string;
  status: RowStatus;
}
export interface Run {
  rows: Row[];
  abort: AbortController;
  done: Promise<void>;
  listeners: Set<() => void>;
  finished: boolean;
}

const DAY = 24 * 3600 * 1000;
const PDF_TAGS = [T.pdfFound, T.pdfMissing, T.pdfCheck];
const RET_TAGS = [T.retracted, T.notRetracted, T.retractionCheck];
const CITE_TAGS = [T.citeOk, T.citeIncomplete, T.citeMismatch, T.citeCheck];

export function contactEmail(): string {
  return (getPref("contactEmail") as string) || "";
}

export function enabledSources(): Source[] {
  return ALL_SOURCES.filter(
    (s) => s.alwaysOn || getPref(`src.${s.id}` as any) !== false,
  );
}

function makeCtx(http: Http, signal: AbortSignal): Ctx {
  return {
    http,
    email: contactEmail() || "refwright@users.noreply.github.com",
    keys: {
      core: (getPref("key.core") as string) || undefined,
      s2: (getPref("key.s2") as string) || undefined,
      openalex: (getPref("key.openalex") as string) || undefined,
    },
    preferHosted: !!getPref("preferHosted"),
    signal,
  };
}

export function startRun(task: Task, input: Zotero.Item[], win?: Window): Run {
  const items = regularItems(input);
  const rows: Row[] = items.map((i) => ({
    itemID: i.id,
    title: (i.getField("title") as string) || "(untitled)",
    text: "",
    status: "pending",
  }));
  const abort = new AbortController();
  const listeners = new Set<() => void>();
  const run: Run = {
    rows,
    abort,
    listeners,
    finished: false,
    done: Promise.resolve(),
  };
  const notify = () => listeners.forEach((l) => l());
  const set = (i: number, status: RowStatus, text: string) => {
    rows[i].status = status;
    rows[i].text = text;
    notify();
  };
  const raw = polite(zoteroHttp, {
    delayMs: Number(getPref("delayMs")) || 400,
    restMs: 60_000,
    retries: 1,
  });
  const http = memoGet(raw);
  const ctx = makeCtx(http, abort.signal);
  const seen = new Set<number>();
  let attached = 0;

  const one = async (item: Zotero.Item, i: number) => {
    if (abort.signal.aborted)
      return set(i, "cancelled", getString("status-cancelled"));
    if (seen.has(item.id)) return set(i, "skip", getString("status-dup"));
    seen.add(item.id);
    set(i, "running", "…");
    const fl = fieldsOf(item);
    try {
      const parts: string[] = [];
      let worst: RowStatus = "ok";
      const merge = (st: RowStatus, text: string) => {
        parts.push(text);
        if (st === "error" || (st === "warn" && worst !== "error")) worst = st;
      };
      if (task === "pdf" || task === "preview" || task === "full") {
        const r = await doPdf(
          item,
          fl,
          ctx,
          task === "preview" || !!getPref("previewOnly"),
          win,
        );
        if (r.attached) attached++;
        merge(r.status, r.text);
      }
      if (task === "retraction" || task === "full")
        merge(...(await doRetraction(item, fl, ctx)));
      if (task === "citation" || task === "full")
        merge(...(await doCitation(item, fl, ctx)));
      set(i, worst, parts.join(" · "));
    } catch (e: any) {
      if (abort.signal.aborted)
        set(i, "cancelled", getString("status-cancelled"));
      else
        set(
          i,
          "error",
          getString("status-error", {
            args: { message: String(e?.message ?? e) },
          }),
        );
    }
  };

  run.done = (async () => {
    await pool(
      items,
      Math.min(6, Math.max(1, Number(getPref("concurrency")) || 3)),
      one,
      abort.signal,
    );
    rows.forEach((r, i) => {
      if (r.status === "pending")
        set(i, "cancelled", getString("status-cancelled"));
    });
    saveState();
    run.finished = true;
    notify();
    if (attached)
      new ztoolkit.ProgressWindow(addon.data.config.addonName, {
        closeOnClick: true,
        closeTime: 4000,
      })
        .createLine({
          text: getString("popup-pdfs-attached", { args: { count: attached } }),
          type: "success",
          progress: 100,
        })
        .show();
  })();
  return run;
}

type R = { status: RowStatus; text: string; attached?: boolean };

async function doPdf(
  item: Zotero.Item,
  fl: Fields,
  ctx: Ctx,
  preview: boolean,
  win?: Window,
): Promise<R> {
  const abort = ctx.signal!;
  if (await hasUsablePdf(item)) {
    if (!preview) await setStatusTags(item, [], [T.pdfMissing, T.pdfCheck]);
    return { status: "skip", text: getString("status-pdf-existing") };
  }
  const key = idKey(fl.ids) || `title:${fl.title.toLowerCase()}`;
  if (!idKey(fl.ids) && !fl.title)
    return { status: "warn", text: getString("status-no-ids") };
  const miss = S().misses[key];
  if (!preview && getPref("rememberMisses") && miss && Date.now() - miss < DAY)
    return { status: "warn", text: getString("status-pdf-cached-miss") };

  const dl = new Map<string, Promise<Uint8Array | null>>();
  const download = (c: Candidate) => {
    let p = dl.get(c.url);
    if (!p)
      p = ctx
        .http({
          url: c.url,
          headers: { Accept: "application/pdf,*/*", ...c.headers },
          timeout: 60_000,
          signal: abort,
        })
        .then((r) => (r.status === 200 ? r.bytes() : null))
        .catch((e) => {
          if (abort.aborted) throw e;
          return null;
        });
    dl.set(c.url, p);
    return p;
  };
  const out = await findPdf(
    { ids: fl.ids, title: fl.title, year: fl.year },
    {
      ctx,
      sources: enabledSources(),
      titleLookup: !!getPref("titleLookup"),
      internetArchive: !!getPref("internetArchive"),
      preview,
      download,
      fallback:
        getPref("publisherFallback") && !preview
          ? async () => {
              const fn = (Zotero.Attachments as any).addAvailableFiles;
              if (typeof fn !== "function") return false;
              const r = await fn.call(Zotero.Attachments, [item], {
                methods: ["doi", "url"],
              });
              return Array.isArray(r) ? !!r[0] : !!r;
            }
          : undefined,
    },
  );
  const note = out.notes.length ? ` (${out.notes.join(", ")})` : "";
  if (out.status === "found") {
    if (preview)
      return {
        status: "ok",
        text: getString("status-pdf-preview", { args: { source: out.source } }),
      };
    if (out.bytes) await attachPdf(item, out.bytes, out.url, out.source);
    await setStatusTags(item, [T.pdfFound], [T.pdfMissing, T.pdfCheck]);
    if (out.foundDoi && getPref("fillDoi") && !fl.doi) {
      try {
        item.setField("DOI", out.foundDoi);
        await item.saveTx();
      } catch {
        /* item type has no DOI field */
      }
    }
    if (
      out.openalexId &&
      getPref("recordOpenAlexId") &&
      !/^OpenAlex:/im.test(fl.extra)
    ) {
      item.setField(
        "extra",
        (fl.extra ? fl.extra + "\n" : "") + `OpenAlex: ${out.openalexId}`,
      );
      await item.saveTx();
    }
    delete S().misses[key];
    return {
      status: "ok",
      attached: true,
      text: out.url
        ? getString("status-pdf-attached", { args: { source: out.source } })
        : getString("status-pdf-attached-page"),
    };
  }
  if (preview)
    return {
      status: out.status === "missing" ? "warn" : "warn",
      text: getString("status-pdf-missing") + note,
    };
  if (out.status === "check-needed") {
    await setStatusTags(item, [T.pdfCheck], [T.pdfFound, T.pdfMissing]);
    const reason = out.pdfDoi ? `${out.reason} (${out.pdfDoi})` : out.reason;
    return {
      status: "warn",
      text: getString("status-pdf-check", { args: { reason } }) + note,
    };
  }
  await setStatusTags(item, [T.pdfMissing], [T.pdfFound, T.pdfCheck]);
  S().misses[key] = Date.now();
  return { status: "warn", text: getString("status-pdf-missing") + note };
}

async function attachPdf(
  item: Zotero.Item,
  bytes: Uint8Array,
  url: string,
  source: string,
) {
  const name = `refwright-${Date.now()}-${item.id}.pdf`;
  const tmp = PathUtils.join(Zotero.getTempDirectory().path, name);
  await IOUtils.write(tmp, bytes);
  try {
    const att = await Zotero.Attachments.importFromFile({
      file: tmp,
      parentItemID: item.id,
      libraryID: item.libraryID,
      contentType: "application/pdf",
    } as any);
    if (att) {
      att.setField("url", url);
      att.setField("title", "Full Text PDF");
      await att.saveTx();
    }
  } finally {
    await IOUtils.remove(tmp, { ignoreAbsent: true });
  }
}

async function doRetraction(
  item: Zotero.Item,
  fl: Fields,
  ctx: Ctx,
): Promise<[RowStatus, string]> {
  const r = await checkRetraction(fl.ids, ctx);
  if (r.status === "retracted") {
    await setStatusTags(
      item,
      [T.retracted],
      [T.notRetracted, T.retractionCheck],
    );
    await reportNote(
      item,
      "retraction",
      `Retracted (${r.source}${r.note ? `, ${r.note}` : ""})`,
    );
    return [
      "error",
      getString("status-retracted", { args: { source: r.source ?? "" } }),
    ];
  }
  if (r.status === "none") {
    await setStatusTags(
      item,
      [T.notRetracted],
      [T.retracted, T.retractionCheck],
    );
    await reportNote(item, "retraction", null);
    return ["ok", getString("status-not-retracted")];
  }
  await setStatusTags(item, [T.retractionCheck], [T.retracted, T.notRetracted]);
  return ["warn", getString("status-retraction-check")];
}

async function doCitation(
  item: Zotero.Item,
  fl: Fields,
  ctx: Ctx,
): Promise<[RowStatus, string]> {
  const r = await checkCitation(fl.ids.doi, fl.cite, ctx);
  const set = (t: string) =>
    setStatusTags(
      item,
      [t],
      CITE_TAGS.filter((x) => x !== t),
    );
  switch (r.status) {
    case "ok":
      await set(T.citeOk);
      await reportNote(item, "citation", null);
      return ["ok", getString("status-cite-ok")];
    case "incomplete":
      await set(T.citeIncomplete);
      await reportNote(item, "citation", `Missing: ${r.missing.join(", ")}`);
      return [
        "warn",
        getString("status-cite-incomplete", {
          args: { fields: r.missing.join(", ") },
        }),
      ];
    case "mismatch":
      await set(T.citeMismatch);
      await reportNote(
        item,
        "citation",
        `Differs from Crossref: ${r.differs.join(", ")}`,
      );
      return [
        "warn",
        getString("status-cite-mismatch", {
          args: { fields: r.differs.join(", ") },
        }),
      ];
    default:
      await set(T.citeCheck);
      return ["warn", getString("status-cite-check")];
  }
}

/** Optional per-item report note. One note per item, rewritten per check kind. */
async function reportNote(
  item: Zotero.Item,
  kind: string,
  problem: string | null,
) {
  if (!getPref("reportNote")) return;
  const notes = item
    .getNotes()
    .map((id) => Zotero.Items.get(id) as Zotero.Item)
    .filter((n) => n && n.hasTag(T.report));
  const note = notes[0];
  const lines = new Map<string, string>();
  if (note) {
    const html = note.getNote();
    for (const m of html.matchAll(/<li data-kind="(\w+)">(.*?)<\/li>/g))
      lines.set(m[1], m[2]);
  }
  if (problem) lines.set(kind, problem);
  else lines.delete(kind);
  if (!lines.size) {
    if (note) await note.eraseTx();
    return;
  }
  const html = `<h2>refwright report</h2><ul>${[...lines].map(([k, v]) => `<li data-kind="${k}">${v}</li>`).join("")}</ul>`;
  const n = note ?? new Zotero.Item("note");
  if (!note) {
    n.libraryID = item.libraryID;
    n.parentID = item.id;
    n.addTag(T.report, 1);
  }
  n.setNote(html);
  await n.saveTx();
}
