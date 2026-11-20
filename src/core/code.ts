export type LinkKind = "code" | "data";
export interface CodeLink {
  url: string;
  title: string;
  kind: LinkKind;
}

export const CODE_TAGS = {
  code: "code:available",
  data: "data:available",
} as const;

const P = String.raw;
/** one pass over the text; every alternative has its own named groups */
const RE = new RegExp(
  [
    P`(?:https?:\/\/)?(?:www\.)?(?<host>github\.com|gitlab\.com|bitbucket\.org)\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)`,
    P`(?:https?:\/\/)?(?:www\.)?zenodo\.org\/(?:records?|deposit)\/(?<zu>\d+)`,
    P`(?:https?:\/\/)?(?:www\.)?osf\.io\/(?<ou>[a-z0-9]{5})\b`,
    P`(?:https?:\/\/)?(?:www\.)?huggingface\.co\/(?<hf>(?:datasets\/)?[\w.-]+\/[\w.-]+)`,
    P`\b10\.5281\/zenodo\.(?<zd>\d+)`,
    P`\b10\.17605\/osf\.io\/(?<od>[a-z0-9]{5})\b`,
    P`\b10\.6084\/m9\.figshare\.(?<fs>\d+)`,
    P`\b10\.5061\/dryad\.(?<dr>[a-z0-9]+)`,
  ].join("|"),
  "gi",
);

/** first path segments that are site pages, not users */
const SITE_PATHS = new Set(
  (
    "about,features,pricing,sponsors,orgs,topics,collections,marketplace,login,join,settings," +
    "explore,trending,notifications,pulls,issues,search,enterprise,customer-stories,readme"
  ).split(","),
);
const trim = (s: string) => s.replace(/(?:\.git|[.-])+$/i, "");

const data = (url: string, title: string): CodeLink => ({
  url,
  title,
  kind: "data",
});

function fromGroups(
  g: Record<string, string | undefined>,
): CodeLink | undefined {
  if (g.host) {
    const o = trim(g.owner!);
    const r = trim(g.repo!);
    if (!o || !r || SITE_PATHS.has(o.toLowerCase())) return;
    return {
      url: `https://${g.host.toLowerCase()}/${o}/${r}`,
      title: `Code: ${o}/${r}`,
      kind: "code",
    };
  }
  const zn = g.zu ?? g.zd;
  if (zn)
    return data(`https://doi.org/10.5281/zenodo.${zn}`, `Data: Zenodo ${zn}`);
  const osf = (g.ou ?? g.od)?.toLowerCase();
  if (osf) return data(`https://osf.io/${osf}`, `Data: OSF ${osf}`);
  if (g.fs)
    return data(
      `https://doi.org/10.6084/m9.figshare.${g.fs}`,
      `Data: figshare ${g.fs}`,
    );
  if (g.dr)
    return data(`https://doi.org/10.5061/dryad.${g.dr}`, `Data: Dryad ${g.dr}`);
  if (g.hf) {
    const ds = g.hf.startsWith("datasets/");
    const name = g.hf.replace(/^datasets\//, "");
    return {
      url: `https://huggingface.co/${g.hf}`,
      title: `${ds ? "Data" : "Code"}: Hugging Face ${name}`,
      kind: ds ? "data" : "code",
    };
  }
}

/** every distinct repository or data link in the text, in order of first appearance */
export function findLinks(
  text: string,
  keep?: (at: number, prevEnd: number, prevKept: boolean) => boolean,
) {
  const out = new Map<string, CodeLink>();
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let prevEnd = 0;
  let prevKept = false;
  while ((m = RE.exec(text))) {
    prevKept = !keep || keep(m.index, prevEnd, prevKept);
    prevEnd = m.index + m[0].length;
    if (!prevKept) continue;
    const l = fromGroups(m.groups!);
    if (l && !out.has(l.url.toLowerCase())) out.set(l.url.toLowerCase(), l);
  }
  return [...out.values()];
}

const CUE =
  /availab|deposit|source code|our code|code and data|replicat|reproduc|supplement|archiv|released|open[- ]source|repository|hosted/i;
const REFS = /\n\s*(?:references|bibliography|literature cited)\s*\n/gi;
const CUE_WINDOW = 250;
/** only separators between two links: the second belongs to the same list */
const LIST_GAP = /^[\s,;&()]*(?:and|or)?[\s,;&()]*$/i;

/**
 * Links in a paper's full text. References and cited tools also have URLs, so a hit counts only
 * when an availability cue sits just before it, and nothing after the reference list starts.
 */
export function findInFullText(text: string): CodeLink[] {
  let end = text.length;
  for (const m of text.matchAll(REFS))
    if (m.index > text.length * 0.4) end = m.index;
  const body = text.slice(0, end);
  return findLinks(body, (at, prevEnd, prevKept) =>
    prevKept && LIST_GAP.test(body.slice(prevEnd, at))
      ? true
      : CUE.test(body.slice(Math.max(prevEnd, at - CUE_WINDOW), at)),
  );
}

export const MAX_LINKS = 6;

/** abstract/extra/url hits first (the authors' own pointer), then full text; capped */
export function collect(
  front: string,
  fullText: string | undefined,
): CodeLink[] {
  const all = new Map<string, CodeLink>();
  for (const l of [
    ...findLinks(front),
    ...(fullText ? findInFullText(fullText) : []),
  ])
    if (!all.has(l.url.toLowerCase())) all.set(l.url.toLowerCase(), l);
  return [...all.values()].slice(0, MAX_LINKS);
}
