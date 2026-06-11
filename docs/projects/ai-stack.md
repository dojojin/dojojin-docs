---
title: AI Stack (Local LLM)
description: Self-hosted local LLM infrastructure — Ollama, Open WebUI, SearXNG, and Continue.dev running entirely on-premise with a consumer GPU. No cloud subscriptions. No data leaves the machine.
---

# AI Stack — Self-Hosted Local LLM Infrastructure

A fully self-hosted AI inference stack running on consumer GPU hardware. All computation happens locally — no API keys, no usage fees, no data transmitted to external services.

The stack is built around [Ollama](https://ollama.com) as the inference engine and assembles purpose-fit tools on top: a web chat interface, a metasearch layer for web-augmented answers, a coding assistant integrated directly into the editor, and a model selection strategy tuned to the hardware limits of a 6 GB VRAM GPU.

---

## Why Self-Hosted

| Factor | Cloud API | This Stack |
|---|---|---|
| Privacy | Prompts leave your machine | All inference on-premise |
| Cost | Per-token billing, ongoing | One-time hardware; no API fees |
| Availability | Depends on vendor uptime | Works offline |
| Model control | Provider decides what runs | Full control over model choice |
| Response speed | Network RTT + queue | Local GPU, no network hop |

This stack was built for daily use as a developer tool — chat, code completion, document analysis, and web-augmented research — without ongoing subscription overhead.

---

## Architecture

Four services, one GPU:

```
  ┌──────────────────────────────────────────────────┐
  │              Ollama (host systemd)                │
  │              127.0.0.1:11434                      │
  │         LLM engine · RTX 3060 Laptop 6 GB        │
  └──────┬──────────────────┬────────────────┬───────┘
         │ HTTP /api/*       │                │
         ▼                   ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  Open WebUI  │  │ Continue.dev │  │  SearXNG     │
  │  :3000       │  │ VS Code /    │  │  :8888 host  │
  │  (container) │  │ JetBrains    │  │  :8080 net   │
  └──────┬───────┘  └──────────────┘  └──────┬───────┘
         │                                    │ search
         └────────────────────────────────────┘
                    search results → prompt
```

**Ollama** runs on the host as a systemd service so it has direct access to the GPU without container passthrough complexity. All other components reach it over `localhost:11434`.

**Open WebUI** runs in a [Podman](https://podman.io) container (Quadlet, systemd-managed). It provides a ChatGPT-style web interface, manages conversation history, handles RAG document uploads, and orchestrates web search by calling SearXNG internally.

**SearXNG** is a self-hosted metasearch engine. When web search is enabled in Open WebUI, SearXNG queries multiple public search engines, aggregates the results, and returns snippets that are injected directly into the LLM prompt — no embedding or vector retrieval is needed for web context.

**Continue.dev** is a VS Code / JetBrains extension. It connects directly to Ollama (`127.0.0.1:11434`) and provides inline code completion and chat within the editor.

---

## Models

Model selection is constrained by the hardware: RTX 3060 Laptop with **6 GB VRAM**. A model must fit in VRAM (weights + KV-cache) to run at interactive speed. Exceeding this causes Ollama to offload layers to RAM, which degrades throughput significantly.

Practical ceiling for interactive use: **Q4 weights ≤ ~5.5 GB**.

### Installed Models

| Model | Size (Q4) | Task | VRAM fit | Notes |
|---|---|---|---|---|
| `qwen2.5-coder:7b` | ~4.7 GB | Code chat, review, generation | ✅ Full GPU | Primary coding model — top-tier performance in its class for ≤6 GB hardware |
| `qwen2.5-coder:3b` | ~2.0 GB | Editor autocomplete | ✅ Full GPU | Fast enough for keystroke-latency completion; same family as 7b for consistency |
| `qwen3:4b` | ~2.5 GB | General purpose, Thai language | ✅ Full GPU | Replaces qwen2.5:7b — newer architecture, thinking mode, better multilingual |
| `gemma3:4b` | ~3.3 GB | Multimodal (image + text) | ✅ Full GPU (~2.9 GB) | Used by the model router for image inputs; Google's compact vision model |
| `deepseek-r1:7b` | ~5.1 GB | Reasoning, logic, math | ⚠️ 91% GPU / 9% CPU | Slightly over the ceiling; minor layer offload is acceptable for reasoning workloads where speed is secondary |
| `bge-m3` | ~1.2 GB | Embedding (RAG, semantic search) | ✅ Full GPU | 1024-dimension multilingual embeddings; used for document Knowledge in Open WebUI |

### Model Router

Open WebUI runs a lightweight model router pipe that auto-selects the right backend model based on the user's message:

- Message contains an image → `gemma3:4b`
- Message contains code patterns → `qwen2.5-coder:7b`
- Otherwise → `qwen3:4b`

The task model (used for title generation and search query construction) is fixed to `qwen2.5-coder:3b` — fast, no thinking mode, minimal VRAM when the main model is already loaded.

### Why Qwen2.5-Coder

At the 7B parameter scale with Q4 quantization, `qwen2.5-coder` consistently performs at the top of public coding benchmarks for models that fit in consumer VRAM. It supports Fill-In-the-Middle (FIM), making it suitable for both autocomplete and full-context chat. The 3B variant of the same family provides the same tokenizer and style at lower latency for the editor — no context inconsistency between completion and chat models.

### Why Qwen3:4b for General Use

`qwen3:4b` is newer than `qwen2.5:7b` and fits fully in VRAM at Q4, leaving headroom for context. Its key advantage for this use case is the **thinking mode** (`/think` directive), which enables multi-step reasoning on demand while defaulting to fast single-pass responses via `/no_think`. It handles Thai-language input at an adequate level for general use; for translation-heavy workloads, a dedicated Thai translation model is the preferred alternative.

### Why DeepSeek-R1:7b for Reasoning

DeepSeek-R1 applies reinforcement learning to improve performance on logical reasoning, mathematical problems, and structured multi-step tasks. The 7B variant slightly exceeds the 6 GB ceiling (minor offload), which is acceptable because reasoning workloads are not latency-sensitive — a correct answer in 30 seconds is more useful than a fast incorrect one.

---

## Key Capabilities

### Offline Chat

The full inference stack functions without internet connectivity. Ollama serves models from local storage; Open WebUI provides the interface. This is useful for sensitive document analysis, working in environments with restricted connectivity, or simply avoiding cloud API availability dependencies.

### Web-Augmented Chat (SearXNG)

When the web search toggle is enabled in Open WebUI, SearXNG queries multiple public search engines in parallel, extracts result snippets, and injects them into the LLM's context window before generating a response. The LLM receives current information without needing knowledge base updates or fine-tuning.

**Configuration used:**
- Bypass web loader: on (use snippets, not full-page fetch)
- Bypass embedding and retrieval: on (direct context injection, not vector lookup)
- Result count: 5
- Language: all

### Document Knowledge (RAG)

Documents uploaded to Open WebUI's Knowledge system are chunked, embedded with `bge-m3`, and stored in a local vector database. Relevant chunks are retrieved at query time and injected into context. `bge-m3`'s multilingual embedding space handles Thai and English documents in the same index.

### Code Assistance (Continue.dev)

Continue.dev integrates Ollama models directly into VS Code and JetBrains editors:

- **Tab completion** — `qwen2.5-coder:3b` provides single-line and multi-line completions as you type, using FIM prompting
- **Inline chat** — select code and ask questions or request refactors; routed to `qwen2.5-coder:7b`
- **File context** — Continue can attach open files and the current codebase directory to the prompt

All editor requests go directly to `127.0.0.1:11434` — no traffic leaves the machine.

### Multimodal Input

Open WebUI's model router automatically routes image-containing messages to `gemma3:4b`. Supported input: drag-and-drop or paste image directly into the chat. Typical use cases: diagram explanation, screenshot analysis, OCR-style description of image content.

---

## Remote Access

The stack is accessible from outside the local network through a Cloudflare Tunnel:

```
Browser / Mobile → ai.dojojin.tech → Cloudflare Access (authentication required)
                                    → Cloudflare Tunnel → Open WebUI :3000
```

**Cloudflare Access** gates the endpoint — only authenticated users (owner email) can reach the interface. No inbound firewall ports are opened; the tunnel is outbound-only from the server.

This means the full AI stack is accessible from a mobile browser or any device on the internet, through the same interface as local access, with session authentication provided by Cloudflare.

Ollama's API endpoint (`/api/*`) is not exposed externally — only the Open WebUI interface is tunneled.

---

## Infrastructure

**Operating system:** Bazzite (Fedora Atomic / immutable Linux, KDE Plasma 6 Wayland)

**GPU:** NVIDIA RTX 3060 Laptop, 6 GB GDDR6

**CPU / RAM:** AMD Ryzen 7 5800H, 35 GB RAM

**Container runtime:** Podman with Quadlet (systemd-native container management; no Docker daemon)

| Service | Run as | Managed by |
|---|---|---|
| Ollama | systemd service (host) | `/etc/systemd/system/ollama.service` |
| Open WebUI | Podman container | `/etc/containers/systemd/openwebui.container` |
| SearXNG | Podman container | `/etc/containers/systemd/searxng.container` |
| Continue.dev | VS Code / JetBrains extension | Editor-managed |

Both Podman containers share a dedicated internal network (`ai-stack`). Open WebUI reaches Ollama via `host.containers.internal` (host-gateway alias). SearXNG is accessible to Open WebUI by container name within the network and to the host at `127.0.0.1:8888` for manual testing.

---

## Roadmap

- **Phase C — OpenClaw agent:** a local AI agent with tool access (shell, file system, browser) using Ollama as the reasoning backend; runs with a strict allowlist to limit blast radius
- **Phase D — Telegram integration:** command the agent from mobile via Telegram bot; connect cloud API (Anthropic) as a fallback brain for tasks that exceed local model capability
- **ChindaMT-4B:** a Thai-English translation model specialized for this language pair; pending the `.gguf` file
