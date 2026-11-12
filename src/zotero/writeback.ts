import { WRITEBACK_PREFIXES } from "../core/tags";
import { makeToken, parseWrite, plan, tokenOk } from "../core/writeback";
import { getPref, setPref } from "../utils/prefs";
import { S, saveState, AuditEntry } from "./state";

type Req = {
  method: string;
  headers: Record<string, string>;
  data?: any;
  searchParams?: URLSearchParams;
};
type Res = [number, string, string];
const J = (code: number, body: unknown): Res => [
  code,
  "application/json",
  JSON.stringify(body),
];

function guard(r: Req): Res | null {
  if (!getPref("writeBackEnabled" as any))
    return J(404, { error: "write-back is off" });
  const h =
    r.headers?.["authorization"] ??
    r.headers?.["Authorization"] ??
    r.headers?.["x-carrel-token"];
  if (!tokenOk(h, String(getPref("writeBackToken" as any) || "")))
    return J(401, { error: "bad token" });
  return null;
}

const uuid = () => Zotero.Utilities.randomString(16);

function find(libraryID: number, key: string) {
  return Zotero.Items.getByLibraryAndKey(libraryID, key) as Zotero.Item | false;
}

export function generateToken(): string {
  const t = makeToken(
    (n) =>
      Zotero.getMainWindow().crypto.getRandomValues(
        new Uint8Array(n),
      ) as Uint8Array,
  );
  setPref("writeBackToken" as any, t as any);
  return t;
}

export function registerEndpoints() {
  const E = Zotero.Server.Endpoints as any;
  const make = (methods: string[], init: (r: Req) => Promise<Res>) => {
    const C: any = function () {};
    C.prototype = {
      supportedMethods: methods,
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      init: async (r: Req) => {
        const denied = guard(r);
        if (denied) return denied;
        try {
          return await init(r);
        } catch (e: any) {
          return J(400, { error: String(e?.message ?? e) });
        }
      },
    };
    return C;
  };
  E["/carrel/ping"] = make(["GET"], async () =>
    J(200, {
      name: "carrel",
      version: addon.data.config
        ? ((Zotero as any).Plugins?.getVersion?.() ?? "")
        : "",
      endpoints: [
        "/carrel/ping",
        "/carrel/tag",
        "/carrel/audit",
        "/carrel/undo",
      ],
      tagPrefixes: WRITEBACK_PREFIXES,
      dryRun: true,
    }),
  );
  E["/carrel/tag"] = make(["POST"], async (r) => {
    const req = parseWrite(r.data);
    const libraryID = req.libraryID ?? Zotero.Libraries.userLibraryID;
    const planned = plan(req);
    const applied: unknown[] = [];
    for (const p of planned) {
      const item = find(libraryID, p.key);
      if (!item) {
        applied.push({
          key: p.key,
          error: "item not found",
          refused: p.refused,
        });
        continue;
      }
      const log: AuditEntry[] = [];
      if (!req.dryRun) {
        for (const t of p.add)
          if (!item.hasTag(t)) {
            item.addTag(t, 0);
            log.push({
              at: Date.now(),
              op: "add",
              itemKey: p.key,
              tag: t,
              id: uuid(),
            });
          }
        for (const t of p.remove)
          if (item.hasTag(t)) {
            item.removeTag(t);
            log.push({
              at: Date.now(),
              op: "remove",
              itemKey: p.key,
              tag: t,
              id: uuid(),
            });
          }
        if (log.length) await item.saveTx();
      } else {
        for (const t of p.add)
          log.push({
            at: Date.now(),
            op: "add",
            itemKey: p.key,
            tag: t,
            id: "",
            dryRun: true,
          });
        for (const t of p.remove)
          log.push({
            at: Date.now(),
            op: "remove",
            itemKey: p.key,
            tag: t,
            id: "",
            dryRun: true,
          });
      }
      if (!req.dryRun) S().audit.push(...log);
      applied.push({
        key: p.key,
        changes: log.map((l) => ({ op: l.op, tag: l.tag, id: l.id })),
        refused: p.refused,
      });
    }
    S().audit = S().audit.slice(-5000);
    saveState();
    return J(200, { dryRun: !!req.dryRun, items: applied });
  });
  E["/carrel/audit"] = make(["GET"], async () =>
    J(200, { entries: S().audit.slice(-500).reverse() }),
  );
  E["/carrel/undo"] = make(["POST"], async (r) => {
    const id = String(r.data?.id ?? "");
    const e = S().audit.find((a) => a.id === id && a.id);
    if (!e) return J(404, { error: "no such write" });
    if (e.undone) return J(409, { error: "already undone" });
    const item = find(Zotero.Libraries.userLibraryID, e.itemKey);
    if (!item) return J(404, { error: "item not found" });
    if (e.op === "add") item.removeTag(e.tag);
    else if (e.op === "remove") item.addTag(e.tag, 0);
    await item.saveTx();
    e.undone = true;
    S().audit.push({
      at: Date.now(),
      op: "undo",
      itemKey: e.itemKey,
      tag: e.tag,
      id: uuid(),
    });
    saveState();
    return J(200, { undone: id });
  });
}
