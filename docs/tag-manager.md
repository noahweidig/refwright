---
icon: lucide/merge
---

# Tag Manager

**Tools > refwright > Tag Manager.** Nothing changes until you merge, rename or delete, and **Undo last change** reverses the last one.

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

!!! note

    Status tags such as `fulltext:pdf-missing` are never listed, merged or deleted.

## Scans

**Duplicates** opens at once and shows a progress bar while it scans, so Zotero stays responsive even on libraries with thousands of tags.

**Similar Meaning (AI)** shows a token estimate before it runs and sends tag names and counts only, in batches. Tags it has already checked are skipped next time; **Forget checked tags** clears that memory. If the model's reply is not valid JSON, refwright retries once in plain mode and shows the start of the reply if that fails too. Batch size and the number of requests per scan are under [Settings](settings.md).
