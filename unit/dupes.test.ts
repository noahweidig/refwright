import { describe, expect, it } from "vitest";
import {
  DupCand,
  exportNonDups,
  importNonDups,
  pairKey,
  pickMaster,
  smartFill,
  splitByNonDups,
} from "../src/core/dupes";

const c = (id: number, o: Partial<DupCand>): DupCand => ({
  id,
  key: `K${id}`,
  added: "2024-01-01 00:00:00",
  modified: "2024-01-01 00:00:00",
  filled: 0,
  attachments: 0,
  notes: 0,
  ...o,
});

describe("dupes", () => {
  const items = [
    c(1, { added: "2023-01-01", modified: "2025-01-01" }),
    c(2, { added: "2024-06-01", attachments: 2 }),
    c(3, { added: "2022-01-01", filled: 3 }),
  ];
  it("picks master by policy", () => {
    expect(pickMaster(items, "oldest")).toBe(3);
    expect(pickMaster(items, "newest")).toBe(2);
    expect(pickMaster(items, "modified")).toBe(1);
    expect(pickMaster(items, "complete")).toBe(2);
  });
  it("fills only empty, allowed fields", () => {
    expect(
      smartFill(
        { title: "T", DOI: "" },
        [
          { title: "X", DOI: "10.1/a", ISSN: "1" },
          { DOI: "10.1/b", pages: "3" },
        ],
        (f) => f !== "ISSN",
      ),
    ).toEqual({ DOI: "10.1/a", pages: "3" });
  });
  it("pair key is order-free and round-trips", () => {
    const k = pairKey(1, "B", "A");
    expect(k).toBe(pairKey(1, "A", "B"));
    expect(importNonDups(exportNonDups([k]))).toEqual([k]);
    expect(
      importNonDups({ pairs: [{ libraryID: 1, a: "A", b: "A" }] }),
    ).toEqual([]);
    expect(() => importNonDups({})).toThrow();
  });
  it("splits sets by non-duplicate marks", () => {
    const nd = new Set(["A|B"]);
    const is = (a: string, b: string) =>
      nd.has(a < b ? `${a}|${b}` : `${b}|${a}`);
    expect(splitByNonDups(["A", "B", "C"], is)).toEqual([["A", "C"]]);
    expect(splitByNonDups(["A", "B"], is)).toEqual([]);
  });
});
