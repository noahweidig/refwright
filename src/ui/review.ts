import { $, arg, h } from "./dom";

interface TagChoice {
  tag: string;
  source: string;
  on: boolean;
}
interface CollChoice {
  id: number;
  name: string;
  path: string;
  confidence: string;
  score: number;
  already: boolean;
  on: boolean;
  why: { words: string[]; papers: string[] };
}
interface RItem {
  itemID: number;
  title: string;
  on: boolean;
  tags?: TagChoice[];
  suggested?: string[];
  coll?: { choices: CollChoice[]; preselected: number[]; already: number[] };
}
interface Ctrl {
  single: boolean;
  items: RItem[];
  note?: string;
  labels: Record<string, string>;
  topN: number;
  retry?(): Promise<RItem[]>;
  apply(results: any[]): Promise<void>;
}

const c = arg<Ctrl>();
let items = c.items;
const L = c.labels;
let threshold = 0;
let filter = "";

function tagChip(it: RItem, t: TagChoice): HTMLElement {
  const chip = h(
    "span",
    {
      class: "refwright-chip tag" + (t.on ? " on" : ""),
      title: t.source ? `${L.source}: ${t.source}` : "",
      tabindex: 0,
      role: "checkbox",
      "aria-checked": String(t.on),
    },
    h("span", { class: "label" }, t.tag),
    t.source && !c.single
      ? h("span", { class: "refwright-src" }, t.source)
      : null,
    h(
      "button",
      {
        class: "refwright-x",
        title: L.remove,
        onclick: (e: Event) => {
          e.stopPropagation();
          it.tags = it.tags!.filter((x) => x !== t);
          render();
        },
      },
      "×",
    ),
  );
  const toggle = () => {
    t.on = !t.on;
    render();
  };
  chip.addEventListener("click", toggle);
  chip.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  return chip;
}

function collChip(ch: CollChoice): HTMLElement {
  const tip = [
    ch.path,
    ch.why.words.length ? `${L.matched}: ${ch.why.words.join(", ")}` : "",
    ...ch.why.papers.map((p) => `• ${p}`),
    `${L.score}: ${ch.score.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const chip = h(
    "span",
    {
      class: `refwright-chip coll${ch.on ? " on" : ""}${ch.already ? " already" : ""}`,
      title: tip,
      tabindex: 0,
      role: "checkbox",
      "aria-checked": String(ch.on),
    },
    h("span", { class: `refwright-dot ${ch.confidence}` }),
    h("span", { class: "label" }, ch.name),
  );
  const toggle = () => {
    ch.on = !ch.on;
    render();
  };
  chip.addEventListener("click", toggle);
  chip.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  return chip;
}

function card(it: RItem): HTMLElement {
  const body: (HTMLElement | null)[] = [];
  if (it.tags) {
    const input = h("input", {
      type: "text",
      class: "refwright-add",
      placeholder: L.addTag,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        const v = (e.target as HTMLInputElement).value.trim();
        if (v && !it.tags!.some((t) => t.tag.toLowerCase() === v.toLowerCase()))
          it.tags!.push({ tag: v, source: L.you, on: true });
        render();
      },
    }) as HTMLInputElement;
    body.push(
      h(
        "div",
        { class: "refwright-line" },
        h("span", { class: "refwright-k" }, L.tags),
        h(
          "div",
          { class: "refwright-chips" },
          ...(it.tags.length
            ? it.tags.map((t) => tagChip(it, t))
            : [h("span", { class: "refwright-muted" }, L.noTags)]),
          input,
        ),
      ),
    );
  }
  if (it.coll) {
    let ch = it.coll.choices.filter((x) => x.already || x.score >= threshold);
    if (filter) ch = ch.filter((x) => x.path.toLowerCase().includes(filter));
    const shown = c.single ? ch : ch.slice(0, c.topN);
    body.push(
      h(
        "div",
        { class: "refwright-line" },
        h("span", { class: "refwright-k" }, L.collections),
        h(
          "div",
          { class: "refwright-chips" },
          ...(shown.length
            ? shown.map(collChip)
            : [h("span", { class: "refwright-muted" }, L.noCollections)]),
        ),
      ),
    );
  }
  return h(
    "div",
    { class: "refwright-card" + (it.on ? "" : " off") },
    h(
      "label",
      { class: "refwright-head" },
      h("input", {
        type: "checkbox",
        checked: it.on,
        onchange: (e: Event) => {
          it.on = (e.target as HTMLInputElement).checked;
          render();
        },
      }),
      h("span", { class: "refwright-title" }, it.title),
    ),
    ...body,
  );
}

function render() {
  const list = $("list");
  list.replaceChildren(
    ...(items.length
      ? items.map(card)
      : [h("div", { class: "refwright-empty" }, L.empty)]),
  );
  const n = items.filter((i) => i.on).length;
  $("count").textContent = `${n} / ${items.length}`;
}

function results() {
  return items.map((i) => ({
    itemID: i.itemID,
    on: i.on,
    tags: (i.tags ?? []).filter((t) => t.on).map((t) => t.tag),
    suggested: i.suggested ?? [],
    collections: (i.coll?.choices ?? []).filter((x) => x.on).map((x) => x.id),
    preselected: i.coll?.preselected ?? [],
  }));
}

window.addEventListener("load", () => {
  document.title = L.title;
  if (c.note) $("note").textContent = c.note;
  $("note").hidden = !c.note;
  if (c.single) {
    $("tools").hidden = false;
    ($("search") as HTMLInputElement).addEventListener("input", (e) => {
      filter = (e.target as HTMLInputElement).value.toLowerCase();
      render();
    });
    ($("thresh") as HTMLInputElement).addEventListener("input", (e) => {
      threshold = Number((e.target as HTMLInputElement).value) / 100;
      render();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        $("search").focus();
      }
    });
  }
  $("all").addEventListener("click", () => {
    const on = items.some((i) => !i.on);
    items.forEach((i) => (i.on = on));
    render();
  });
  const dlg = document.querySelector("dialog") as any;
  dlg.getButton("accept").label = L.apply;
  dlg.getButton("cancel").label = L.cancel;
  const rb = dlg.getButton("extra2");
  rb.label = L.retry;
  rb.hidden = !c.retry;
  $("all").textContent = L.toggleAll;
  document.addEventListener("dialogaccept", async (e) => {
    e.preventDefault();
    dlg.getButton("accept").disabled = true;
    try {
      await c.apply(results());
      window.close();
    } catch (err: any) {
      $("note").textContent = String(err?.message ?? err);
      $("note").hidden = false;
      dlg.getButton("accept").disabled = false;
    }
  });
  if (c.retry) {
    document.addEventListener("dialogextra2", async () => {
      items = await c.retry!();
      render();
    });
  }
  render();
});
