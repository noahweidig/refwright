import { describe, expect, it } from "vitest";
import { findPdf } from "../src/core/findPdf";
import { Http, HttpRes, pool, polite } from "../src/core/http";
import {
  ALL_SOURCES,
  Source,
  europepmc,
  unpaywall,
  crossref,
} from "../src/core/sources";
import { embeddedDoi, validatePdf, wrongPaper } from "../src/core/pdfCheck";
import {
  checkRetraction,
  compareCitation,
  checkCitation,
} from "../src/core/integrity";
import {
  PROVIDERS,
  buildChat,
  parseChat,
  buildEmbed,
  parseEmbed,
  extractJson,
  defaultChatOptions,
  provider,
} from "../src/core/llm";
import { parseTagReply, tagSystemPrompt } from "../src/core/prompts";

const res = (
  status: number,
  body: unknown = "",
  bytes?: Uint8Array,
): HttpRes => ({
  status,
  headers: {},
  text: () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: () => (typeof body === "string" ? JSON.parse(body) : body) as any,
  bytes: () => bytes ?? new TextEncoder().encode(String(body)),
});
const pdf = (doi?: string, size = 20000) => {
  const head = `%PDF-1.7\n${doi ? "doi:" + doi + "\n" : ""}`;
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode(head));
  return b;
};
const ctx = (http: Http) => ({ http, email: "a@b.c", keys: {} });

describe("pdf validation", () => {
  it("rejects small / non-pdf", () => {
    expect(validatePdf(pdf(undefined, 100)).ok).toBe(false);
    expect(validatePdf(new Uint8Array(20000)).ok).toBe(false);
    expect(validatePdf(pdf()).ok).toBe(true);
  });
  it("embedded doi + wrong-paper rules", () => {
    expect(embeddedDoi(pdf("10.1234/abc"))).toBe("10.1234/abc");
    expect(wrongPaper("10.1000/a", "10.1000/b")).toBe("mismatch");
    expect(wrongPaper("10.1/a", undefined)).toBe("ok");
    expect(wrongPaper("10.1/a", "10.1101/2020.01.01.1")).toBe("ok");
  });
});

describe("findPdf", () => {
  const sources: Source[] = [unpaywall, europepmc];
  it("stops at first valid PDF, names source", async () => {
    const calls: string[] = [];
    const http: Http = async (r) => {
      calls.push(r.url);
      if (r.url.includes("unpaywall"))
        return res(200, {
          oa_locations: [{ url_for_pdf: "https://x.org/a.pdf" }],
        });
      return res(404);
    };
    const r = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(http),
        sources,
        titleLookup: true,
        internetArchive: false,
        download: async () => pdf("10.1/a"),
      },
    );
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.source).toBe("Unpaywall");
    expect(calls.some((c) => c.includes("ebi.ac.uk"))).toBe(false);
  });
  it("wrong paper -> check-needed with found DOI", async () => {
    const http: Http = async () =>
      res(200, { oa_locations: [{ url_for_pdf: "https://x.org/a.pdf" }] });
    const r = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(http),
        sources: [unpaywall],
        titleLookup: false,
        internetArchive: false,
        download: async () => pdf("10.9999/zzz"),
      },
    );
    expect(r).toMatchObject({
      status: "check-needed",
      reason: "wrong paper",
      pdfDoi: "10.9999/zzz",
    });
  });
  it("dead link retried via Internet Archive", async () => {
    const http: Http = async (r) => {
      if (r.url.includes("unpaywall"))
        return res(200, {
          oa_locations: [{ url_for_pdf: "https://dead.org/a.pdf" }],
        });
      if (r.url.includes("wayback"))
        return res(200, {
          archived_snapshots: {
            closest: {
              available: true,
              url: "http://web.archive.org/web/2020/https://dead.org/a.pdf",
            },
          },
        });
      return res(404);
    };
    const r = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(http),
        sources: [unpaywall],
        titleLookup: false,
        internetArchive: true,
        download: async (c) => (c.url.includes("archive.org") ? pdf() : null),
      },
    );
    expect(r).toMatchObject({ status: "found", source: "Internet Archive" });
    if (r.status === "found") expect(r.url).toContain("2020id_/");
  });
  it("no copy -> missing; all extra sources failing -> check-needed", async () => {
    const ok: Http = async () => res(404);
    const m = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(ok),
        sources,
        titleLookup: false,
        internetArchive: false,
        download: async () => null,
      },
    );
    expect(m.status).toBe("missing");
    const boom: Http = async (r) =>
      r.url.includes("unpaywall") ? res(404) : res(500);
    const c = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(boom),
        sources,
        titleLookup: false,
        internetArchive: false,
        download: async () => null,
      },
    );
    expect(c).toMatchObject({
      status: "check-needed",
      reason: "sources unavailable",
    });
    expect(c.notes).toContain("Europe PMC unavailable");
  });
  it("title-only item: exact title supplies DOI; near match refused", async () => {
    const http: Http = async (r) => {
      if (r.url.includes("ebi.ac.uk"))
        return res(200, {
          resultList: {
            result: [
              {
                title: "Exact Title.",
                pubYear: "2020",
                doi: "10.5/EXACT",
                fullTextUrlList: {},
              },
              { title: "Exact Title Plus", pubYear: "2020", doi: "10.5/other" },
            ],
          },
        });
      if (r.url.includes("unpaywall"))
        return res(200, {
          oa_locations: [{ url_for_pdf: "https://x.org/p.pdf" }],
        });
      return res(404);
    };
    const r = await findPdf(
      { ids: {}, title: "Exact title", year: 2020 },
      {
        ctx: ctx(http),
        sources,
        titleLookup: true,
        internetArchive: false,
        download: async () => pdf("10.5/exact"),
      },
    );
    expect(r).toMatchObject({ status: "found", foundDoi: "10.5/exact" });
    const none: Http = async (r) =>
      r.url.includes("ebi.ac.uk")
        ? res(200, {
            resultList: {
              result: [
                {
                  title: "Exact Title Plus",
                  pubYear: "2020",
                  doi: "10.5/other",
                },
              ],
            },
          })
        : res(404);
    const r2 = await findPdf(
      { ids: {}, title: "Exact title", year: 2020 },
      {
        ctx: ctx(none),
        sources,
        titleLookup: true,
        internetArchive: false,
        download: async () => pdf(),
      },
    );
    expect(r2.status).toBe("missing");
  });
  it("preview does not download", async () => {
    let dl = 0;
    const http: Http = async () =>
      res(200, { oa_locations: [{ url_for_pdf: "https://x.org/a.pdf" }] });
    const r = await findPdf(
      { ids: { doi: "10.1/a" } },
      {
        ctx: ctx(http),
        sources: [unpaywall],
        titleLookup: false,
        internetArchive: false,
        preview: true,
        download: async () => (dl++, pdf()),
      },
    );
    expect(r.status).toBe("found");
    expect(dl).toBe(0);
  });
  it("crossref: closed license links ignored", async () => {
    const http: Http = async () =>
      res(200, {
        message: {
          DOI: "10.1/a",
          title: ["T"],
          license: [{ URL: "https://publisher.com/tdm" }],
          link: [
            { URL: "https://pub.com/a.pdf", "content-type": "application/pdf" },
          ],
        },
      });
    const h = await crossref.run({ ids: { doi: "10.1/a" } }, ctx(http));
    expect(h[0].candidates).toEqual([]);
  });
  it("source order is fixed", () => {
    expect(ALL_SOURCES.map((s) => s.id).slice(0, 4)).toEqual([
      "unpaywall",
      "pmc",
      "europepmc",
      "semanticscholar",
    ]);
  });
});

describe("http", () => {
  it("retries once on 5xx, rests host after 429", async () => {
    let n = 0;
    let t = 0;
    const h = polite(async () => (++n === 1 ? res(503) : res(200, "ok")), {
      delayMs: 0,
      restMs: 60000,
      retries: 1,
      now: () => t,
    });
    expect((await h({ url: "https://a.org/x" })).status).toBe(200);
    expect(n).toBe(2);
    const h2 = polite(async () => res(429), {
      delayMs: 0,
      restMs: 60000,
      retries: 1,
      now: () => t,
    });
    await expect(h2({ url: "https://a.org/x" })).rejects.toThrow("429");
    expect(h2.resting("a.org")).toBe(true);
    t = 61000;
    expect(h2.resting("a.org")).toBe(false);
  });
  it("pool stops after abort", async () => {
    const ac = new AbortController();
    const done: number[] = [];
    await pool(
      [1, 2, 3, 4, 5],
      1,
      async (x) => {
        done.push(x);
        if (x === 2) ac.abort();
      },
      ac.signal,
    );
    expect(done).toEqual([1, 2]);
  });
});

describe("integrity", () => {
  it("retraction via pubmed, then crossref, else none / check-needed", async () => {
    const pm: Http = async (r) =>
      r.url.includes("Retracted") || r.url.includes("%22Retracted")
        ? res(200, { esearchresult: { count: "1" } })
        : res(200, { esearchresult: { idlist: ["42"], count: "0" } });
    expect(await checkRetraction({ doi: "10.1/a" }, ctx(pm))).toMatchObject({
      status: "retracted",
      source: "PubMed",
    });
    const cr: Http = async (r) =>
      r.url.includes("eutils")
        ? res(200, { esearchresult: { idlist: [], count: "0" } })
        : res(200, {
            message: {
              "updated-by": [
                { type: "retraction", source: "retraction-watch" },
              ],
              title: ["x"],
            },
          });
    expect(await checkRetraction({ doi: "10.1/a" }, ctx(cr))).toMatchObject({
      status: "retracted",
      source: "Crossref",
    });
    const none: Http = async (r) =>
      r.url.includes("eutils")
        ? res(200, { esearchresult: { idlist: [], count: "0" } })
        : res(200, { message: { title: ["x"] } });
    expect((await checkRetraction({ doi: "10.1/a" }, ctx(none))).status).toBe(
      "none",
    );
    const down: Http = async () => res(500);
    expect((await checkRetraction({ doi: "10.1/a" }, ctx(down))).status).toBe(
      "check-needed",
    );
  });
  it("citation compare", () => {
    expect(
      compareCitation(
        { title: "A B", year: 2020, journal: "J" },
        { title: "A B", year: 2020, journal: "J", volume: "3" },
      ).status,
    ).toBe("incomplete");
    expect(
      compareCitation(
        { title: "Totally different", year: 2020 },
        { title: "A B", year: 2020 },
      ).status,
    ).toBe("mismatch");
    expect(
      compareCitation(
        { title: "A B", year: 2020, pages: "10-20" },
        { title: "a b.", year: 2020, pages: "10–20" },
      ).status,
    ).toBe("ok");
  });
  it("citation: no doi -> check-needed; changes nothing", async () => {
    expect(
      (
        await checkCitation(
          undefined,
          {},
          ctx(async () => res(200)),
        )
      ).status,
    ).toBe("check-needed");
  });
});

describe("llm", () => {
  const cfg = { key: "k", model: "", baseUrl: "" };
  it("builds per-provider requests", () => {
    const o = buildChat(provider("openai")!, cfg, "s", "u", defaultChatOptions);
    expect(o.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(o.headers!.Authorization).toBe("Bearer k");
    expect(JSON.parse(o.body!).model).toBe("gpt-4o-mini");
    const a = buildChat(
      provider("anthropic")!,
      cfg,
      "s",
      "u",
      defaultChatOptions,
    );
    expect(a.headers!["x-api-key"]).toBe("k");
    expect(JSON.parse(a.body!).system).toBe("s");
    const g = buildChat(provider("gemini")!, cfg, "s", "u", {
      ...defaultChatOptions,
      jsonMode: true,
    });
    expect(g.url).toContain(":generateContent");
    expect(g.url).not.toContain("key=");
    expect(
      buildChat(
        provider("ollama")!,
        { ...cfg, key: "" },
        "s",
        "u",
        defaultChatOptions,
      ).headers!.Authorization,
    ).toBeUndefined();
  });
  it("parses replies + embeddings", () => {
    expect(
      parseChat(provider("openai")!, {
        choices: [{ message: { content: "hi" } }],
      }),
    ).toBe("hi");
    expect(
      parseChat(provider("anthropic")!, {
        content: [{ text: "a" }, { text: "b" }],
      }),
    ).toBe("ab");
    expect(
      parseChat(provider("gemini")!, {
        candidates: [{ content: { parts: [{ text: "x" }] } }],
      }),
    ).toBe("x");
    expect(
      parseEmbed(provider("openai")!, {
        data: [
          { index: 1, embedding: [2] },
          { index: 0, embedding: [1] },
        ],
      }),
    ).toEqual([[1], [2]]);
    expect(
      parseEmbed(provider("cohere")!, { embeddings: { float: [[1]] } }),
    ).toEqual([[1]]);
    expect(buildEmbed(provider("openai")!, cfg, ["a"]).url).toContain(
      "/embeddings",
    );
  });
  it("json extraction + tag reply", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(
      parseTagReply(
        '{"items":[{"id":1,"tags":["a","b"]},{"id":"2","tags":[]}]}',
      ).get(1),
    ).toEqual(["a", "b"]);
  });
  it("system prompt carries steering", () => {
    const s = tagSystemPrompt({
      seeds: ["x", "y"],
      onlySeeds: true,
      language: "French",
      maxTags: 5,
      libraryTags: ["lib"],
    });
    expect(s).toMatch(/Only use tags from this list: x, y/);
    expect(s).toMatch(/French/);
    expect(PROVIDERS.length).toBe(8);
  });
});
