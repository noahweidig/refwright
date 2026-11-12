---
icon: lucide/bot
---

# AI providers

Each provider keeps its own key, model and base URL. **Test connection** loads the live model list.

| Provider                   | Default model         | Chat | Embeddings |
| -------------------------- | --------------------- | ---- | ---------- |
| OpenAI                     | `gpt-4o-mini`         | yes  | yes        |
| Anthropic                  | `claude-haiku-5-5`    | yes  | no         |
| Google Gemini              | `gemini-3.6-flash`    | yes  | yes        |
| DeepSeek                   | `deepseek-chat`       | yes  | no         |
| OpenRouter                 | `openai/gpt-4o-mini`  | yes  | no         |
| Cohere                     | `command-r7b-12-2024` | yes  | yes        |
| Custom (OpenAI-compatible) | your choice           | yes  | yes        |
| Ollama (local)             | `llama3.2`            | yes  | yes        |

Custom works with LM Studio, vLLM, Groq and similar; the key is optional. Ollama uses `http://127.0.0.1:11434/v1` and needs no key.

Keys are stored in Zotero prefs and sent only to the provider's base URL.
