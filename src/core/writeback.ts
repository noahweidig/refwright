import { isWritebackAllowed } from "./tags";

export interface WriteOp {
  key: string;
  add: string[];
  remove: string[];
}
export interface WritePlanned extends WriteOp {
  refused: { tag: string; reason: string }[];
}
export interface WriteRequest {
  libraryID?: number;
  dryRun?: boolean;
  items: WriteOp[];
}

export function parseWrite(body: unknown): WriteRequest {
  const b = body as any;
  if (!b || !Array.isArray(b.items)) throw new Error("items[] required");
  const items: WriteOp[] = b.items.map((i: any) => {
    if (!i?.key || typeof i.key !== "string")
      throw new Error("item.key required");
    const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
    return { key: i.key, add: arr(i.add), remove: arr(i.remove) };
  });
  return { libraryID: b.libraryID, dryRun: !!b.dryRun, items };
}

/** only allowlisted prefixes pass, even with a valid token */
export function plan(req: WriteRequest): WritePlanned[] {
  return req.items.map((i) => {
    const refused: { tag: string; reason: string }[] = [];
    const ok = (t: string) => {
      if (isWritebackAllowed(t)) return true;
      refused.push({ tag: t, reason: "prefix not allowed" });
      return false;
    };
    return {
      key: i.key,
      add: i.add.filter(ok),
      remove: i.remove.filter(ok),
      refused,
    };
  });
}

export function tokenOk(header: string | undefined, token: string): boolean {
  if (!token || token.length < 16 || !header) return false;
  const given = header.replace(/^Bearer\s+/i, "").trim();
  if (given.length !== token.length) return false;
  let d = 0;
  for (let i = 0; i < given.length; i++)
    d |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return d === 0;
}

export function makeToken(rnd: (n: number) => Uint8Array): string {
  return [...rnd(24)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
