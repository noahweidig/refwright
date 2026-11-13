import {
  cleanTags,
  CleanOptions,
  defaultCleanOptions,
  parseReplacements,
  tagKey,
} from "../core/tagCleaner";
import { extractKeywords } from "../core/keywords";
import { applyLearned, learnFromEdit } from "../core/learning";
import { LibraryTagIndex, Proposal, TItem } from "../core/tagSuggest";
import { crossrefTags, openAlexTags, pubmedTags } from "../core/tagSources";
import {
  defaultSendFields,
  estimateTokens,
  parseTagReply,
  PromptItem,
  SendFields,
  tagSystemPrompt,
  tagUserPrompt,
} from "../core/prompts";
import { Ctx } from "../core/sources";
import { polite, pool } from "../core/http";
import { isReserved } from "../core/tags";
import { memoGet, zoteroHttp } from "./net";
import { aiReady, chat } from "./ai";
import { contactEmail } from "./engine";
import { allRegularItems, fieldsOf, regularItems, tagCounts } from "./library";
import { S, saveState } from "./state";
import { getPref } from "../utils/prefs";

const g = (k: string) => getPref(k as any) as any;

export interface TagChoice {
  tag: string;
  source: string;
  on: boolean;
}
export interface ItemSuggestion {
  itemID: number;
  title: string;
  existing: string[];
  tags: TagChoice[];
  on: boolean;
  /** original cleaned suggestions, for learning */
  suggested: string[];
}

export function cleanOptions(): CleanOptions {
  return {
    ...defaultCleanOptions,
    removeSlashes: !!g("clean.slashes"),
    removeWeird: !!g("clean.weird"),
    mergeDuplicates: !!g("clean.merge"),
    reuseExisting: !!g("clean.reuse"),
    letterCase: g("clean.case") || "lower",
    separator: g("clean.separator") || "keep",
    maxTags: Number(g("clean.maxTags")) || 0,
    maxWords: Number(g("clean.maxWords")) || 0,
    maxLength: Number(g("clean.maxLength")) || 0,
    prefix: g("clean.prefix") || "",
    blacklist: String(g("clean.blacklist") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    replacements: parseReplacements(String(g("clean.replacements") || "")),
  };
}
export const sendFields = (): SendFields =>
  ({
    ...defaultSendFields,
    ...Object.fromEntries(
      Object.keys(defaultSendFields).map((k) => [k, !!g(`send.${k}`)]),
    ),
  }) as SendFields;

export interface TagRun {
  results: ItemSuggestion[];
  abort: AbortController;
  note?: string;
}

const seeds = () =>
  String(g("tag.seeds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function estimateAiRequest(count: number): string {
  const per = 220;
  return `~${estimateTokens("x".repeat(per * 4)) * count} tokens`;
}

/** Suggest tags. Nothing is written. `method` free: no AI, no key. */
export async function suggestTags(
  input: Zotero.Item[],
  method: "ai" | "free",
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<ItemSuggestion[]> {
  const items = regularItems(input);
  if (!items.length) return [];
  const libraryID = items[0].libraryID;
  const lib = await allRegularItems(libraryID);
  const counts = await tagCounts(libraryID);
  const libTags = counts.filter((c) => !isReserved(c.name)).map((c) => c.name);
  const clean = cleanOptions();
  const learned = S().learned;
  const http = memoGet(
    polite(zoteroHttp, { delayMs: 250, restMs: 60_000, retries: 1 }),
  );
  const ctx: Ctx = {
    http,
    email: contactEmail() || "refwright@users.noreply.github.com",
    keys: {},
    signal,
  };
  const out: ItemSuggestion[] = new Array(items.length);
  let done = 0;

  const finish = (item: Zotero.Item, proposals: Proposal[]): ItemSuggestion => {
    const existing = item.getTags().map((t) => t.tag);
    const kept = proposals.filter((p) => !isReserved(p.tag));
    const adjusted = applyLearned(
      learned,
      kept.map((p) => p.tag),
    );
    const bySource = new Map<string, string>();
    for (const p of kept)
      if (!bySource.has(tagKey(p.tag))) bySource.set(tagKey(p.tag), p.source);
    const only =
      seeds().length && g("tag.onlySeeds")
        ? new Set(seeds().map(tagKey))
        : null;
    const cleaned = cleanTags(
      adjusted.filter((t) => !only || only.has(tagKey(t))),
      clean,
      libTags,
      existing,
    );
    const tags = cleaned.map((t) => ({
      tag: t,
      source: bySource.get(tagKey(t.replace(clean.prefix, ""))) ?? "",
      on: true,
    }));
    return {
      itemID: item.id,
      title: (item.getField("title") as string) || "(untitled)",
      existing,
      tags,
      on: tags.length > 0,
      suggested: tags.map((t) => t.tag),
    };
  };
  const skip = (item: Zotero.Item) =>
    !!g("tag.skipTagged") && item.getTags().some((t) => !isReserved(t.tag));

  if (method === "free") {
    const idx = new LibraryTagIndex(
      lib.map((i): TItem => ({
        id: i.id,
        title: i.getField("title") as string,
        abstract: i.getField("abstractNote") as string,
        tags: i
          .getTags()
          .map((t) => t.tag)
          .filter((t) => !isReserved(t)),
      })),
    );
    await pool(
      items,
      3,
      async (item, i) => {
        if (skip(item)) {
          out[i] = { ...finish(item, []), on: false };
        } else {
          const fl = fieldsOf(item);
          const props: Proposal[] = [];
          if (g("tag.src.library"))
            props.push(
              ...idx.suggest(
                {
                  id: item.id,
                  title: fl.title,
                  abstract: fl.abstract,
                  tags: [],
                },
                { minTagged: Number(g("tag.minTagged")) || 30 },
              ),
            );
          let looked = 0;
          if (fl.ids.doi) {
            const tasks: [boolean, () => Promise<Proposal[]>][] = [
              [!!g("tag.src.openalex"), () => openAlexTags(fl.ids.doi!, ctx)],
              [!!g("tag.src.pubmed"), () => pubmedTags(fl.ids.doi!, ctx)],
              [!!g("tag.src.crossref"), () => crossrefTags(fl.ids.doi!, ctx)],
            ];
            for (const [on, fn] of tasks) {
              if (!on) continue;
              try {
                const r = await fn();
                looked += r.length;
                props.push(...r);
              } catch (e) {
                if (signal.aborted) throw e;
              }
            }
          }
          if (g("tag.src.keywords") && (!looked || !fl.ids.doi))
            props.push(
              ...extractKeywords(fl.title, fl.abstract).map((tag) => ({
                tag,
                source: "Keywords",
              })),
            );
          out[i] = finish(item, props);
        }
        progress(++done, items.length);
      },
      signal,
    );
    return out.filter(Boolean);
  }

  if (!aiReady())
    throw new Error("Add an API key and model in refwright settings > AI");
  const batch = Math.max(1, Number(g("ai.batchSize")) || 5);
  const groups: Zotero.Item[][] = [];
  for (let i = 0; i < items.length; i += batch)
    groups.push(items.slice(i, i + batch));
  const top = g("send.libraryTags")
    ? counts
        .filter((c) => !isReserved(c.name))
        .sort((a, b) => b.count - a.count)
        .slice(0, Number(g("send.libraryTagCount")) || 100)
        .map((c) => c.name)
    : [];
  const sys = tagSystemPrompt({
    seeds: seeds(),
    onlySeeds: !!g("tag.onlySeeds"),
    language: g("tag.language") || "English",
    maxTags: clean.maxTags || 8,
    libraryTags: top,
    custom: g("tag.prompt"),
  });
  const fields = sendFields();
  let idx = 0;
  for (const grp of groups) {
    if (signal.aborted) throw new Error("Cancelled");
    const pitems: PromptItem[] = [];
    for (const it of grp) {
      const fl = fieldsOf(it);
      pitems.push({
        id: it.id,
        title: fl.title,
        abstract: fl.abstract,
        authors: fl.authors,
        journal: fl.journal,
        date: fl.date,
        tags: it.getTags().map((t) => t.tag),
        doi: fl.ids.doi,
        pdfText: fields.pdfText ? await pdfText(it) : undefined,
      });
    }
    const reply = await chat(sys, tagUserPrompt(pitems, fields), signal);
    const parsed = parseTagReply(reply);
    for (const it of grp) {
      const tags = parsed.get(it.id) ?? [];
      out[idx++] = skip(it)
        ? { ...finish(it, []), on: false }
        : finish(
            it,
            tags.map((tag) => ({ tag, source: "AI" })),
          );
    }
    progress(idx, items.length);
  }
  return out;
}

export async function pdfText(item: Zotero.Item): Promise<string | undefined> {
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id) as Zotero.Item;
    if (a?.isPDFAttachment() && (await a.fileExists())) {
      try {
        const r = await (Zotero as any).PDFWorker.getFullText(a.id, 20);
        const max = Number(g("send.pdfChars")) || 4000;
        return String(r?.text ?? "").slice(0, max || undefined);
      } catch {
        return undefined;
      }
    }
  }
}

/** Apply reviewed choices. Whole-item deselect teaches nothing. */
export async function applyTags(
  results: {
    itemID: number;
    on: boolean;
    tags: string[];
    suggested: string[];
  }[],
): Promise<number> {
  const type = g("tag.automatic") ? 1 : 0;
  const marker = String(g("tag.marker") || "").trim();
  let total = 0;
  await Zotero.DB.executeTransaction(async () => {
    for (const r of results) {
      if (!r.on) continue;
      const item = Zotero.Items.get(r.itemID) as Zotero.Item;
      if (!item) continue;
      let added = 0;
      for (const t of r.tags) {
        if (!item.hasTag(t)) {
          item.addTag(t, type);
          added++;
        }
      }
      if (marker && (added || r.tags.length) && !item.hasTag(marker))
        item.addTag(marker, type);
      await item.save();
      total += added;
      S().learned = learnFromEdit(S().learned, r.suggested, r.tags);
    }
  });
  saveState();
  return total;
}
