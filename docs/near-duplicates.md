---
icon: lucide/copy
---

# Near-duplicate items

Zotero's own duplicate finder matches items with the same DOI or the same title. **Tools > refwright > Find Near-Duplicate Items…** finds the ones it misses, for example a preprint and its published version or a paper whose title changed between versions. It runs offline on title, abstract, first author and year.

## What counts as a near-duplicate

Two items are paired when they have different DOIs and different titles, and either:

- their titles are very similar (85% or more), or
- they share a first author, were published within 3 years of each other, and have similar titles or abstracts.

Pairs that chain together (A with B, B with C) become one group. Each group shows why it matched: *preprint and published version* (one item is a preprint or has a preprint-server DOI such as arXiv or bioRxiv), *similar title*, or *same author, similar content*.

## The review window

Each group lists its items with authors, year, venue, DOI, number of attachments and a **Preprint** label.

1. Choose which item to **keep** in each group. refwright pre-selects the published version with the most attachments and the most complete record.
2. Tick **Merge** on the groups you want, or use **Select all**. Nothing is ticked at the start.
3. Click **Merge selected** and confirm.

## What merging does

It uses Zotero's own merge. Notes, attachments, tags, collections and relations move to the item you keep, and the other items go to the trash. The item you keep keeps its own fields, so check that the preferred record is the one with the correct metadata. **Edit > Undo** can reverse a merge, and trashed items can be restored.

!!! warning

    Similar is not the same. Two papers by the same author with related titles can be separate papers. Look at each group before ticking it.
