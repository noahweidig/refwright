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

export function chat(
  system: string,
  user: string,
  signal?: AbortSignal,
  over: Partial<ChatOptions> = {},
) {
  const { p, cfg } = cfgFor(g("ai.provider"));
  if (p.needsKey && !cfg.key)
    throw new Error(`${p.label}: add an API key in RefWright settings`);
  return complete(
    zoteroHttp,
    p,
    cfg,
    system,
    user,
    { ...chatOptions(), ...over },
    signal,
  );
}

export function embedTexts(texts: string[], signal?: AbortSignal) {
  const id = g("ai.embedProvider");
  const { p, cfg } = cfgFor(id);
  const model = g(`ai.${p.id}.embedModel`) || p.embedModel || "";
  if (!model) throw new Error(`${p.label}: set an embedding model`);
  if (p.needsKey && !cfg.key)
    throw new Error(`${p.label}: add an API key in RefWright settings`);
  return embed(zoteroHttp, p, { ...cfg, model }, texts, signal);
}

/** "Test connection": loads the live model list */
export async function listModels(id: string): Promise<string[]> {
  const { p, cfg } = cfgFor(id);
  const res = await zoteroHttp({ ...buildModels(p, cfg), timeout: 20000 });
  if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return parseModels(p, res.json());
}

const RATE_LIMITED = /HTTP (413|429|5\d\d)/;

/**
 * JSON mode first, then one plain-mode retry for a bad reply. A rate limit stops at once with advice,
 * so a limit never doubles the usage.
 */
export async function chatParsed<T>(
  system: string,
  user: string,
  signal: AbortSignal,
  maxTokens: number,
  parse: (reply: string) => T,
): Promise<T> {
  let lastError = "";
  for (const jsonMode of [true, false]) {
    try {
      const opts = { jsonMode, maxTokens, lowEffort: true };
      return parse(await chat(system, user, signal, opts)); // NOSONAR: retry only after a failure
    } catch (e: any) {
      if (signal.aborted) throw e;
      lastError = String(e?.message ?? e);
      if (RATE_LIMITED.test(lastError))
        throw new Error(
          `${lastError}. Try again in a minute or use a smaller library.`,
          {
            cause: e,
          },
        );
    }
  }
  throw new Error(lastError);
}
