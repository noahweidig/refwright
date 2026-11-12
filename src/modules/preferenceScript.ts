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
    const model = $("refwright-ai-model"),
      key = $("refwright-ai-key"),
      base = $("refwright-ai-base");
    if (!model || !key || !base) return;
    model.value = cfg.model;
    key.value = cfg.key;
    base.value = cfg.baseUrl;
    model.placeholder = p.model;
    model.oninput = () => s(`ai.${id}.model`, model.value);
    key.oninput = () => s(`ai.${id}.key`, key.value);
    base.oninput = () => s(`ai.${id}.baseUrl`, base.value);
    const res = $<HTMLElement>("refwright-ai-result");
    if (res) res.setAttribute("value", "");
  };
  const bindEmbed = () => {
    const id = String(g("ai.embedProvider"));
    const e = $("refwright-ai-embed");
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

  $("refwright-ai-test")?.addEventListener("click", async () => {
    const out = $<HTMLElement>("refwright-ai-result")!;
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
  $("refwright-forget-misses")?.addEventListener("click", () => {
    S().misses = {};
    saveState();
  });
  $("refwright-clear-embed")?.addEventListener("click", () =>
    clearEmbeddings(),
  );

  const token = $("refwright-wb-token");
  if (token) token.value = String(g("writeBackToken") || "");
  $("refwright-wb-gen")?.addEventListener("click", () => {
    if (token) token.value = generateToken();
  });
  $("refwright-wb-copy")?.addEventListener("click", () => {
    new ztoolkit.Clipboard()
      .addText(String(g("writeBackToken") || ""), "text/unicode")
      .copy();
  });
  $("refwright-wb-test")?.addEventListener("click", async () => {
    const out = $<HTMLElement>("refwright-wb-result")!;
    try {
      const port = Zotero.Prefs.get("httpServer.port") || 23119;
      const r = await zoteroHttp({
        url: `http://127.0.0.1:${port}/refwright/ping`,
        headers: { Authorization: `Bearer ${g("writeBackToken")}` },
        timeout: 5000,
      });
      out.setAttribute("value", r.status === 200 ? "OK" : `HTTP ${r.status}`);
    } catch (e: any) {
      out.setAttribute("value", String(e?.message ?? e));
    }
  });
}
