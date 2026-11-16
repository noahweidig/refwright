import { describe, expect, it } from "vitest";
import {
  abstractFromInverted,
  abstractFromJats,
  plausible,
  recordFromCrossref,
} from "../src/core/metadata";
import {
  findPublished,
  isPreprintItem,
  planUpgrade,
  preprintDoi,
  relatedPublishedDoi,
} from "../src/core/preprint";
import type { Http } from "../src/core/http";
import type { Ctx } from "../src/core/sources";

const work = {
  DOI: "10.1234/JOURNAL.2023.5",
  title: ["Wildfire smoke and respiratory health"],
  "container-title": ["Environmental Health"],
  volume: "12",
  issue: "3",
  page: "100-110",
  issued: { "date-parts": [[2023, 5]] },
  ISSN: ["1234-5678"],
  type: "journal-article",
  abstract: "<jats:p>Smoke harms lungs.</jats:p>",
  author: [
    { given: "Ann", family: "Lee" },
    { given: "Bo", family: "Chen" },
  ],
};

const reply = (body: unknown, status = 200) => ({
  status,
  headers: {},
  text: () => JSON.stringify(body),
  json: () => body as any,
  bytes: () => new Uint8Array(),
});
function ctxFor(routes: Record<string, unknown>): Ctx {
  const http: Http = async ({ url }) => {
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? reply(routes[hit]) : reply(null, 404);
  };
  return { http, email: "t@example.com", keys: {} };
}

describe("record parsing", () => {
  it("maps Crossref fields", () => {
    const r = recordFromCrossref(work);
    expect(r).toMatchObject({
      doi: "10.1234/journal.2023.5",
      journal: "Environmental Health",
      date: "2023-05",
      year: 2023,
      pages: "100-110",
      abstract: "Smoke harms lungs.",
    });
    expect(r.authors[0]).toEqual({ first: "Ann", last: "Lee", single: false });
  });
  it("cleans JATS and rebuilds inverted abstracts", () => {
    expect(
      abstractFromJats(
        "<jats:title>Abstract</jats:title><jats:p>A &amp; B.</jats:p>",
      ),
    ).toBe("A & B.");
    expect(abstractFromInverted({ Smoke: [0], harms: [1], lungs: [2] })).toBe(
      "Smoke harms lungs",
    );
    expect(abstractFromInverted(undefined)).toBe("");
  });
});

describe("plausible", () => {
  const rec = recordFromCrossref(work);
  it("exact title wins; near title needs the author", () => {
    expect(plausible({ title: rec.title, year: 2022 }, rec)).toBe(true);
    const near = {
      title: "Wildfire smoke and respiratory health outcomes",
      author: "Lee",
      year: 2022,
    };
    expect(plausible(near, rec)).toBe(true);
    expect(plausible({ ...near, author: "Park" }, rec)).toBe(false);
  });
  it("rejects a record years away", () => {
    expect(plausible({ title: rec.title, year: 2015 }, rec)).toBe(false);
  });
});

describe("preprint detection", () => {
  it("by type, DOI, URL; never with a journal", () => {
    expect(isPreprintItem({ type: "preprint" })).toBe(true);
    expect(
      isPreprintItem({ type: "journalArticle", doi: "10.1101/2020.1" }),
    ).toBe(true);
    expect(
      isPreprintItem({
        type: "journalArticle",
        url: "https://arxiv.org/abs/2101.01234",
      }),
    ).toBe(true);
    expect(
      isPreprintItem({
        type: "journalArticle",
        doi: "10.1101/2020.1",
        journal: "X",
      }),
    ).toBe(false);
    expect(isPreprintItem({ type: "journalArticle", doi: "10.1000/x" })).toBe(
      false,
    );
  });
  it("builds the arXiv DOI from the URL", () => {
    expect(preprintDoi({ url: "https://arxiv.org/abs/2101.01234" })).toBe(
      "10.48550/arxiv.2101.01234",
    );
    expect(preprintDoi({ doi: "10.1101/2020.1" })).toBe("10.1101/2020.1");
  });
  it("reads the Crossref relation", () => {
    expect(
      relatedPublishedDoi({
        relation: {
          "is-preprint-of": [{ "id-type": "doi", id: "10.1234/ABC" }],
        },
      }),
    ).toBe("10.1234/abc");
    expect(relatedPublishedDoi({})).toBeUndefined();
  });
});

describe("findPublished", () => {
  const q = {
    doi: "10.1101/2022.1.1.1",
    title: "Wildfire smoke and respiratory health",
    author: "Lee",
    year: 2022,
  };
  it("follows the Crossref link", async () => {
    const c = ctxFor({
      "works/10.1101/2022.1.1.1": {
        message: {
          relation: {
            "is-preprint-of": [
              { "id-type": "doi", id: "10.1234/journal.2023.5" },
            ],
          },
        },
      },
      "works/10.1234/journal.2023.5": { message: work },
    });
    const r = await findPublished(q, c);
    expect(r?.via).toBe("Crossref link");
    expect(r?.record.journal).toBe("Environmental Health");
  });
  it("uses OpenAlex when it points at a different, plausible DOI", async () => {
    const c = ctxFor({
      "works/10.1101/2022.1.1.1": { message: {} },
      "api.openalex.org": { doi: "https://doi.org/10.1234/journal.2023.5" },
      "works/10.1234/journal.2023.5": { message: work },
    });
    expect((await findPublished(q, c))?.via).toBe("OpenAlex");
  });
  it("rejects an OpenAlex DOI for a different paper", async () => {
    const c = ctxFor({
      "api.openalex.org": { doi: "https://doi.org/10.1234/journal.2023.5" },
      "works/10.1234/journal.2023.5": {
        message: {
          ...work,
          title: ["Deep sea mining"],
          author: [{ given: "X", family: "Park" }],
        },
      },
    });
    expect(await findPublished(q, c)).toBeNull();
  });
  it("falls back to a title and author search", async () => {
    const c = ctxFor({
      "api.crossref.org/works?": { message: { items: [work] } },
    });
    expect((await findPublished({ ...q, doi: undefined }, c))?.via).toBe(
      "title and author",
    );
  });
  it("returns null when nothing matches", async () => {
    expect(await findPublished(q, ctxFor({}))).toBeNull();
  });
});

describe("planUpgrade", () => {
  const rec = recordFromCrossref(work);
  it("sets journal fields, keeps an existing abstract, records the preprint", () => {
    const u = planUpgrade(
      {
        abstract: "mine",
        extra: "",
        arxivId: "2101.01234",
        preprintDoi: "10.48550/arxiv.2101.01234",
        creators: [{ last: "Lee" }],
      },
      rec,
    );
    expect(u.type).toBe("journalArticle");
    expect(u.fields).toMatchObject({
      publicationTitle: "Environmental Health",
      DOI: "10.1234/journal.2023.5",
      url: "https://doi.org/10.1234/journal.2023.5",
    });
    expect(u.fields.abstractNote).toBeUndefined();
    expect(u.extraLines).toEqual([
      "Preprint DOI: 10.48550/arxiv.2101.01234",
      "arXiv: 2101.01234",
    ]);
    expect(u.replaceCreators).toBe(true);
  });
  it("fills an empty abstract; keeps creators when the first author differs", () => {
    const u = planUpgrade(
      { abstract: "", extra: "arXiv: 1", creators: [{ last: "Park" }] },
      rec,
    );
    expect(u.fields.abstractNote).toBe("Smoke harms lungs.");
    expect(u.replaceCreators).toBe(false);
    expect(u.extraLines).toEqual([]);
  });
});
