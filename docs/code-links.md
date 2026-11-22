---
icon: lucide/git-branch
tags:
  - Find
  - Integrity
  - Offline
---

# Code and data links

Right-click items > **RefWright** > **Find Code and Data Links**, or **Tools > RefWright** for the whole library.

Looks in the abstract, Extra, URL and Zotero's indexed full text for GitHub, GitLab, Bitbucket, Hugging Face, Zenodo, OSF, figshare and Dryad links (including their DOIs). Each new one becomes a link attachment, up to 6 per item, and the item is tagged `code:available` (repositories) or `data:available` (datasets).

Full text is noisy, since reference lists and cited tools have links too. A full-text link counts only when words like "available", "deposited" or "source code" sit just before it, and nothing after the reference list starts is read. Links in the abstract, Extra or URL always count.

Runs offline. Rerunning adds nothing that is already attached. The `code:` and `data:` tags are reserved, so tagging and cleanup never touch them.
