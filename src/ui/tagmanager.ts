import { $, arg, h, isTyping } from "./dom";

interface TC {
  name: string;
  count: number;
}
interface Group {
  reason: string;
  tags: TC[];
  target: string;
}
interface Ctrl {
  labels: Record<string, string>;
  load(): Promise<TC[]>;
  duplicates(tags: TC[]): Promise<Group[]>;
  formatting(tags: TC[]): (TC & { fixed: string })[];
  estimate(tags: TC[]): { tags: number; requests: number; tokens: number };
  similar(tags: TC[]): Promise<Group[]>;
  forget(): void;
  merge(from: string[], to: string, batch?: number): Promise<number>;
  undo(): Promise<boolean>;
  aiReady(): boolean;
  cancel(): void;
}
const c = arg<Ctrl>();
const L = c.labels;
let tags: TC[] = [];
let view: "all" | "dup" | "fmt" | "sim" = "all";
let sort = "count";
let filt = "any";
let q = "";
const sel = new Set<string>();
let groups: Group[] = [];
let fmt: (TC & { fixed: string })[] = [];
let busy = "";
/** the tags the All Tags list shows right now (after search and filter) */
let visible: TC[] = [];
let scanning = false;
let scanSeq = 0;

async function scanDup() {
  const seq = ++scanSeq;
  scanning = true;
  groups = [];
  draw();
  try {
    const r = await c.duplicates(tags);
    if (seq !== scanSeq) return;
    groups = r;
  } catch (e: any) {
    if (seq === scanSeq) status(String(e?.message ?? e));
  }
  if (seq === scanSeq) {
    scanning = false;
    draw();
  }
}

const Z = (n: string) =>
  n.startsWith("chrome://") ? n : `chrome://zotero/skin/16/universal/${n}.svg`;
const glyph = (n: string, cls = "") =>
  h("span", {
    class: `refwright-glyph ${cls}`,
    style: { backgroundImage: `url(${Z(n)})` },
  });

const status = (s: string) => {
  $("status").textContent = s;
};

async function reload() {
  tags = await c.load();
  if (view === "fmt") fmt = c.formatting(tags);
  sel.clear();
  prune();
  draw();
}

/** Drop merged-away tags from the open groups; a group left with one tag disappears. */
function prune() {
  const live = new Map(tags.map((t) => [t.name, t]));
  groups = groups
    .map((g) => {
      const m = g.tags
        .filter((t) => live.has(t.name))
        .map((t) => live.get(t.name)!);
      const best =
        [...m].sort((a, b) => b.count - a.count)[0]?.name ?? g.target;
      return { ...g, tags: m, target: live.has(g.target) ? g.target : best };
    })
    .filter((g) => g.tags.length > 1);
}

async function doMerge(
  from: string[],
  to: string,
  done?: Group,
  remove = false,
) {
  if (!from.length || (!remove && !to.trim())) return;
  busy = "…";
  draw();
  try {
    const n = await c.merge(from, remove ? "" : to.trim());
    if (done) groups = groups.filter((g) => g !== done);
    status(`${L.merged}: ${n}`);
  } catch (e: any) {
    status(String(e?.message ?? e));
  }
  busy = "";
  await reload();
}

function deleteSelected() {
  if (!sel.size || busy) return;
  if (window.confirm(L.confirmDelete))
    void doMerge([...sel], "", undefined, true);
}

async function doUndo() {
  if (busy) return;
  status((await c.undo()) ? L.undone : L.nothing);
  await reload();
}

function selectVisible() {
  for (const t of visible) sel.add(t.name);
  draw(true);
}

function focusSearch() {
  (
    $("pane").querySelector("input[type=search]") as HTMLElement | null
  )?.focus();
}

/** The action for a key press, or nothing. Text fields keep their own select-all and undo. */
function shortcut(e: KeyboardEvent): (() => void) | undefined {
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  const key = e.key.toLowerCase();
  const all = view === "all";
  if (mod && key === "f" && all) return focusSearch;
  if (isTyping(e)) return undefined;
  if (mod && key === "a" && all) return selectVisible;
  if (mod && key === "z") return () => void doUndo();
  if ((e.key === "Delete" || e.key === "Backspace") && all)
    return deleteSelected;
  return undefined;
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return;
  if (e.key === "Escape") return window.close();
  const act = shortcut(e);
  if (!act) return;
  e.preventDefault();
  act();
}

function loadingPane(): HTMLElement[] {
  return [
    h(
      "div",
      { class: "refwright-loading" },
      h("progress", {}),
      h("span", { class: "refwright-muted" }, L.scanning),
    ),
  ];
}

function allPane(): HTMLElement[] {
  let list = tags.filter((t) => t.name.toLowerCase().includes(q));
  if (filt === "once") list = list.filter((t) => t.count === 1);
  if (filt === "many") list = list.filter((t) => t.count > 1);
  list.sort((a, b) =>
    sort === "az"
      ? a.name.localeCompare(b.name)
      : sort === "least"
        ? a.count - b.count || a.name.localeCompare(b.name)
        : b.count - a.count || a.name.localeCompare(b.name),
  );
  visible = list;
  const target = h("input", {
    type: "text",
    placeholder: L.target,
    value: sel.size === 1 ? [...sel][0] : "",
    id: "target",
  }) as HTMLInputElement;
  const count = h("span", { class: "refwright-muted refwright-selcount" });
  const ren = h("button") as HTMLButtonElement;
  const del = h("button") as HTMLButtonElement;
  const sync = () => {
    count.textContent = sel.size
      ? `${sel.size} / ${list.length}`
      : `${list.length}`;
    ren.disabled = del.disabled = !sel.size;
    ren.textContent = sel.size > 1 ? L.merge : L.rename;
    if (sel.size === 1) target.value = [...sel][0];
  };
  ren.onclick = () => void doMerge([...sel], target.value);
  del.textContent = L.del;
  del.onclick = deleteSelected;
  target.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (sel.size && target.value.trim()) ren.click();
  });
  const row = (t: TC) => {
    const r = h(
      "div",
      {
        class: `refwright-tagrow${sel.has(t.name) ? " selected" : ""}`,
        role: "option",
        tabindex: "0",
        "aria-selected": String(sel.has(t.name)),
      },
      glyph("tag"),
      h("span", { class: "n" }, t.name),
      h("span", { class: "c" }, String(t.count)),
    );
    const flip = () => {
      if (sel.has(t.name)) sel.delete(t.name);
      else sel.add(t.name);
      r.classList.toggle("selected", sel.has(t.name));
      r.setAttribute("aria-selected", String(sel.has(t.name)));
      sync();
    };
    r.addEventListener("click", flip);
    r.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip();
      }
    });
    return r;
  };
  const listEl = h("div", {
    class: "refwright-list",
    role: "listbox",
    "aria-multiselectable": "true",
  });
  let shown = 0;
  const more = () => {
    const next = list.slice(shown, shown + 120);
    shown += next.length;
    listEl.append(...next.map(row));
  };
  more();
  listEl.addEventListener("scroll", () => {
    if (
      shown < list.length &&
      listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 300
    )
      more();
  });
  sync();
  return [
    h(
      "div",
      { class: "refwright-bar" },
      h(
        "div",
        { class: "refwright-search" },
        glyph("magnifier"),
        h("input", {
          type: "search",
          placeholder: L.search,
          value: q,
          oninput: (e: Event) => {
            q = (e.target as HTMLInputElement).value.toLowerCase();
            draw(true);
          },
        }),
      ),
      h(
        "select",
        {
          onchange: (e: Event) => {
            sort = (e.target as HTMLSelectElement).value;
            draw();
          },
        },
        ...[
          ["count", L.mostUsed],
          ["az", L.az],
          ["least", L.leastUsed],
        ].map(([v, t]) => h("option", { value: v, selected: v === sort }, t)),
      ),
      h(
        "select",
        {
          onchange: (e: Event) => {
            filt = (e.target as HTMLSelectElement).value;
            draw();
          },
        },
        ...[
          ["any", L.all],
          ["once", L.usedOnce],
          ["many", L.usedMany],
        ].map(([v, t]) => h("option", { value: v, selected: v === filt }, t)),
      ),
    ),
    h(
      "div",
      { class: "refwright-colhead" },
      h("span", { class: "n" }, L.allTags),
      h("span", { class: "c" }, "#"),
    ),
    listEl,
    h("div", { class: "refwright-footer" }, count, target, ren, del),
  ];
}

interface Card {
  group: Group;
  names(): string[];
  target(): string;
}
let cards: Card[] = [];

/** Merge every open group with the ticks and targets currently shown. One undo reverses all. */
async function mergeAll() {
  const todo = cards
    .map((cd) => ({ group: cd.group, from: cd.names(), to: cd.target() }))
    .filter((t) => t.from.some((n) => n !== t.to));
  if (!todo.length) return status(L.none);
  if (
    !window.confirm(L.confirmMergeAll.replace("{count}", String(todo.length)))
  )
    return;
  busy = "…";
  draw();
  const batch = Date.now();
  let n = 0;
  try {
    for (const t of todo) {
      n += await c.merge(t.from, t.to, batch); // NOSONAR: one database write at a time
      groups = groups.filter((g) => g !== t.group);
    }
    status(`${L.merged}: ${n}`);
  } catch (e: any) {
    status(String(e?.message ?? e));
  }
  busy = "";
  await reload();
}

function mergeAllButton(count: number) {
  return h(
    "button",
    {
      disabled: !!busy || scanning || !count,
      onclick: mergeAll,
    },
    `${L.mergeAll} (${count})`,
  );
}

function groupPane(gs: Group[], ai = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  cards = [];
  if (ai) {
    const est = c.estimate(tags);
    out.push(
      h(
        "div",
        { class: "refwright-bar" },
        h(
          "span",
          { class: "refwright-muted refwright-grow" },
          L.estimate
            .replace("{tags}", String(est.tags))
            .replace("{requests}", String(est.requests))
            .replace("{tokens}", String(est.tokens)),
        ),
        h(
          "button",
          {
            disabled: !!busy || !c.aiReady() || !est.tags,
            onclick: runSimilar,
          },
          L.run,
        ),
        h(
          "button",
          {
            onclick: () => {
              c.forget();
              draw();
            },
          },
          L.forget,
        ),
        mergeAllButton(gs.length),
      ),
    );
    if (!c.aiReady()) out.push(h("div", { class: "refwright-note" }, L.needAi));
  } else if (gs.length) {
    out.push(
      h(
        "div",
        { class: "refwright-bar" },
        h("span", { class: "refwright-muted refwright-grow" }, `${gs.length}`),
        mergeAllButton(gs.length),
      ),
    );
  }
  const body = h("div", { class: "refwright-body" });
  out.push(body);
  if (!gs.length) body.append(h("div", { class: "refwright-empty" }, L.none));
  gs.forEach((g, gi) => {
    const checks = new Map<string, HTMLInputElement>();
    const targetSel = h(
      "select",
      {},
      ...g.tags.map((t) =>
        h(
          "option",
          { value: t.name, selected: t.name === g.target },
          `${t.name} (${t.count})`,
        ),
      ),
    ) as HTMLSelectElement;
    cards.push({
      group: g,
      names: () => [...checks].filter(([, cb]) => cb.checked).map(([n]) => n),
      target: () => targetSel.value,
    });
    body.append(
      h(
        "div",
        { class: "refwright-card" },
        h(
          "div",
          { class: "refwright-head" },
          glyph("tag"),
          h("span", { class: "refwright-title" }, g.target),
          h("span", { class: "refwright-badge" }, g.reason),
          h("span", { class: "refwright-muted" }, `${g.tags.length}`),
        ),
        h(
          "div",
          { class: "refwright-chips" },
          ...g.tags.map((t) => {
            const cb = h("input", {
              type: "checkbox",
              checked: true,
            }) as HTMLInputElement;
            checks.set(t.name, cb);
            return h(
              "label",
              { class: "refwright-chip on" },
              cb,
              h("span", { class: "label" }, `${t.name}`),
              h("span", { class: "refwright-src" }, String(t.count)),
            );
          }),
        ),
        h(
          "div",
          { class: "refwright-actions" },
          h("span", { class: "refwright-k" }, L.mergeInto),
          targetSel,
          h(
            "button",
            {
              disabled: !!busy,
              onclick: () =>
                doMerge(
                  [...checks].filter(([, cb]) => cb.checked).map(([n]) => n),
                  targetSel.value,
                  g,
                ),
            },
            L.merge,
          ),
        ),
      ),
    );
    void gi;
  });
  return out;
}

async function runSimilar() {
  busy = L.working;
  draw();
  try {
    groups = await c.similar(tags);
    status(`${groups.length}`);
  } catch (e: any) {
    status(String(e?.message ?? e));
  }
  busy = "";
  draw();
}

function fmtPane(): HTMLElement[] {
  if (!fmt.length) return [h("div", { class: "refwright-empty" }, L.none)];
  return [
    h(
      "div",
      { class: "refwright-colhead" },
      h("span", { class: "n" }, L.formatting),
      h("span", { class: "c" }, "#"),
      h("span", { class: "act" }),
    ),
    h(
      "div",
      { class: "refwright-list" },
      ...fmt.map((t) =>
        h(
          "div",
          { class: "refwright-tagrow fix" },
          glyph("tag"),
          h("span", { class: "n" }, t.name),
          h("span", { class: "arrow" }, "→"),
          h("span", { class: "n new" }, t.fixed || L.dropped),
          h("span", { class: "c" }, String(t.count)),
          h(
            "button",
            { disabled: !t.fixed, onclick: () => doMerge([t.name], t.fixed) },
            L.fix,
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "refwright-footer" },
      h("span", { class: "refwright-muted refwright-grow" }, `${fmt.length}`),
      h(
        "button",
        {
          onclick: async () => {
            for (const t of fmt.filter((x) => x.fixed))
              await doMerge([t.name], t.fixed);
          },
        },
        L.fixAll,
      ),
    ),
  ];
}

function paneFor(): HTMLElement[] {
  if (view === "all") return allPane();
  if (view === "fmt") return fmtPane();
  if (view === "dup") return scanning ? loadingPane() : groupPane(groups);
  return groupPane(groups, true);
}

function draw(keepFocus = false) {
  const pane = $("pane");
  const active = keepFocus ? document.activeElement : null;
  const pos = (active as HTMLInputElement | null)?.selectionStart;
  const nodes = paneFor();
  pane.replaceChildren(...nodes);
  if (active && (active as HTMLInputElement).type === "search") {
    const s = pane.querySelector(
      "input[type=search]",
    ) as HTMLInputElement | null;
    s?.focus();
    if (pos != null) s?.setSelectionRange(pos, pos);
  }
  for (const b of document.querySelectorAll("#nav button"))
    b.classList.toggle("active", (b as HTMLElement).dataset.view === view);
  $("total").textContent = `${tags.length} ${L.total}`;
}

window.addEventListener("load", async () => {
  document.title = L.title;
  const names: [typeof view, string][] = [
    ["all", L.allTags],
    ["dup", L.duplicates],
    ["fmt", L.formatting],
    ["sim", L.similar],
  ];
  $("nav").replaceChildren(
    ...names.map(([v, t]) =>
      h(
        "button",
        {
          "data-view": v,
          class: "refwright-nav",
          onclick: async () => {
            view = v;
            sel.clear();
            scanSeq++;
            scanning = false;
            if (v === "fmt") fmt = c.formatting(tags);
            if (v === "sim") groups = [];
            if (v === "dup") await scanDup();
            else draw();
          },
        },
        t,
      ),
    ),
  );
  $("close").textContent = L.close;
  $("close").addEventListener("click", () => window.close());
  document.addEventListener("keydown", onKey);
  $("undo").textContent = L.undo;
  $("undo").addEventListener("click", () => void doUndo());
  window.addEventListener("unload", () => c.cancel());
  status(L.working);
  await reload();
  status("");
});
