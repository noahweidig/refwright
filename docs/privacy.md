---
icon: lucide/lock-keyhole
---

# Privacy

No accounts, no analytics, no server of ours.

| Feature                         | What leaves your computer, and where                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDFs                            | DOI, PMID, arXiv ID or title, plus your contact email and any keys you set, to the scholarly services listed in [PDFs](pdfs.md). PDF host sites see the URL only. |
| Retractions, citations          | DOI or PMID to PubMed and Crossref                                                                                                                                |
| Free tags                       | DOI only, to OpenAlex, PubMed, Crossref                                                                                                                           |
| AI tags                         | the fields you tick under _What the model sees_, to your chosen provider. PDF text is off by default.                                                             |
| Tag Manager (AI scan)           | tag names and counts only                                                                                                                                         |
| Tag Manager (local scans)       | nothing                                                                                                                                                           |
| Summaries                       | title, authors, date and abstract (or PDF text if there is no abstract) to your chosen provider                                                                   |
| Cited column                    | DOIs to OpenAlex, plus your contact email and key if set                                                                                                          |
| Related (AI), offline           | nothing                                                                                                                                                           |
| Related (AI), embeddings        | title and the first 1,000 characters of the abstract of each item, to your embedding provider                                                                     |
| Collections, offline            | nothing                                                                                                                                                           |
| Collections, embeddings or LLM  | see [Collections](collections.md)                                                                                                                                 |
| Ollama or a local custom server | nothing leaves your machine                                                                                                                                       |

The OpenAlex key is sent in an `Authorization` header and never saved on an attachment. Undo history, learned tag rules and the audit log are stored locally in your profile.
