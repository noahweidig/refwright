import { getPref, setPref } from "../utils/prefs";
import { cfgFor, listModels } from "../zotero/ai";
import { generateToken } from "../zotero/writeback";
import { clearEmbeddings } from "../zotero/routing";
import { S, saveState } from "../zotero/state";
import { getString } from "../utils/locale";
import { zoteroHttp } from "../zotero/net";

export async function registerPrefsScripts(win: Window) {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
    win.document.getElementById(id) as T | null;
  const g = (k: string) => getPref(k as any) as any;
  const s = (k: string, v: any) => setPref(k as any, v);

  const bindProvider = () => {
    const id = String(g("ai.provider"));
    const { p, cfg } = cfgFor(id);
    const model = $("carrel-ai-model"),
      key = $("carrel-ai-key"),
      base = $("carrel-ai-base");
    if (!model || !key || !base) return;
    model.value = cfg.model;
    key.value = cfg.key;
    base.value = cfg.baseUrl;
    model.placeholder = p.model;
    model.oninput = () => s(`ai.${id}.model`, model.value);
    key.oninput = () => s(`ai.${id}.key`, key.value);
    base.oninput = () => s(`ai.${id}.baseUrl`, base.value);
    const res = $<HTMLElement>("carrel-ai-result");
    if (res) res.setAttribute("value", "");
  };
  const bindEmbed = () => {
    const id = String(g("ai.embedProvider"));
    const e = $("carrel-ai-embed");
    if (!e) return;
    e.value = g(`ai.${id}.embedModel`) || "";
    e.oninput = () => s(`ai.${id}.embedModel`, e.value);
  };
  bindProvider();
  bindEmbed();
  // menulists write the pref after their own change event
  win.document.querySelectorAll("menulist").forEach((m: Element) =>
    m.addEventListener("command", () =>
      win.setTimeout(() => {
        bindProvider();
        bindEmbed();
      }, 50),
    ),
  );

  $("carrel-ai-test")?.addEventListener("click", async () => {
    const out = $<HTMLElement>("carrel-ai-result")!;
    out.setAttribute("value", "…");
    try {
      const models = await listModels(String(g("ai.provider")));
      out.setAttribute(
        "value",
        getString("ai-ok", { args: { count: models.length } }),
      );
    } catch (e: any) {
      out.setAttribute(
        "value",
        getString("ai-fail", { args: { message: String(e?.message ?? e) } }),
      );
    }
  });
  $("carrel-forget-misses")?.addEventListener("click", () => {
    S().misses = {};
    saveState();
  });
  $("carrel-clear-embed")?.addEventListener("click", () => clearEmbeddings());

  const token = $("carrel-wb-token");
  if (token) token.value = String(g("writeBackToken") || "");
  $("carrel-wb-gen")?.addEventListener("click", () => {
    if (token) token.value = generateToken();
  });
  $("carrel-wb-copy")?.addEventListener("click", () => {
    new ztoolkit.Clipboard()
      .addText(String(g("writeBackToken") || ""), "text/unicode")
      .copy();
  });
  $("carrel-wb-test")?.addEventListener("click", async () => {
    const out = $<HTMLElement>("carrel-wb-result")!;
    try {
      const port = Zotero.Prefs.get("httpServer.port") || 23119;
      const r = await zoteroHttp({
        url: `http://127.0.0.1:${port}/carrel/ping`,
        headers: { Authorization: `Bearer ${g("writeBackToken")}` },
        timeout: 5000,
      });
      out.setAttribute("value", r.status === 200 ? "OK" : `HTTP ${r.status}`);
    } catch (e: any) {
      out.setAttribute("value", String(e?.message ?? e));
    }
  });
}
