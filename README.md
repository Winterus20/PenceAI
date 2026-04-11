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
- **MCP (Model Context Protocol) integration:** [`src/agent/mcp/`](src/agent/mcp/) implements extensible tool ecosystem with 18+ modules including marketplace, security layer, event bus, and unified registry.
- **Graph-assisted retrieval:** [`src/memory/graph.ts`](src/memory/graph.ts) and the retrieval orchestration layer support relationship-aware memory expansion.
- **Dual-process routing:** The codebase includes infrastructure for routing between faster intuitive flows and more deliberate reasoning flows.
- **Priming and spreading activation:** Retrieval quality is improved through nearby context, type cues, and neighboring memory links.
- **Reconsolidation pilot:** Controlled update and rewrite behavior for semantic memory is being explored.
- **Background job queue:** Persistent workflows support memory maintenance, embedding backfill, summarization, and deeper extraction tasks.
- **Web interface + gateway:** An HTTP/WebSocket server works together with a React-based client with React Query for data fetching and state management.
- **Multi-provider LLM integration:** Adapters are available for OpenAI, Anthropic, Groq, Mistral, Ollama, NVIDIA, GitHub, and other providers.
- **Observability & cost tracking:** Langfuse integration with OpenTelemetry provides end-to-end tracing, token usage tracking, and cost estimation across all 8 providers.
- **Multi-channel support:** Telegram, Discord, and WhatsApp channel integrations for broader accessibility.
- **Token usage analytics:** Real-time cost calculation with provider/model-specific pricing via [`costCalculator.ts`](src/utils/costCalculator.ts).

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

### 3.1. MCP (Model Context Protocol) Module

[`src/agent/mcp/`](src/agent/mcp/) implements the Model Context Protocol for extensible tool integration:

- **MCPClientManager:** Server lifecycle management (connect, disconnect, status tracking)
- **ToolAdapter:** Bridges MCP tools to existing ToolExecutor interface
- **UnifiedToolRegistry:** Centralized tool registration and execution
- **Security Layer:** Command validation, path extraction, argument validation with defense-in-depth
- **EventBus:** Event publishing/subscribing for MCP lifecycle and tool calls
- **Marketplace:** Server discovery, installation, and catalog management
- **Watcher:** Process health monitoring and auto-recovery

### 4. Gateway and Communication Layer

[`src/gateway/index.ts`](src/gateway/index.ts) is the main application entry point. Configuration loading, database initialization, LLM provider startup, runtime wiring, background workers, and the web server are assembled there.

[`src/gateway/bootstrap.ts`](src/gateway/bootstrap.ts) contains server helpers such as dashboard access control and the WebSocket upgrade flow.

#### Controllers ([`src/gateway/controllers/`](src/gateway/controllers/))

- **mcpController.ts:** MCP server management API endpoints
- **memoryController.ts:** Memory management API controller

#### Services ([`src/gateway/services/`](src/gateway/services/))

- **mcpService.ts:** MCP service layer for business logic abstraction

#### Jobs ([`src/gateway/jobs/`](src/gateway/jobs/))

- **autonomousWorker.ts:** Autonomous task background worker
- **systemTasks.ts:** System maintenance scheduled tasks

#### Observability API ([`src/gateway/observability.ts`](src/gateway/observability.ts))

Langfuse public API proxy endpoints for frontend observability features without exposing secret keys.

### 5. Router and Channel Abstraction

[`src/router/index.ts`](src/router/index.ts) provides the routing layer that normalizes messages from different channels and sends responses back through the appropriate transport.

### 6. Web Interface

The React-based client lives under [`src/web/react-app`](src/web/react-app). Chat UI, settings, onboarding, and memory-related interface components are implemented there. The frontend uses **React Query** for data fetching, caching, and state synchronization:

- **Query hooks:** [`src/web/react-app/src/hooks/queries/`](src/web/react-app/src/hooks/queries/) for conversations, memories, settings, LLM providers, memory graph, sensitive paths, stats, MCP servers, observability metrics, and usage stats
- **Mutation hooks:** [`src/web/react-app/src/hooks/mutations/`](src/web/react-app/src/hooks/mutations/) for creating, updating, and deleting memories and conversations
- **Service layer:** [`src/web/react-app/src/services/`](src/web/react-app/src/services/) for conversation, memory, settings, and stats operations
- **Query provider:** [`QueryProvider`](src/web/react-app/src/providers/QueryProvider.tsx) wraps the application with React Query context

#### Component Structure

- **Chat components:** [`src/components/chat/`](src/web/react-app/src/components/chat/) - Main chat interface, memory dialogs, observability panel
- **MCP components:** [`src/components/mcp/`](src/web/react-app/src/components/mcp/) - MCP Marketplace UI for server discovery and management
- **Settings components:** [`src/components/settings/`](src/web/react-app/src/components/settings/) - Usage stats cards and settings UI
- **UI components:** [`src/components/ui/`](src/web/react-app/src/components/ui/) - Radix UI primitives, toasts, error boundaries

### 7. Test Infrastructure

The [`tests`](tests) directory contains comprehensive coverage across multiple test layers:

#### Unit & Integration Tests

- **Memory tests:** [`tests/memory/`](tests/memory/) - memory typing, hybrid search, graph search, retrieval edge cases, reconsolidation pilot, retrieval observability, and integration tests
- **GraphRAG tests:** [`tests/memory/graphRAG/`](tests/memory/graphRAG/) - comprehensive GraphRAG unit and integration tests including engine, expander, cache, worker, PageRank, community detection, summarization, token pruning, shadow mode, and spreading activation
- **Gateway tests:** [`tests/gateway/`](tests/gateway/) - WebSocket behavior and gateway routing
- **Agent/MCP tests:** [`tests/agent/mcp/`](tests/agent/mcp/) - MCP server connection, tool calls, and security validation

#### Frontend Tests

- **UI tests:** [`tests/frontend/ui/`](tests/frontend/ui/) - React component tests and responsive testing
- **Integration tests:** [`tests/frontend/integration/`](tests/frontend/integration/) - Frontend integration scenarios
- **Test setup:** [`tests/frontend/setup/`](tests/frontend/setup/) - Test utilities and helpers

#### E2E Tests (Playwright)

- **E2E specs:** [`tests/e2e/specs/`](tests/e2e/specs/) - End-to-end test scenarios
- **Fixtures:** [`tests/e2e/fixtures/`](tests/e2e/fixtures/) - Test data and mocks
- **Helpers:** [`tests/e2e/helpers/`](tests/e2e/helpers/) - E2E test utilities
- **Reports:** [`tests/e2e/reports/`](tests/e2e/reports/) - Generated test reports
- **Configuration:** [`tests/e2e/playwright.config.ts`](tests/e2e/playwright.config.ts) - Playwright setup with global setup/teardown

#### Benchmark Tests

- **Retrieval benchmarks:** [`tests/benchmark/`](tests/benchmark/) - Performance testing for retrieval operations
- **GraphRAG benchmarks:** [`tests/benchmark/graphRAG/`](tests/benchmark/graphRAG/) - GraphRAG retrieval performance

```bash
# Run all tests
npm test

# Frontend tests
npm run test:frontend
npm run test:ui

# MCP E2E tests
npm run test:mcp:e2e
npm run test:mcp:e2e:ui
npm run test:mcp:e2e:headed
npm run test:mcp:e2e:report
```

## Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Server:** Express + WebSocket
- **Database:** SQLite / `better-sqlite3`
- **Vectors:** `sqlite-vec` for embedding storage
- **MCP:** `@modelcontextprotocol/sdk` for Model Context Protocol
- **Observability:** Langfuse + OpenTelemetry for end-to-end tracing
- **Embeddings:** `@xenova/transformers` (ONNX) + provider-backed embedding layers
- **Frontend:** React + Vite
- **State Management:** Zustand + React Query
- **Testing:** Jest + Playwright + Testing Library
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

- Development server (backend + frontend):

```bash
npm run dev
```

- Backend only:

```bash
npm run dev:backend-only
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

- GraphRAG management:

```bash
npm run graphrag:status         # Check GraphRAG status
npm run graphrag:readiness      # Check GraphRAG readiness
npm run graphrag:go-full        # Activate GraphRAG fully
npm run graphrag:emergency-rollback  # Emergency rollback
```

- Test suite:

```bash
npm test                              # All tests
npm run test:frontend                 # Frontend tests
npm run test:ui                       # UI component tests
npm run test:mcp:e2e                  # MCP E2E tests
npm run test:mcp:e2e:ui               # MCP E2E tests with UI
npm run test:mcp:e2e:report           # View E2E test reports
```

## Project Structure

```text
.
├─ src/
│  ├─ agent/          # Agent runtime, prompts, and tool integrations
│  │  ├─ mcp/         # Model Context Protocol integration
│  │  │  ├─ client.ts         # MCP server manager
│  │  │  ├─ adapter.ts        # Tool adapter
│  │  │  ├─ runtime.ts        # MCP runtime
│  │  │  ├─ registry.ts       # Unified tool registry
│  │  │  ├─ security.ts       # Security layer
│  │  │  ├─ marketplace-*.ts  # Marketplace system
│  │  │  └─ ...
│  │  └─ ...
│  ├─ autonomous/     # Background thinking, queues, and autonomous workers
│  ├─ cli/            # CLI and maintenance commands
│  ├─ gateway/        # HTTP/WebSocket server, bootstrap, and routes
│  │  ├─ controllers/ # API controllers (MCP, memory)
│  │  ├─ services/    # Service layer (MCP service)
│  │  ├─ jobs/        # Background jobs (autonomous worker, system tasks)
│  │  ├─ observability.ts  # Observability API routes
│  │  └─ ...
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
│  │  ├─ manager/     # Memory manager refactored modules
│  │  │  ├─ ConversationManager.ts # Conversation lifecycle
│  │  │  ├─ MemoryStore.ts        # Memory storage
│  │  │  └─ RetrievalService.ts   # Retrieval operations
│  │  └─ extraction/  # Memory extraction pipeline
│  ├─ router/         # Channel abstraction and message routing
│  ├─ observability/  # Langfuse OpenTelemetry integration
│  │  └─ langfuse.ts  # Trace initialization and helpers
│  ├─ utils/          # Logging and utility helpers
│  │  ├─ logger.ts
│  │  └─ costCalculator.ts  # Token cost calculation
│  └─ web/            # Legacy public interface and React application
│     └─ react-app/   # React frontend
│        └─ src/
│           ├─ components/
│           │  ├─ chat/        # Chat UI components
│           │  ├─ mcp/         # MCP Marketplace
│           │  ├─ settings/    # Settings components
│           │  └─ ui/          # UI primitives
│           ├─ hooks/
│           │  ├─ queries/     # React Query query hooks
│           │  └─ mutations/   # React Query mutation hooks
│           ├─ services/       # API service layer
│           ├─ store/          # Zustand state slices
│           └─ providers/      # React Query provider
├─ tests/
│  ├─ agent/
│  │  └─ mcp/         # MCP unit tests
│  ├─ benchmark/      # Performance benchmarks
│  │  └─ graphRAG/   # GraphRAG retrieval benchmarks
│  ├─ e2e/            # End-to-end tests (Playwright)
│  │  ├─ specs/
│  │  ├─ fixtures/
│  │  ├─ helpers/
│  │  └─ reports/
│  ├─ frontend/       # Frontend tests
│  │  ├─ ui/
│  │  ├─ integration/
│  │  └─ setup/
│  ├─ gateway/        # Gateway tests
│  ├─ memory/         # Memory tests
│  │  └─ graphRAG/   # GraphRAG unit and integration tests
│  └─ observability/  # Observability tests
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

## Observability

PenceAI supports [Langfuse](https://langfuse.com) for end-to-end LLM observability with OpenTelemetry.

### Quick Setup

1. Create an account at [https://cloud.langfuse.com](https://cloud.langfuse.com)
2. Generate API keys from the dashboard
3. Add to your `.env` file:

```env
LANGFUSE_ENABLED=true
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

### What's Traced

When Langfuse is enabled, the following operations are automatically traced:

- **LLM calls** — All 8 providers (OpenAI, Anthropic, Ollama, Groq, Mistral, NVIDIA, MiniMax, GitHub)
- **Agent reasoning** — Full processMessage flow with child spans
- **Memory retrieval** — hybridSearch, graphRAGSearch, getPromptContextBundle
- **Tool executions** — Tool call duration and success/failure
- **Latency & tokens** — Prompt tokens, completion tokens, total tokens
- **Cost estimation** — Per-call and aggregated cost tracking

### Trace Hierarchy

```
Trace: user-message-{uuid}
 ├─ Span: agent.processMessage (total duration)
 │  ├─ Span: memory.getPromptContextBundle
 │  ├─ Span: llm.chat (OpenAI, Anthropic, etc.)
 │  │  ├─ Prompt tokens
 │  │  ├─ Completion tokens
 │  │  └─ Cost
 │  ├─ Span: tool.execute (if tools called)
 │  └─ Span: memory.addMemory
```

### Zero Overhead Mode

When `LANGFUSE_ENABLED=false` (default), the observability layer adds **zero performance overhead**. All trace paths are short-circuited at initialization.

### Dashboard

Visit [https://cloud.langfuse.com](https://cloud.langfuse.com) to view:
- Real-time traces
- Generation metrics
- Token usage over time
- Cost per user/conversation
- Error rates and latency percentiles

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
- **MCP integration** with 18+ modules, marketplace system, security layer, and unified tool registry
- **React Query integration** for frontend data fetching, caching, and state management
- **Memory Manager refactoring** with modular ConversationManager, MemoryStore, and RetrievalService
- **UI improvements** including scrollbar styling, markdown rendering, and message area enhancements
- **Observability dashboard** with Langfuse trace viewing, provider statistics, and error analytics
- **Token usage tracking** with real-time cost calculation across all 8 LLM providers
- **Multi-channel support** infrastructure for Telegram, Discord, and WhatsApp
- **Comprehensive test infrastructure** with unit, integration, E2E (Playwright), and benchmark tests
- **Cost calculator** with provider/model-specific pricing for accurate billing estimates

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
- **MCP production hardening:** expanding marketplace catalog, adding more official MCP servers
- **MCP security audits:** implementing stricter command validation and sandboxing
- **Test coverage expansion:** adding more E2E scenarios, frontend component tests, and MCP integration tests
- **Multi-channel deployment:** production-ready Telegram, Discord, and WhatsApp integrations
- **Observability enhancements:** adding custom dashboards, alerting, and advanced analytics
- **Performance optimization:** reducing latency in retrieval orchestration and GraphRAG pipeline
- adding stronger authentication, rate limiting, and operational observability for production deployment
- extending documentation with API references, architecture decision records, and a contribution guide

## Contribution and Usage Note

This repository provides a strong base for both product development and applied AI / cognitive systems research. Contributions should pay particular attention to memory safety, backward compatibility, test coverage, and public repository hygiene.

---

PenceAI is an experimental but serious engineering foundation for building an agent architecture that remembers, relates information, recalls context with varying levels of attention, and behaves more consistently over time.
