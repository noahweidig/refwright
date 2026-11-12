# Changelog

## 0.1.4

- Icons now come from Zotero's own icon set (`attachment`, `tag`, `folder`, `new-collection`), so they match the rest of Zotero and follow light and dark themes with no extra files.
- Fix the refwright submenu in the item and Tools menus: its label also carried a text value, which Fluent wrote over the submenu's contents, so it never expanded. Menu labels are attribute-only now.
- All item pane buttons now look the same; Suggest no longer has a blue primary style.
- Tag suggestions no longer include look-alikes of the status tags (for example `fulltext check-needed`).

## 0.1.3

- Fix `AbortController is not defined`: the plugin sandbox has no web APIs, so `AbortController`, `AbortSignal`, `URL`, `TextDecoder`, `TextEncoder` and `setTimeout` now come from Zotero's hidden window. This is what made Find, Suggest and the other buttons do nothing.
- Fix blank menu entries: menu labels now use Fluent's `.label` form, which Zotero's menus require. The refwright submenu in the item and Tools menus showed no options before.
- Fix black icons in dark mode: section headers, sidebar buttons and menu icons now ship light and dark variants.

## 0.1.2

- Item pane is now three sections: **Find PDFs** (status, retraction and citation badges, actions), **Tags** (inline suggestions: click to add, × to reject, Add all) and **Collections** (current collections, ranked matches you click to file, Undo).
- Every action now reports errors on screen and in the debug log instead of failing silently.
- Docs: tabs, grid cards, per-page Lucide icons, item pane screenshots.

## 0.1.1

- Fix raw string IDs (`refwright-section-row-fulltext`, `refwright-prefs-title`) showing in the item pane and settings: the plugin now loads its main-window strings as well as its own.
- Item pane: short action buttons (Find, Check, Suggest, File), tighter rows that follow Zotero's Info pane rhythm.
- Settings pane: spacing stylesheet.
- Docs workflow: separate build and deploy jobs, manual run button. Release workflow: manual run button.

## 0.1.0

- First version: PDF finder, retraction and citation checks, tagging (free and AI), Tag Manager, collection routing, write-back API.
