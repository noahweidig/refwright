import { describe, expect, it } from "vitest";
import {
  Bookmark,
  bookmarkPayload,
  latest,
  onPage,
  ordered,
  sortIndex,
  step,
} from "../src/core/bookmarks";

const b = (pageIndex: number, modified = 0, id = pageIndex): Bookmark => ({
  id,
  attachmentID: 1,
  pageIndex,
  pageLabel: String(pageIndex + 1),
  comment: "",
  modified,
});

describe("bookmark annotation", () => {
  it("sort index follows Zotero's page|offset|top format", () => {
    expect(sortIndex(4, 22)).toBe("00004|000000|00022");
    expect(sortIndex(0, 0)).toBe("00000|000000|00000");
  });
  it("builds a blue note annotation in the margin", () => {
    const p = bookmarkPayload({
      key: "ABCD1234",
      pageIndex: 6,
      comment: "Bookmark",
      page: { width: 595, height: 842 },
      now: new Date("2026-01-02T03:04:05Z"),
    });
    expect(p).toMatchObject({
      type: "note",
      color: "#2ea8e5",
      pageLabel: "7",
      sortIndex: "00006|000000|00012",
      dateModified: "2026-01-02T03:04:05.000Z",
    });
    const [x1, y1, x2, y2] = p.position.rects[0];
    expect(p.position.pageIndex).toBe(6);
    expect(x2 - x1).toBe(22);
    expect(y2 - y1).toBe(22);
    expect(y2).toBeLessThanOrEqual(842);
    expect(y1).toBeGreaterThan(0);
  });
  it("keeps the PDF's own page label", () => {
    expect(
      bookmarkPayload({ key: "K", pageIndex: 2, pageLabel: "iii", comment: "" })
        .pageLabel,
    ).toBe("iii");
  });
});

describe("moving between bookmarks", () => {
  const list = [b(9), b(2), b(5)];
  it("orders by page", () => {
    expect(ordered(list).map((x) => x.pageIndex)).toEqual([2, 5, 9]);
  });
  it("next and previous, wrapping", () => {
    expect(step(list, 2, 1)?.pageIndex).toBe(5);
    expect(step(list, 9, 1)?.pageIndex).toBe(2);
    expect(step(list, 5, -1)?.pageIndex).toBe(2);
    expect(step(list, 2, -1)?.pageIndex).toBe(9);
    expect(step(list, 3, 1)?.pageIndex).toBe(5);
    expect(step([], 0, 1)).toBeUndefined();
  });
  it("finds the bookmark on a page and the latest one", () => {
    expect(onPage(list, 5)?.pageIndex).toBe(5);
    expect(onPage(list, 6)).toBeUndefined();
    expect(latest([b(1, 10), b(2, 30), b(3, 20)])?.pageIndex).toBe(2);
  });
});
