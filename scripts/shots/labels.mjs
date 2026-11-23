/* global URL, process, console */
// Pulls `key: getString("ftl-id", ...)` pairs from the Zotero layer and resolves them against addon.ftl.
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const ftl = {};
for (const line of readFileSync(
  new URL("addon/locale/en-US/addon.ftl", root),
  "utf8",
).split("\n")) {
  const m = line.match(/^([a-z0-9-]+)\s*=\s*(.*)$/);
  if (m) ftl[m[1]] = m[2].replace(/\{\s*\$(\w+)\s*\}/g, "{$1}");
}
export function labelsFrom(...files) {
  const out = {};
  for (const f of files) {
    const src = readFileSync(new URL(f, root), "utf8");
    for (const m of src.matchAll(/(\w+):\s*getString\(\s*"([a-z0-9-]+)"/g))
      if (ftl[m[2]] !== undefined) out[m[1]] ??= ftl[m[2]];
  }
  return out;
}
export const ftlText = (id) => ftl[id];

/** labels in the code right after `marker` (a window's open call), falling back to all known labels */
export function labelsNear(file, marker, len = 2500) {
  const src = readFileSync(new URL(file, root), "utf8");
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`marker not found: ${marker}`);
  const out = {};
  for (const m of src
    .slice(i, i + len)
    .matchAll(/(\w+):\s*getString\(\s*"([a-z0-9-]+)"/g))
    if (ftl[m[2]] !== undefined) out[m[1]] ??= ftl[m[2]];
  return {
    ...labelsFrom("src/zotero/windows.ts", "src/zotero/actions.ts"),
    ...out,
  };
}
