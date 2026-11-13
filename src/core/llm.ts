import { Http, HttpReq, HttpError } from "./http";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "cohere"
  | "custom"
  | "ollama";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: "openai" | "anthropic" | "gemini" | "cohere";
  baseUrl: string;
  model: string;
  embedModel?: string;
  needsKey: boolean;
  chat: boolean;
  embed: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    embedModel: "text-embedding-3-small",
    needsKey: true,
    chat: true,
    embed: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-5-5",
    needsKey: true,
    chat: true,
    embed: false,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.6-flash",
    embedModel: "gemini-embedding-001",
    needsKey: true,
    chat: true,
    embed: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    needsKey: true,
    chat: true,
    embed: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    needsKey: true,
    chat: true,
    embed: false,
  },
  {
    id: "cohere",
    label: "Cohere",
    kind: "cohere",
    baseUrl: "https://api.cohere.com/v2",
    model: "command-r7b-12-2024",
    embedModel: "embed-v4.0",
    needsKey: true,
    chat: true,
    embed: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    model: "",
    embedModel: "",
    needsKey: false,
    chat: true,
    embed: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    embedModel: "nomic-embed-text",
    needsKey: false,
    chat: true,
    embed: true,
  },
];
export const provider = (id: string) => PROVIDERS.find((p) => p.id === id);

export interface ProviderConfig {
  key: string;
  model: string;
  baseUrl: string;
}
export interface ChatOptions {
  temperature: number;
  maxTokens: number; // 0 = provider default
  timeout: number; // seconds
  jsonMode: boolean;
}
export const defaultChatOptions: ChatOptions = {
  temperature: 0.2,
  maxTokens: 0,
  timeout: 120,
  jsonMode: false,
};

const trim = (u: string) => u.replace(/\/+$/, "");
const bearer = (k: string): Record<string, string> =>
  k ? { Authorization: `Bearer ${k}` } : {};
const JSON_H = { "Content-Type": "application/json" };

export function buildChat(
  p: ProviderInfo,
  c: ProviderConfig,
  system: string,
  user: string,
  o: ChatOptions,
): HttpReq {
  const base = trim(c.baseUrl || p.baseUrl);
  const model = c.model || p.model;
  const timeout = o.timeout * 1000;
  switch (p.kind) {
    case "anthropic":
      return {
        url: `${base}/messages`,
        method: "POST",
        timeout,
        headers: {
          ...JSON_H,
          "x-api-key": c.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          system,
          max_tokens: o.maxTokens || 2048,
          temperature: o.temperature,
          messages: [{ role: "user", content: user }],
        }),
      };
    case "gemini":
      return {
        url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
        method: "POST",
        timeout,
        headers: { ...JSON_H, "x-goog-api-key": c.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: o.temperature,
            ...(o.maxTokens ? { maxOutputTokens: o.maxTokens } : {}),
            ...(o.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
      };
    case "cohere":
      return {
        url: `${base}/chat`,
        method: "POST",
        timeout,
        headers: { ...JSON_H, ...bearer(c.key) },
        body: JSON.stringify({
          model,
          temperature: o.temperature,
          ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
          ...(o.jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      };
    default:
      return {
        url: `${base}/chat/completions`,
        method: "POST",
        timeout,
        headers: { ...JSON_H, ...bearer(c.key) },
        body: JSON.stringify({
          model,
          temperature: o.temperature,
          ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
          ...(o.jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      };
  }
}

export function parseChat(p: ProviderInfo, j: any): string {
  switch (p.kind) {
    case "anthropic":
      return (j.content ?? []).map((b: any) => b.text ?? "").join("");
    case "gemini":
      return (j.candidates?.[0]?.content?.parts ?? [])
        .map((x: any) => x.text ?? "")
        .join("");
    case "cohere":
      return (j.message?.content ?? []).map((b: any) => b.text ?? "").join("");
    default:
      return j.choices?.[0]?.message?.content ?? "";
  }
}

export function buildEmbed(
  p: ProviderInfo,
  c: ProviderConfig,
  inputs: string[],
  timeout = 60,
): HttpReq {
  const base = trim(c.baseUrl || p.baseUrl);
  const model = c.model || p.embedModel || "";
  switch (p.kind) {
    case "gemini":
      return {
        url: `${base}/models/${encodeURIComponent(model)}:batchEmbedContents`,
        method: "POST",
        timeout: timeout * 1000,
        headers: { ...JSON_H, "x-goog-api-key": c.key },
        body: JSON.stringify({
          requests: inputs.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
          })),
        }),
      };
    case "cohere":
      return {
        url: `${base}/embed`,
        method: "POST",
        timeout: timeout * 1000,
        headers: { ...JSON_H, ...bearer(c.key) },
        body: JSON.stringify({
          model,
          texts: inputs,
          input_type: "classification",
          embedding_types: ["float"],
        }),
      };
    default:
      return {
        url: `${base}/embeddings`,
        method: "POST",
        timeout: timeout * 1000,
        headers: { ...JSON_H, ...bearer(c.key) },
        body: JSON.stringify({ model, input: inputs }),
      };
  }
}
export function parseEmbed(p: ProviderInfo, j: any): number[][] {
  switch (p.kind) {
    case "gemini":
      return (j.embeddings ?? []).map((e: any) => e.values);
    case "cohere":
      return j.embeddings?.float ?? [];
    default:
      return (j.data ?? [])
        .sort((a: any, b: any) => a.index - b.index)
        .map((d: any) => d.embedding);
  }
}

export function buildModels(p: ProviderInfo, c: ProviderConfig): HttpReq {
  const base = trim(c.baseUrl || p.baseUrl);
  switch (p.kind) {
    case "anthropic":
      return {
        url: `${base}/models?limit=100`,
        headers: { "x-api-key": c.key, "anthropic-version": "2023-06-01" },
      };
    case "gemini":
      return {
        url: `${base}/models?pageSize=200`,
        headers: { "x-goog-api-key": c.key },
      };
    case "cohere":
      return {
        url: `${base.replace(/\/v2$/, "")}/v1/models?page_size=200`,
        headers: bearer(c.key),
      };
    default:
      return { url: `${base}/models`, headers: bearer(c.key) };
  }
}
export function parseModels(p: ProviderInfo, j: any): string[] {
  const list: any[] = j.data ?? j.models ?? [];
  return list
    .map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}

export async function complete(
  http: Http,
  p: ProviderInfo,
  c: ProviderConfig,
  system: string,
  user: string,
  o: ChatOptions,
  signal?: AbortSignal,
): Promise<string> {
  const res = await http({ ...buildChat(p, c, system, user, o), signal });
  if (res.status >= 300) throw new Error(describe(res, p));
  return parseChat(p, res.json());
}

export async function embed(
  http: Http,
  p: ProviderInfo,
  c: ProviderConfig,
  inputs: string[],
  signal?: AbortSignal,
  batch = 64,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batch) {
    const res = await http({
      ...buildEmbed(p, c, inputs.slice(i, i + batch)),
      signal,
    });
    if (res.status >= 300) throw new Error(describe(res, p));
    out.push(...parseEmbed(p, res.json()));
  }
  return out;
}

function describe(res: { status: number; text(): string }, p: ProviderInfo) {
  let msg = "";
  try {
    const j = JSON.parse(res.text());
    msg = j.error?.message ?? j.message ?? "";
  } catch {
    /* body is not JSON */
  }
  return `${p.label}: HTTP ${res.status}${msg ? ` ${msg}` : ""}`;
}
export { HttpError };

/** Pull the first JSON value out of model output (handles fences and chatter). */
export function extractJson(text: string): any {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  for (const [o, c] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const a = t.indexOf(o),
      b = t.lastIndexOf(c);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* try next shape */
      }
    }
  }
  const open = t.indexOf("{");
  if (open >= 0) {
    // truncated output: close an unterminated array/object by trimming to the last complete group
    const cut = t.lastIndexOf("}");
    for (let e = cut; e > open; e = t.lastIndexOf("}", e - 1)) {
      for (const tail of ["]}", "}", "]"]) {
        try {
          return JSON.parse(t.slice(open, e + 1) + tail);
        } catch {
          /* keep trimming */
        }
      }
    }
  }
  throw new Error("Model did not return valid JSON");
}
