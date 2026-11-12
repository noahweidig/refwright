import { describe, expect, it } from "vitest";
import {
  cleanTags,
  defaultCleanOptions as D,
  parseReplacements,
} from "../src/core/tagCleaner";
import {
  findDuplicates,
  findFormatting,
  pickTarget,
} from "../src/core/tagDedupe";
import {
  applyLearned,
  emptyLearned,
  learnFromEdit,
} from "../src/core/learning";
import { extractKeywords } from "../src/core/keywords";
import { LibraryTagIndex } from "../src/core/tagSuggest";
import { isReserved, isWritebackAllowed } from "../src/core/tags";

describe("cleanTags", () => {
  it("merges plural/case dupes, lowercases, caps", () => {
    expect(
      cleanTags(["Machine Learning", "machine learnings", "Deep/Learning"], D),
    ).toEqual(["machine learning", "deep learning"]);
  });
  it("reuses library spelling", () => {
    expect(
      cleanTags(["MACHINE LEARNING"], { ...D, letterCase: "keep" }, [
        "Machine learning",
      ]),
    ).toEqual(["Machine learning"]);
  });
  it("drops long, blacklisted, existing", () => {
    expect(
      cleanTags(
        ["a b c d e f", "spam", "keep me"],
        { ...D, blacklist: ["spam"] },
        [],
        ["Keep me"],
      ),
    ).toEqual([]);
  });
  it("replacements, prefix, cap", () => {
    const o = {
      ...D,
      replacements: parseReplacements("ML -> machine learning"),
      prefix: "ai/",
      maxTags: 2,
    };
    expect(cleanTags(["ML", "x1", "y1"], o)).toEqual([
      "ai/machine learning",
      "ai/x1",
    ]);
  });
  it("never touches reserved status tags", () => {
    expect(cleanTags(["fulltext:pdf-found", "Foo"], D)).toEqual(["foo"]);
    expect(isReserved("Retraction:retracted")).toBe(true);
  });
  it("case modes", () => {
    expect(cleanTags(["Deep learning"], { ...D, letterCase: "snake" })).toEqual(
      ["deep_learning"],
    );
    expect(
      cleanTags(["deep learning of nets"], { ...D, letterCase: "title" }),
    ).toEqual(["Deep Learning of Nets"]);
  });
});
describe("dedupe", () => {
  const tags = [
    { name: "machine learning", count: 10 },
    { name: "Machine Learning", count: 3 },
    { name: "learning machine", count: 1 },
    { name: "ML", count: 2 },
    { name: "neuroscience", count: 4 },
    { name: "neurscience", count: 1 },
    { name: "fulltext:pdf-found", count: 50 },
    { name: "fulltext:pdf-founds", count: 1 },
  ];
  const g = findDuplicates(tags);
  it("groups", () => {
    const ml = g.find((x) => x.tags.some((t) => t.name === "ML"))!;
    expect(ml.tags.map((t) => t.name).sort()).toEqual(
      ["ML", "Machine Learning", "learning machine", "machine learning"].sort(),
    );
    expect(ml.target).toBe("machine learning");
    expect(g.find((x) => x.reason === "typo")?.target).toBe("neuroscience");
  });
  it("skips reserved", () =>
    expect(
      g.some((x) => x.tags.some((t) => t.name.startsWith("fulltext"))),
    ).toBe(false));
  it("target tie-break", () =>
    expect(
      pickTarget([
        { name: "bb", count: 2 },
        { name: "a", count: 2 },
        { name: "c", count: 2 },
      ]),
    ).toBe("a"));
  it("formatting", () =>
    expect(
      findFormatting(
        [
          { name: "Deep/Learning", count: 1 },
          { name: "ok", count: 1 },
        ],
        D,
      )[0].fixed,
    ).toBe("deep learning"));
});
describe("learning", () => {
  it("hides after 2 net removals; keeps offset", () => {
    let s = emptyLearned();
    s = learnFromEdit(s, ["a1", "b1"], ["b1"]);
    expect(applyLearned(s, ["a1"])).toEqual(["a1"]);
    s = learnFromEdit(s, ["a1", "b1"], ["b1"]);
    expect(applyLearned(s, ["a1", "b1"])).toEqual(["b1"]);
    s = learnFromEdit(s, ["a1"], ["a1"]);
    expect(applyLearned(s, ["a1"])).toEqual(["a1"]);
  });
  it("swap applied after twice", () => {
    let s = emptyLearned();
    s = learnFromEdit(s, ["ML"], ["machine learning"]);
    expect(applyLearned(s, ["ML"])).toEqual(["ML"]);
    s = learnFromEdit(s, ["ML"], ["machine learning"]);
    expect(applyLearned(s, ["ML"])).toEqual(["machine learning"]);
  });
});
describe("keywords + library", () => {
  it("extracts repeated phrases", () => {
    const k = extractKeywords(
      "Soil carbon sequestration in forests",
      "We measure soil carbon sequestration. Soil carbon sequestration rises with age.",
    );
    expect(k).toContain("soil carbon sequestration");
  });
  it("library index needs enough tagged items", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      title: i % 2 ? "neural network training" : "forest ecology trees",
      abstract: "",
      tags: [i % 2 ? "ai" : "eco"],
    }));
    const idx = new LibraryTagIndex(items);
    expect(
      idx.suggest({ id: 99, title: "neural network", tags: [] })[0].tag,
    ).toBe("ai");
    expect(
      new LibraryTagIndex(items.slice(0, 5)).suggest({
        id: 99,
        title: "neural network",
        tags: [],
      }),
    ).toEqual([]);
  });
  it("writeback allowlist", () => {
    expect(isWritebackAllowed("GRADE:high")).toBe(true);
    expect(isWritebackAllowed("random")).toBe(false);
  });
});
