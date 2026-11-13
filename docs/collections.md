---
icon: lucide/folder-input
---

# Collections

Right-click > **refwright > File into Collections…** for one paper or many.

## Ranking

=== "Offline (default)"

    Each collection is profiled from the titles, abstracts, tags and venues of the papers in it. Score = TF-IDF similarity to the profile + nearest filed neighbours + collection-name match. No key, nothing leaves your computer.

=== "Embeddings"

    Cosine similarity between the paper and each collection, with a depth penalty. Sends the paper title and each collection's name plus the first 100 characters of its papers' titles and abstracts.

=== "LLM"

    One prompt with the paper's title and abstract plus all collection names.

If a remote method fails, refwright falls back to offline ranking and says so.

## Adjustments

- **Ignore** collections whose name contains a word (default `inbox`): never suggested, and papers filed only there are not evidence.
- Oversized catch-all collections are down-weighted.
- A child collection is not suggested when its parent is already a strong match.
- Chips you turn off feed a per-item blacklist; **Retry** re-ranks.

## Review window

Each paper shows its top 5 suggestions as chips, best pre-selected. Hover for the matched words and the most similar papers filed there. Single-paper mode adds a search box (`/`) and a threshold slider.

## Undo

**refwright > Undo Last Filing** reverses additions and inbox removals in one step. It survives restarts and covers the last filing only.

## Suggest new collections

**Tools > refwright > Suggest New Collections…** looks at papers that are in no collection (or only in an ignored one such as an inbox) and groups them by topic. It runs offline on title, abstract, tags and journal.

- Each suggested group has a name taken from its strongest words, which you can edit, and a list of its papers.
- Only groups of 4 or more papers are shown, largest first, up to 30.
- Tick the groups you want, or use **Select all**, then **Create selected**. Nothing is created until then.
- If a top-level collection with the same name already exists, the papers go into it instead of making a second one.
- **Undo Last Filing** takes the papers back out of the collections. The collections themselves stay.

