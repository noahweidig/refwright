---
icon: lucide/folder-input
---

# Collections

Right-click > **RefWright > File into Collections…** for one paper or many.

## Ranking

=== "Offline (default)"

    Each collection is profiled from the titles, abstracts, tags and venues of the papers in it. Score = TF-IDF similarity to the profile + nearest filed neighbours + collection-name match. No key, nothing leaves your computer.

=== "Embeddings"

    Cosine similarity between the paper and each collection, with a depth penalty. Sends the paper title and each collection's name plus the first 100 characters of its papers' titles and abstracts.

=== "LLM"

    One prompt with the paper's title and abstract plus all collection names.

If a remote method fails, RefWright falls back to offline ranking and says so.

## Adjustments

- **Ignore** collections whose name contains a word (default `inbox`): never suggested, and papers filed only there are not evidence.
- Oversized catch-all collections are down-weighted.
- A child collection is not suggested when its parent is already a strong match.
- Chips you turn off feed a per-item blacklist; **Retry** re-ranks.

## Review window

Each paper shows its top 5 suggestions as chips, best pre-selected. Hover for the matched words and the most similar papers filed there. Single-paper mode adds a search box (`/`) and a threshold slider.

## Undo

**RefWright > Undo Last Filing** reverses additions and inbox removals in one step. It survives restarts and covers the last filing only.

## Suggest new collections

**Tools > RefWright > Suggest New Collections…** proposes collections for papers that no existing collection fits. It runs offline on title, abstract, tags and journal.

1. It starts from papers that are in no collection (or only in an ignored one such as an inbox).
2. It drops every paper that an existing collection already fits, using the same offline ranking as **File into Collections…**. Those belong in that collection, not in a new one.
3. It groups the rest by topic and names each group after the phrase its titles share (for example "Wildland urban interface"), or its strongest words when no phrase is shared.

In the review window, tick the groups you want, rename them if you like, and click **Create selected**. Nothing is created until then.

- Only groups of 4 or more papers are shown, largest first, up to 30.
- If a top-level collection with the same name already exists, the papers go into it instead of making a second one.
- **Undo Last Filing** takes the papers back out of the collections. The collections themselves stay.
- If nothing is suggested, every loose paper either fits a collection you already have or does not form a group of 4. Use **File into Collections…** for the first kind.

### With AI

**Tools > RefWright > Suggest New Collections with AI…** does the same grouping, then asks your [AI provider](providers.md) to name each group.

- The grouping is still offline. The AI only names the groups, so the cost stays small: one request per 8 groups, with the titles of the first 6 papers in each group and the names of your existing collections.
- A group the model calls incoherent is dropped.
- If a group clearly belongs in a collection you already have, the model can answer with that collection's name, and the papers go into it.
- If the request fails, for example on a rate limit, the window opens with the offline names and says why.

Only titles and collection names are sent, never abstracts or PDF text. See [Privacy](privacy.md).

