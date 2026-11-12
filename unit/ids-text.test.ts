import { describe, expect, it } from "vitest";
import { extractIds } from "../src/core/ids";
import { normalizeTitle, tokenize } from "../src/core/text";
import { titleMatches } from "../src/core/sources";

describe("ids", () => {
  it("extracts from fields, Extra and URL", () => {
    expect(extractIds({ doi: "https://doi.org/10.1000/ABC.1." }).doi).toBe(
      "10.1000/abc.1",
    );
  });
  it("Extra DOI needs a real registrant", () => {
    const r = extractIds({
      extra: "PMID: 123\nDOI: 10.1234/x",
      url: "https://arxiv.org/abs/2101.01234",
    });
    expect(r).toEqual({ doi: "10.1234/x", pmid: "123", arxiv: "2101.01234" });
  });
  it("pmcid from url", () => {
    expect(
      extractIds({ url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/" })
        .pmcid,
    ).toBe("PMC12345");
  });
});
describe("text", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("Café: A  Study!")).toBe("cafe a study");
  });
  it("tokenizes with stemming and stopwords", () => {
    expect(tokenize("The learning of Neural Networks")).toEqual([
      "learn",
      "neural",
      "network",
    ]);
  });
  it("CJK pairs", () => {
    expect(tokenize("机器学习")).toEqual(["机器", "器学", "学习"]);
  });
});
describe("titleMatches", () => {
  it("exact within 1 year", () => {
    expect(
      titleMatches(
        { title: "A Study", year: 2020 },
        { title: "a study.", year: 2021 },
      ),
    ).toBe(true);
    expect(
      titleMatches(
        { title: "A Study", year: 2020 },
        { title: "a study", year: 2023 },
      ),
    ).toBe(false);
  });
  it("near matches rejected", () => {
    expect(
      titleMatches(
        { title: "Deep learning for cats", year: 2020 },
        { title: "Deep learning for dogs", year: 2020 },
      ),
    ).toBe(false);
  });
  it("long prefix needs same year", () => {
    const long =
      "A very long descriptive title about the effects of things on stuff";
    expect(
      titleMatches(
        { title: long, year: 2020 },
        { title: long + ": a subtitle", year: 2020 },
      ),
    ).toBe(true);
    expect(
      titleMatches(
        { title: long, year: 2020 },
        { title: long + ": a subtitle", year: 2021 },
      ),
    ).toBe(false);
  });
});
