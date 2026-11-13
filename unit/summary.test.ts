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
});
