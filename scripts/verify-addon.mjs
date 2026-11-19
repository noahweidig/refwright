/* global URL, process, console */
// Static checks on the built add-on (.scaffold/build). Run after `npm run build`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const build = join(root, ".scaffold/build");
const addon = join(build, "addon");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ref = pkg.config.addonRef;
const prefix = pkg.config.prefsPrefix;
const MAX_XPI_KB = Number(process.env.MAX_XPI_KB ?? 2048);

let failed = 0;
const fail = (m) => {
  failed++;
  console.log(`::error::${m}`);
};
const ok = (m) => console.log(`ok  ${m}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const read = (p) => readFileSync(p, "utf8");
const files = walk(addon);
const rel = (p) => relative(addon, p);
const text = files.filter((f) => /\.(js|json|xhtml|css|ftl|svg)$/.test(f));

// 1. XPI
const xpi = join(build, `${ref}.xpi`);
check(existsSync(xpi), "xpi exists");
const kb = statSync(xpi).size / 1024;
check(kb <= MAX_XPI_KB, `xpi size ${kb.toFixed(0)} KB <= ${MAX_XPI_KB} KB`);
const zipList = execFileSync("/usr/bin/unzip", ["-Z1", xpi], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
for (const req of ["manifest.json", "bootstrap.js", "prefs.js"])
  check(zipList.includes(req), `xpi has ${req} at root`);
check(
  !zipList.some((n) => n.startsWith("addon/") || n.startsWith("/")),
  "xpi has no addon/ prefix or absolute paths",
);
check(
  !zipList.some((n) => /node_modules|\.map$|\.ts$|\.env/.test(n)),
  "xpi has no sourcemaps, ts, node_modules or .env",
);
execFileSync("/usr/bin/unzip", ["-tq", xpi]);
ok("xpi zip integrity");
const diskSet = new Set(files.map(rel));
for (const f of diskSet)
  if (!zipList.includes(f)) fail(`file missing from xpi: ${f}`);
ok("all built files packed in xpi");

// 2. manifest
const mf = JSON.parse(read(join(addon, "manifest.json")));
const z = mf.applications?.zotero ?? {};
check(mf.manifest_version === 2, "manifest_version 2");
check(mf.version === pkg.version, "manifest version == package.json");
check(z.id === pkg.config.addonID, "manifest id == config.addonID");
check(/^[^@\s]+@[^@\s]+$/.test(z.id ?? ""), "addon id looks like name@domain");
check(
  /^\d+\.\d+/.test(z.strict_min_version ?? ""),
  `strict_min_version set (${z.strict_min_version})`,
);
check(
  /^\d+\.(\*|\d+)/.test(z.strict_max_version ?? ""),
  `strict_max_version set (${z.strict_max_version})`,
);
check(
  Number.parseFloat(z.strict_min_version) >= 7,
  "strict_min_version >= 7 (bootstrap plugins)",
);
check((z.update_url ?? "").startsWith("https://"), "update_url is https");
for (const [size, p] of Object.entries(mf.icons ?? {}))
  check(existsSync(join(addon, p)), `icon ${size} exists (${p})`);
check(
  !/__\w+__/.test(read(join(addon, "manifest.json"))),
  "manifest has no placeholders",
);

// 3. no unreplaced placeholders anywhere
for (const f of text) {
  const m = read(f).match(
    /__(addon\w+|buildVersion|buildTime|author|homepage|description)__/,
  );
  if (m) fail(`unreplaced placeholder ${m[0]} in ${rel(f)}`);
}
ok("placeholder scan done");

// 4. bootstrap
const boot = read(join(addon, "bootstrap.js"));
for (const fn of [
  "install",
  "startup",
  "shutdown",
  "uninstall",
  "onMainWindowLoad",
  "onMainWindowUnload",
])
  check(
    new RegExp(String.raw`function\s+${fn}\s*\(`).test(boot),
    `bootstrap defines ${fn}`,
  );
check(
  boot.includes(`content/scripts/${ref}.js`) &&
    existsSync(join(addon, `content/scripts/${ref}.js`)),
  "bootstrap loads existing main script",
);
check(
  boot.includes("registerChrome") && boot.includes(`"${ref}"`),
  "bootstrap registers chrome package",
);

// 5. JS bundles parse and have no leftover module syntax
for (const f of files.filter((f) => f.endsWith(".js"))) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`syntax error in ${rel(f)}: ${e.stderr}`);
    continue;
  }
  const src = read(f);
  if (/^[ \t]*(?:import|export)\s/m.test(src) && f.includes("/scripts/"))
    fail(`bundle has ES import/export: ${rel(f)}`);
  if (/\brequire\(["'](?!chrome)/.test(src) && f.includes("/scripts/"))
    fail(`bundle has unresolved require(): ${rel(f)}`);
}
ok("js syntax + module leftovers");

// 6. xhtml: well-formed, chrome:// refs resolve
const xhtml = files.filter((f) => f.endsWith(".xhtml"));
check(xhtml.length > 0, `${xhtml.length} xhtml windows built`);
for (const f of xhtml) {
  try {
    // preferences.xhtml is a fragment with several roots
    const frag = f.endsWith("preferences.xhtml");
    execFileSync("/usr/bin/xmllint", ["--noout", "-"], {
      input: frag
        ? `<root xmlns:html="http://www.w3.org/1999/xhtml" xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul">${read(f).replace(/<\?xml[^>]*>/, "")}</root>`
        : read(f),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    fail(`xhtml not well-formed: ${rel(f)}: ${e.stderr}`);
  }
}
const chromeRef = new RegExp(`chrome://${ref}/content/([^"'\\s)\`]+)`, "g");
for (const f of text) {
  for (const m of read(f).matchAll(chromeRef)) {
    if (m[1].includes("${")) continue;
    if (!diskSet.has(`content/${m[1]}`))
      fail(`${rel(f)} references missing chrome://${ref}/content/${m[1]}`);
  }
}
ok("chrome:// references resolve");
// every ui bundle is used by an xhtml, every xhtml script exists
const uiJs = files.filter((f) => /scripts\/ui-/.test(f)).map(rel);
const xhtmlText = xhtml.map(read).join("\n");
for (const j of uiJs)
  check(xhtmlText.includes(j.replace("content/", "")), `ui bundle used: ${j}`);

// 7. fluent
const ftlFiles = files.filter((f) => f.endsWith(".ftl"));
const ids = new Set();
const dup = new Set();
for (const f of ftlFiles) {
  const base = f.split("/").pop();
  check(base.startsWith(`${ref}-`), `ftl prefixed: ${base}`);
  for (const line of read(f).split("\n")) {
    const m = line.match(/^([a-zA-Z][\w-]*)\s*=/);
    if (m) {
      if (ids.has(m[1])) dup.add(m[1]);
      ids.add(m[1]);
    }
  }
}
check(dup.size === 0, `no duplicate ftl ids ${[...dup].join(",")}`);
// source files reference real ids (ids are prefixed at build time)
const srcFiles = walk(join(root, "src")).filter((f) => f.endsWith(".ts"));
const srcText = srcFiles
  .filter((f) => !f.endsWith("utils/locale.ts"))
  .map(read)
  .join("\n");
const used = new Set(
  [...srcText.matchAll(/getString\(\s*"([\w-]+)"/g)].map((m) => m[1]),
);
for (const id of used)
  check(ids.has(`${ref}-${id}`), `getString id defined: ${id}`);
// xhtml data-l10n-id
for (const f of xhtml)
  for (const m of read(f).matchAll(/data-l10n-id="([\w-]+)"/g))
    if (!ids.has(m[1])) fail(`${rel(f)}: data-l10n-id ${m[1]} not in ftl`);
ok("data-l10n-id references resolve");
const mw = ids; // ids used in main window via getLocaleID / ztoolkit
for (const m of srcText.matchAll(/getLocaleID\(\s*"([\w-]+)"/g))
  check(mw.has(`${ref}-${m[1]}`), `getLocaleID defined: ${m[1]}`);

// 8. prefs
const prefsJs = read(join(addon, "prefs.js"));
const defined = new Set(
  [...prefsJs.matchAll(/pref\("([^"]+)"/g)].map((m) => m[1]),
);
check(defined.size > 0, `${defined.size} prefs defined`);
for (const k of defined)
  if (!k.startsWith(`${prefix}.`)) fail(`pref outside prefix: ${k}`);
const usedPrefs = new Set(
  [...srcText.matchAll(/(?:(?:get|set|clear)Pref|\bg)\(\s*"([^"]+)"/g)].map(
    (m) => m[1],
  ),
);
for (const k of usedPrefs)
  check(defined.has(`${prefix}.${k}`), `pref has default: ${k}`);
const prefLines = read(join(addon, "prefs.js")).split("\n").filter(Boolean);
check(new Set(prefLines).size === prefLines.length, "no duplicate pref lines");
// preference pane bindings
const prefXhtml = read(join(addon, "content/preferences.xhtml"));
for (const m of prefXhtml.matchAll(/preference="([^"]+)"/g))
  check(
    defined.has(m[1]) || m[1].startsWith(prefix) === false,
    `pane binding has default: ${m[1]}`,
  );
check(
  /<linkset|<vbox\s+id="zotero-prefpane-/.test(prefXhtml),
  "preferences.xhtml has a prefpane root",
);

// 9. update manifests
for (const [name, hasHash] of [
  ["update.json", true],
  ["update-beta.json", true],
]) {
  const p = join(build, name);
  if (!existsSync(p)) {
    fail(`${name} missing`);
    continue;
  }
  const u = JSON.parse(read(p)).addons?.[z.id]?.updates ?? [];
  check(u.length > 0, `${name} has an update entry`);
  const e = u[u.length - 1];
  check(e?.version === pkg.version, `${name} version == package.json`);
  check(
    /^https:\/\/.*\.xpi$/.test(e?.update_link ?? ""),
    `${name} link is https .xpi`,
  );
  if (hasHash && e?.update_hash) {
    const h = createHash("sha512").update(readFileSync(xpi)).digest("hex");
    check(e.update_hash === `sha512:${h}`, `${name} sha512 matches xpi`);
  }
}

// 10. no secrets / debug leftovers shipped
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const s = read(f);
  if (/sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}/.test(s))
    fail(`possible secret in ${rel(f)}`);
  if (/\bdebugger\b/.test(s)) fail(`debugger statement in ${rel(f)}`);
  if (
    /localhost:\d{4,5}\/(?!v1)/.test(s) &&
    /livereload|ws:\/\/localhost/.test(s)
  )
    fail(`dev-server hook in ${rel(f)}`);
}
ok("secret/debug scan done");
check(
  !read(join(addon, `content/scripts/${ref}.js`)).includes("__env__"),
  "__env__ define replaced",
);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
