---
icon: lucide/plug-zap
---

# Write-back API

Lets another local program add or remove tags through Zotero's local server (`127.0.0.1`). **Off by default.**

## Setup

1. Zotero > Settings > Advanced: enable **Allow other applications on this computer to communicate with Zotero**.
2. refwright settings: enable the API, **Generate** a token.
3. Send `Authorization: Bearer <token>`.

## Endpoints

| Endpoint           | Method | Does                                  |
| ------------------ | ------ | ------------------------------------- |
| `/refwright/ping`  | GET    | capabilities                          |
| `/refwright/tag`   | POST   | add or remove tags; supports `dryRun` |
| `/refwright/audit` | GET    | newest 500 log entries                |
| `/refwright/undo`  | POST   | reverse one recorded write by `id`    |

```bash
curl -X POST http://127.0.0.1:23119/refwright/tag \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dryRun":true,"items":[{"key":"ABCD1234","add":["GRADE:high"]}]}'
```

## Allowed tag prefixes

`fulltext:`, `retraction:`, `citation:`, `refwright:`, `GRADE:`, `RoB2:`, `ROBINS-I:`, `Quality:`. Anything else is refused, even with a valid token.

View or clear the log under **Tools > refwright > Write-back Audit Log**. Clearing it changes no tags.
