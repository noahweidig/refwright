import { describe, expect, it } from "vitest";
import { parsePubmedXml, openAlexTags } from "../src/core/tagSources";
import { parseWrite, plan, tokenOk } from "../src/core/writeback";

describe("tag sources", () => {
  it("pubmed xml", () => {
    const t = parsePubmedXml(
      "<DescriptorName UI='D1'>Neoplasms &amp; Co</DescriptorName><Keyword MajorTopicYN='N'>cancer</Keyword>",
    );
    expect(t.map((x) => x.tag)).toEqual(["Neoplasms & Co", "cancer"]);
  });
  it("openalex min score + subfield", async () => {
    const http = async () =>
      ({
        status: 200,
        headers: {},
        text: () => "",
        bytes: () => new Uint8Array(),
        json: () => ({
          keywords: [
            { display_name: "a", score: 0.9 },
            { display_name: "b", score: 0.1 },
          ],
          primary_topic: { subfield: { display_name: "Ecology" } },
        }),
      }) as any;
    const r = await openAlexTags("10.1/x", { http, email: "e", keys: {} });
    expect(r.map((x) => x.tag)).toEqual(["a", "Ecology"]);
  });
});
describe("writeback", () => {
  it("refuses disallowed prefixes even with a valid request", () => {
    const p = plan(
      parseWrite({
        items: [
          {
            key: "AAAA1111",
            add: ["GRADE:high", "evil"],
            remove: ["fulltext:pdf-missing", "other"],
          },
        ],
      }),
    );
    expect(p[0].add).toEqual(["GRADE:high"]);
    expect(p[0].remove).toEqual(["fulltext:pdf-missing"]);
    expect(p[0].refused.map((r) => r.tag)).toEqual(["evil", "other"]);
  });
  it("validates body", () => {
    expect(() => parseWrite({})).toThrow();
    expect(() => parseWrite({ items: [{}] })).toThrow();
  });
  it("token check", () => {
    const t = "a".repeat(48);
    expect(tokenOk("Bearer " + t, t)).toBe(true);
    expect(tokenOk("Bearer " + t.slice(1) + "b", t)).toBe(false);
    expect(tokenOk(undefined, t)).toBe(false);
    expect(tokenOk("Bearer short", "short")).toBe(false);
  });
});
import { toCsv } from "../src/core/csv";
describe("csv", () => {
  it("quotes and neutralizes formulas", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", "=SUM(A1)"],
          ['q"q', "ok"],
        ],
      ),
    ).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n"q""q",ok\r\n');
  });
});
