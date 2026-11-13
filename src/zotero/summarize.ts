import { chat } from "./ai";
import { pdfText } from "./tagging";
import { fieldsOf, regularItems } from "./library";
import { getPref } from "../utils/prefs";
import {
  cleanSummary,
  isSummaryNote,
  summaryNoteHtml,
  summarySystem,
  summaryUserPrompt,
} from "../core/prompts";

const g = (k: string) => getPref(k as any) as any;

export interface SummaryResult {
  made: number;
  skipped: number;
  failed: number;
  error?: string;
}

function hasSummary(item: Zotero.Item): boolean {
  for (const id of item.getNotes()) {
    const n = Zotero.Items.get(id) as Zotero.Item;
    if (n && isSummaryNote(n.getNote())) return true;
  }
  return false;
}

/** Writes one note. Returns false when the item has nothing to summarize. */
async function summarizeOne(
  it: Zotero.Item,
  signal: AbortSignal,
): Promise<boolean> {
  const fl = fieldsOf(it);
  const abstract = fl.abstract?.trim();
  const text = abstract ? undefined : await pdfText(it);
  if (!abstract && !text) return false;
  const reply = await chat(
    summarySystem(g("tag.language") || "English"),
    summaryUserPrompt({
      title: fl.title,
      authors: fl.authors,
      date: fl.date,
      abstract,
      pdfText: text,
    }),
    signal,
    {
      jsonMode: false,
      maxTokens: Math.max(Number(g("ai.maxTokens")) || 0, 1024),
    },
  );
  const summary = cleanSummary(reply);
  if (!summary) throw new Error("Empty reply");
  const note = new Zotero.Item("note");
  note.libraryID = it.libraryID;
  note.parentID = it.id;
  note.setNote(
    summaryNoteHtml(
      summary,
      abstract ? "Summarized from the abstract" : "Summarized from PDF text",
    ),
  );
  await note.saveTx();
  return true;
}

/** One child note per item, from the abstract (PDF text when there is none). */
export async function summarizeItems(
  input: Zotero.Item[],
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<SummaryResult> {
  const items = regularItems(input);
  const res: SummaryResult = { made: 0, skipped: 0, failed: 0 };
  let done = 0;
  for (const it of items) {
    if (signal.aborted) break;
    progress(done++, items.length);
    if (hasSummary(it)) {
      res.skipped++;
      continue;
    }
    try {
      const ok = await summarizeOne(it, signal); // NOSONAR: sequential (rate limits)
      if (ok) res.made++;
      else res.skipped++;
    } catch (e: any) {
      if (signal.aborted) break;
      res.failed++;
      res.error ??= String(e?.message ?? e);
    }
  }
  progress(items.length, items.length);
  return res;
}
