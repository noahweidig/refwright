import { emptyLearned, Learned } from "../core/learning";

export interface UndoRecord {
  kind: "filing";
  at: number;
  added: { itemID: number; collectionID: number }[];
  removed: { itemID: number; collectionID: number }[];
}
export interface TagUndo {
  at: number;
  libraryID: number;
  from: string[];
  to: string;
  fromItems: Record<string, number[]>;
  hadTo: number[];
  type: number;
}
export interface AuditEntry {
  at: number;
  op: "add" | "remove" | "undo";
  itemKey: string;
  tag: string;
  dryRun?: boolean;
  id: string;
  undone?: boolean;
}
export interface State {
  misses: Record<string, number>;
  learned: Learned;
  filing: UndoRecord | null;
  rejected: Record<string, Record<number, number>>; // itemKey -> collID -> n
  audit: AuditEntry[];
  tmChecked: Record<string, number>;
  tmUndo: TagUndo[];
  embeddings: Record<string, { sig: string; vec: number[] }>;
  cites: Record<string, { n: number; at: number }>; // libraryID/itemKey
}
const fresh = (): State => ({
  misses: {},
  learned: emptyLearned(),
  filing: null,
  rejected: {},
  audit: [],
  tmChecked: {},
  tmUndo: [],
  embeddings: {},
  cites: {},
});

let state: State = fresh();
let timer: ReturnType<typeof setTimeout> | undefined;
const file = () => PathUtils.join(PathUtils.profileDir, "refwright-state.json");

export const S = () => state;

export async function loadState() {
  try {
    if (await IOUtils.exists(file()))
      state = { ...fresh(), ...(await IOUtils.readJSON(file())) };
  } catch (e) {
    ztoolkit.log("state load failed", e);
  }
}
export function saveState() {
  clearTimeout(timer);
  timer = setTimeout(flushState, 500);
}
export async function flushState() {
  clearTimeout(timer);
  try {
    await IOUtils.writeJSON(file(), state);
  } catch (e) {
    ztoolkit.log("state save failed", e);
  }
}
