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
- **[NEW] Containerized Deployments via Docker and Docker Compose**

## Key Features

- **End-to-end TypeScript architecture:** Agent, gateway, memory, router, web, and test layers share one language and type system.
- **Agent runtime + tool loop:** [`AgentRuntime`](src/agent/runtime.ts) manages reasoning, tool calls, observations, and response generation in a unified flow.
- **Cognitive memory layer:** [`MemoryManager`](src/memory/manager/index.ts) coordinates conversation history, long-term memory, retrieval orchestration, and maintenance routines.
- **Episodic / semantic memory separation:** Memories are treated not only by content, but also by their functional role.
- **GraphRAG (Graph-based Retrieval Augmented Generation):** [`src/memory/graphRAG/`](src/memory/graphRAG/) provides graph-aware retrieval with PageRank scoring, community detection, community summarization, graph expansion, caching, token pruning, and shadow-mode behavior discovery.
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

## Setup & Deployment

PenceAI supports two primary methods of installation: **Docker (Recommended)** or **Manual Node.js Setup**.

### Method 1: Docker Compose (Recommended)

Using Docker mitigates any operating system incompatibilities (especially with native C++ packages like `better-sqlite3` and `sqlite-vec`) and provides an isolated runtime.

1. Ensure **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** or Docker Engine is installed and running.
2. Clone the repository and prepare your environment file:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` to include your desired LLM API Keys (e.g. `OPENAI_API_KEY`).
4. Build the image and start the application in the background:
   ```bash
   docker compose up -d --build
   ```
5. Access the web dashboard at **http://localhost:3001**!
   *(Note: The database is persistently mapped to your local `./data` folder, thus memory survives container restarts).*

### Method 2: Manual Node.js Setup

If you prefer to run the application natively on your host:

1. Requirements: Node.js `>= 22`, npm, and available Python/Build-Tools for native module compilation.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Prepare environment variables:
   ```bash
   cp .env.example .env
   ```
4. Start the development server (runs both frontend and backend):
   ```bash
   npm run dev
   ```

## Using [`.env.example`](.env.example)

The root [`.env.example`](.env.example) file contains safe placeholder values. Main variable groups:

- **Server:** `PORT`, `HOST`
- **Database:** `DB_PATH`
- **LLM providers:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_TOKEN`
- **Local model access:** `OLLAMA_BASE_URL`
- **Security:** `ALLOW_SHELL_EXECUTION`, `FS_ROOT_DIR`, `DASHBOARD_PASSWORD`, `SENSITIVE_PATHS`
- **Embeddings:** `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- **Application behavior:** `SYSTEM_PROMPT`, `AUTONOMOUS_STEP_LIMIT`, `MEMORY_DECAY_THRESHOLD`, `SEMANTIC_SEARCH_THRESHOLD`, `LOG_LEVEL`

> **Note:** Never commit real API keys, tokens, or passwords to a public repository.

## Commands

Primary commands from [`package.json`](package.json) for manual development:

- **Development server:** `npm run dev`
- **Backend only:** `npm run dev:backend-only`
- **Production build:** `npm run build`
- **Start after build:** `npm run start`
- **CLI tools:** `npm run cli`
- **Maintenance tasks:** `npm run maintenance`

Docker lifecycle commands:
- **Build / Run:** `docker compose up -d --build`
- **Stop:** `docker compose down`
- **View Logs:** `docker compose logs -f`

## Architecture Summary

*(For a deep-dive, see `architecture_overview.md` in the knowledge base).*

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
