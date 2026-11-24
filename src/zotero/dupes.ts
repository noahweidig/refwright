import {
  DupAction,
  DupCand,
  MasterPolicy,
  exportNonDups,
  importNonDups,
  pairKey,
  pickMaster,
  smartFill,
  splitByNonDups,
} from "../core/dupes";
import { S, saveState } from "./state";
import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";

const g = (k: string) => getPref(k as any) as any;
const QUIET_MS = 3000;
const FRESH_MS = 120_000;

function toast(
  text: string,
  type: "success" | "default" | "error" = "default",
) {
  new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: true,
    closeTime: 5000,
  })
    .createLine({ text, type, progress: 100 })
    .show();
}

/* ---------- non-duplicates ---------- */
export const isNonDup = (libraryID: number, a: string, b: string) =>
  !!S().nonDups[pairKey(libraryID, a, b)];

export function markNonDups(items: Zotero.Item[], not: boolean) {
  const reg = items.filter((i) => i.isRegularItem());
  if (reg.length < 2) return toast(getString("dup-select-two"));
  for (let x = 0; x < reg.length; x++)
    for (let y = x + 1; y < reg.length; y++) {
      if (reg[x].libraryID !== reg[y].libraryID) continue;
      const k = pairKey(reg[x].libraryID, reg[x].key, reg[y].key);
      if (not) S().nonDups[k] = Date.now();
      else delete S().nonDups[k];
    }
  saveState();
  refreshDuplicatesView();
  toast(getString(not ? "dup-marked-not" : "dup-marked-dup"), "success");
}

/* ---------- hide non-duplicates from Zotero's Duplicate Items view ---------- */
let origFind: ((...a: any[]) => Promise<void>) | undefined;

export function patchDuplicates() {
  const P = (Zotero as any).Duplicates?.prototype;
  if (!P || origFind) return;
  origFind = P._findDuplicates;
  P._findDuplicates = async function (this: any, ...args: any[]) {
    await origFind!.apply(this, args);
    try {
      const lib: number = this._libraryID;
      if (!Object.keys(S().nonDups).length) return;
      const ids: number[] = this._sets.findAll(true);
      const seen = new Set<number>();
      const groups: number[][] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        const set: number[] = this.getSetItemsByItemID(id);
        set.forEach((i) => seen.add(i));
        const byKey = new Map<string, number>();
        for (const i of set) {
          const it = Zotero.Items.get(i) as Zotero.Item;
          if (it) byKey.set(it.key, i);
        }
        for (const g of splitByNonDups([...byKey.keys()], (a, b) =>
          isNonDup(lib, a, b),
        ))
          if (g.length > 1) groups.push(g.map((k) => byKey.get(k)!));
      }
      this._sets = new (Zotero as any).DisjointSetForest();
      for (const g of groups)
        for (let i = 1; i < g.length; i++)
          this._sets.union(
            this._getObjectFromID(g[0]),
            this._getObjectFromID(g[i]),
          );
    } catch (e) {
      ztoolkit.log("non-dup filter failed", e);
    }
  };
}

export function unpatchDuplicates() {
  const P = (Zotero as any).Duplicates?.prototype;
  if (P && origFind) P._findDuplicates = origFind;
  origFind = undefined;
}

function refreshDuplicatesView() {
  for (const win of Zotero.getMainWindows() as any[]) {
    const pane = win.ZoteroPane;
    const row = pane?.getCollectionTreeRow?.();
    if (!row?.isDuplicates?.()) continue;
    row.clearCache?.();
    void pane.itemsView?.refreshAndMaintainSelection?.();
  }
}

export async function exportNonDupsFile(win: Window) {
  const fp = new ztoolkit.FilePicker(
    getString("dup-export"),
    "save",
    [["JSON", "*.json"]],
    "refwright-non-duplicates.json",
    win as any,
  );
  const path = await fp.open();
  if (!path) return;
  await IOUtils.writeJSON(path, exportNonDups(Object.keys(S().nonDups)));
  toast(
    getString("dup-exported", {
      args: { count: Object.keys(S().nonDups).length },
    }),
  );
}

export async function importNonDupsFile(win: Window) {
  const fp = new ztoolkit.FilePicker(
    getString("dup-import"),
    "open",
    [["JSON", "*.json"]],
    undefined,
    win as any,
  );
  const path = await fp.open();
  if (!path) return;
  let keys: string[];
  try {
    keys = importNonDups(await IOUtils.readJSON(path));
  } catch (e) {
    return toast(String(e), "error");
  }
  let n = 0;
  for (const k of keys) {
    const [lib, rest] = k.split(":");
    const [a, b] = rest.split("|");
    const L = Number(lib);
    if (
      !Zotero.Items.getByLibraryAndKey(L, a) ||
      !Zotero.Items.getByLibraryAndKey(L, b)
    )
      continue;
    if (!S().nonDups[k]) n++;
    S().nonDups[k] ??= Date.now();
  }
  saveState();
  toast(getString("dup-imported", { args: { count: n } }), "success");
}

/* ---------- duplicate sets from Zotero's own finder ---------- */
export async function duplicateSets(
  libraryID: number,
): Promise<Zotero.Item[][]> {
  const dups = new (Zotero as any).Duplicates(libraryID);
  const search = await dups.getSearchObject();
  const ids: number[] = await search.search();
  const seen = new Set<number>();
  const out: Zotero.Item[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const set: number[] = dups.getSetItemsByItemID(id);
    set.forEach((i) => seen.add(i));
    const items = (Zotero.Items.get(set) as Zotero.Item[]).filter(
      (i) => i && !i.deleted && i.isRegularItem(),
    );
    const byKey = new Map(items.map((i) => [i.key, i]));
    for (const grp of splitByNonDups(
      items.map((i) => i.key),
      (a, b) => isNonDup(libraryID, a, b),
    ))
      out.push(grp.map((k) => byKey.get(k)!));
  }
  return out;
}

/* ---------- merge ---------- */
function filledFields(item: Zotero.Item): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
    const name = Zotero.ItemFields.getName(id) as string;
    const v = String(item.getField(name, false, true) ?? "");
    if (v) out[name] = v;
  }
  return out;
}

const candOf = (i: Zotero.Item): DupCand => ({
  id: i.id,
  key: i.key,
  added: i.dateAdded,
  modified: i.dateModified,
  filled: Object.keys(filledFields(i)).length,
  attachments: i.numAttachments(),
  notes: i.numNotes(),
});

export const masterOf = (items: Zotero.Item[], policy?: MasterPolicy) =>
  pickMaster(items.map(candOf), policy ?? (g("dup.master") as MasterPolicy));

/** Smart fill (empty fields of the kept item from the others), then Zotero's merge. Returns the trashed IDs. */
export async function mergeSet(
  items: Zotero.Item[],
  masterID: number,
): Promise<number[]> {
  const master = items.find((i) => i.id === masterID)!;
  const others = items.filter((i) => i.id !== masterID);
  if (!others.length) return [];
  if (g("dup.smartFill")) {
    const fill = smartFill(
      filledFields(master),
      others.map(filledFields),
      (f) => {
        const id = Zotero.ItemFields.getID(f);
        return !!id && Zotero.ItemFields.isValidForType(id, master.itemTypeID);
      },
    );
    if (Object.keys(fill).length) {
      for (const [k, v] of Object.entries(fill)) master.setField(k, v);
      await master.saveTx();
    }
  }
  await (Zotero.Items as any).merge(master, others);
  return others.map((o) => o.id);
}

async function restore(ids: number[]) {
  for (const id of ids) {
    const it = Zotero.Items.get(id) as Zotero.Item;
    if (!it) continue;
    it.deleted = false;
    await it.saveTx(); // NOSONAR: sequential
  }
}

/** Merges every duplicate set in the library with the master policy. Progress, stop, and optional restore on stop. */
export async function bulkMerge(libraryID: number, win: Window) {
  const sets = await duplicateSets(libraryID);
  if (!sets.length) return toast(getString("dup-none"));
  const total = sets.reduce((n, s) => n + s.length - 1, 0);
  if (
    !Services.prompt.confirm(
      win as any,
      addon.data.config.addonDisplayName,
      getString("dup-bulk-confirm", {
        args: { sets: sets.length, count: total, policy: g("dup.master") },
      }),
    )
  )
    return;
  let stop = false;
  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonDisplayName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: getString("dup-bulk-working"),
      type: "default",
      progress: 0,
    })
    .show();
  const onStop = () => (stop = true);
  (pw as any).win?.addEventListener?.("click", onStop);
  const trashed: number[] = [];
  let done = 0;
  for (const set of sets) {
    if (stop) break;
    try {
      trashed.push(...(await mergeSet(set, masterOf(set)))); // NOSONAR: one merge transaction at a time
    } catch (e) {
      ztoolkit.log("merge failed", e);
    }
    done++;
    pw.changeLine({
      text: `${getString("dup-bulk-working")} ${done}/${sets.length} (${getString("dup-click-stop")})`,
      progress: Math.round((done / sets.length) * 100),
    });
  }
  pw.close();
  if (stop && trashed.length) {
    const P = Services.prompt as any;
    const btn = P.confirmEx(
      win as any,
      addon.data.config.addonDisplayName,
      getString("dup-bulk-stopped", { args: { count: trashed.length } }),
      P.BUTTON_POS_0 * P.BUTTON_TITLE_IS_STRING +
        P.BUTTON_POS_1 * P.BUTTON_TITLE_IS_STRING,
      getString("dup-keep-merged"),
      getString("dup-restore"),
      null,
      null,
      {},
    );
    if (btn === 1) {
      await restore(trashed);
      return toast(
        getString("dup-restored", { args: { count: trashed.length } }),
      );
    }
  }
  toast(
    getString("dup-bulk-done", { args: { count: trashed.length } }),
    "success",
  );
}

/* ---------- import-time detection ---------- */
const pendingIDs = new Set<number>();
let timer: ReturnType<typeof setTimeout> | undefined;

const isFreshRegular = (i: Zotero.Item | false): i is Zotero.Item =>
  !!i &&
  i.isRegularItem() &&
  !i.isFeedItem &&
  !(Zotero.Libraries.get(i.libraryID) as any)?.isFeed &&
  Date.now() - Date.parse(`${i.dateAdded.replace(" ", "T")}Z`) < FRESH_MS;

export function onItemsAddedDup(ids: number[]) {
  if (!g("dup.detect")) return;
  for (const id of ids)
    if (isFreshRegular(Zotero.Items.get(id))) pendingIDs.add(id);
  if (!pendingIDs.size) return;
  clearTimeout(timer);
  timer = setTimeout(() => void checkNew(), QUIET_MS);
}

function askAction(win: Window, n: number): DupAction | null {
  const P = Services.prompt as any;
  const remember = { value: false };
  const btn = P.confirmEx(
    win as any,
    addon.data.config.addonDisplayName,
    getString("dup-found", { args: { count: n } }),
    P.BUTTON_POS_0 * P.BUTTON_TITLE_IS_STRING +
      P.BUTTON_POS_1 * P.BUTTON_TITLE_IS_STRING +
      P.BUTTON_POS_2 * P.BUTTON_TITLE_IS_STRING,
    getString("dup-keep-new"),
    getString("dup-keep-all"),
    getString("dup-keep-old"),
    getString("dup-remember"),
    remember,
  );
  const act: DupAction =
    btn === 0 ? "keepNew" : btn === 2 ? "keepOld" : "keepAll";
  if (remember.value) setPref("dup.action" as any, act as any);
  return act;
}

async function checkNew() {
  const ids = [...pendingIDs];
  pendingIDs.clear();
  const newItems = (Zotero.Items.get(ids) as Zotero.Item[]).filter(
    (i) => i && !i.deleted,
  );
  if (!newItems.length) return;
  const libs = [...new Set(newItems.map((i) => i.libraryID))];
  const newSet = new Set(newItems.map((i) => i.id));
  const hits: { set: Zotero.Item[]; fresh: Zotero.Item[] }[] = [];
  for (const lib of libs) {
    for (const set of await duplicateSets(lib)) {
      const fresh = set.filter((i) => newSet.has(i.id));
      if (fresh.length && fresh.length < set.length)
        hits.push({
          set: set.filter((i) => i.itemTypeID === fresh[0].itemTypeID),
          fresh,
        });
    }
  }
  const real = hits.filter((h) => h.set.length > 1);
  if (!real.length) return;
  let act = g("dup.action") as DupAction;
  const win = Zotero.getMainWindow();
  if (act === "ask") {
    const a = askAction(win, real.length);
    if (!a) return;
    act = a;
  }
  if (act === "keepAll") return;
  let n = 0;
  for (const { set, fresh } of real) {
    const old = set.filter((i) => !newSet.has(i.id));
    const masterID =
      act === "keepNew" ? masterOf(fresh, "newest") : masterOf(old);
    try {
      n += (await mergeSet(set, masterID)).length; // NOSONAR: sequential
    } catch (e) {
      ztoolkit.log("merge failed", e);
    }
  }
  toast(getString("dup-auto-merged", { args: { count: n } }), "success");
}
