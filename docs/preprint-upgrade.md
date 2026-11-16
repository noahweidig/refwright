---
icon: lucide/arrow-up-right
---

# Preprint upgrade

A paper you saved from arXiv or bioRxiv may have appeared in a journal since. **Tools > RefWright > Find Published Versions of Preprints…** checks every preprint in your library. Select preprints and use **RefWright > Find Published Version…** in the item menu to check only those.

## What counts as a preprint

An item of type *Preprint*, or one with a DOI or URL from arXiv, bioRxiv, medRxiv, OSF, SSRN, Research Square, Preprints.org or PsyArXiv, and no journal. arXiv ids in the URL or Extra work without a DOI.

## How the published version is found

1. **Crossref link.** bioRxiv and medRxiv record the journal version on the preprint. This is trusted.
2. **OpenAlex.** It merges a preprint and its journal version into one work. A different, non-preprint DOI is accepted only if the title, first author and year fit.
3. **Title and author.** A Crossref search for a journal article with a close title, the same first author and a year 0 to 4 years later.

Each row shows the journal, volume, pages, year, DOI and which step found it. A preprint with no result is not looked up again for 7 days, unless you select it yourself.

## What the upgrade does

The item is changed in place, so its notes, tags, collections, annotations and attachments stay.

- The item type becomes *Journal Article* (or *Conference Paper*).
- Title, journal, volume, issue, pages, date, ISSN and DOI come from the published record. The URL becomes the DOI link.
- The abstract is filled only if it was empty.
- Authors are replaced with the published list when it is at least as long and the first author matches.
- `Preprint DOI:` and `arXiv:` lines are added to Extra, so the preprint stays traceable.
- The item gets the tag `refwright:upgraded-from-preprint`.
- With **Also attach the final PDF** ticked, RefWright runs the normal open-access PDF search for the new DOI. The preprint PDF is kept and retitled *Preprint PDF*.

If the published version is already in your library, the row is shown but not fixable. Merge the pair with [Near-duplicate items](near-duplicates.md).

!!! warning

    The change to the item cannot be undone in one step. Read each row before ticking it. A title-and-author match is the weakest of the three.
