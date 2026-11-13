---
icon: lucide/sparkles
---

# Summaries and related items

Three extras that use your library's metadata. Summaries and related items use an AI provider you set up under [AI providers](providers.md); the citation column uses OpenAlex only.

## Summarize with AI

Right-click items, then **RefWright > Summarize with AI…**.

- Each item gets a child note titled **AI summary** with one paragraph of about 4 sentences: the question, the method, the main result and the main limitation if the text states one.
- The source is the abstract. If the item has none, RefWright uses the PDF's text instead (length set by *What the model sees*).
- Items that already have an AI summary note are skipped, so running it again never duplicates or overwrites a note. Notes written before 0.4.5 were titled "refwright summary"; they count too.
- Items with no abstract and no PDF are skipped. The final message counts added, skipped and failed items.
- More than 20 items ask for confirmation first. The summary language follows your tag language setting.

!!! warning

    Summaries are written by a language model from the text it is given. Read the abstract before you rely on one.

## Cited and OA columns

The **Cited** column shows how many works cite each item, and the **OA** column shows its open-access status (gold, green, hybrid, bronze, diamond or closed), both from [OpenAlex](https://openalex.org). Both sort.

1. Show the columns: right-click the item list header and tick **Cited** and **OA** (restart Zotero once after installing).
2. Fill them: right-click items and choose **RefWright > Update Citations and Open Access**, or use **Tools > RefWright > Update Citations and Open Access for Library**.

Both come from the same request, looked up by DOI, 50 at a time, and cached on your computer. Items without a DOI stay blank, and the result message tells you how many were not found. Values do not change until you update them again.

## Related (AI)

The **Related (AI)** section of the item pane suggests other items in the same library that cover similar ground.

1. Select an item and click **Find related**.
2. Click a suggestion to link both items in Zotero's own **Related** field, or click **Link all** to link every suggestion at once. **Dismiss** clears the list. Items that are already linked are not suggested. Hovering a suggestion shows its similarity score.

Choose how similarity is measured under **Settings > Related items**:

=== "Offline (default)"

    Compares the title (weighted double), abstract, tags and journal of every item in the library on your computer. No key, nothing leaves your machine, and it works with any provider setup, including ones with no embeddings endpoint such as Groq.

=== "Embeddings"

    Embeds the title and the start of the abstract of every item with your embedding provider. The first run takes a while on large libraries and can hit free-tier rate limits; progress is saved, so a stopped run resumes. If the provider fails, RefWright shows offline matches and says why. Embeddings are cached in the plugin's state file in your profile.

Choose the embedding provider under [AI providers](providers.md); not every provider offers embeddings.

### Many items at once

Select several items, right-click, then **RefWright > Find Related Items…**.

1. A review window lists each selected item with up to 5 suggestions as chips. Each chip shows its similarity score.
2. Drag **Select suggestions at or above** to tick every suggestion at or above that score, or tick chips one by one. **Select none** clears everything.
3. Click **Link selected**. Nothing is linked until you do.

Scores depend on the similarity method, so offline scores run lower than embedding scores. Look at a few suggestions before choosing a threshold.
