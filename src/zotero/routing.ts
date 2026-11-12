import {
  RouterIndex,
  RouteOptions,
  RItem,
  Suggestion,
  confidenceOf,
  parseLlmRanking,
  rankEmbeddings,
  defaultRouteOptions,
} from "../core/router";
import { denseCosine } from "../core/vec";
import { ROUTE_SYSTEM, routeUserPrompt } from "../core/prompts";
import { aiReady, chat, embedTexts } from "./ai";
import { currentLibraryID, routerData, toRItem } from "./library";
import { S, saveState } from "./state";
import { getPref } from "../utils/prefs";

const g = (k: string) => getPref(k as any) as any;

export interface CollChoice {
  id: number;
  name: string;
  path: string;
  confidence: "high" | "medium" | "low";
  score: number;
  already: boolean;
  on: boolean;
  why: { words: string[]; papers: string[] };
}
export interface ItemRoute {
  itemID: number;
  title: string;
  choices: CollChoice[];
  on: boolean;
  preselected: number[];
  already: number[];
}

export const routeOptions = (): RouteOptions => ({
  ...defaultRouteOptions,
  ignore: String(g("route.ignore") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  minConfidence: Number(g("route.minConfidence")) / 100 || 0,
  maxPicks: Number(g("route.perPaper")) || 4,
});

let cache: {
  libraryID: number;
  sig: string;
  index: RouterIndex;
  names: Map<number, string>;
  paths: Map<number, string>;
  colls: { id: number; name: string; parent?: number | null }[];
  items: RItem[];
} | null = null;
let dirty = true;
export const invalidateRouter = () => (dirty = true);

async function getIndex(libraryID: number) {
  if (cache && cache.libraryID === libraryID && !dirty) return cache;
  const d = await routerData(libraryID);
  if (cache && cache.libraryID === libraryID && cache.sig === d.signature) {
    dirty = false;
    return cache;
  }
  const byId = new Map(d.colls.map((c) => [c.id, c]));
  const pathOf = (id: number): string => {
    const c = byId.get(id)!;
    return c.parent && byId.has(c.parent)
      ? `${pathOf(c.parent)} › ${c.name}`
      : c.name;
  };
  cache = {
    libraryID,
    sig: d.signature,
    index: new RouterIndex(d.colls, d.items, routeOptions()),
    names: new Map(d.colls.map((c) => [c.id, c.name])),
    paths: new Map(d.colls.map((c) => [c.id, pathOf(c.id)])),
    colls: d.colls,
    items: d.items,
  };
  dirty = false;
  return cache;
}
export async function warmRouter() {
  try {
    await getIndex(currentLibraryID());
  } catch (e) {
    ztoolkit.log("router warm failed", e);
  }
}

export async function routeItems(
  items: Zotero.Item[],
  signal?: AbortSignal,
): Promise<{ routes: ItemRoute[]; note?: string }> {
  const libraryID = items[0].libraryID;
  const c = await getIndex(libraryID);
  if (!c.colls.length) throw new Error("no-collections");
  const mode = String(g("route.mode") || "offline");
  let note: string | undefined;
  const opts = routeOptions();
  const routes: ItemRoute[] = [];
  for (const item of items) {
    const ri = toRItem(item);
    let sugg: Suggestion[] | null = null;
    if (mode !== "offline") {
      try {
        sugg = await remoteRank(ri, mode, c, signal);
      } catch (e: any) {
        if (signal?.aborted) throw e;
        note = `${mode === "llm" ? "LLM" : "Embedding"} ranking failed (${e?.message ?? e}). Used offline ranking.`;
      }
    }
    sugg ??= c.index.rank(ri);
    const rejected = S().rejected[item.key] ?? {};
    if (Object.keys(rejected).length)
      sugg = sugg
        .map((s) => ({
          ...s,
          score: s.score * Math.pow(0.5, rejected[s.collectionId] ?? 0),
        }))
        .sort((a, b) => b.score - a.score)
        .map((s) => ({ ...s, confidence: confidenceOf(s.score) }));
    const picks = new Set(c.index.picks(sugg));
    const choices: CollChoice[] = sugg.map((s) => ({
      id: s.collectionId,
      name: c.names.get(s.collectionId) ?? "",
      path: c.paths.get(s.collectionId) ?? "",
      confidence: s.confidence,
      score: s.score,
      already: s.already,
      on: picks.has(s.collectionId),
      why: s.why,
    }));
    // memberships outside the suggestion list (e.g. ignored collections) are not shown
    routes.push({
      itemID: item.id,
      title: (item.getField("title") as string) || "(untitled)",
      choices,
      on: choices.some((x) => x.on && !x.already),
      preselected: choices.filter((x) => x.on).map((x) => x.id),
      already: ri.collections,
    });
    void opts;
  }
  return { routes, note };
}

async function remoteRank(
  ri: RItem,
  mode: string,
  c: NonNullable<typeof cache>,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const ign = routeOptions().ignore.map((w) => w.toLowerCase());
  const live = c.colls.filter(
    (x) => !ign.some((w) => x.name.toLowerCase().includes(w)),
  );
  if (!aiReady() && mode === "llm")
    throw new Error("no AI provider configured");
  if (mode === "llm") {
    const names = new Map(live.map((x) => [x.name.toLowerCase(), x.id]));
    const reply = await chat(
      ROUTE_SYSTEM,
      routeUserPrompt(
        { title: ri.title, abstract: ri.abstract },
        live.map((x) => x.name),
      ),
      signal,
    );
    return parseLlmRanking(reply, names).map((r, i) => ({
      collectionId: r.collectionId,
      score:
        (r.confidence === "high"
          ? 0.7
          : r.confidence === "medium"
            ? 0.4
            : 0.2) -
        i * 0.005,
      confidence: r.confidence,
      already: ri.collections.includes(r.collectionId),
      why: { words: [], papers: [] },
    }));
  }
  // embeddings: collection = name + first 100 chars of titles/abstracts of its papers
  const texts = live.map((col) => {
    const members = c.items
      .filter((i) => i.collections.includes(col.id) && i.id !== ri.id)
      .slice(0, 25);
    return (
      `${col.name}\n` +
      members
        .map(
          (m) => `${m.title.slice(0, 100)} ${(m.abstract ?? "").slice(0, 100)}`,
        )
        .join("\n")
    );
  });
  const prov = String(g("ai.embedProvider"));
  const cache = S().embeddings;
  const need: number[] = [];
  const sig = (t: string) =>
    `${prov}:${t.length}:${[...t].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)}`;
  live.forEach((col, i) => {
    const e = cache[`${prov}:${col.id}`];
    if (!e || e.sig !== sig(texts[i])) need.push(i);
  });
  if (need.length) {
    const vecs = await embedTexts(
      need.map((i) => texts[i]),
      signal,
    );
    need.forEach(
      (i, k) =>
        (cache[`${prov}:${live[i].id}`] = { sig: sig(texts[i]), vec: vecs[k] }),
    );
    saveState();
  }
  const [pv] = await embedTexts(
    [`${ri.title}\n${(ri.abstract ?? "").slice(0, 1000)}`],
    signal,
  );
  const depth = (id: number): number => {
    let d = 0,
      cur = c.colls.find((x) => x.id === id);
    while (cur?.parent) {
      d++;
      cur = c.colls.find((x) => x.id === cur!.parent);
    }
    return d;
  };
  const ranked = rankEmbeddings(
    pv,
    live.map((col) => ({
      id: col.id,
      vec: cache[`${prov}:${col.id}`].vec,
      depth: depth(col.id),
    })),
    denseCosine,
  );
  return ranked.slice(0, 12).map((r) => {
    const score = Math.max(0, Math.min(1, (r.score - 0.2) / 0.6));
    return {
      collectionId: r.collectionId,
      score,
      confidence: confidenceOf(score),
      already: ri.collections.includes(r.collectionId),
      why: { words: [], papers: [] },
    };
  });
}

export function clearEmbeddings() {
  S().embeddings = {};
  saveState();
}

/** Apply memberships in one transaction; record it for undo. */
export async function applyFiling(
  results: {
    itemID: number;
    on: boolean;
    collections: number[];
    preselected: number[];
  }[],
): Promise<number> {
  const c = cache;
  const ign = routeOptions().ignore.map((w) => w.toLowerCase());
  const inbox = new Set(
    (c?.colls ?? [])
      .filter((x) => ign.some((w) => x.name.toLowerCase().includes(w)))
      .map((x) => x.id),
  );
  const added: { itemID: number; collectionID: number }[] = [];
  const removed: { itemID: number; collectionID: number }[] = [];
  let n = 0;
  await Zotero.DB.executeTransaction(async () => {
    for (const r of results) {
      const item = Zotero.Items.get(r.itemID) as Zotero.Item;
      if (!item) continue;
      // auto-picks the user turned off still feed the blacklist
      const rej = (S().rejected[item.key] ??= {});
      for (const id of r.preselected)
        if (!r.collections.includes(id)) rej[id] = (rej[id] ?? 0) + 1;
      if (!r.on) continue;
      const have = new Set(item.getCollections());
      let filed = false;
      for (const id of r.collections)
        if (!have.has(id)) {
          item.addToCollection(id);
          added.push({ itemID: item.id, collectionID: id });
          filed = true;
        }
      if (filed && g("route.removeInbox"))
        for (const id of have)
          if (inbox.has(id)) {
            item.removeFromCollection(id);
            removed.push({ itemID: item.id, collectionID: id });
          }
      await item.save();
      if (filed) n++;
    }
  });
  if (added.length || removed.length)
    S().filing = { kind: "filing", at: Date.now(), added, removed };
  saveState();
  invalidateRouter();
  return n;
}

export async function undoFiling(): Promise<boolean> {
  const f = S().filing;
  if (!f) return false;
  await Zotero.DB.executeTransaction(async () => {
    const touched = new Set([...f.added, ...f.removed].map((x) => x.itemID));
    for (const id of touched) {
      const item = Zotero.Items.get(id) as Zotero.Item;
      if (!item) continue;
      for (const a of f.added.filter((x) => x.itemID === id))
        item.removeFromCollection(a.collectionID);
      for (const r of f.removed.filter((x) => x.itemID === id))
        item.addToCollection(r.collectionID);
      await item.save();
    }
  });
  S().filing = null;
  saveState();
  invalidateRouter();
  return true;
}
