import { $, arg, h } from "./dom";

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
  duplicates(tags: TC[]): Group[];
  formatting(tags: TC[]): (TC & { fixed: string })[];
  estimate(tags: TC[]): { tags: number; requests: number; tokens: number };
  similar(tags: TC[]): Promise<Group[]>;
  forget(): void;
  merge(from: string[], to: string): Promise<number>;
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

const status = (s: string) => {
  $("status").textContent = s;
};

async function reload() {
  tags = await c.load();
  if (view === "dup") groups = c.duplicates(tags);
  if (view === "fmt") fmt = c.formatting(tags);
  sel.clear();
  draw();
}

async function doMerge(from: string[], to: string) {
  if (!to.trim() || !from.length) return;
  busy = "…";
  draw();
  try {
    const n = await c.merge(from, to.trim());
    status(`${L.merged}: ${n}`);
  } catch (e: any) {
    status(String(e?.message ?? e));
  }
  busy = "";
  await reload();
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
  const chosen = [...sel];
  const target = h("input", {
    type: "text",
    placeholder: L.target,
    value: chosen.length === 1 ? chosen[0] : "",
    id: "target",
  }) as HTMLInputElement;
  return [
    h(
      "div",
      { class: "refwright-bar" },
      h("input", {
        type: "search",
        placeholder: L.search,
        value: q,
        oninput: (e: Event) => {
          q = (e.target as HTMLInputElement).value.toLowerCase();
          draw(true);
        },
      }),
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
      { class: "refwright-list" },
      ...list.slice(0, 800).map((t) =>
        h(
          "label",
          { class: "refwright-tagrow" },
          h("input", {
            type: "checkbox",
            checked: sel.has(t.name),
            onchange: (e: Event) => {
              if ((e.target as HTMLInputElement).checked) sel.add(t.name);
              else sel.delete(t.name);
              draw(true);
            },
          }),
          h("span", { class: "n" }, t.name),
          h("span", { class: "c" }, String(t.count)),
        ),
      ),
    ),
    h(
      "div",
      { class: "refwright-actions" },
      target,
      h(
        "button",
        {
          disabled: !chosen.length,
          onclick: () =>
            doMerge(chosen, ($("target") as HTMLInputElement).value),
        },
        chosen.length > 1 ? L.merge : L.rename,
      ),
      h(
        "button",
        {
          disabled: !chosen.length,
          onclick: () => {
            if (window.confirm(L.confirmDelete)) doMerge(chosen, "");
          },
        },
        L.del,
      ),
    ),
  ];
}

function groupPane(gs: Group[], ai = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (ai) {
    const est = c.estimate(tags);
    out.push(
      h(
        "div",
        { class: "refwright-bar" },
        h(
          "span",
          { class: "refwright-muted" },
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
      ),
    );
    if (!c.aiReady()) out.push(h("div", { class: "refwright-note" }, L.needAi));
  }
  if (!gs.length) out.push(h("div", { class: "refwright-empty" }, L.none));
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
    out.push(
      h(
        "div",
        { class: "refwright-card" },
        h(
          "div",
          { class: "refwright-head" },
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
              onclick: () =>
                doMerge(
                  [...checks].filter(([, cb]) => cb.checked).map(([n]) => n),
                  targetSel.value,
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
      { class: "refwright-list" },
      ...fmt.map((t) =>
        h(
          "div",
          { class: "refwright-tagrow fix" },
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
      { class: "refwright-actions" },
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

function draw(keepFocus = false) {
  const pane = $("pane");
  const active = keepFocus ? document.activeElement : null;
  const pos = (active as HTMLInputElement | null)?.selectionStart;
  const nodes =
    view === "all"
      ? allPane()
      : view === "dup"
        ? groupPane(groups)
        : view === "fmt"
          ? fmtPane()
          : groupPane(groups, true);
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
  $("total").textContent = `${tags.length}`;
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
            if (v === "dup") groups = c.duplicates(tags);
            if (v === "fmt") fmt = c.formatting(tags);
            if (v === "sim") groups = [];
            draw();
          },
        },
        t,
      ),
    ),
  );
  $("undo").textContent = L.undo;
  $("undo").addEventListener("click", async () => {
    status((await c.undo()) ? L.undone : L.nothing);
    await reload();
  });
  window.addEventListener("unload", () => c.cancel());
  status(L.working);
  await reload();
  status("");
});
