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

## Key Features

- **End-to-end TypeScript architecture:** Agent, gateway, memory, router, web, and test layers share one language and type system.
- **Agent runtime + tool loop:** [`AgentRuntime`](src/agent/runtime.ts) manages reasoning, tool calls, observations, and response generation in a unified flow.
- **Cognitive memory layer:** [`MemoryManager`](src/memory/manager/index.ts) coordinates conversation history, long-term memory, retrieval orchestration, and maintenance routines.
- **Episodic / semantic memory separation:** Memories are treated not only by content, but also by their functional role.
- **GraphRAG (Graph-based Retrieval Augmented Generation):** [`src/memory/graphRAG/`](src/memory/graphRAG/) provides graph-aware retrieval with PageRank scoring, community detection, community summarization, graph expansion, caching, token pruning, and shadow-mode behavior discovery.
- **Graph-assisted retrieval:** [`src/memory/graph.ts`](src/memory/graph.ts) and the retrieval orchestration layer support relationship-aware memory expansion.
- **Dual-process routing:** The codebase includes infrastructure for routing between faster intuitive flows and more deliberate reasoning flows.
- **Priming and spreading activation:** Retrieval quality is improved through nearby context, type cues, and neighboring memory links.
- **Reconsolidation pilot:** Controlled update and rewrite behavior for semantic memory is being explored.
- **Background job queue:** Persistent workflows support memory maintenance, embedding backfill, summarization, and deeper extraction tasks.
- **Web interface + gateway:** An HTTP/WebSocket server works together with a React-based client with React Query for data fetching and state management.
- **Multi-provider LLM integration:** Adapters are available for OpenAI, Anthropic, Groq, Mistral, Ollama, NVIDIA, GitHub, and other providers.

## Architecture Summary

### 1. Agent Runtime

[`src/agent/runtime.ts`](src/agent/runtime.ts) receives user messages, prepares conversational context, gathers relevant memory, interacts with the LLM, optionally calls tools, and writes results back to conversation history. It can also schedule background work such as deeper memory extraction and conversation summarization.

### 2. Memory Layer

[`src/memory/manager/index.ts`](src/memory/manager/index.ts) is the center of the memory system. Conversation lifecycle management, message storage, embedding generation, retrieval orchestration, review/decay processes, and graph adjacency handling all come together here.

In practice, the memory architecture includes:

- short-term conversation context
- long-term user memory
- episodic / semantic separation
- hybrid semantic search and full-text search
- Ebbinghaus-style review and forgetting logic
- graph relationships and neighboring memory activation

### 3. GraphRAG Module

[`src/memory/graphRAG/`](src/memory/graphRAG/) implements graph-based Retrieval Augmented Generation for context-aware memory retrieval:

- **GraphRAGEngine:** Core graph RAG retrieval engine
- **GraphExpander:** Graph expansion for related memory nodes
- **GraphCache:** In-memory graph caching for performance
- **GraphWorker:** Background graph processing tasks
- **PageRankScorer:** PageRank-based node importance scoring
- **CommunityDetector:** Graph community detection for memory clustering
- **CommunitySummarizer:** Automatic summarization of detected communities
- **TokenPruner:** Token budget management and pruning
- **ShadowMode:** Shadow-mode testing for safe feature rollout
- **BehaviorDiscoveryShadow:** Behavior discovery in shadow mode

### 4. Gateway and Communication Layer

[`src/gateway/index.ts`](src/gateway/index.ts) is the main application entry point. Configuration loading, database initialization, LLM provider startup, runtime wiring, background workers, and the web server are assembled there.

[`src/gateway/bootstrap.ts`](src/gateway/bootstrap.ts) contains server helpers such as dashboard access control and the WebSocket upgrade flow.

### 5. Router and Channel Abstraction

[`src/router/index.ts`](src/router/index.ts) provides the routing layer that normalizes messages from different channels and sends responses back through the appropriate transport.

### 6. Web Interface

The React-based client lives under [`src/web/react-app`](src/web/react-app). Chat UI, settings, onboarding, and memory-related interface components are implemented there. The frontend uses **React Query** for data fetching, caching, and state synchronization:

- **Query hooks:** [`src/web/react-app/src/hooks/queries/`](src/web/react-app/src/hooks/queries/) for conversations, memories, settings, LLM providers, memory graph, sensitive paths, and stats
- **Mutation hooks:** [`src/web/react-app/src/hooks/mutations/`](src/web/react-app/src/hooks/mutations/) for creating, updating, and deleting memories and conversations
- **Service layer:** [`src/web/react-app/src/services/`](src/web/react-app/src/services/) for conversation, memory, settings, and stats operations
- **Query provider:** [`QueryProvider`](src/web/react-app/src/providers/QueryProvider.tsx) wraps the application with React Query context

### 7. Test Infrastructure

The [`tests`](tests) directory contains coverage for memory typing, retrieval observability, gateway WebSocket behavior, reconsolidation scenarios, and GraphRAG functionality. For example, [`tests/memory/reconsolidationPilot.test.ts`](tests/memory/reconsolidationPilot.test.ts) validates semantic/episodic separation and safe reconsolidation decisions, while [`tests/memory/graphRAG/`](tests/memory/graphRAG/) provides comprehensive GraphRAG test coverage.

## Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Server:** Express + WebSocket
- **Database:** SQLite / `better-sqlite3`
- **Embeddings / semantic search:** `sqlite-vec` plus provider-backed embedding layers
- **Frontend:** React + Vite
- **Testing:** Jest
- **Logging:** Pino

## Setup

### Requirements

- Node.js `>= 22`
- npm
- API credentials if you want to use a hosted LLM provider
- Ollama if you want to run a local model

### Installation

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Prepare environment variables:

```bash
copy .env.example .env
```

On non-Windows systems, use `cp .env.example .env` instead.

4. Update [`.env`](.env) using [`.env.example`](.env.example) as a reference.
5. Provide the required provider credentials and base configuration.
6. Start the development server:

```bash
npm run dev
```

## Using [`.env.example`](.env.example)

The root [`.env.example`](.env.example) file contains safe placeholder values suitable for a public repository. It does not include real secrets; it only documents the variables expected by the application.

Main variable groups:

- **Server:** `PORT`, `HOST`
- **Database:** `DB_PATH`
- **LLM providers:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_TOKEN`
- **Local model access:** `OLLAMA_BASE_URL`
- **Security:** `ALLOW_SHELL_EXECUTION`, `FS_ROOT_DIR`, `DASHBOARD_PASSWORD`, `SENSITIVE_PATHS`
- **Embeddings:** `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- **Application behavior:** `SYSTEM_PROMPT`, `AUTONOMOUS_STEP_LIMIT`, `MEMORY_DECAY_THRESHOLD`, `SEMANTIC_SEARCH_THRESHOLD`, `LOG_LEVEL`

Notes:

- Keep real secrets only in local [`.env`](.env) files or secure secret-management systems.
- Never commit real API keys, tokens, passwords, or user-specific paths to a public repository.
- Only enable powerful settings such as `ALLOW_SHELL_EXECUTION` with a clear understanding of the security implications.

## Development Commands

Primary commands from [`package.json`](package.json):

- Development server:

```bash
npm run dev
```

- Production build:

```bash
npm run build
```

- Start after build:

```bash
npm run start
```

- CLI tools:

```bash
npm run cli
```

- Maintenance tasks:

```bash
npm run maintenance
```

- Test suite:

```bash
npm test
```

## Project Structure

```text
.
├─ src/
│  ├─ agent/          # Agent runtime, prompts, and tool integrations
│  ├─ autonomous/     # Background thinking, queues, and autonomous workers
│  ├─ cli/            # CLI and maintenance commands
│  ├─ gateway/        # HTTP/WebSocket server, bootstrap, and routes
│  ├─ llm/            # Provider adapters
│  ├─ memory/         # Database, retrieval, graph, and memory logic
│  │  ├─ graphRAG/    # Graph-based Retrieval Augmented Generation
│  │  │  ├─ GraphRAGEngine.ts    # Core graph RAG engine
│  │  │  ├─ GraphExpander.ts     # Graph expansion
│  │  │  ├─ GraphCache.ts        # Graph caching
│  │  │  ├─ GraphWorker.ts       # Background graph tasks
│  │  │  ├─ PageRankScorer.ts    # PageRank scoring
│  │  │  ├─ CommunityDetector.ts # Community detection
│  │  │  ├─ CommunitySummarizer.ts # Community summarization
│  │  │  ├─ TokenPruner.ts       # Token pruning
│  │  │  ├─ ShadowMode.ts        # Shadow mode testing
│  │  │  ├─ BehaviorDiscoveryShadow.ts # Behavior discovery
│  │  │  ├─ config.ts            # GraphRAG configuration
│  │  │  ├─ index.ts             # Module exports
│  │  │  ├─ monitoring.ts        # Monitoring utilities
│  │  │  └─ rollback.ts          # Rollback support
│  │  └─ manager/     # Memory manager refactored modules
│  │     ├─ ConversationManager.ts # Conversation lifecycle
│  │     ├─ MemoryStore.ts        # Memory storage
│  │     └─ RetrievalService.ts   # Retrieval operations
│  ├─ router/         # Channel abstraction and message routing
│  ├─ utils/          # Logging and utility helpers
│  └─ web/            # Legacy public interface and React application
│     └─ react-app/   # React frontend
│        └─ src/
│           ├─ hooks/
│           │  ├─ queries/        # React Query query hooks
│           │  └─ mutations/      # React Query mutation hooks
│           ├─ services/          # API service layer
│           └─ providers/         # React Query provider
├─ tests/
│  ├─ benchmark/      # Performance benchmarks
│  │  └─ graphRAG/   # GraphRAG retrieval benchmarks
│  └─ memory/
│     └─ graphRAG/   # GraphRAG unit and integration tests
├─ scripts/           # Development and debugging helper scripts
├─ .env.example       # Safe example environment file
├─ package.json       # Commands and dependencies
└─ tsconfig.json      # TypeScript configuration
```

## Security and Data Notes

This project works with memory records, conversation history, user messages, and model outputs, so it should be operated carefully even in default local setups.

- Conversation and memory data may be stored in a local database.
- Depending on the selected LLM provider, some content may be sent to external APIs.
- Password protection is recommended for dashboard access in public or shared deployments.
- If shell or filesystem access is enabled, restricted directories and explicit security policies should be used.
- Additional review is recommended for regulated or highly sensitive data scenarios.

This README intentionally avoids real secrets, sample tokens, personal data, or operationally sensitive details.

## Current Status

The project is under active development. The codebase already provides a strong foundation across the agent runtime, memory orchestration, web UI, gateway, automated tests, and experimental cognitive retrieval features. Some areas still have a research or prototype character and may require additional hardening before production use.

Notable implemented areas include:

- a working gateway and web chat flow
- conversation-based memory storage and recall
- retrieval observability
- autonomous task queue infrastructure
- semantic / episodic memory experiments
- pilot logic for reconsolidation and dual-process routing
- **GraphRAG module** with graph-based retrieval, PageRank scoring, community detection, and shadow-mode testing
- **React Query integration** for frontend data fetching, caching, and state management
- **Memory Manager refactoring** with modular ConversationManager, MemoryStore, and RetrievalService
- **UI improvements** including scrollbar styling, markdown rendering, and message area enhancements

## Roadmap

Reasonable short- and mid-term directions include:

- expanding retrieval quality metrics and offline evaluation scenarios
- refining semantic / episodic memory writing policies
- maturing the reconsolidation pilot with more measurable safety criteria
- making dual-process routing decisions more configurable
- **GraphRAG production rollout:** moving from shadow-mode to active graph-based retrieval with configurable thresholds
- **GraphRAG performance optimization:** improving PageRank computation speed and community detection scalability
- **GraphRAG monitoring dashboard:** adding real-time graph visualization and retrieval quality metrics to the web interface
- moving graph activation from shadow-mode behavior toward more controlled active usage
- improving memory visibility and debug panels in the React interface
- adding stronger authentication, rate limiting, and operational observability for production deployment
- extending documentation with API references, architecture decision records, and a contribution guide

## Contribution and Usage Note

This repository provides a strong base for both product development and applied AI / cognitive systems research. Contributions should pay particular attention to memory safety, backward compatibility, test coverage, and public repository hygiene.

---

PenceAI is an experimental but serious engineering foundation for building an agent architecture that remembers, relates information, recalls context with varying levels of attention, and behaves more consistently over time.
