import { describe, expect, it } from "vitest";
import {
  authorVariants,
  compatibleGiven,
  HDoc,
  mistyped,
  missingAbstract,
  missingDoi,
} from "../src/core/health";

const d = (o: Partial<HDoc>): HDoc => ({
  id: 1,
  type: "journalArticle",
  title: "A paper",
  abstract: "",
  doi: "",
  doiField: true,
  url: "",
  journal: "",
  extra: "",
  creators: [],
  ...o,
});
const cr = (first: string, last: string) => ({ first, last, single: false });

describe("missing fields", () => {
  it("flags articles without a DOI, not books", () => {
    expect(missingDoi(d({}))).toBe(true);
    expect(missingDoi(d({ doi: "10.1000/x" }))).toBe(false);
    expect(missingDoi(d({ extra: "DOI: 10.1000/x" }))).toBe(false);
    expect(missingDoi(d({ url: "https://doi.org/10.1000/x" }))).toBe(false);
    expect(missingDoi(d({ type: "book", doiField: false }))).toBe(false);
  });
  it("flags empty abstracts on scholarly types only", () => {
    expect(missingAbstract(d({}))).toBe(true);
    expect(missingAbstract(d({ abstract: "  " }))).toBe(true);
    expect(missingAbstract(d({ abstract: "x" }))).toBe(false);
    expect(missingAbstract(d({ type: "webpage" }))).toBe(false);
  });
});

describe("mistyped", () => {
  it("arXiv DOI on a document or journal article without a journal", () => {
    expect(
      mistyped(d({ type: "document", doi: "10.48550/arxiv.2101.1" })),
    ).toEqual(expect.objectContaining({ to: "preprint" }));
    expect(mistyped(d({ url: "https://arxiv.org/abs/2101.01234" }))?.to).toBe(
      "preprint",
    );
  });
  it("leaves a journal article that has a journal", () => {
    expect(
      mistyped(d({ doi: "10.48550/arxiv.2101.1", journal: "Nature" })),
    ).toBeUndefined();
  });
  it("preprint item with a publisher DOI is a journal article", () => {
    expect(mistyped(d({ type: "preprint", doi: "10.1000/j.1" }))?.to).toBe(
      "journalArticle",
    );
    expect(
      mistyped(d({ type: "preprint", doi: "10.1101/2020.01.01.1" })),
    ).toBeUndefined();
  });
  it("webpage with a publisher DOI", () => {
    expect(mistyped(d({ type: "webpage", doi: "10.1000/j.1" }))?.to).toBe(
      "journalArticle",
    );
  });
});

describe("author variants", () => {
  const docs = (...names: [string, string][]) =>
    names.map(([f, l], i) => d({ id: i + 1, creators: [cr(f, l)] }));
  it("given-name compatibility", () => {
    expect(compatibleGiven("J.", "John")).toBe(true);
    expect(compatibleGiven("John A.", "John")).toBe(true);
    expect(compatibleGiven("John", "Jane")).toBe(false);
    expect(compatibleGiven("John A", "John B")).toBe(false);
    expect(compatibleGiven("Jean-Paul", "J P")).toBe(true);
  });
  it("groups initials, full name, case and accents under the fullest form", () => {
    const g = authorVariants(
      docs(
        ["John", "Smith"],
        ["J.", "Smith"],
        ["J", "SMITH"],
        ["José", "García"],
        ["Jose", "Garcia"],
      ),
    );
    expect(g).toHaveLength(2);
    const smith = g.find((x) => x.canonical.last === "Smith")!;
    expect(smith.canonical.first).toBe("John");
    expect(smith.variants.map((v) => v.first).sort()).toEqual(["J", "J."]);
    const garcia = g.find((x) => x.canonical.last === "García")!;
    expect(garcia.canonical.first).toBe("José");
  });
  it("keeps different people apart", () => {
    expect(
      authorVariants(docs(["John", "Smith"], ["Jane", "Smith"])),
    ).toHaveLength(0);
    expect(
      authorVariants(docs(["John A.", "Smith"], ["John B.", "Smith"])),
    ).toHaveLength(0);
  });
  it("ignores institutions and empty first names", () => {
    const x = d({
      creators: [{ first: "", last: "WHO", single: true }, cr("", "Plato")],
    });
    expect(authorVariants([x, x])).toHaveLength(0);
  });
  it("collects item ids", () => {
    const [g] = authorVariants(
      docs(["John", "Smith"], ["J.", "Smith"], ["J.", "Smith"]),
    );
    expect(g.variants[0].itemIDs).toEqual([2, 3]);
    expect(g.variants[0].count).toBe(2);
  });
});
