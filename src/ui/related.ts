import { $, arg, h } from "./dom";

interface Hit {
  itemID: number;
  title: string;
  score: number;
  on: boolean;
}
interface RItem {
  itemID: number;
  title: string;
  hits: Hit[];
}
interface Ctrl {
  items: RItem[];
  note?: string;
  labels: Record<string, string>;
  apply(links: { itemID: number; others: number[] }[]): Promise<void>;
}

const c = arg<Ctrl>();
const L = c.labels;
const Z = (n: string) => `chrome://zotero/skin/16/universal/${n}.svg`;
const glyph = (n: string) =>
  h("span", {
    class: "refwright-glyph",
    style: { backgroundImage: `url(${Z(n)})` },
  });

const pct = (s: number) => `${Math.round(s * 100)}%`;
const all = () => c.items.flatMap((i) => i.hits);
const chips = new Map<Hit, HTMLElement>();

function refresh() {
  const n = all().filter((x) => x.on).length;
  $("count").textContent = L.selected.replace("{count}", String(n));
  const dlg = document.querySelector("dialog") as any;
  dlg.getButton("accept").disabled = !n;
  for (const [hit, el] of chips) {
    el.classList.toggle("on", hit.on);
    (el.querySelector("input") as HTMLInputElement).checked = hit.on;
  }
}

function chipFor(hit: Hit) {
  const cb = h("input", {
    type: "checkbox",
    checked: hit.on,
  }) as HTMLInputElement;
  const el = h(
    "label",
    { class: `refwright-chip${hit.on ? " on" : ""}`, title: pct(hit.score) },
    cb,
    h("span", { class: "label" }, hit.title),
    h("span", { class: "refwright-src" }, pct(hit.score)),
  );
  cb.addEventListener("change", () => {
    hit.on = cb.checked;
    refresh();
  });
  chips.set(hit, el);
  return el;
}

function render() {
  chips.clear();
  const list = $("list");
  if (!c.items.length) {
    list.replaceChildren(h("div", { class: "refwright-empty" }, L.empty));
    return refresh();
  }
  list.replaceChildren(
    ...c.items.map((it) =>
      h(
        "div",
        { class: "refwright-card" },
        h(
          "div",
          { class: "refwright-head" },
          glyph("related"),
          h("span", { class: "refwright-title" }, it.title),
          h("span", { class: "refwright-muted" }, String(it.hits.length)),
        ),
        h(
          "div",
          { class: "refwright-chips" },
          ...(it.hits.length
            ? it.hits.map(chipFor)
            : [h("span", { class: "refwright-muted" }, L.none)]),
        ),
      ),
    ),
  );
  refresh();
}

window.addEventListener("load", () => {
  document.title = L.title;
  if (c.note) {
    $("note").textContent = c.note;
    $("note").hidden = false;
  }
  $("thresh-label").textContent = L.threshold;
  $("none").textContent = L.selectNone;
  const t = $("thresh") as HTMLInputElement;
  const shown = () => {
    $("thresh-value").textContent =
      Number(t.value) >= 100 ? "-" : `${t.value}%`;
  };
  t.addEventListener("input", () => {
    // 100 selects nothing; lower values select every suggestion at or above it
    for (const hit of all())
      hit.on = Number(t.value) < 100 && hit.score * 100 >= Number(t.value);
    shown();
    refresh();
  });
  $("none").addEventListener("click", () => {
    t.value = "100";
    for (const hit of all()) hit.on = false;
    shown();
    refresh();
  });
  const dlg = document.querySelector("dialog") as any;
  dlg.getButton("accept").label = L.apply;
  dlg.getButton("cancel").label = L.cancel;
  document.addEventListener("dialogaccept", async (e) => {
    e.preventDefault();
    dlg.getButton("accept").disabled = true;
    try {
      await c.apply(
        c.items
          .map((i) => ({
            itemID: i.itemID,
            others: i.hits.filter((x) => x.on).map((x) => x.itemID),
          }))
          .filter((l) => l.others.length),
      );
      window.close();
    } catch (err: any) {
      $("note").textContent = String(err?.message ?? err);
      $("note").hidden = false;
      refresh();
    }
  });
  shown();
  render();
});
