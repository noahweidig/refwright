---
icon: lucide/heart-pulse
---

# Library health

**Tools > RefWright > Library Health Report…** scans your library and lists what needs fixing. Nothing is ticked at the start, and nothing changes until you click **Fix selected** and confirm.

## What it checks

| Section | What it finds | Fix |
| --- | --- | --- |
| Wrong item type | A document or web page with an arXiv or bioRxiv DOI or URL, a journal article with no journal, a preprint with a publisher DOI, a web page with a publisher DOI | Changes the type. Items that would lose a filled-in field are listed but not fixable, with the fields named. |
| Missing DOI | Journal articles, conference papers and preprints with no DOI in the DOI field, Extra or URL | Looks the paper up on Crossref by title, first author and year. Writes the DOI only for a confident match. |
| Missing abstract | The same types, plus theses, with an empty abstract | Fetches it from Crossref, then OpenAlex. |
| Broken attachments | A linked or stored file Zotero cannot find | Moves the attachment to the Trash. Stored files that file sync has not downloaded yet are skipped. |
| Standalone PDFs | A PDF with no parent item | Runs Zotero's own document recognizer to create the parent item. |
| Inconsistent author names | The same person written as `J. Smith`, `John Smith`, `SMITH, John` or `Jose Garcia` and `José García` | Rewrites each variant to the fullest, best-formatted form. |

## Author names

Names are grouped by family name and first initial, then by compatible given names: `J.` matches `John` and `John A.` matches `John`, but `John` does not match `Jane` and `John A.` does not match `John B.`. Institutions and single-field names are skipped. The preferred form has the most complete given name, mixed case and accents. Check each group before ticking it. Two different people can share a name.

## Safety

- Lookups use the same polite, rate-limited HTTP as the PDF finder and respect your delay setting.
- Click **Stop** to cancel a running fix. Rows already fixed stay fixed.
- Each row shows its result next to it, a tick or a reason it failed.
- Trashed attachments restore from the Trash. A retype or a rewritten name does not undo in one step.
