/* global URL, process, console */
// Renders RefWright's real dialog markup and built UI scripts with sample data, light and dark.
// Usage: npm run build && node scripts/shots/shoot.mjs [name...]
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { shots } from "./data.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const css = read("addon/content/refwright.css");
const theme = read("scripts/shots/theme.css");
const out = new URL("docs/img/shots/", root);
mkdirSync(out, { recursive: true });

function bodyOf(xhtml) {
  const inner = xhtml
    .replace(/^[\s\S]*?<window[^>]*>/, "")
    .replace(/<\/window>[\s\S]*$/, "")
    .replace(/<script[^>]*\/>/g, "")
    .replace(/<(\/?)html:/g, "<$1")
    .replace(/<dialog([^>]*)>/, '<dialog$1 open style="flex-direction:column">')
    .replace(
      /<\/dialog>/,
      '<div class="dlg-buttons"><button data-b="cancel"></button><button class="accept" data-b="accept"></button></div></dialog>',
    );
  return inner.replace(/<(\w+)([^>]*)\/>/g, (m, t, a) =>
    ["input", "br", "img", "hr"].includes(t) ? m : `<${t}${a}></${t}>`,
  );
}

function page(s, dark) {
  const x = read(`addon/content/${s.xhtml}.xhtml`);
  const w = s.width ?? +x.match(/width="(\d+)"/)[1];
  const h = s.height ?? +x.match(/height="(\d+)"/)[1];
  const cls = x.match(/<window[\s\S]*?class="([^"]*)"/)?.[1] ?? "";
  return `<!doctype html><html data-theme="${dark ? "dark" : "light"}"><head><meta charset="utf-8">
<style>${theme}</style><style>${css}</style><style>${s.css ?? ""}</style></head>
<body><div class="win ${cls}" style="width:${w}px;height:${h}px">
<div class="titlebar"><span class="dots"><i></i><i></i><i></i></span><span class="t">${s.title}</span></div>
<div class="content">${bodyOf(x)}</div></div>
<script>
${s.setup}
document.querySelectorAll("dialog").forEach(d => d.getButton = (n) => {
  const b = d.querySelector('[data-b="'+n+'"]');
  return new Proxy(b, { set(t,k,v){ if(k==="label") t.textContent=v; else t[k]=v; return true; }, get(t,k){ const v=t[k]; return typeof v==="function"?v.bind(t):v; } });
});
</script>
<script>${read(`.scaffold/build/addon/content/scripts/${s.script}.js`)}</script>
</body></html>`;
}

const want = process.argv.slice(2);
const browser = await chromium.launch();
for (const s of shots.filter((s) => !want.length || want.includes(s.name))) {
  for (const dark of [false, true]) {
    const p = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 1600, height: 1200 },
    });
    p.on("pageerror", (e) => console.error(s.name, e.message));
    await p.setContent(page(s, dark), { waitUntil: "load" });
    await p.waitForTimeout(400);
    if (s.after) await p.evaluate(s.after);
    await p.waitForTimeout(300);
    await p.locator("body").screenshot({
      path: new URL(`${s.name}-${dark ? "dark" : "light"}.png`, out).pathname,
    });
    await p.close();
  }
  console.log("shot", s.name);
}
await browser.close();
