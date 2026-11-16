import { $, arg, h } from "./dom";

interface Row {
  key: string;
  title: string;
  itemType?: string;
  lines: string[];
  fixable: boolean;
}
interface Section {
  id: string;
  label: string;
  rows: Row[];
}
interface Option {
  id: string;
  label: string;
  on: boolean;
}
interface Ctrl {
  sections: Section[];
  options: Option[];
  labels: Record<string, string>;
  run(
    keys: string[],
    opts: Record<string, boolean>,
    report: (key: string, ok: boolean, text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

const c = arg<Ctrl>();
const L = c.labels;
const Z = (n: string) => `chrome://zotero/skin/16/universal/${n}.svg`;
const glyph = (n: string) =>
  h("span", {
    class: "refwright-glyph",
    style: { backgroundImage: `url(${Z(n)})` },
  });

const picked = new Set<string>();
const boxes = new Map<string, HTMLInputElement>();
const results = new Map<string, HTMLElement>();
const sectionBoxes = new Map<Section, HTMLInputElement>();
let running = false;
let abort: AbortController | undefined;

const fixable = (s: Section) => s.rows.filter((r) => r.fixable);

function refresh() {
  $("count").textContent = L.selected.replace("{count}", String(picked.size));
  ($("apply") as HTMLButtonElement).disabled = !running && !picked.size;
  for (const [k, cb] of boxes) {
    cb.checked = picked.has(k);
    cb.disabled = running;
  }
  for (const [s, cb] of sectionBoxes) {
    const rows = fixable(s);
    cb.checked = rows.length > 0 && rows.every((r) => picked.has(r.key));
    cb.disabled = running || !rows.length;
  }
}

function typeIcon(type?: string) {
  return type
    ? h("span", {
        class: "icon icon-item-type refwright-fx-type",
        "data-item-type": type,
      })
    : h("span", { class: "refwright-fx-type" });
}

function row(r: Row) {
  const cb = h("input", { type: "checkbox", disabled: !r.fixable });
  cb.addEventListener("change", () => {
    if ((cb as HTMLInputElement).checked) picked.add(r.key);
    else picked.delete(r.key);
    refresh();
  });
  boxes.set(r.key, cb as HTMLInputElement);
  const result = h("span", { class: "refwright-fx-result" });
  results.set(r.key, result);
  return h(
    "label",
    { class: "refwright-nd-row" },
    cb,
    typeIcon(r.itemType),
    h(
      "span",
      { class: "refwright-nd-text refwright-grow" },
      h("span", { class: "refwright-nd-title" }, r.title),
      ...r.lines.map((l) => h("span", { class: "refwright-muted" }, l)),
      !r.fixable && h("span", { class: "refwright-muted" }, L.noFix),
    ),
    result,
  );
}

function card(s: Section) {
  const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
  cb.addEventListener("change", () => {
    for (const r of fixable(s))
      if (cb.checked) picked.add(r.key);
      else picked.delete(r.key);
    refresh();
  });
  sectionBoxes.set(s, cb);
  return h(
    "div",
    { class: "refwright-card" },
    h(
      "div",
      { class: "refwright-head" },
      h(
        "label",
        { class: "refwright-nd-merge", title: L.sectionAll },
        cb,
        s.label,
      ),
      h("span", { class: "refwright-badge" }, String(s.rows.length)),
    ),
    ...s.rows.map(row),
  );
}

function report(key: string, ok: boolean, text: string) {
  const el = results.get(key);
  if (!el) return;
  el.replaceChildren(
    glyph(ok ? "tick" : "warning"),
    h("span", { class: ok ? "refwright-muted" : "refwright-fx-bad" }, text),
  );
  el.classList.toggle("ok", ok);
  tally[ok ? "ok" : "failed"]++;
  $("status").textContent = L.running;
}
const tally = { ok: 0, failed: 0 };

async function start() {
  const keys = [...picked];
  if (!window.confirm(L.confirm.replace("{count}", String(keys.length))))
    return;
  const opts: Record<string, boolean> = {};
  for (const o of c.options)
    opts[o.id] = (
      document.getElementById(`opt-${o.id}`) as HTMLInputElement
    ).checked;
  running = true;
  abort = new AbortController();
  $("apply").textContent = L.stop;
  ($("apply") as HTMLButtonElement).disabled = false;
  $("status").textContent = L.running;
  refresh();
  try {
    await c.run(keys, opts, report, abort.signal);
  } catch (e: any) {
    $("note").textContent = String(e?.message ?? e);
    $("note").hidden = false;
  }
  running = false;
  for (const k of keys) picked.delete(k);
  $("apply").textContent = L.apply;
  $("status").textContent = L.finished
    .replace("{ok}", String(tally.ok))
    .replace("{failed}", String(tally.failed));
  refresh();
}

window.addEventListener("load", () => {
  document.title = L.title;
  $("all").textContent = L.selectAll;
  $("none").textContent = L.selectNone;
  $("close").textContent = L.close;
  $("apply").textContent = L.apply;
  $("all").addEventListener("click", () => {
    for (const s of c.sections) for (const r of fixable(s)) picked.add(r.key);
    refresh();
  });
  $("none").addEventListener("click", () => {
    picked.clear();
    refresh();
  });
  $("close").addEventListener("click", () => window.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !running) window.close();
  });
  $("apply").addEventListener("click", () => {
    if (running) abort?.abort();
    else void start();
  });
  $("opts").replaceChildren(
    ...c.options.map((o) =>
      h(
        "label",
        { class: "refwright-fx-opt" },
        h("input", { type: "checkbox", id: `opt-${o.id}`, checked: o.on }),
        o.label,
      ),
    ),
  );
  $("list").replaceChildren(...c.sections.map(card));
  refresh();
});
