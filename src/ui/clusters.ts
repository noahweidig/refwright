import { $, arg, h } from "./dom";

interface Suggestion {
  name: string;
  ids: number[];
  titles: string[];
  on?: boolean;
}
interface Ctrl {
  items: Suggestion[];
  note?: string;
  labels: Record<string, string>;
  apply(picks: { name: string; ids: number[] }[]): Promise<void>;
}

const c = arg<Ctrl>();
const L = c.labels;
const cbs = new Map<Suggestion, HTMLInputElement>();
const names = new Map<Suggestion, HTMLInputElement>();
const SHOWN = 6;

function refresh() {
  const n = c.items.filter((s) => s.on).length;
  $("count").textContent = L.selected.replace("{count}", String(n));
  ($("apply") as HTMLButtonElement).disabled = !n;
  for (const [s, cb] of cbs) cb.checked = !!s.on;
}

function card(s: Suggestion) {
  const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
  cb.addEventListener("change", () => {
    s.on = cb.checked;
    refresh();
  });
  cbs.set(s, cb);
  const name = h("input", { type: "text", value: s.name }) as HTMLInputElement;
  names.set(s, name);
  const rest = s.titles.length - SHOWN;
  return h(
    "div",
    { class: "refwright-card" },
    h(
      "div",
      { class: "refwright-head" },
      cb,
      name,
      h(
        "span",
        { class: "refwright-muted" },
        L.papers.replace("{count}", String(s.ids.length)),
      ),
    ),
    h(
      "div",
      { class: "refwright-chips" },
      ...s.titles
        .slice(0, SHOWN)
        .map((t) => h("span", { class: "refwright-chip" }, t)),
      rest > 0
        ? h(
            "span",
            { class: "refwright-muted" },
            L.more.replace("{count}", String(rest)),
          )
        : null,
    ),
  );
}

const setAll = (on: boolean) => {
  for (const s of c.items) s.on = on;
  refresh();
};

window.addEventListener("load", () => {
  document.title = L.title;
  if (c.note) {
    $("note").textContent = c.note;
    $("note").hidden = false;
  }
  $("all").textContent = L.selectAll;
  $("none").textContent = L.selectNone;
  $("apply").textContent = L.apply;
  $("cancel").textContent = L.cancel;
  $("all").addEventListener("click", () => setAll(true));
  $("none").addEventListener("click", () => setAll(false));
  $("cancel").addEventListener("click", () => window.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
  $("apply").addEventListener("click", async () => {
    ($("apply") as HTMLButtonElement).disabled = true;
    try {
      await c.apply(
        c.items
          .filter((s) => s.on && names.get(s)!.value.trim())
          .map((s) => ({ name: names.get(s)!.value.trim(), ids: s.ids })),
      );
      window.close();
    } catch (err: any) {
      $("note").textContent = String(err?.message ?? err);
      $("note").hidden = false;
      refresh();
    }
  });
  $("list").replaceChildren(
    ...(c.items.length
      ? c.items.map(card)
      : [h("div", { class: "refwright-empty" }, L.empty)]),
  );
  refresh();
});
