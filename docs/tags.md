# :lucide-tags: Tags

## Methods

=== "Free"

    No AI, no key. Results go through the same cleanup and review as AI tags, and each tag shows its source.

    1. **Your library**: TF-IDF similarity against already-tagged items; the 8 nearest vote and tags carried by at least 2 are proposed. Needs 30+ tagged items (configurable). Offline.
    2. **OpenAlex** (DOI): keywords above a minimum score plus the broad subfield.
    3. **PubMed** (DOI): MeSH headings and author keywords. Biomedical only.
    4. **Crossref** (DOI): journal subjects. Often empty, off by default.
    5. **Keywords**: repeated phrases from title and abstract, only where lookups found nothing.

=== "AI"

    Item metadata goes to the provider you choose. See [AI providers](providers.md) and [Privacy](privacy.md).

## Review

Tags appear in one window per batch. Click a chip to toggle it, **×** to reject, type to add. Collection suggestions share the same window.

## Steering

Seed keywords, only-seeds mode, tag language, custom prompt, marker tag, automatic (gray) tags, skip already-tagged items.

## Cleanup

Remove slashes and odd characters, merge duplicates (case, spacing, plurals), reuse the spelling of existing library tags, letter case, separator, max tags (8), max words (4), max length (40), prefix, blacklist, replacement rules (`ML -> machine learning`).

## Learning from your edits

A tag you remove twice (net of times you kept it) stops appearing. A replacement you make twice is applied automatically. Deselecting a whole item teaches nothing. Stored in the profile, not synced.

## Tag Manager

**Tools > refwright > Tag Manager.** Nothing changes until you merge, and every change can be undone.

- **Duplicates** (local): case, plurals, typos, word order, abbreviations.
- **Formatting** (local): tags that break your cleanup rules.
- **Similar meaning** (AI): sends tag names and counts only. Shows a token estimate first.
- **All tags**: search, sort, filter, bulk rename, merge, delete.

The merge target is the most-used tag; ties go to the shorter name, then alphabetical.
