import { assert } from "chai";
import { config } from "../package.json";

const P = config.prefsPrefix;
const win = () => Zotero.getMainWindow();

describe("refwright", function () {
  describe("startup", function () {
    it("should have plugin instance defined", function () {
      assert.isNotEmpty(Zotero[config.addonInstance]);
    });

    it("is initialized and alive", function () {
      const d = Zotero[config.addonInstance].data;
      assert.isTrue(d.initialized);
      assert.isTrue(d.alive);
    });

    it("exposes hooks", function () {
      const h = Zotero[config.addonInstance].hooks;
      for (const k of ["onStartup", "onShutdown", "onMainWindowLoad"])
        assert.isFunction(h[k], k);
    });
  });

  describe("prefs", function () {
    it("registers defaults", function () {
      assert.strictEqual(Zotero.Prefs.get(`${P}.batchTag`, true), "refwright");
      assert.strictEqual(Zotero.Prefs.get(`${P}.concurrency`, true), 3);
      assert.strictEqual(
        Zotero.Prefs.get(`${P}.writeBackEnabled`, true),
        false,
      );
      assert.strictEqual(Zotero.Prefs.get(`${P}.previewOnly`, true), false);
    });

    it("ships no API keys by default", function () {
      for (const k of [
        "ai.openai.key",
        "ai.anthropic.key",
        "key.core",
        "key.s2",
      ])
        assert.strictEqual(Zotero.Prefs.get(`${P}.${k}`, true), "", k);
    });

    it("round-trips a pref", function () {
      const k = `${P}.delayMs`;
      const old = Zotero.Prefs.get(k, true);
      Zotero.Prefs.set(k, 777, true);
      assert.strictEqual(Zotero.Prefs.get(k, true), 777);
      Zotero.Prefs.set(k, old, true);
    });
  });

  describe("chrome resources", function () {
    it("load from chrome://", async function () {
      const files = [
        "content/refwright.css",
        "content/prefs.css",
        "content/review.xhtml",
        "content/report.xhtml",
        "content/tagmanager.xhtml",
        "content/related.xhtml",
        "content/nearduplicates.xhtml",
        "content/fixlist.xhtml",
        "content/scripts/ui-review.js",
        "content/icons/favicon.png",
      ];
      for (const f of files) {
        const r = await win().fetch(`chrome://${config.addonRef}/${f}`);
        assert.isTrue(r.ok, f);
      }
    });
  });

  describe("locale", function () {
    it("resolves ftl strings", async function () {
      const L = new (win() as any).Localization(
        [`${config.addonRef}-addon.ftl`],
        true,
      );
      const [msg] = L.formatMessagesSync([
        { id: `${config.addonRef}-progress-title` },
      ]);
      assert.isOk(msg?.value);
    });
  });

  describe("ui registration", function () {
    it("adds menu items to the main window", function () {
      const doc = win().document;
      assert.isNotNull(
        doc.querySelector(`[id*="${config.addonRef}"]`),
        "no element with refwright id in main window",
      );
    });

    it("keeps the library usable (items tree present)", function () {
      assert.isNotNull(win().document.getElementById("zotero-items-tree"));
    });
  });

  describe("library operations", function () {
    it("can create and trash an item without errors", async function () {
      const item = new Zotero.Item("journalArticle");
      item.setField("title", "RefWright CI probe");
      item.setField("DOI", "10.1000/xyz123");
      const id = await item.saveTx();
      assert.isAbove(id, 0);
      const got = Zotero.Items.get(id);
      assert.strictEqual(got.getField("title"), "RefWright CI probe");
      await got.eraseTx();
    });
  });
});
