---
icon: lucide/shield-alert
tags:
  - Integrity
  - Find
---

# Retractions and citations

## Retraction check

PubMed (`Retracted Publication` type) first, then Crossref, which includes Retraction Watch. DOI-only items get a PMID through a PubMed search first.

Tags: `retraction:retracted`, `retraction:none`, `retraction:check-needed`.

![Retraction check results](img/shots/integrity-light.png#only-light)
![Retraction check results](img/shots/integrity-dark.png#only-dark)

## Citation metadata check

Compares title, year, journal, volume, issue, pages and first author with Crossref. **It never changes a field.**

Tags: `citation:ok`, `citation:incomplete` (fields missing), `citation:mismatch` (often a wrong DOI), `citation:check-needed` (no DOI or Crossref unreachable).

## Report notes

Off by default. When on, items with problems get one child note tagged `refwright:report` that names each problem and its source.

## Full check

**RefWright > Full Check** runs PDF, retraction and citation checks together.
