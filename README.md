# PenceAI

PenceAI is a self-hosted, local-first AI agent platform built with TypeScript. It brings together multi-provider LLM access, short- and long-term memory management, graph-assisted context retrieval, cognitive memory patterns, a web interface, a gateway layer, and automated tests in a single codebase.

This repository is designed as a practical engineering foundation for AI agent experiments and product-oriented development. It combines chat-based agent execution, memory extraction, semantic recall, conversation summarization, background tasks, and observable retrieval flows inside one cohesive system.

## Overview

The primary goal is to provide more than a simple chatbot. PenceAI is structured as an agent runtime that can retain conversational context, distinguish between memory types, shift into more deliberate reasoning when needed, and behave more consistently over time.

Core capabilities include:

- Agent runtime and tool-calling loop
- Episodic and semantic memory separation
- SQLite-based memory and conversation storage
- Embedding-powered semantic search and graph relationships
- Cognitive signals such as cognitive load, priming, and spreading activation
- Experimental decision mechanisms including reconsolidation and dual-process routing
- WebSocket-based web UI and gateway server
- Jest-based test infrastructure
- Hook Execution Engine for tool call lifecycle security
- Context Compaction for automatic token budget management
- LLM Prompt Cache for zero-cost repeated queries
- **[NEW] Containerized Deployments via Docker and Docker Compose**

## Key Features

- **End-to-end TypeScript architecture:** Agent, gateway, memory, router, web, and test layers share one language and type system.
- **Agent runtime + tool loop:** [`AgentRuntime`](src/agent/runtime.ts) manages reasoning, tool calls, observations, and response generation in a unified flow.
- **Cognitive memory layer:** [`MemoryManager`](src/memory/manager/index.ts) coordinates conversation history, long-term memory, retrieval orchestration, and maintenance routines.
- **Episodic / semantic memory separation:** Memories are treated not only by content, but also by their functional role.
- **GraphRAG (Graph-based Retrieval Augmented Generation):** [`src/memory/graphRAG/`](src/memory/graphRAG/) provides graph-aware retrieval with PageRank scoring, community detection, community summarization, and **deterministic RAG patterns** (Evaluation Gate, Phrase Bonus Scoring) for high-reliability memory recall.
- **MCP (Model Context Protocol) integration:** [`src/agent/mcp/`](src/agent/mcp/) implements extensible tool ecosystem with 18+ modules including marketplace, security layer, event bus, and unified registry.
- **Docker Ready:** Built-in multi-stage `Dockerfile` and `docker-compose.yml` to effortlessly deploy on Windows, Mac, or Linux without OS-level C++ compilation issues.
- **Background job queue:** Persistent workflows support memory maintenance, embedding backfill, summarization, and deeper extraction tasks.
- **Web interface + gateway:** An HTTP/WebSocket server works together with a React-based client with React Query for data fetching and state management.
- **Multi-provider LLM integration:** Adapters are available for OpenAI, Anthropic, Groq, Mistral, Ollama, NVIDIA, GitHub, and other providers.
- **Observability & cost tracking:** Custom local metrics system provides token usage tracking and cost estimation natively across all 8 providers without external dependencies.
- **Multi-channel support:** Telegram, Discord, and WhatsApp channel integrations for broader accessibility.
- **Token usage analytics:** Real-time cost calculation with provider/model-specific pricing via [`costCalculator.ts`](src/utils/costCalculator.ts).

## Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Server:** Express + WebSocket
- **Database:** SQLite / `better-sqlite3`
- **Vectors:** `sqlite-vec` for embedding storage
- **Infrastructure:** Docker & Docker Compose
- **MCP:** `@modelcontextprotocol/sdk` for Model Context Protocol
- **Observability:** Built-in local metrics and tracing system
- **Embeddings:** `@xenova/transformers` (ONNX) + provider-backed embedding layers
- **Frontend:** React + Vite
- **State Management:** Zustand + React Query
- **Testing:** Jest + Playwright + Testing Library
- **Logging:** Pino

## Prerequisites

| Requirement | Docker | Manual |
|---|---|---|
| **Node.js** ≥ 22 | Not needed on host | Required |
| **npm** | Not needed on host | Required |
| **Python 3 + C++ build tools** | Not needed on host | Required (for `better-sqlite3`, `sqlite-vec`) |
| **Docker** | Required | Not needed |

> **Windows users:** Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload) before `npm install` if you see native compilation errors.
>
> **Linux users:** `sudo apt install build-essential python3` (Debian/Ubuntu) or equivalent.

## Setup & Deployment

### Quick Start (One Command)

The easiest way to get started — the setup script handles everything automatically:

| OS | Command |
|---|---|
| **Windows** | `scripts\setup.ps1` |
| **Linux / macOS** | `bash scripts/setup.sh` |

```bash
git clone <repo-url> && cd PenceAI

# Windows (PowerShell)
scripts\setup.ps1

# Linux / macOS
bash scripts/setup.sh
```

The setup script will:
1. Check Node.js ≥ 22 is installed
2. Install all dependencies (root + frontend)
3. Create your `.env` file from `.env.example`
4. Prompt you to choose an LLM provider and enter your API key
5. Build the project (TypeScript + Vite frontend)
6. Show you how to start the application

If you prefer **Docker** (no Node.js needed on host), see Method 1 below.

### Method 1: Docker Compose (Recommended without Node.js)

Using Docker avoids native C++ compilation issues (`better-sqlite3`, `sqlite-vec`) and provides an isolated runtime that works the same on every OS.

```bash
# 1. Clone the repository
git clone <repo-url> && cd PenceAI

# 2. Create your .env from the example
cp .env.example .env

# 3. Edit .env — at minimum, set an LLM API key
#    Example: OPENAI_API_KEY=sk-...
nano .env   # or use any editor

# 4. Build and start
docker compose up -d --build
```

Access the dashboard at **http://localhost:3001**

The database is persistently stored in `./data` on the host, so it survives container restarts.

Common Docker commands:
```bash
docker compose up -d --build    # Build & start
docker compose down             # Stop & remove
docker compose logs -f          # Follow logs
docker compose restart           # Restart
```

> **Connection troubleshooting:** If you can't reach http://localhost:3001, make sure `HOST=0.0.0.0` is set in your `.env` file. The default is `0.0.0.0` (listens on all interfaces). Setting `HOST=localhost` inside Docker will prevent external access.

### Method 2: Manual Node.js Setup

```bash
# 1. Clone the repository
git clone <repo-url> && cd PenceAI

# 2. Install root dependencies (includes devDependencies needed for build)
npm install

# 3. Install frontend dependencies
cd src/web/react-app && npm install && cd ../..

# 4. Create your .env from the example
cp .env.example .env

# 5. Edit .env — at minimum, set an LLM API key
nano .env

# 6a. Development (hot-reload backend + frontend):
npm run dev

# 6b. OR — Production build + run:
npm run build
npm start
```

Development mode starts both the backend (port 3001) and the frontend dev server (port 5173) concurrently. The frontend proxies `/api` and `/ws` requests to the backend automatically.

Production mode serves the pre-built frontend from `dist/web/public` on port 3001.

## Environment Variables

Create your `.env` file by copying `.env.example`:

```bash
cp .env.example .env
```

### Required for functionality

At least **one** LLM API key must be set. The `DEFAULT_LLM_PROVIDER` determines which one is used:

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI (default provider) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `MINIMAX_API_KEY` | MiniMax |
| `NVIDIA_API_KEY` | NVIDIA |
| `GITHUB_TOKEN` | GitHub Models |
| `OLLAMA_BASE_URL` | Local Ollama (default: `http://localhost:11434`) |

### Common settings

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind address (`0.0.0.0` for all interfaces) |
| `PORT` | `3001` | Server port |
| `DB_PATH` | `./data/penceai.db` | SQLite database path |
| `DEFAULT_LLM_PROVIDER` | `openai` | Active LLM provider |
| `DEFAULT_LLM_MODEL` | `gpt-4o` | Default model name |
| `EMBEDDING_PROVIDER` | `openai` | Embedding provider (`openai`, `minimax`, `voyage`, `none`) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `error`) |
| `DASHBOARD_PASSWORD` | — | Password protect the web dashboard |

> **Important:** Never commit real API keys or passwords to the repository.

<details>
<summary>Full variable list</summary>

#### Server
- `PORT` — Server port (default: 3001)
- `HOST` — Bind address (default: 0.0.0.0)
- `DB_PATH` — SQLite database file path (default: ./data/penceai.db)

#### LLM Providers
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `MINIMAX_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_TOKEN`
- `DEFAULT_LLM_PROVIDER` — One of: `openai`, `anthropic`, `ollama`, `minimax`, `github`, `groq`, `mistral`, `nvidia`
- `DEFAULT_LLM_MODEL` — Model name (default: `gpt-4o`)
- `OLLAMA_BASE_URL` — Ollama server URL (default: `http://localhost:11434`)
- `ENABLE_OLLAMA_TOOLS` — Enable Ollama tool calling (default: false)
- `ENABLE_NVIDIA_TOOLS` — Enable NVIDIA tool calling (default: false)

#### Embedding
- `EMBEDDING_PROVIDER` — `openai`, `minimax`, `voyage`, `none` (default: `openai`)
- `EMBEDDING_MODEL` — Embedding model (default: `text-embedding-3-small`)
- `VOYAGE_API_KEY` — Voyage API key

#### Messaging Channels
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`
- `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_USERS`
- `WHATSAPP_ENABLED`

#### Security
- `ALLOW_SHELL_EXECUTION` — Enable shell command execution (default: false)
- `SHELL_TIMEOUT` — Shell command timeout in ms (default: 30000)
- `FS_ROOT_DIR` — Root directory for file operations
- `DASHBOARD_PASSWORD` — Password for web dashboard
- `BRAVE_SEARCH_API_KEY` — Brave Search API key
- `SENSITIVE_PATHS` — Comma-separated protected paths

#### Application Behavior
- `SYSTEM_PROMPT` — Custom system prompt override
- `AUTONOMOUS_STEP_LIMIT` — Max autonomous reasoning steps (default: 5)
- `MEMORY_DECAY_THRESHOLD` — Memory decay days (default: 30)
- `SEMANTIC_SEARCH_THRESHOLD` — Similarity threshold (default: 0.7)
- `LOG_LEVEL` — `debug`, `info`, `error` (default: `info`)
- `DEFAULT_USER_NAME` — Default user display name

#### MCP (Model Context Protocol)
- `ENABLE_MCP` — Enable MCP (default: true)
- `MCP_SERVERS` — JSON array of MCP server configs
- `MCP_TIMEOUT` — Timeout in ms (default: 30000)
- `MCP_MAX_CONCURRENT` — Max parallel MCP calls (default: 5)
- `MCP_LOGGING` — Enable MCP logging (default: true)

#### Hook Execution Engine
- `ENABLE_HOOKS` — Enable hooks (default: true)
- `HOOK_SECURITY_MONITOR` — Path traversal & secret detection (default: true)
- `HOOK_OUTPUT_SANITIZER` — API key masking (default: true)
- `HOOK_CONSOLE_LOG_DETECTOR` — `ask`, `approve`, `block` (default: ask)
- `HOOK_OBSERVATION_CAPTURE` — Log tool calls (default: true)
- `HOOK_DEV_SERVER_BLOCKER` — Block dev server commands (default: true)
- `HOOK_CONTEXT_BUDGET_GUARD` — Compaction enforcement (default: true)
- `HOOK_SESSION_SUMMARY` — Session end metrics (default: true)

#### Context Compaction
- `COMPACT_ENABLED` — Enable automatic context compaction (default: true)
- `COMPACT_TOKEN_THRESHOLD` — Token threshold to trigger compaction (default: 100000)
- `COMPACT_PRESERVE_RECENT_MESSAGES` — Recent messages to preserve (default: 10)
- `COMPACT_PRESERVE_FILE_ATTACHMENTS` — Preserve file attachments (default: true)
- `COMPACT_MAX_FILE_ATTACHMENT_BYTES` — Max file attachment size in bytes (default: 51200)

#### LLM Prompt Cache
- `LLM_CACHE_ENABLED` — Enable LLM prompt caching (default: true)
- `LLM_CACHE_TTL_HOURS` — Cache TTL in hours (default: 24)
- `LLM_CACHE_MAX_ENTRIES` — Max cache entries (default: 1000)

#### Agentic RAG
- `AGENTIC_RAG_ENABLED` — Enable agentic RAG (default: true)
- `AGENTIC_RAG_MAX_HOPS` — Multi-hop retrieval depth, 1-5 (default: 3)
- `AGENTIC_RAG_DECISION_CONFIDENCE` — Minimum confidence (default: 0.5)
- `AGENTIC_RAG_CRITIQUE_RELEVANCE_FLOOR` — (default: 0.5)
- `AGENTIC_RAG_CRITIQUE_COMPLETENESS_FLOOR` — (default: 0.3)
- `AGENTIC_RAG_VERIFICATION_SUPPORT_FLOOR` — (default: 0.6)
- `AGENTIC_RAG_VERIFICATION_UTILITY_FLOOR` — 1-5 (default: 2)
- `AGENTIC_RAG_MAX_REGENERATIONS` — 0-3 (default: 1)

</details>

## Commands

| Command | Description |
|---|---|
| `scripts\setup.ps1` *(Win)* / `bash scripts/setup.sh` *(Unix)* | One-command setup wizard |
| `scripts\start.ps1` *(Win)* / `bash scripts/start.sh` *(Unix)* | Start production server |
| `npm run dev` | Development mode (backend + frontend with hot-reload) |
| `npm run dev:backend` | Backend only with hot-reload |
| `npm run build` | Production build (TypeScript + Vite) |
| `npm start` | Start production server (requires `npm run build` first) |
| `npm run cli` | Interactive CLI |
| `npm run maintenance` | Maintenance CLI |

## Architecture Summary

### 1. Agent Runtime
[`src/agent/runtime.ts`](src/agent/runtime.ts) manages reasoning, tool calls, observations, and writes results back to conversation history.

### 2. Memory Layer
[`src/memory/manager/index.ts`](src/memory/manager/index.ts) is the center of the memory system combining short-term, long-term, and semantic relationships.

### 3. Gateway and Communication Layer
[`src/gateway/index.ts`](src/gateway/index.ts) is the main application entry point (Express & WebSockets).

### 4. Web Interface
The React-based client lives under [`src/web/react-app`](src/web/react-app). Uses React Query for data fetching.

## Observability

PenceAI uses a built-in local metrics system for observability.
Operations that are automatically traced and stored locally include:
- LLM calls and token usage across all 8 providers
- Cost calculation based on provider/model pricing
- Agent reasoning, memory retrieval, tool executions, and latency metrics.

No external API keys are required for observability, ensuring your data remains fully local.

## Current Status & Roadmap

The project is under active development. Notable implemented areas include:
- A working gateway and web chat flow
- GraphRAG module with shadow-mode testing
- MCP integration with marketplace
- Docker Compose containerization for reliable deployment
- Multi-channel support (Telegram, Discord, WhatsApp)
- Detailed observability dashboard

**Roadmap highlights:**
- GraphRAG production rollout (moving out of shadow-mode)
- Hardening MCP Security and sandboxing
- Enhancing Web UI debug panels
- Adding stronger authentication and rate limiting

## Contribution and Usage Note

This repository provides a strong base for both product development and applied AI / cognitive systems research. Contributions should pay particular attention to memory safety, backward compatibility, test coverage, and public repository hygiene.

---

PenceAI is an experimental but serious engineering foundation for building an agent architecture that remembers, relates information, recalls context with varying levels of attention, and behaves more consistently over time.
