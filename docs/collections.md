# :lucide-folder-input: Collections

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
