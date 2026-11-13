import { describe, expect, it } from "vitest";
import { mergeUserPrompt, parseMergeReply } from "../src/core/prompts";
import { buildChat, PROVIDERS, defaultChatOptions } from "../src/core/llm";

describe("compact merge prompt", () => {
  it("sends names only, one per line", () => {
    expect(mergeUserPrompt(["a b", "c"])).toBe("a b\nc");
  });
  it("parses the group-array shape and the older object shape", () => {
    expect(parseMergeReply('{"groups":[["a","b"],["c"]]}')).toEqual([
      ["a", "b"],
    ]);
    expect(
      parseMergeReply('{"groups":[{"target":"a","merge":["b","c"]}]}'),
    ).toEqual([["a", "b", "c"]]);
  });
});

describe("low effort", () => {
  const groq = PROVIDERS.find((p) => p.id === "custom")!;
  const cfg = (model: string) => ({
    key: "k",
    model,
    baseUrl: "https://api.groq.com/openai/v1",
  });
  const body = (model: string, lowEffort: boolean) =>
    JSON.parse(
      buildChat(groq, cfg(model), "s", "u", {
        ...defaultChatOptions,
        lowEffort,
      }).body!,
    );
  it("adds reasoning_effort only for gpt-oss models", () => {
    expect(body("openai/gpt-oss-20b", true).reasoning_effort).toBe("low");
    expect(body("llama-3.1-8b-instant", true).reasoning_effort).toBeUndefined();
    expect(body("openai/gpt-oss-20b", false).reasoning_effort).toBeUndefined();
  });
});
