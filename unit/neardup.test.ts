import { describe, expect, it } from "vitest";
import { findNearDuplicates, runToEnd, DupDoc } from "../src/core/nearDup";

const d = (id: number, o: Partial<DupDoc>): DupDoc => ({
  id,
  title: "",
  abstract: "",
  author: "",
  doi: "",
  preprint: false,
  ...o,
});
const run = (docs: DupDoc[]) => runToEnd(findNearDuplicates(docs));

describe("near duplicates", () => {
  const preprint = d(1, {
    title: "Wildfire smoke exposure and respiratory health in western cities",
    abstract: "We estimate respiratory effects of smoke from wildfires.",
    author: "smith",
    year: 2022,
    doi: "10.48550/arxiv.1",
    preprint: true,
  });
  const published = d(2, {
    title:
      "Wildfire smoke exposure and respiratory health in western US cities",
    abstract: "We estimate respiratory effects of smoke from wildfires.",
    author: "smith",
    year: 2023,
    doi: "10.1000/j.2023.5",
  });
  const other = d(3, {
    title: "Timber trade flows between nations",
    abstract: "Global timber harvest footprints.",
    author: "jones",
    year: 2020,
    doi: "10.1000/x",
  });

  it("pairs a preprint with its published version", () => {
    const g = run([preprint, published, other]);
    expect(g).toHaveLength(1);
    expect(g[0].ids.sort()).toEqual([1, 2]);
    expect(g[0].reason).toBe("preprint and published version");
  });
  it("leaves out what Zotero already finds (same DOI or same title)", () => {
    const sameDoi = d(4, { ...published, id: 4 });
    const sameTitle = d(5, { ...published, id: 5, doi: "10.1/other" });
    expect(run([published, sameDoi])).toHaveLength(0);
    expect(run([published, sameTitle])).toHaveLength(0);
  });
  it("ignores similar titles by different authors years apart", () => {
    const far = d(6, {
      ...published,
      id: 6,
      author: "lee",
      year: 2005,
      doi: "10.2/z",
      title: "Wildfire smoke exposure and respiratory health in eastern cities",
    });
    expect(run([published, far])).toHaveLength(0);
  });
  it("joins a chain into one group", () => {
    const v3 = d(7, {
      ...published,
      id: 7,
      doi: "10.3/v3",
      title:
        "Wildfire smoke exposure and respiratory health in western US cities: a review",
    });
    const g = run([preprint, published, v3]);
    expect(g).toHaveLength(1);
    expect(g[0].ids.sort()).toEqual([1, 2, 7]);
  });
});
