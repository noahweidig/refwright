---
icon: lucide/copy-check
tags:
  - Library cleanup
  - Bulk edit
---

# Duplicates

RefWright works with Zotero's own duplicate finder (same DOI or title). For items it misses, see [near-duplicate items](near-duplicates.md).

## New items

With **Check new items for duplicates** on (Settings > Duplicates), items you add are checked a few seconds after the import settles. Feed items are ignored, and only items of the same type count. The action is one of:

- **Always ask** (default): a dialog offers Keep new, Keep old or Keep all, with **Use this action by default**.
- **Keep new**: the new item is kept; the old ones are merged into it.
- **Keep old**: an existing item is kept, chosen by the master rule.
- **Keep all**: nothing is merged.

## Merge all duplicates

**Tools > RefWright > Merge All Duplicates…** merges every duplicate set in the current library. The kept item follows **Item to keep**: earliest added (default), latest added, most recently modified, or most complete (attachments, notes, filled fields). Click the progress popup to stop; you can then keep what was merged or restore the trashed items. Restoring does not move notes, tags or attachments back.

## Merging

Zotero's merge moves notes, attachments, tags, collections and relations to the kept item and trashes the others. **Smart fill** (on by default) first copies fields the kept item lacks from the duplicates.

## Not duplicates

Select two or more items, right-click > **RefWright > They Are Not Duplicates**. Marked pairs are skipped by new-item checks, Merge All and near-duplicate scans. **They Are Duplicates** removes the mark. Marks are stored by item key on this computer and do not sync; use **Export/Import non-duplicates…** in Settings to move them. Import is additive and skips pairs whose items are missing.

## Limits

- Zotero's Duplicate Items pane still lists pairs you marked; RefWright cannot filter it.
- Merges run one at a time.
- No duplicate count in the collection pane.
