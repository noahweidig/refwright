import { Http } from "./http";
import { Ids } from "./ids";
import { normalizeTitle } from "./text";

export interface Query {
  ids: Ids;
  title?: string;
  year?: number;
}
export interface Candidate {
  url: string;
  headers?: Record<string, string>;
}
export interface Ctx {
  http: Http;
  email: string;
  keys: { core?: string; s2?: string; openalex?: string };
  signal?: AbortSignal;
  preferHosted?: boolean;
}
export interface Hit {
  doi?: string;
  title?: string;
  year?: number;
  openalexId?: string;
  candidates: Candidate[];
}
export interface Source {
  id: string;
  label: string;
  /** step group, used for settings checkboxes */
  group: string;
  alwaysOn?: boolean;
  /** one source may find a DOI for a title-only item */
  byTitle?: boolean;
  run(q: Query, c: Ctx): Promise<Hit[]>;
}

const enc = encodeURIComponent;

/** exact normalized title + year within 1; long-prefix titles only if years agree */
export function titleMatches(
  want: { title?: string; year?: number },
  got: { title?: string; year?: number },
): boolean {
  if (!want.title || !got.title) return false;
  const a = normalizeTitle(want.title),
    b = normalizeTitle(got.title);
  if (!a || !b) return false;
  const dy =
    want.year != null && got.year != null
      ? Math.abs(want.year - got.year)
      : NaN;
  if (a === b) return Number.isNaN(dy) || dy <= 1;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 40 && l.startsWith(s) && dy === 0;
}

const j = async (c: Ctx, url: string, headers?: Record<string, string>) => {
  const r = await c.http({
    url,
    headers: { Accept: "application/json", ...headers },
    signal: c.signal,
  });
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const yearOf = (x: any): number | undefined => {
  const n = Number(String(x ?? "").slice(0, 4));
  return n > 1000 ? n : undefined;
};
const cands = (...u: (string | undefined | null)[]): Candidate[] =>
  [...new Set(u.filter(Boolean) as string[])].map((url) => ({ url }));

export const unpaywall: Source = {
  id: "unpaywall",
  label: "Unpaywall",
  group: "unpaywall",
  alwaysOn: true,
  async run(q, c) {
    if (!q.ids.doi) return [];
    const d = await j(
      c,
      `https://api.unpaywall.org/v2/${q.ids.doi}?email=${enc(c.email)}`,
    );
    if (!d) return [];
    const locs = [d.best_oa_location, ...(d.oa_locations ?? [])].filter(
      Boolean,
    );
    return [{ candidates: cands(...locs.map((l: any) => l.url_for_pdf)) }];
  },
};

export const pmc: Source = {
  id: "pmc",
  label: "PubMed Central",
  group: "pmc",
  alwaysOn: true,
  async run(q, c) {
    let id = q.ids.pmcid;
    if (!id) {
      const key = q.ids.pmid ?? q.ids.doi;
      if (!key) return [];
      const d = await j(
        c,
        `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1.0/articles/?ids=${enc(key)}&format=json&tool=refwright&email=${enc(c.email)}`,
      );
      id = d?.records?.[0]?.pmcid;
    }
    if (!id) return [];
    return [
      {
        candidates: cands(
          `https://pmc.ncbi.nlm.nih.gov/articles/${id}/pdf/`,
          `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${id}&blobtype=pdf`,
        ),
      },
    ];
  },
};

export const europepmc: Source = {
  id: "europepmc",
  label: "Europe PMC",
  group: "europepmc",
  byTitle: true,
  async run(q, c) {
    const query = q.ids.doi
      ? `DOI:"${q.ids.doi}"`
      : q.ids.pmid
        ? `EXT_ID:${q.ids.pmid} AND SRC:MED`
        : q.title
          ? `TITLE:"${q.title.replace(/"/g, "")}"`
          : "";
    if (!query) return [];
    const d = await j(
      c,
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(query)}&format=json&resultType=core&pageSize=5&email=${enc(c.email)}`,
    );
    return (d?.resultList?.result ?? []).map((r: any) => ({
      doi: r.doi?.toLowerCase(),
      title: r.title,
      year: yearOf(r.pubYear),
      candidates: cands(
        ...(r.fullTextUrlList?.fullTextUrl ?? [])
          .filter(
            (u: any) =>
              u.documentStyle === "pdf" &&
              /open access|free/i.test(u.availability),
          )
          .map((u: any) => u.url),
        r.pmcid && r.isOpenAccess === "Y"
          ? `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${r.pmcid}&blobtype=pdf`
          : undefined,
      ),
    }));
  },
};

export const semanticscholar: Source = {
  id: "semanticscholar",
  label: "Semantic Scholar",
  group: "semanticscholar",
  byTitle: true,
  async run(q, c) {
    const h = c.keys.s2 ? { "x-api-key": c.keys.s2 } : undefined;
    const f = "title,year,externalIds,openAccessPdf";
    const id = q.ids.doi
      ? `DOI:${q.ids.doi}`
      : q.ids.pmid
        ? `PMID:${q.ids.pmid}`
        : q.ids.arxiv
          ? `ARXIV:${q.ids.arxiv}`
          : "";
    let p: any[] = [];
    if (id) {
      const d = await j(
        c,
        `https://api.semanticscholar.org/graph/v1/paper/${enc(id)}?fields=${f}`,
        h,
      );
      if (d) p = [d];
    } else if (q.title) {
      const d = await j(
        c,
        `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${enc(q.title)}&fields=${f}`,
        h,
      );
      p = d?.data ?? [];
    }
    return p.map((r) => ({
      doi: r.externalIds?.DOI?.toLowerCase(),
      title: r.title,
      year: r.year,
      candidates: cands(r.openAccessPdf?.url),
    }));
  },
};

const OPEN_LICENSE = /creativecommons\.org|open-?access|publiclicense|\/oa\//i;
export const crossref: Source = {
  id: "crossref",
  label: "Crossref",
  group: "crossref",
  byTitle: true,
  async run(q, c) {
    const mt = `mailto=${enc(c.email)}`;
    let works: any[] = [];
    if (q.ids.doi) {
      const d = await j(c, `https://api.crossref.org/works/${q.ids.doi}?${mt}`);
      if (d?.message) works = [d.message];
    } else if (q.title) {
      const d = await j(
        c,
        `https://api.crossref.org/works?query.bibliographic=${enc(q.title)}&rows=3&select=DOI,title,issued&${mt}`,
      );
      works = d?.message?.items ?? [];
    }
    const out: Hit[] = [];
    for (const w of works) {
      const open = (w.license ?? []).some((l: any) =>
        OPEN_LICENSE.test(l.URL ?? ""),
      );
      const links = (w.link ?? []).filter(
        (l: any) =>
          /pdf/i.test(l["content-type"] ?? "") || /\.pdf($|\?)/i.test(l.URL),
      );
      const pre: string[] = (w.relation?.["has-preprint"] ?? []).map(
        (r: any) => r.id,
      );
      out.push({
        doi: w.DOI?.toLowerCase(),
        title: w.title?.[0],
        year: w.issued?.["date-parts"]?.[0]?.[0],
        candidates: [
          ...(open ? cands(...links.map((l: any) => l.URL)) : []),
          ...pre.flatMap((id) =>
            preprintFor(
              String(id)
                .replace(/^https?:\/\/doi\.org\//, "")
                .toLowerCase(),
            ),
          ),
        ],
      });
    }
    return out;
  },
};

/** direct PDF guesses for known preprint DOI prefixes */
export function preprintFor(doi: string): Candidate[] {
  let m = doi.match(/^10\.48550\/arxiv\.(.+)$/);
  if (m) return cands(`https://arxiv.org/pdf/${m[1]}`);
  m = doi.match(/^10\.7287\/peerj\.preprints\.(\d+)/);
  if (m) return cands(`https://peerj.com/preprints/${m[1]}.pdf`);
  return [];
}

export const core: Source = {
  id: "core",
  label: "CORE",
  group: "core",
  byTitle: true,
  async run(q, c) {
    const qs = q.ids.doi
      ? `doi:"${q.ids.doi}"`
      : q.title
        ? `title:"${q.title.replace(/"/g, "")}"`
        : "";
    if (!qs) return [];
    const d = await j(
      c,
      `https://api.core.ac.uk/v3/search/works?q=${enc(qs)}&limit=3`,
      c.keys.core ? { Authorization: `Bearer ${c.keys.core}` } : undefined,
    );
    return (d?.results ?? []).map((r: any) => ({
      doi: r.doi?.toLowerCase(),
      title: r.title,
      year: r.yearPublished,
      candidates: cands(r.downloadUrl),
    }));
  },
};

export const openaire: Source = {
  id: "openaire",
  label: "OpenAIRE",
  group: "openaire",
  byTitle: true,
  async run(q, c) {
    const param = q.ids.doi
      ? `doi=${enc(q.ids.doi)}`
      : q.title
        ? `title=${enc(q.title)}`
        : "";
    if (!param) return [];
    const d = await j(
      c,
      `https://api.openaire.eu/search/publications?${param}&format=json&size=3`,
    );
    const res = d?.response?.results?.result;
    const list: any[] = Array.isArray(res) ? res : res ? [res] : [];
    const val = (x: any) =>
      x == null ? undefined : typeof x === "object" ? x.$ : x;
    return list.map((r) => {
      const e = r.metadata?.["oaf:entity"]?.["oaf:result"] ?? {};
      const t = Array.isArray(e.title) ? e.title[0] : e.title;
      const inst = [].concat(e.children?.instance ?? []) as any[];
      const urls = inst
        .filter((i) => i.accessright?.["@classid"] === "OPEN")
        .flatMap((i) =>
          [].concat(i.webresource ?? []).map((w: any) => val(w.url)),
        );
      const doi = []
        .concat(e.pid ?? [])
        .find((p: any) => p["@classid"] === "doi");
      return {
        doi: val(doi)?.toLowerCase(),
        title: val(t),
        year: yearOf(val(e.dateofacceptance)),
        candidates: cands(...urls),
      };
    });
  },
};

const OSF = /^10\.(31234|31235|31222|31223|31219)\//;
export const preprints: Source = {
  id: "preprints",
  label: "Preprint servers",
  group: "preprints",
  async run(q, c) {
    const out: Candidate[] = [];
    if (q.ids.arxiv) out.push(...cands(`https://arxiv.org/pdf/${q.ids.arxiv}`));
    const doi = q.ids.doi;
    if (!doi) return [{ candidates: out }];
    out.push(...preprintFor(doi));
    if (/^10\.1101\//.test(doi)) {
      for (const server of ["biorxiv", "medrxiv"]) {
        const d = await j(
          c,
          `https://api.biorxiv.org/details/${server}/${doi}`,
        );
        const last = d?.collection?.[d.collection.length - 1];
        if (last) {
          out.push(
            ...cands(
              `https://www.${server}.org/content/${doi}v${last.version}.full.pdf`,
            ),
          );
          break;
        }
      }
    } else if (OSF.test(doi)) {
      const d = await j(
        c,
        `https://api.osf.io/v2/preprints/?filter[doi]=${enc(doi)}`,
      );
      const fid = d?.data?.[0]?.relationships?.primary_file?.data?.id;
      if (fid) out.push(...cands(`https://osf.io/download/${fid}/`));
    } else if (/^10\.5281\/zenodo\.(\d+)/.test(doi)) {
      const id = doi.match(/zenodo\.(\d+)/)![1];
      const d = await j(c, `https://zenodo.org/api/records/${id}`);
      out.push(
        ...cands(
          ...(d?.files ?? [])
            .filter((f: any) => /\.pdf$/i.test(f.key))
            .map((f: any) => f.links?.self),
        ),
      );
    } else if (/^10\.6084\/m9\.figshare\.(\d+)/.test(doi)) {
      const id = doi.match(/figshare\.(\d+)/)![1];
      const d = await j(c, `https://api.figshare.com/v2/articles/${id}`);
      out.push(
        ...cands(
          ...(d?.files ?? [])
            .filter((f: any) => /\.pdf$/i.test(f.name))
            .map((f: any) => f.download_url),
        ),
      );
    }
    return [{ candidates: out }];
  },
};

export const hal: Source = {
  id: "hal",
  label: "HAL",
  group: "hal",
  byTitle: true,
  async run(q, c) {
    const qs = q.ids.doi
      ? `doiId_s:"${q.ids.doi}"`
      : q.title
        ? `title_t:"${q.title.replace(/"/g, "")}"`
        : "";
    if (!qs) return [];
    const d = await j(
      c,
      `https://api.archives-ouvertes.fr/search/?q=${enc(qs)}&fl=fileMain_s,title_s,producedDateY_i,doiId_s&rows=3&wt=json`,
    );
    return (d?.response?.docs ?? []).map((r: any) => ({
      doi: r.doiId_s?.toLowerCase(),
      title: r.title_s?.[0],
      year: r.producedDateY_i,
      candidates: cands(r.fileMain_s),
    }));
  },
};

export const doaj: Source = {
  id: "doaj",
  label: "DOAJ",
  group: "doaj",
  async run(q, c) {
    if (!q.ids.doi) return [];
    const d = await j(
      c,
      `https://doaj.org/api/search/articles/doi:${enc(q.ids.doi)}`,
    );
    return (d?.results ?? []).map((r: any) => ({
      candidates: cands(
        ...(r.bibjson?.link ?? [])
          .filter((l: any) => l.type === "fulltext")
          .map((l: any) => l.url),
      ),
    }));
  },
};

export const osti: Source = {
  id: "osti",
  label: "OSTI",
  group: "osti",
  async run(q, c) {
    if (!q.ids.doi) return [];
    const d = await j(
      c,
      `https://www.osti.gov/api/v1/records?doi=${enc(q.ids.doi)}`,
    );
    return (Array.isArray(d) ? d : []).map((r: any) => ({
      candidates: cands(
        ...(r.links ?? [])
          .filter((l: any) => l.rel === "fulltext")
          .map((l: any) => l.href),
      ),
    }));
  },
};

export const iascholar: Source = {
  id: "iascholar",
  label: "Internet Archive Scholar",
  group: "iascholar",
  async run(q, c) {
    if (!q.ids.doi) return [];
    const d = await j(
      c,
      `https://api.fatcat.wiki/v0/release/lookup?doi=${enc(q.ids.doi)}&expand=files&hide=abstracts,refs`,
    );
    const urls = (d?.files ?? [])
      .filter((f: any) => !f.mimetype || f.mimetype === "application/pdf")
      .flatMap((f: any) => f.urls ?? [])
      .sort(
        (a: any, b: any) =>
          (a.rel === "webarchive" ? -1 : 0) - (b.rel === "webarchive" ? -1 : 0),
      )
      .map((u: any) => u.url);
    return [{ candidates: cands(...urls) }];
  },
};

const VERSION_RANK: Record<string, number> = {
  publishedVersion: 0,
  acceptedVersion: 1,
  submittedVersion: 2,
};
export const openalex: Source = {
  id: "openalex",
  label: "OpenAlex",
  group: "openalex",
  alwaysOn: true,
  async run(q, c) {
    const h = c.keys.openalex
      ? { Authorization: `Bearer ${c.keys.openalex}` }
      : undefined;
    const base = q.ids.doi
      ? `https://api.openalex.org/works/doi:${q.ids.doi}`
      : q.ids.pmid
        ? `https://api.openalex.org/works/pmid:${q.ids.pmid}`
        : "";
    if (!base) return [];
    const d = await j(c, `${base}?mailto=${enc(c.email)}`, h);
    if (!d) return [];
    const locs = (d.locations ?? [])
      .filter((l: any) => l.pdf_url)
      .sort(
        (a: any, b: any) =>
          (VERSION_RANK[a.version] ?? 3) - (VERSION_RANK[b.version] ?? 3),
      );
    const hosted: Candidate[] =
      c.keys.openalex && d.id
        ? [
            {
              url: `https://content.openalex.org/works/${String(d.id).split("/").pop()}.pdf`,
              headers: { Authorization: `Bearer ${c.keys.openalex}` },
            },
          ]
        : [];
    const links = cands(...locs.map((l: any) => l.pdf_url));
    return [
      {
        openalexId:
          String(d.id ?? "")
            .split("/")
            .pop() || undefined,
        doi: d.doi?.replace(/^https?:\/\/doi\.org\//, "").toLowerCase(),
        candidates: c.preferHosted
          ? [...hosted, ...links]
          : [...links, ...hosted],
      },
    ];
  },
};

/** Fixed step order. Settings only toggle membership. */
export const ALL_SOURCES: Source[] = [
  unpaywall,
  pmc,
  europepmc,
  semanticscholar,
  crossref,
  core,
  openaire,
  preprints,
  hal,
  doaj,
  osti,
  iascholar,
  openalex,
];

/** Internet Archive snapshot for a dead URL (raw bytes form) */
export async function waybackFor(
  url: string,
  c: Ctx,
): Promise<Candidate | undefined> {
  const d = await j(c, `https://archive.org/wayback/available?url=${enc(url)}`);
  const snap = d?.archived_snapshots?.closest;
  if (!snap?.available || !snap.url) return;
  return {
    url: String(snap.url)
      .replace(/^http:/, "https:")
      .replace(/(\/web\/\d+)\//, "$1id_/"),
  };
}
