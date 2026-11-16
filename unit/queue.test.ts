import { describe, expect, it } from "vitest";
import {
  afterOpening,
  estimateMinutes,
  fmtMinutes,
  minutesSortKey,
  nextUp,
  rankForProject,
  READ_TAGS,
  statusFromSortKey,
  statusOf,
  statusSortKey,
} from "../src/core/queue";
import { isReserved } from "../src/core/tags";

describe("reading status", () => {
  it("reads the tag, strongest state wins", () => {
    expect(statusOf([])).toBe("");
    expect(statusOf([READ_TAGS.unread])).toBe("unread");
    expect(statusOf([READ_TAGS.unread, READ_TAGS.reading])).toBe("reading");
    expect(statusOf([READ_TAGS.reading, READ_TAGS.done])).toBe("done");
  });
  it("tags are reserved so tagging never touches them", () => {
    for (const t of Object.values(READ_TAGS)) expect(isReserved(t)).toBe(true);
  });
  it("sorts reading, unread, done, untracked", () => {
    const keys = (["", "done", "unread", "reading"] as const).map(
      statusSortKey,
    );
    expect([...keys].sort().map(statusFromSortKey)).toEqual([
      "reading",
      "unread",
      "done",
      "",
    ]);
  });
});

describe("read time", () => {
  it("uses text length, else pages, else nothing", () => {
    expect(estimateMinutes({ chars: 90000, wpm: 150 })).toBe(100);
    expect(estimateMinutes({ pages: 10, wpm: 150 })).toBe(33);
    expect(estimateMinutes({ wpm: 150 })).toBeUndefined();
    expect(estimateMinutes({ chars: 10, wpm: 150 })).toBe(1);
  });
  it("formats and sorts numerically", () => {
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(60)).toBe("1 h");
    expect(fmtMinutes(95)).toBe("1 h 35 min");
    expect(minutesSortKey(9) < minutesSortKey(10)).toBe(true);
  });
});

describe("next up", () => {
  const docs = [
    { id: 1, text: "soil carbon sequestration in forest ecosystems" },
    { id: 2, text: "forest soil carbon storage under warming" },
    { id: 3, text: "deep learning for protein structure" },
    { id: 4, text: "carbon cycling in forest soils" },
  ];
  it("ranks candidates by similarity to the project papers", () => {
    const r = rankForProject(docs, new Set([1]), new Set([2, 3, 4]));
    expect(r[0].id).toBeGreaterThan(0);
    expect(r.at(-1)!.id).toBe(3);
    expect(r.find((x) => x.id === 3)!.score).toBe(0);
  });
  it("returns nothing without a profile and never ranks the profile itself", () => {
    expect(rankForProject(docs, new Set(), new Set([2]))).toEqual([]);
    expect(
      rankForProject(docs, new Set([1]), new Set([1, 2])).map((x) => x.id),
    ).toEqual([2]);
  });
  it("breaks ties with the shorter read", () => {
    const r = nextUp(
      [
        { id: 1, score: 50 },
        { id: 2, score: 50 },
      ],
      (id) => (id === 1 ? 60 : 20),
    );
    expect(r.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe("opening a PDF", () => {
  it("starts Unread items only", () => {
    expect(afterOpening("unread")).toBe("reading");
    expect(afterOpening("reading")).toBeUndefined();
    expect(afterOpening("done")).toBeUndefined();
    expect(afterOpening("")).toBeUndefined();
  });
});
