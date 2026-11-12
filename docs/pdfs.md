---
icon: lucide/file-down
---

# PDFs

Open-access only. Sources run in this order and stop at the first valid PDF:

1. Existing attachment (skipped; stale `fulltext:pdf-missing` and `fulltext:check-needed` tags cleared)
2. Unpaywall
3. PubMed Central
4. Europe PMC
5. Semantic Scholar
6. Crossref (open-licensed links only; follows preprint links)
7. CORE
8. OpenAIRE (only products it rates open)
9. Preprint servers: arXiv, bioRxiv, medRxiv, OSF family, PeerJ Preprints, Zenodo, Figshare
10. HAL, DOAJ, OSTI, Internet Archive Scholar
11. OpenAlex links, then hosted full text if you set a key
12. Internet Archive retry for dead links
13. Free-to-read publisher pages through Zotero's own downloader (on by default)

## Safety checks

- Bytes must start with `%PDF-` and be 10 KB to 100 MB.
- If the PDF's embedded DOI differs from the item's, it is not attached and the item gets `fulltext:check-needed`. Preprint DOIs inside a published item's PDF are tolerated.
- Title-only items match on exact normalized title and year within 1. Near matches are never accepted.

## Politeness

3 items in parallel, 400 ms pause per host, one retry on network errors and 5xx, a 429 makes that source rest for a minute. Items with no open copy are skipped for a day. Runs over 60 items ask first. Cancel stops in-flight requests.

!!! tip
**Preview PDF Sources** shows which source would supply each PDF and changes nothing.

Tags written: `fulltext:pdf-found`, `fulltext:pdf-missing`, `fulltext:check-needed`. **Tools > refwright > Export Missing PDFs** writes a CSV for interlibrary loan.
