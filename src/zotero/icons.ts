/** Icons resolved against the running Zotero, so a renamed or missing one never leaves a blank slot. */
const SKIN = "chrome://zotero/skin/";
const own = () =>
  `chrome://${addon.data.config.addonRef}/content/icons/refwright.svg`;

async function firstThatLoads(urls: string[], fallback: string) {
  const win = Zotero.getMainWindow() as any;
  const ok = await Promise.all(
    urls.map((u) =>
      win.fetch(u).then(
        (r: Response) => r.ok,
        () => false,
      ),
    ),
  );
  return urls[ok.indexOf(true)] ?? fallback;
}

export const icons = { related: "", search: "" };

export async function resolveIcons() {
  [icons.related, icons.search] = await Promise.all([
    firstThatLoads(
      [
        "itempane/16/related",
        "itempane/20/related",
        "16/universal/related",
        "16/universal/link",
      ].map((p) => `${SKIN}${p}.svg`),
      own(),
    ),
    firstThatLoads(
      ["16/universal/search", "itempane/16/search"]
        .map((p) => `${SKIN}${p}.svg`)
        .concat("chrome://global/skin/icons/search-glass.svg"),
      "",
    ),
  ]);
}
