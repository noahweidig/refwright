import { describe, expect, it } from "vitest";
import {
  RouterIndex,
  RItem,
  RColl,
  defaultRouteOptions,
  parseLlmRanking,
} from "../src/core/router";

const colls: RColl[] = [
  { id: 1, name: "Machine learning" },
  { id: 2, name: "Ecology" },
  { id: 3, name: "Inbox" },
  { id: 4, name: "Deep nets", parent: 1 },
];
const mk = (id: number, title: string, abs: string, c: number[]): RItem => ({
  id,
  title,
  abstract: abs,
  collections: c,
});
const items: RItem[] = [
  mk(
    1,
    "Neural network training",
    "gradient descent optimisation of deep neural networks",
    [1],
  ),
  mk(
    2,
    "Convolutional networks for images",
    "deep neural network image classification",
    [1],
  ),
  mk(
    3,
    "Gradient boosting machines",
    "learning with boosted decision trees",
    [1],
  ),
  mk(
    4,
    "Forest ecology",
    "tree species diversity in tropical forest ecosystems",
    [2],
  ),
  mk(
    5,
    "Predator prey dynamics",
    "ecosystem population dynamics of predators",
    [2],
  ),
  mk(6, "Pollinator decline", "bee populations and ecosystem services", [2]),
  mk(7, "Unfiled neural paper", "deep neural network gradient training", [3]),
];
describe("router", () => {
  const idx = new RouterIndex(colls, items, { ...defaultRouteOptions });
  it("ranks the right collection first", () => {
    const r = idx.rank(
      mk(
        100,
        "Training deep neural networks",
        "gradient methods for neural network learning",
        [],
      ),
    );
    expect(r[0].collectionId).toBe(1);
    expect(r.find((x) => x.collectionId === 2)).toBeUndefined();
  });
  it("never suggests ignored collections", () => {
    const r = idx.rank(mk(100, "Neural", "neural network", []));
    expect(r.some((x) => x.collectionId === 3)).toBe(false);
  });
  it("papers filed only in ignored collections are not evidence", () => {
    const r = idx.rank(
      mk(
        101,
        "Unfiled neural paper",
        "deep neural network gradient training",
        [],
      ),
    );
    expect(r[0].why.papers).not.toContain("Unfiled neural paper");
  });
  it("marks already-filed and excludes self from evidence", () => {
    const r = idx.rank(items[3]);
    expect(r[0].collectionId).toBe(2);
    expect(r[0].already).toBe(true);
  });
  it("rejections down-rank", () => {
    const i2 = new RouterIndex(colls, items, {
      ...defaultRouteOptions,
      rejected: { 1: 3 },
    });
    const p = mk(100, "Neural network gradient", "neural network training", []);
    expect(i2.rank(p)[0]?.score ?? 0).toBeLessThan(idx.rank(p)[0].score);
  });
  it("picks respects cap", () => {
    const r = idx.rank(
      mk(100, "Training deep neural networks", "gradient neural", []),
    );
    expect(idx.picks(r).length).toBeLessThanOrEqual(4);
  });
});
describe("parseLlmRanking", () => {
  const names = new Map([
    ["ecology", 2],
    ["machine learning", 1],
  ]);
  it("json", () => {
    expect(
      parseLlmRanking('[{"collection":"Ecology","confidence":"High"}]', names),
    ).toEqual([{ collectionId: 2, confidence: "high" }]);
  });
  it("lines", () => {
    expect(
      parseLlmRanking("1. Machine learning | medium\n2. Nope | high", names),
    ).toEqual([{ collectionId: 1, confidence: "medium" }]);
  });
});
