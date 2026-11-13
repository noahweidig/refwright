---
icon: lucide/merge
---

# Tag Manager

**Tools > RefWright > Tag Manager.** Nothing changes until you merge, rename or delete, and **Undo last change** reverses the last one.

The window follows Zotero's own layout: views in the left pane, a searchable table on the right, and the action bar at the bottom.

## Views

| View               | What it does                                                                                                         | Sends data? |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| **All Tags**       | Search, sort (most used, A to Z, least used) and filter (used once, used more than once). Click rows to select many. | no          |
| **Duplicates**     | Groups of tags that differ by case, plurals, typos, word order or abbreviation.                                      | no          |
| **Formatting**     | Tags that break your [cleanup rules](tags.md#cleanup), each with its fixed form.                                     | no          |
| **Similar Meaning (AI)** | Groups of synonyms found by your AI provider.                                                                  | tag names and counts |

## Merging and renaming

1. Select one or more tags in **All Tags**.
2. Type the target name. With one tag selected it starts as that tag's name.
3. Click **Rename** (one tag) or **Merge** (several). Items that carry any selected tag end up with the target.

In **Duplicates** and **Similar Meaning**, untick the tags you want to leave out and choose the merge target from the list. The default target is the most-used tag; ties go to the shorter name, then alphabetical.

### Merge all

**Duplicates** and **Similar Meaning (AI)** each have a **Merge all** button. It merges every group listed, using the tags currently ticked and the merge target currently chosen in each card, after asking you to confirm. Untick tags or change a target first to steer it. **Undo last change** reverses the whole Merge all at once.

A group disappears from the list as soon as you merge it, and groups drop out when their tags no longer exist.

!!! note

    Status tags such as `fulltext:pdf-missing` are never listed, merged or deleted.

## Keyboard shortcuts

Use **Cmd** on macOS and **Ctrl** on Windows and Linux. In All Tags:

| Keys                | Does                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Cmd/Ctrl + A        | selects every tag in the list, after search and filter                |
| Cmd/Ctrl + Z        | undoes the last change (the same as **Undo last change**)             |
| Cmd/Ctrl + F        | focuses the search box                                                |
| Delete or Backspace | deletes the selected tags, after a confirmation                       |
| Enter               | in the name box, renames one selected tag or merges several into it   |
| Esc                 | closes the window                                                     |

Inside a text box, Cmd/Ctrl + A and Cmd/Ctrl + Z keep their normal text behavior.

## Scans

**Duplicates** opens at once and shows a progress bar while it scans, so Zotero stays responsive even on libraries with thousands of tags.

**Similar Meaning (AI)** shows a token estimate before it runs and sends tag names only, one per line, in batches. It is built to use few tokens:

- Tags the local scan already groups (case, plurals, typos, word order, abbreviations) are sent as a single representative, and the merged group includes all of them.
- The reply is just a list of groups, capped at a few hundred tokens, and reasoning models such as `gpt-oss` are asked for low effort.
- A rate-limit error (HTTP 429 or 413) stops the scan instead of retrying, so a limit never doubles the usage.
- Tags it has already checked are skipped next time; **Forget checked tags** clears that memory.

To cut tokens further, lower **AI scan: tags per request** or raise **AI scan: only tags used at least** (for example 2 skips tags used once) under [Settings](settings.md). If the model's reply is not valid JSON, RefWright retries once in plain mode and shows the start of the reply if that fails too.
