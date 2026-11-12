const HTML = "http://www.w3.org/1999/xhtml";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, any>;

/** tiny XHTML element builder for dialog windows */
export function h(
  tag: string,
  attrs: Attrs = {},
  ...kids: Child[]
): HTMLElement {
  const el = document.createElementNS(HTML, tag) as HTMLElement;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && k !== "list" && typeof v !== "string")
      (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k) el.append(k as any);
  return el;
}
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const arg = <T>(): T => {
  const a = (window as any).arguments?.[0];
  return (a?.wrappedJSObject ?? a) as T;
};
export function icon(path: string): HTMLElement {
  return h("span", {
    class: "carrel-icon",
    style: { backgroundImage: `url(${path})` },
  });
}
