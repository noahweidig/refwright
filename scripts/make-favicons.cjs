/*
 * Regenerates the docs favicon set and social image from the plugin icon
 * (addon/content/icons/refwright.svg). Needs Playwright. Run from the repo root:
 *   node scripts/make-favicons.cjs
 * Writes favicon.svg (also the site logo), favicon.ico, PNGs, apple-touch-icon.png, android-chrome and
 * maskable icons, mstile, safari-pinned-tab.svg, og.png, site.webmanifest and browserconfig.xml to docs/.
 */
/* global __dirname, console, process */
const fs = require("node:fs");
const { Buffer } = require("node:buffer");
const path = require("node:path");
const { chromium } = require("playwright");

const out = path.join(__dirname, "..", "docs");
const BLUE = "#4072E5"; // Zotero's accent blue, same as the plugin's favicon
const NAME = "refwright";
const DESC =
  "Find PDFs, check retractions and citations, tag, and file papers in Zotero.";

// the plugin icon's paths (16 x 16 grid)
const PATHS = [
  ...fs
    .readFileSync(
      path.join(__dirname, "..", "addon/content/icons/refwright.svg"),
      "utf8",
    )
    .matchAll(/ d="([^"]+)"/g),
].map((m) => m[1]);
const glyph = (fill) =>
  PATHS.map((d) => `<path fill="${fill}" d="${d}"/>`).join("");

// a square tile in the brand blue with the white glyph at `scale` of the tile
const tile = ({ radius, scale, size = 24 }) => {
  const g = 24 * scale;
  const offset = (24 - g) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">` +
    `<rect width="24" height="24" rx="${radius}" fill="${BLUE}"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${g / 16})">${glyph("#FFFFFF")}</g></svg>\n`
  );
};
const write = (name, data) => fs.writeFileSync(path.join(out, name), data);

const main = async () => {
  write("favicon.svg", tile({ radius: 5, scale: 0.68 }));
  // single colour mask for Safari pinned tabs
  write(
    "safari-pinned-tab.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${glyph("#000")}</svg>\n`,
  );

  // name, pixel size, tile options, transparent corners
  const pngs = [
    ["favicon-16x16.png", 16, { radius: 4, scale: 0.8 }, true],
    ["favicon-32x32.png", 32, { radius: 5, scale: 0.74 }, true],
    ["favicon-48x48.png", 48, { radius: 5, scale: 0.7 }, true],
    ["apple-touch-icon.png", 180, { radius: 0, scale: 0.62 }, false],
    ["android-chrome-192x192.png", 192, { radius: 5, scale: 0.68 }, true],
    ["android-chrome-512x512.png", 512, { radius: 5, scale: 0.68 }, true],
    ["maskable-512x512.png", 512, { radius: 0, scale: 0.5 }, false], // glyph inside the 80% safe zone
    ["mstile-150x150.png", 150, { radius: 0, scale: 0.6 }, false],
  ];
  const browser = await chromium.launch();
  await Promise.all(
    pngs.map(async ([name, size, opts, transparent]) => {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<body style="margin:0;background:transparent">${tile({ ...opts, size })}</body>`,
      );
      await page.screenshot({
        path: path.join(out, name),
        omitBackground: transparent,
        clip: { x: 0, y: 0, width: size, height: size },
      });
      await page.close();
    }),
  );
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  // social card, 1200 x 630
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(
    `<body style="margin:0;width:1200px;height:630px;box-sizing:border-box;padding:84px 96px;background:${BLUE};color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;gap:28px">` +
      `<svg width="120" height="120" viewBox="0 0 16 16">${glyph("#fff")}</svg>` +
      `<div style="font-size:112px;font-weight:800;letter-spacing:-0.03em;line-height:1">${NAME}</div>` +
      `<div style="font-size:40px;line-height:1.3;max-width:900px;opacity:.92">${DESC}</div></body>`,
  );
  await page.screenshot({
    path: path.join(out, "og.png"),
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await browser.close();

  // favicon.ico: 16, 32 and 48 px PNG images in one container
  const sizes = [16, 32, 48];
  const images = sizes.map((s) =>
    fs.readFileSync(path.join(out, `favicon-${s}x${s}.png`)),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s, e);
    header.writeUInt8(s, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  write("favicon.ico", Buffer.concat([header, ...images]));
  fs.unlinkSync(path.join(out, "favicon-48x48.png")); // only needed inside the ICO

  write(
    "site.webmanifest",
    JSON.stringify(
      {
        name: NAME,
        short_name: NAME,
        description: DESC,
        start_url: "./",
        display: "standalone",
        theme_color: BLUE,
        background_color: "#ffffff",
        icons: [
          {
            src: "android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  write(
    "browserconfig.xml",
    `<?xml version="1.0" encoding="utf-8"?>\n<browserconfig><msapplication><tile><square150x150logo src="mstile-150x150.png"/><TileColor>${BLUE}</TileColor></tile></msapplication></browserconfig>\n`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
