export interface HttpReq {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  signal?: AbortSignal;
}
export interface HttpRes {
  status: number;
  headers: Record<string, string>;
  text(): string;
  json<T = any>(): T;
  bytes(): Uint8Array;
}
export type Http = (req: HttpReq) => Promise<HttpRes>;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} ${new URL(url).host}`);
  }
}

export const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal?.aborted) return rej(new Error("Cancelled"));
    const t = setTimeout(res, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("Cancelled"));
      },
      { once: true },
    );
  });

export interface PoliteOptions {
  delayMs: number; // pause before each request to the same host
  restMs: number; // after a 429
  retries: number;
  now?: () => number;
}

/** Wraps Http: per-host spacing, 1 retry on network error/5xx, 429 => host rests. */
export function polite(
  http: Http,
  o: PoliteOptions,
): Http & {
  resting: (host: string) => boolean;
} {
  const now = o.now ?? Date.now;
  const next = new Map<string, number>();
  const restUntil = new Map<string, number>();
  const fn = async (req: HttpReq): Promise<HttpRes> => {
    const host = hostOf(req.url);
    if ((restUntil.get(host) ?? 0) > now()) throw new HttpError(429, req.url);
    for (let attempt = 0; ; attempt++) {
      const wait = (next.get(host) ?? 0) - now();
      next.set(host, Math.max(now(), next.get(host) ?? 0) + o.delayMs);
      if (wait > 0) await sleep(wait, req.signal);
      try {
        const res = await http(req);
        if (res.status === 429) {
          restUntil.set(host, now() + o.restMs);
          throw new HttpError(429, req.url);
        }
        if (res.status >= 500 && attempt < o.retries) continue;
        return res;
      } catch (e) {
        if (req.signal?.aborted || e instanceof HttpError) throw e;
        if (attempt >= o.retries) throw e;
      }
    }
  };
  return Object.assign(fn, {
    resting: (host: string) => (restUntil.get(host) ?? 0) > now(),
  });
}

/** run fn over items with n workers; stops picking up work once aborted */
export async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length && !signal?.aborted) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return out;
}
