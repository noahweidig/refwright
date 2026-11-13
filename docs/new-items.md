---
icon: lucide/inbox
---

# New items

refwright can queue the items you add, look up their PDFs, and then show tag and collection suggestions for all of them in one review window. It is off by default.

## Turn it on

**Zotero > Settings > refwright > New items**:

- **Queue new items automatically** turns the feature on.
- **Look up PDFs for queued items** runs an ordinary [Find PDFs](pdfs.md) pass on each batch. Turn it off to queue items without any lookup.

## How it works

1. You add items (a save from the browser, an import of a few papers, a pasted DOI).
2. After 20 quiet seconds, the new items join a queue. If PDF lookup is on, it runs on that batch.
3. A message tells you how many items are ready.
4. Choose **Tools > refwright > Review New Items…**. One window shows tag suggestions and collection suggestions for every queued item, the same review window used elsewhere. Tags use your [tag method](tags.md) (free sources or AI); collections use your [collection ranking](collections.md).
5. Click **Apply**. Applied items leave the queue.

Nothing is tagged or filed until you apply it. PDF lookup is the only step that runs on its own, and it works the way Find PDFs always does: it attaches a PDF only when the source checks pass.

## What gets queued

- Regular items in your own library added in the last two minutes. Items downloaded by sync keep their original date, so they are left out.
- No more than 100 at once. A bigger batch looks like an import, so refwright skips it and says so. Select the items and use the item menu instead.
- The queue is saved in your profile, so it survives a restart. Items you delete drop out of it.

!!! note

    With AI tag suggestions turned on, applying this window sends item metadata to your provider, as in [Tags](tags.md). Free sources and offline collection ranking send nothing beyond the PDF and tag lookups described in [Privacy](privacy.md).
