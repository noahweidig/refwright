---
icon: lucide/sparkles
---

# Summaries and related items

Three extras that use your library's metadata. Summaries and related items use an AI provider you set up under [AI providers](providers.md); the citation column uses OpenAlex only.

## Summarize with AI

Right-click items, then **refwright > Summarize with AI…**.

- Each item gets a child note titled **refwright summary** with one paragraph of about 4 sentences: the question, the method, the main result and the main limitation if the text states one.
- The source is the abstract. If the item has none, refwright uses the PDF's text instead (length set by *What the model sees*).
- Items that already have a refwright summary are skipped, so running it again never duplicates or overwrites a note.
- Items with no abstract and no PDF are skipped. The final message counts added, skipped and failed items.
- More than 20 items ask for confirmation first. The summary language follows your tag language setting.

!!! warning

    Summaries are written by a language model from the text it is given. Read the abstract before you rely on one.

## Cited column

The **Cited** column shows how many works cite each item, from [OpenAlex](https://openalex.org). It sorts numerically.

1. Show the column: right-click the item list header and tick **Cited** (restart Zotero once after installing).
2. Fill it: right-click items and choose **refwright > Update Citation Counts**, or use **Tools > refwright > Update Citation Counts for Library**.

Counts are looked up by DOI, 50 at a time, and cached on your computer. Items without a DOI stay blank, and the result message tells you how many were not found. Counts do not change until you update them again.

## Related (AI)

The **Related (AI)** section of the item pane suggests other items in the same library that cover similar ground.

1. Select an item and click **Find related**.
2. The first run embeds the title and the start of the abstract of every item in the library with your embedding provider. This takes a while on large libraries and can hit free-tier rate limits. Progress is saved, so a stopped run resumes.
3. Click a suggestion to link both items in Zotero's own **Related** field. Items that are already linked are not suggested.

Embeddings are cached in the plugin's state file in your profile. Hovering a suggestion shows its similarity score. Choose the embedding provider under [AI providers](providers.md); not every provider offers embeddings.
