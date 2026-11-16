---
icon: lucide/book-open
---

# Reading queue

Right-click items > **RefWright** > **Mark as Unread / Reading / Done / Clear Reading Status**.

## Columns

Add them from the column picker (right-click the column header).

- **Reading status**: Zotero's own icons, colored. Blue book is unread, orange eye is reading, green tick is done. Sorts reading, unread, done, then untracked.
- **Read time**: estimated from the text Zotero indexed from the PDF, or the page count if the PDF is not indexed yet. Blank when neither is known. Set your speed under **Settings > Reading queue** (default 150 words per minute).
- **Relevance**: 0 to 100% for unread items. It compares each unread item with the papers in the selected collection that you are reading or have finished (or the untracked ones if you have not started any). Select the collection that is your project, then sort by this column. Runs offline.

## Next up

**Select Next Up** (item menu or **Tools > RefWright**) selects the unread item with the highest relevance in the current collection. Ties go to the shorter read.

## Where status lives

Three reserved tags: `refwright:read:unread`, `refwright:read:reading`, `refwright:read:done`. They sync with your library and are never suggested, cleaned or merged. If sync leaves more than one on an item, done beats reading beats unread.

Turn on **Mark new items as Unread** in settings to queue every new item.

## Opening a PDF starts it

When you open an Unread item's PDF in the reader, RefWright marks the item **Reading**. Items with no status, and items already Reading or Done, are left alone. Each reader tab does this once, so marking the item Unread again while the PDF stays open sticks. Turn it off with **Mark Unread items as Reading when I open their PDF** in settings. It does nothing in a library you can't edit.
