import {
  ChatOptions,
  complete,
  embed,
  ProviderConfig,
  ProviderInfo,
  provider,
  PROVIDERS,
  buildModels,
  parseModels,
} from "../core/llm";
import { zoteroHttp } from "./net";
import { getPref } from "../utils/prefs";

const g = (k: string) => getPref(k as any) as any;

export function cfgFor(id: string): { p: ProviderInfo; cfg: ProviderConfig } {
  const p = provider(id) ?? PROVIDERS[0];
  return {
    p,
    cfg: {
      key: g(`ai.${p.id}.key`) || "",
      model: g(`ai.${p.id}.model`) || p.model,
      baseUrl: g(`ai.${p.id}.baseUrl`) || p.baseUrl,
    },
  };
}
export const chatOptions = (): ChatOptions => ({
  temperature: Number(g("ai.temperature")) || 0.2,
  maxTokens: Number(g("ai.maxTokens")) || 0,
  timeout: Number(g("ai.timeout")) || 120,
  jsonMode: !!g("ai.jsonMode"),
});

export function aiReady(): boolean {
  const { p, cfg } = cfgFor(g("ai.provider"));
  return !!cfg.model && (!p.needsKey || !!cfg.key);
}

export function chat(system: string, user: string, signal?: AbortSignal) {
  const { p, cfg } = cfgFor(g("ai.provider"));
  if (p.needsKey && !cfg.key)
    throw new Error(`${p.label}: add an API key in refwright settings`);
  return complete(zoteroHttp, p, cfg, system, user, chatOptions(), signal);
}

export function embedTexts(texts: string[], signal?: AbortSignal) {
  const id = g("ai.embedProvider");
  const { p, cfg } = cfgFor(id);
  const model = g(`ai.${p.id}.embedModel`) || p.embedModel || "";
  if (!model) throw new Error(`${p.label}: set an embedding model`);
  if (p.needsKey && !cfg.key)
    throw new Error(`${p.label}: add an API key in refwright settings`);
  return embed(zoteroHttp, p, { ...cfg, model }, texts, signal);
}

/** "Test connection": loads the live model list */
export async function listModels(id: string): Promise<string[]> {
  const { p, cfg } = cfgFor(id);
  const res = await zoteroHttp({ ...buildModels(p, cfg), timeout: 20000 });
  if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return parseModels(p, res.json());
}
