import { describe, expect, it } from "vitest";
import { collect, findInFullText, findLinks } from "../src/core/code";
import { isReserved } from "../src/core/tags";

describe("findLinks", () => {
  it("finds and normalises hosts and repository DOIs", () => {
    const t =
      "Code at https://github.com/foo/bar.git. Data: 10.5281/zenodo.123456, osf.io/AB12c, https://zenodo.org/records/99, 10.5061/dryad.x1y2.";
    expect(findLinks(t).map((l) => l.url)).toEqual([
      "https://github.com/foo/bar",
      "https://doi.org/10.5281/zenodo.123456",
      "https://osf.io/ab12c",
      "https://doi.org/10.5281/zenodo.99",
      "https://doi.org/10.5061/dryad.x1y2",
    ]);
  });
  it("dedupes and skips site pages", () => {
    const t =
      "github.com/foo/bar and https://GitHub.com/foo/bar/ and github.com/features/copilot";
    expect(findLinks(t).map((l) => l.url)).toEqual([
      "https://github.com/foo/bar",
    ]);
  });
  it("kinds", () => {
    expect(
      findLinks("github.com/a/b zenodo.org/record/5").map((l) => l.kind),
    ).toEqual(["code", "data"]);
  });
});

describe("full text", () => {
  it("needs an availability cue and ignores the reference list", () => {
    const body =
      "x".repeat(400) +
      " Code availability: our code is at github.com/me/tool. We used github.com/other/lib too.\n" +
      "y".repeat(600);
    const t = body + "\nReferences\n[1] see github.com/ref/paper";
    expect(findInFullText(t).map((l) => l.url)).toEqual([
      "https://github.com/me/tool",
    ]);
  });
  it("abstract links need no cue and come first", () => {
    const out = collect(
      "see github.com/a/b",
      "Data are available at osf.io/zzzzz.",
    );
    expect(out.map((l) => l.url)).toEqual([
      "https://github.com/a/b",
      "https://osf.io/zzzzz",
    ]);
  });
});

describe("tags", () => {
  it("are reserved", () => {
    expect(isReserved("code:available")).toBe(true);
    expect(isReserved("data:available")).toBe(true);
  });
});
