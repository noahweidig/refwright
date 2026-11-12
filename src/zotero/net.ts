import type { Http, HttpRes } from "../core/http";

const parseHeaders = (raw: string) => {
  const h: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0)
      h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
};

/** Http over Zotero.HTTP.request: honours the user's proxy settings. */
export const zoteroHttp: Http = async (req) => {
  if (req.signal?.aborted) throw new Error("Cancelled");
  let cancel: (() => void) | undefined;
  const onAbort = () => cancel?.();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const xhr = await Zotero.HTTP.request(req.method ?? "GET", req.url, {
      headers: req.headers,
      body: req.body,
      timeout: req.timeout ?? 30000,
      responseType: "arraybuffer",
      successCodes: false,
      cancellerReceiver: (c: () => void) => {
        cancel = c;
      },
    } as any);
    const buf = new Uint8Array(xhr.response as ArrayBuffer);
    let text: string | undefined;
    const t = () => (text ??= new TextDecoder().decode(buf));
    const res: HttpRes = {
      status: xhr.status,
      headers: parseHeaders(xhr.getAllResponseHeaders?.() ?? ""),
      text: t,
      json: () => JSON.parse(t()),
      bytes: () => buf,
    };
    return res;
  } catch (e) {
    if (req.signal?.aborted) throw new Error("Cancelled", { cause: e });
    throw e;
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
  }
};

/** per-run GET memo: items sharing a DOI hit each service once */
export function memoGet(http: Http): Http {
  const cache = new Map<string, Promise<HttpRes>>();
  return (req) => {
    if ((req.method ?? "GET") !== "GET" || req.headers?.Authorization)
      return http(req);
    const k = req.url;
    let p = cache.get(k);
    if (!p) {
      p = http(req);
      cache.set(k, p);
      p.catch(() => cache.delete(k));
    }
    return p;
  };
}
