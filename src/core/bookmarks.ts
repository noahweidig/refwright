export const BOOKMARK_TAG = "refwright:bookmark";
/** Zotero's own annotation blue, so a bookmark reads as a Zotero note */
export const BOOKMARK_COLOR = "#2ea8e5";
/** where the marker sits when the page size is unknown: top-left margin of a US Letter page */
const FALLBACK = { w: 612, h: 792 };
const SIZE = 22;

export interface Bookmark {
  /** annotation item id */
  id: number;
  attachmentID: number;
  pageIndex: number;
  pageLabel: string;
  comment: string;
  /** ms since epoch */
  modified: number;
}

const pad = (n: number, w: number) =>
  String(Math.max(0, Math.round(n))).padStart(w, "0");

/** Zotero's annotation sort key: page, character offset, distance from the top, e.g. 00004|000000|00022 */
export const sortIndex = (pageIndex: number, top: number) =>
  `${pad(pageIndex, 5)}|${pad(0, 6)}|${pad(top, 5)}`;

export interface PageBox {
  width: number;
  height: number;
}

/** A note annotation in the left margin, near the top of the page. */
export function bookmarkPayload(o: {
  key: string;
  pageIndex: number;
  pageLabel?: string;
  comment: string;
  page?: PageBox;
  now?: Date;
}) {
  const h = o.page?.height ?? FALLBACK.h;
  const x1 = 12,
    y2 = h - 12;
  const rect = [x1, y2 - SIZE, x1 + SIZE, y2];
  return {
    key: o.key,
    type: "note" as const,
    comment: o.comment,
    text: "",
    color: BOOKMARK_COLOR,
    pageLabel: o.pageLabel || String(o.pageIndex + 1),
    sortIndex: sortIndex(o.pageIndex, h - y2),
    position: { pageIndex: o.pageIndex, rects: [rect] },
    dateModified: (o.now ?? new Date()).toISOString(),
    readOnly: false,
  };
}

export const onPage = (list: Bookmark[], pageIndex: number) =>
  list.find((b) => b.pageIndex === pageIndex);

/** In page order, oldest first on the same page. */
export const ordered = (list: Bookmark[]) =>
  [...list].sort(
    (a, b) => a.pageIndex - b.pageIndex || a.modified - b.modified,
  );

/** The next or previous bookmark from a page, wrapping around. Undefined when there are none. */
export function step(
  list: Bookmark[],
  pageIndex: number,
  dir: 1 | -1,
): Bookmark | undefined {
  const l = ordered(list);
  if (!l.length) return undefined;
  if (dir === 1) return l.find((b) => b.pageIndex > pageIndex) ?? l[0];
  return (
    [...l].reverse().find((b) => b.pageIndex < pageIndex) ?? l[l.length - 1]
  );
}

/** the one added most recently */
export const latest = (list: Bookmark[]): Bookmark | undefined =>
  [...list].sort((a, b) => b.modified - a.modified)[0];
