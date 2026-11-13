import { $, arg, h } from "./dom";

interface Item {
  id: number;
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  attachments: number;
  preprint: boolean;
}
interface Group {
  score: number;
  reason: string;
  items: Item[];
  masterID: number;
  on?: boolean;
}
interface Ctrl {
  groups: Group[];
  labels: Record<string, string>;
  apply(picks: { masterID: number; otherIDs: number[] }[]): Promise<void>;
}

const c = arg<Ctrl>();
const L = c.labels;
const Z = (n: string) => `chrome://zotero/skin/16/universal/${n}.svg`;
const cbs = new Map<Group, HTMLInputElement>();

const meta = (i: Item) =>
  [
    i.authors,
    i.year,
    i.venue,
    i.doi,
    i.attachments
      ? L.attachments.replace("{count}", String(i.attachments))
      : "",
    i.preprint ? L.preprint : "",
  ]
    .filter(Boolean)
    .join(" · ");

function refresh() {
  const n = c.groups.filter((g) => g.on).length;
  $("count").textContent = L.selected.replace("{count}", String(n));
  ($("apply") as HTMLButtonElement).disabled = !n;
  for (const [g, cb] of cbs) cb.checked = !!g.on;
}

function row(g: Group, i: Item) {
  const radio = h("input", {
    type: "radio",
    name: `keep-${g.items[0].id}`,
    checked: g.masterID === i.id,
  }) as HTMLInputElement;
  radio.addEventListener("change", () => {
    g.masterID = i.id;
  });
  return h(
    "label",
    { class: "refwright-nd-row" },
    radio,
    h(
      "span",
      { class: "refwright-nd-text" },
      h("span", { class: "refwright-nd-title" }, i.title),
      h("span", { class: "refwright-muted" }, meta(i)),
    ),
  );
}

function card(g: Group) {
  const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
  cb.addEventListener("change", () => {
    g.on = cb.checked;
    refresh();
  });
  cbs.set(g, cb);
  return h(
    "div",
    { class: "refwright-card" },
    h(
      "div",
      { class: "refwright-head" },
      h("label", { class: "refwright-nd-merge" }, cb, L.mergeGroup),
      h("span", { class: "refwright-badge" }, g.reason),
      h("span", { class: "refwright-muted" }, `${Math.round(g.score * 100)}%`),
    ),
    h("div", { class: "refwright-nd-keep refwright-muted" }, L.keep),
    ...g.items.map((i) => row(g, i)),
  );
}

const setAll = (on: boolean) => {
  for (const g of c.groups) g.on = on;
  refresh();
};

window.addEventListener("load", () => {
  document.title = L.title;
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
    const picks = c.groups
      .filter((g) => g.on)
      .map((g) => ({
        masterID: g.masterID,
        otherIDs: g.items.map((i) => i.id).filter((id) => id !== g.masterID),
      }));
    if (!window.confirm(L.confirm.replace("{count}", String(picks.length))))
      return;
    ($("apply") as HTMLButtonElement).disabled = true;
    try {
      await c.apply(picks);
      window.close();
    } catch (err: any) {
      $("note").textContent = String(err?.message ?? err);
      $("note").hidden = false;
      refresh();
    }
  });
  $("list").replaceChildren(
    ...(c.groups.length
      ? c.groups.map(card)
      : [h("div", { class: "refwright-empty" }, L.empty)]),
  );
  refresh();
});
