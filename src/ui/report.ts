import { $, arg, h } from "./dom";

interface Row {
  itemID: number;
  title: string;
  text: string;
  status: string;
}
interface Ctrl {
  title: string;
  labels: Record<string, string>;
  rows: Row[];
  finished(): boolean;
  subscribe(cb: () => void): void;
  cancel?(): void;
  onClose?(): void;
  select?(itemID: number): void;
}
const c = arg<Ctrl>();
const L = c.labels;

function draw() {
  const body = $("rows");
  body.replaceChildren(
    ...c.rows.map((r) =>
      h(
        "tr",
        { class: `s-${r.status}`, ondblclick: () => c.select?.(r.itemID) },
        h(
          "td",
          { class: "state" },
          h("span", { class: `refwright-dot st-${r.status}` }),
        ),
        h("td", { class: "item", title: r.title }, r.title),
        h("td", { class: "res", title: r.text }, r.text),
      ),
    ),
  );
  const done = c.rows.filter(
    (r) => r.status !== "pending" && r.status !== "running",
  ).length;
  $("sum").textContent = `${done} / ${c.rows.length}`;
  ($("bar") as HTMLProgressElement).value = c.rows.length
    ? done / c.rows.length
    : 1;
  const dlg = document.querySelector("dialog") as any;
  if (c.finished()) {
    dlg.getButton("cancel").hidden = true;
    dlg.getButton("accept").hidden = false;
    ($("bar") as HTMLElement).hidden = true;
  }
}
window.addEventListener("load", () => {
  document.title = c.title;
  $("c1").textContent = L.item;
  $("c2").textContent = L.result;
  const dlg = document.querySelector("dialog") as any;
  dlg.getButton("cancel").label = L.cancel;
  dlg.getButton("accept").label = L.close;
  dlg.getButton("accept").hidden = !c.finished();
  document.addEventListener("dialogcancel", (e) => {
    if (c.finished()) return;
    e.preventDefault();
    c.cancel?.();
  });
  window.addEventListener("unload", () => c.onClose?.());
  c.subscribe(draw);
  draw();
});
