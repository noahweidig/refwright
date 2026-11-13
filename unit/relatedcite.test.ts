import { describe, expect, it } from "vitest";
import {
  citationUrl,
  parseCounts,
  sortKey,
  usableDoi,
} from "../src/core/citations";
import { quantize, rankRelated } from "../src/core/related";

describe("citations", () => {
  it("builds batch url and parses counts", () => {
    const u = citationUrl(["https://doi.org/10.1/A", "10.2/b"], "a@b.c");
    expect(u).toContain("filter=doi:10.1%2Fa|10.2%2Fb");
    expect(u).toContain("per-page=2");
    const m = parseCounts({
      results: [{ doi: "https://doi.org/10.1/a", cited_by_count: 12 }],
    });
    expect(m.get("10.1/a")).toBe(12);
  });
  it("skips unusable dois and pads sort keys", () => {
    expect(usableDoi("10.1/a,b")).toBe(false);
    expect(usableDoi("not a doi")).toBe(false);
    expect(usableDoi("10.1/ok")).toBe(true);
    expect(sortKey(9) < sortKey(10)).toBe(true);
  });
});
describe("related", () => {
  it("ranks by similarity, excludes linked", () => {
    const r = rankRelated(
      [1, 0],
      [
        { id: 1, vec: [1, 0] },
        { id: 2, vec: [0.9, 0.1] },
        { id: 3, vec: [0, 1] },
      ],
      new Set([1]),
      2,
    );
    expect(r.map((x) => x.id)).toEqual([2, 3]);
    expect(quantize([0.12345])).toEqual([0.123]);
  });
});

describe("related offline", () => {
  it("ranks shared vocabulary and skips linked items", async () => {
    const { rankOffline } = await import("../src/core/related");
    const docs = [
      { id: 1, text: "wildfire smoke exposure and respiratory health" },
      { id: 2, text: "respiratory health effects of wildfire smoke" },
      { id: 3, text: "timber trade flows between nations" },
      { id: 4, text: "wildfire smoke respiratory outcomes in children" },
    ];
    const r = rankOffline(docs, 1, new Set([1, 4]));
    expect(r.map((x) => x.id)).toEqual([2]);
  });
});
