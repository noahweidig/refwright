import { labelsNear, ftlText as t } from "./labels.mjs";
const A = "src/zotero/actions.ts";
const L = (marker, extra = {}) => ({ ...labelsNear(A, marker), ...extra });
const noop = "async () => {}";
/** builds the `window.arguments` setup script: data as JSON, then functions by source */
const setup = (data, fns = {}) =>
  `const C = ${JSON.stringify(data)};\n` +
  Object.entries(fns)
    .map(([k, v]) => `C.${k} = ${v};`)
    .join("\n") +
  `\nwindow.arguments = [{ wrappedJSObject: C }];`;

const papers = [
  "Attention Is All You Need",
  "Soil carbon sequestration in temperate forests under warming",
  "Wildfire smoke exposure and respiratory admissions in western US cities",
  "A global map of root biomass across terrestrial biomes",
  "Deep residual learning for image recognition",
  "Microbial controls on soil organic matter formation",
  "Drought legacy effects on tree growth: a meta-analysis",
  "BERT: Pre-training of deep bidirectional transformers for language understanding",
  "Urban heat islands and heat-related mortality in Europe",
  "Mycorrhizal associations predict forest carbon storage",
];

/* ---------- review ---------- */
const coll = (
  id,
  name,
  path,
  confidence,
  score,
  on,
  words,
  already = false,
) => ({
  id,
  name,
  path,
  confidence,
  score,
  already,
  on,
  why: { words, papers: [papers[5], papers[3]] },
});
const review = {
  single: false,
  topN: 4,
  note: "",
  labels: L('"review.xhtml"', { title: "Review suggestions" }),
  items: [
    {
      itemID: 1,
      title: papers[1],
      on: true,
      tags: [
        { tag: "soil carbon", source: "OpenAlex", on: true },
        { tag: "forest ecology", source: "Your library", on: true },
        { tag: "climate warming", source: "PubMed MeSH", on: true },
        { tag: "carbon cycle", source: "Keywords", on: false },
      ],
      suggested: [],
      coll: {
        choices: [
          coll(11, "Soil carbon", "Ecology / Soil carbon", "high", 0.82, true, [
            "soil",
            "carbon",
          ]),
          coll(12, "Forests", "Ecology / Forests", "high", 0.74, true, [
            "forest",
            "temperate",
          ]),
          coll(13, "Climate change", "Climate change", "medium", 0.51, false, [
            "warming",
          ]),
          coll(14, "Reading list", "Reading list", "low", 0.2, false, [], true),
        ],
        preselected: [11, 12],
        already: [14],
      },
    },
    {
      itemID: 2,
      title: papers[2],
      on: true,
      tags: [
        { tag: "wildfire smoke", source: "OpenAlex", on: true },
        { tag: "air pollution", source: "Your library", on: true },
        { tag: "respiratory health", source: "PubMed MeSH", on: true },
        { tag: "PM2.5", source: "Keywords", on: false },
      ],
      suggested: [],
      coll: {
        choices: [
          coll(21, "Air quality", "Health / Air quality", "high", 0.79, true, [
            "smoke",
            "pm2.5",
          ]),
          coll(22, "Fire", "Ecology / Fire", "medium", 0.55, true, [
            "wildfire",
          ]),
          coll(
            23,
            "Epidemiology",
            "Health / Epidemiology",
            "low",
            0.31,
            false,
            ["admissions"],
          ),
        ],
        preselected: [21, 22],
        already: [],
      },
    },
    {
      itemID: 3,
      title: papers[0],
      on: true,
      tags: [
        { tag: "transformers", source: "OpenAlex", on: true },
        { tag: "machine learning", source: "Your library", on: true },
        { tag: "attention", source: "Keywords", on: false },
      ],
      suggested: [],
      coll: {
        choices: [
          coll(
            31,
            "Deep learning",
            "Methods / Deep learning",
            "high",
            0.88,
            true,
            ["neural", "attention"],
          ),
          coll(32, "NLP", "Methods / NLP", "medium", 0.6, true, [
            "translation",
          ]),
        ],
        preselected: [31, 32],
        already: [],
      },
    },
  ],
};

/* ---------- report ---------- */
const rep = (status, title, text) => ({
  itemID: (Math.random() * 1e6) | 0,
  title,
  text,
  status,
});
const report = {
  title: "RefWright — Find PDFs",
  labels: L('"report.xhtml"'),
  rows: [
    rep("ok", papers[1], "Attached PDF from Unpaywall (publisher, CC BY)"),
    rep("ok", papers[2], "Attached PDF from PubMed Central"),
    rep("ok", papers[3], "Attached PDF from Europe PMC"),
    rep(
      "warn",
      papers[4],
      "Found a PDF on arXiv; the title did not match, not attached",
    ),
    rep("ok", papers[5], "Attached PDF from Semantic Scholar"),
    rep("skip", papers[6], "Already has a PDF"),
    rep("error", papers[7], "No legal open-access copy found in 15 sources"),
    rep("ok", papers[8], "Attached PDF from CORE"),
    rep("running", papers[9], "Checking OpenAIRE…"),
    rep("pending", "Global patterns of drought recovery", ""),
  ],
};

const integrity = {
  title: "RefWright — Check retractions",
  labels: report.labels,
  rows: [
    rep("ok", papers[1], "Not retracted (PubMed, Crossref)"),
    rep(
      "error",
      "Hydroxychloroquine and azithromycin as a treatment of COVID-19",
      "Retracted 2024-12-17 (Retraction Watch). Tagged retraction:retracted",
    ),
    rep("ok", papers[2], "Not retracted (PubMed)"),
    rep(
      "warn",
      "Gut microbiota and autism spectrum disorder in children",
      "Expression of concern 2023 (Crossref). Tagged retraction:concern",
    ),
    rep("ok", papers[3], "Not retracted (Crossref)"),
    rep("skip", "Field notes, summer 2021", "No DOI or PMID"),
    rep("ok", papers[7], "Not retracted (Crossref)"),
  ],
};

/* ---------- tag manager ---------- */
const tags = [
  ["machine learning", 142],
  ["Machine Learning", 18],
  ["machine-learning", 6],
  ["ML", 4],
  ["climate change", 120],
  ["Climate Change", 22],
  ["climate-change", 3],
  ["soil carbon", 61],
  ["soil organic carbon", 14],
  ["SOC", 9],
  ["remote sensing", 58],
  ["Remote Sensing", 11],
  ["deep learning", 77],
  ["Deep learning", 13],
  ["forest ecology", 44],
  ["forests", 39],
  ["wildfire", 31],
  ["wildfires", 12],
  ["drought", 29],
  ["air pollution", 27],
  ["PM2.5", 15],
  ["epidemiology", 25],
  ["meta-analysis", 21],
  ["Meta-Analysis", 6],
  ["#todo", 3],
  ["important!!", 2],
  ["Read later ", 5],
].map(([name, count]) => ({ name, count }));
const grp = (reason, names, target) => ({
  reason,
  target,
  tags: names.map((n) => tags.find((t) => t.name === n)),
});
const tagmanager = {
  labels: L('"tagmanager.xhtml"'),
  groups: [
    grp(
      "case",
      ["machine learning", "Machine Learning", "machine-learning"],
      "machine learning",
    ),
    grp(
      "case",
      ["climate change", "Climate Change", "climate-change"],
      "climate change",
    ),
    grp("plural", ["wildfire", "wildfires"], "wildfire"),
    grp("case", ["deep learning", "Deep learning"], "deep learning"),
    grp("case", ["remote sensing", "Remote Sensing"], "remote sensing"),
    grp("case", ["meta-analysis", "Meta-Analysis"], "meta-analysis"),
  ],
  tags,
};

/* ---------- near duplicates ---------- */
const nd = (id, title, authors, year, venue, doi, attachments, preprint) => ({
  id,
  title,
  authors,
  year,
  venue,
  doi,
  attachments,
  preprint,
});
const nearDup = {
  labels: L('"nearduplicates.xhtml"'),
  groups: [
    {
      on: true,
      score: 0.93,
      reason: "preprint and published version",
      masterID: 2,
      items: [
        nd(
          1,
          "Wildfire smoke and respiratory admissions across western U.S. cities",
          "Smith et al.",
          "2022",
          "medRxiv",
          "10.1101/2022.03.11.22272250",
          1,
          true,
        ),
        nd(
          2,
          papers[2],
          "Smith et al.",
          "2023",
          "Environmental Health Perspectives",
          "10.1289/EHP11234",
          2,
          false,
        ),
      ],
    },
    {
      on: true,
      score: 0.88,
      reason: "similar title",
      masterID: 4,
      items: [
        nd(
          3,
          "Global map of root biomass in terrestrial biomes",
          "Lopez, Chen",
          "2021",
          "",
          "",
          0,
          false,
        ),
        nd(
          4,
          papers[3],
          "Lopez et al.",
          "2021",
          "Nature Ecology & Evolution",
          "10.1038/s41559-021-01485-1",
          1,
          false,
        ),
      ],
    },
    {
      score: 0.71,
      reason: "same author, similar content",
      masterID: 6,
      items: [
        nd(
          5,
          "Drought legacies in tree growth: global synthesis",
          "Anderegg et al.",
          "2015",
          "Science",
          "",
          0,
          false,
        ),
        nd(
          6,
          papers[6],
          "Anderegg et al.",
          "2015",
          "Science",
          "10.1126/science.aab1833",
          1,
          false,
        ),
      ],
    },
  ],
};

/* ---------- fixlist: health ---------- */
const row = (key, title, itemType, lines, fixable = true) => ({
  key,
  title,
  itemType,
  lines,
  fixable,
});
const health = {
  labels: L('"fixlist.xhtml"', {
    title: t("health-title"),
    confirm: t("health-confirm"),
  }),
  options: [],
  sections: [
    {
      id: "type",
      label: t("health-sec-type"),
      rows: [
        row("t1", papers[0], "webpage", ["Web Page → Conference Paper"]),
        row("t2", papers[7], "document", [
          "Document → Preprint",
          "Would drop: Publisher",
        ]),
      ],
    },
    {
      id: "doi",
      label: t("health-sec-doi"),
      rows: [
        row("d1", papers[4], "journalArticle", [t("health-doi-lookup")]),
        row("d2", papers[9], "journalArticle", [t("health-doi-lookup")]),
      ],
    },
    {
      id: "abs",
      label: t("health-sec-abs"),
      rows: [row("a1", papers[8], "journalArticle", [t("health-abs-lookup")])],
    },
    {
      id: "att",
      label: t("health-sec-att"),
      rows: [
        row("b1", "Smith_2019_supplement.pdf", "attachment", [
          t("health-att-trash"),
        ]),
      ],
    },
    {
      id: "auth",
      label: t("health-sec-auth"),
      rows: [
        row("u1", "Anderegg, W. R. L. / Anderegg, William", "", [
          "Use “Anderegg, William R. L.”",
          "in 7 items",
        ]),
      ],
    },
  ],
};

/* ---------- fixlist: preprint upgrade ---------- */
const upgrade = {
  labels: L('"fixlist.xhtml"', { title: t("upgrade-title") }),
  options: [
    { id: "pdf", label: "Replace the PDF with the published one", on: true },
  ],
  sections: [
    {
      id: "up",
      label: t("upgrade-title"),
      rows: [
        row("p1", "Scaling laws for neural language models", "preprint", [
          "arXiv:2001.08361 → Nature Machine Intelligence (2024)",
          "10.1038/s42256-024-00812-3",
        ]),
        row(
          "p2",
          "Wildfire smoke and respiratory admissions across western U.S. cities",
          "preprint",
          [
            "medRxiv → Environmental Health Perspectives (2023)",
            "10.1289/EHP11234",
          ],
        ),
        row(
          "p3",
          "Microbial necromass as a source of soil organic carbon",
          "preprint",
          [
            "bioRxiv → Nature Communications (2022)",
            "10.1038/s41467-022-31234-5",
          ],
        ),
      ],
    },
  ],
};

/* ---------- related ---------- */
const related = {
  labels: L('"related.xhtml"'),
  note: "",
  items: [
    {
      itemID: 1,
      title: papers[1],
      hits: [
        { itemID: 6, title: papers[5], score: 0.71, on: true },
        { itemID: 10, title: papers[9], score: 0.64, on: true },
        { itemID: 4, title: papers[3], score: 0.52, on: true },
        { itemID: 7, title: papers[6], score: 0.33, on: false },
      ],
    },
    {
      itemID: 3,
      title: papers[0],
      hits: [
        { itemID: 8, title: papers[7], score: 0.78, on: true },
        { itemID: 5, title: papers[4], score: 0.46, on: true },
      ],
    },
  ],
};

/* ---------- new collections ---------- */
const clusters = {
  labels: L('"collections-suggest.xhtml"'),
  note: "",
  items: [
    {
      on: true,
      name: "Urban heat",
      ids: [1, 2, 3, 4, 5, 6],
      titles: [
        papers[8],
        "Cool roofs and indoor temperatures in heat waves",
        "Tree canopy cover and land surface temperature",
        "Heat vulnerability indices: a review",
        "Night-time heat and sleep",
        "Green space and summer mortality",
      ],
    },
    {
      on: true,
      name: "Mycorrhizae",
      ids: [7, 8, 9, 10, 11],
      titles: [
        papers[9],
        "Ectomycorrhizal fungi and nitrogen uptake",
        "Arbuscular mycorrhizal networks",
        "Fungal traits along soil gradients",
        "Root–fungal carbon exchange",
      ],
    },
    {
      name: "Language models",
      ids: [12, 13, 14, 15],
      titles: [
        papers[7],
        papers[0],
        "Scaling laws for neural language models",
        "Instruction tuning with human feedback",
      ],
    },
  ],
};

export const shots = [
  {
    name: "review",
    xhtml: "review",
    script: "ui-review",
    title: "Review suggestions",
    height: 560,
    setup: setup(review, { apply: noop }),
  },
  {
    name: "report",
    xhtml: "report",
    script: "ui-report",
    title: report.title,
    height: 430,
    width: 760,
    setup: setup(report, {
      finished: "() => false",
      subscribe: "() => {}",
      cancel: "() => {}",
      select: "() => {}",
    }),
  },
  {
    name: "integrity",
    xhtml: "report",
    script: "ui-report",
    title: integrity.title,
    height: 360,
    width: 860,
    setup: setup(integrity, {
      finished: "() => true",
      subscribe: "() => {}",
      select: "() => {}",
    }),
  },
  {
    name: "tagmanager",
    xhtml: "tagmanager",
    script: "ui-tagmanager",
    title: "Tag Manager",
    height: 600,
    after:
      "[...document.querySelectorAll('#nav *')].find(e => /Duplicates/.test(e.textContent) && !e.children.length)?.click()",
    setup: setup(tagmanager, {
      load: "async () => C.tags",
      duplicates: "async () => C.groups",
      formatting:
        "(t) => t.filter(x => /^#|!!| $/.test(x.name)).map(x => ({ ...x, fixed: x.name.replace(/^#|!+$/g, '').trim().toLowerCase() }))",
      estimate: "() => ({ tags: 27, requests: 1, tokens: 900 })",
      similar: "async () => []",
      forget: "() => {}",
      merge: "async () => 0",
      undo: "async () => false",
      aiReady: "() => true",
      cancel: "() => {}",
    }),
  },
  {
    name: "nearduplicates",
    xhtml: "nearduplicates",
    script: "ui-nearDup",
    title: "Near-duplicate items",
    height: 590,
    setup: setup(nearDup, { apply: noop }),
  },
  {
    name: "health",
    xhtml: "fixlist",
    script: "ui-fixlist",
    title: "Library health",
    height: 700,
    after:
      "{ const c = [...document.querySelectorAll('input[type=checkbox]')]; [1, 2, 4, 5, 7].forEach(i => c[i]?.click()); }",
    setup: setup(health, { run: noop }),
  },
  {
    name: "upgrade",
    xhtml: "fixlist",
    script: "ui-fixlist",
    title: "Published versions of preprints",
    height: 400,
    after: "document.querySelectorAll('input[type=checkbox]')[2]?.click()",
    setup: setup(upgrade, { run: noop }),
  },
  {
    name: "related",
    xhtml: "related",
    script: "ui-related",
    title: "Related items",
    height: 400,
    after:
      "{ const r = document.querySelector('input[type=range]'); if (r) { r.value = 40; r.dispatchEvent(new Event('input')); } }",
    setup: setup(related, { apply: noop }),
  },
  {
    name: "clusters",
    xhtml: "collections-suggest",
    script: "ui-clusters",
    title: "New collections",
    height: 490,
    setup: setup(clusters, { apply: noop }),
  },
];
