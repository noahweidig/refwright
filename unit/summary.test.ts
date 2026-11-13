import { describe, expect, it } from "vitest";
import {
  cleanSummary,
  isSummaryNote,
  summaryNoteHtml,
} from "../src/core/prompts";

describe("summary", () => {
  it("cleans model output", () => {
    expect(cleanSummary("```\nSummary: **Soil** carbon\nrose.\n```")).toBe(
      "Soil carbon rose.",
    );
  });
  it("escapes and detects note", () => {
    const h = summaryNoteHtml("a < b & c", "src");
    expect(h).toContain("a &lt; b &amp; c");
    expect(isSummaryNote(h)).toBe(true);
    expect(isSummaryNote("<p>x</p>")).toBe(false);
  });
  it("titles new notes AI summary and still finds the old title", () => {
    expect(summaryNoteHtml("s", "src")).toContain("<h1>AI summary</h1>");
    expect(isSummaryNote("<h1>refwright summary</h1><p>old</p>")).toBe(true);
  });
});
