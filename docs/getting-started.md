---
icon: lucide/rocket
---

# Getting started

## Install

Download the `.xpi` from the latest release, then in Zotero: **Tools > Plugins > gear icon > Install Plugin From File**.

## First run

1. Open **Zotero > Settings > RefWright** and enter a contact email. It goes to Unpaywall, NCBI, Europe PMC, Crossref and OpenAlex, as their polite-use rules ask.
2. Select items, right-click, **RefWright > Find PDFs**.
3. Results appear in one progress window. Double-click a row to jump to the item.

## Where things are

| Place                         | What                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| Item right-click > RefWright  | PDF, retraction, citation, tag, summary and collection actions  |
| Collection right-click        | Suggest tags for the whole collection                           |
| Tools > RefWright             | Tagged-batch runs, Tag Manager, citation counts, CSV export, audit log, settings |
| Item list column `RefWright`  | `PDF`, `No PDF`, `Check`, `⚠ Retracted` (sortable)              |
| Item list column `Cited`      | OpenAlex citation count (sortable)                              |
| Item pane sections            | PDFs, tags, related (AI) and collections, with per-item buttons |

## Status tags

RefWright writes `fulltext:`, `retraction:`, `citation:` and `refwright:` tags. Tagging, cleanup and the Tag Manager never touch them.
