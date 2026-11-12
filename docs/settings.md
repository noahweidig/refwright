# :lucide-sliders-horizontal: Settings

**Zotero > Settings > refwright.** All preferences live under `extensions.zotero.refwright.*`.

| Group               | Options                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| General             | contact email, batch tag (default `refwright`), report note, preview only, remember misses, show column, show item pane section                              |
| PDF sources         | per-source checkboxes, Internet Archive retry, publisher pages, title lookup, fill DOI, record OpenAlex ID, OpenAlex/CORE/Semantic Scholar keys, hosted text |
| AI                  | provider, model, key, base URL, embedding provider and model, temperature, max tokens, timeout, items per request, JSON mode                                 |
| Tags                | method, free sources, review, seeds, language, prompt, marker tag, automatic tags, skip tagged                                                               |
| What the model sees | title, abstract, authors, journal, date, existing tags, DOI, PDF text and length, share library tags                                                         |
| Tag cleanup         | every rule listed in [Tags](tags.md)                                                                                                                         |
| Collections         | ranking mode, ignore words, minimum confidence, collections per paper, remove from inbox                                                                     |
| Tag Manager         | AI scan tags per request and requests per scan                                                                                                               |
| Write-back API      | enable, token (generate, copy, test)                                                                                                                         |

Hidden preferences: `concurrency` (1 to 6) and `delayMs`.
