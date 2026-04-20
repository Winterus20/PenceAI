# PençeAI Project Context

> Comprehensive architecture reference for PençeAI v0.1.0 — self-hosted, local-first AI agent platform.

## Quick Reference

- **Runtime:** Node.js >= 22, ESM (`"type": "module"`)
- **Language:** TypeScript 5.7+ (imports MUST use `.js` extensions)
- **Backend:** Express.js 4.x + WebSocket (`ws`)
- **Database:** SQLite (`better-sqlite3`) + `sqlite-vec` + FTS5 — Schema version **17**
- **Frontend:** React 19, Vite 6, TailwindCSS 4, Zustand, TanStack Query, Radix UI, D3.js
- **LLM Providers:** OpenAI, Anthropic, Ollama, MiniMax, GitHub, Groq, Mistral, NVIDIA (8 total)
- **Tests:** 77 files — Jest (ts-jest ESM), Playwright (E2E)

## Entry Points

| File | Purpose |
|------|---------|
| `src/gateway/index.ts` | Main server — bootstrap sequence: config → DB → LLM → MCP → GraphRAG → Express/WS → channels → scheduler |
| `src/cli/maintenance.ts` | CLI for GraphRAG management |
| `src/web/react-app/src/main.tsx` | React 19 root |

## Module Map

### Gateway (`src/gateway/`)
- **config.ts** — Zod-validated singleton via `getConfig()`. Invalid env → `process.exit(1)`. Enums use `.catch()` fallback.
- **routes.ts** — REST: `/api/health`, `/api/settings`, `/api/llm/providers`, `/api/feedback`, `/api/graphrag/*`, `/api/behavior-discovery/*`, `/api/metrics/*`
- **websocket.ts** — Real-time chat, streaming tokens, tool call events, stats (debounced 500ms)
- **envUtils.ts** — `secureUpdateEnv()` uses temp file + rename, Windows EPERM fallback
- **bootstrap.ts** — Dashboard WS upgrade, auth middleware, request tracing

### Agent (`src/agent/`)
- **runtime.ts** — `AgentRuntime`: ReAct loop orchestrator. Flow: processMessage → context compaction → memory retrieval → GraphRAG → prompt → ReActLoop → response verification → memory extraction → metrics
- **reactLoop.ts** — `ReActLoop`: Reason-Act-Observe cycle. Events: `thinking`, `tool_start`, `tool_end`, `iteration`, `token`, `clear_stream`, `compaction`
- **toolManager.ts** — `ToolManager`: Built-in + MCP tools. Session tracking for tool call counts.
- **tools.ts** — 10 built-in tools: readFile, writeFile, listDirectory, searchMemory, deleteMemory, saveMemory, searchConversation, webTool, executeShell (gated), webSearch
- **prompt.ts** — `BASE_SYSTEM_PROMPT`, `buildSystemPrompt()`, extraction/summarization prompts
- **contextPreparer.ts** — Conversation → LLM message format
- **memoryExtractor.ts** — Background extraction (light + deep). Throttled: every 3 message pairs → light extraction.
- **compactEngine.ts** — LLM-based context compaction when token budget exceeded
- **graphRAGManager.ts** — Bridges AgentRuntime with GraphRAGEngine
- **metricsTracker.ts** — Per-conversation performance, cost, context token usage
- **fallbackParser.ts** — Parses LLM responses when native tool calling unavailable

### MCP (`src/agent/mcp/`) — 21 files
- **runtime.ts** — `initializeMCP()`, `shutdownMCP()`
- **client.ts** — `MCPClientManager`: connect/disconnect servers, list/call tools, server status
- **registry.ts** — `UnifiedToolRegistry`: merges built-in + MCP tools. Singleton via `getUnifiedToolRegistry()`
- **adapter.ts** — `createMCPToolAdapter()`: naming `mcp:{serverName}:{toolName}`
- **contracts.ts** — Interfaces: `MCPManagerContract`, `ToolRegistryContract`, `TransportContract`
- **result.ts** — `Result<T, E>` pattern: `success()`, `error()`, `isSuccess()`, `tryAsync()`
- **security.ts** — `RateLimiter`, `OutputSanitizer`, `ToolCallValidator`, `ConcurrencyLimiter`, `MCPSecurityManager`
- **command-validator.ts** — Allowlist: `['npx', 'node', 'python', 'python3', 'curl']`
- **hooks.ts** — `HookRegistry`: phases `UserPromptSubmit`, `SessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`
- **eventBus.ts** — `MCPEventBus`: pub/sub for MCP events. Singleton via `getMCPEventBus()`
- **watcher.ts** — `MCPConfigWatcher`: hot-reload MCP configs
- **marketplace-service.ts** — MCP server marketplace + `marketplace-catalog.json`

### LLM (`src/llm/`)
- **provider.ts** — `LLMProvider` (abstract): `chat()`, `chatStream?()`, `healthCheck()`, `resolveModel()`. Signal: `TOOL_CALL_CLEAR_SIGNAL = '\x00__CLEAR_STREAM__\x00'`
- **provider.ts** — `LLMProviderFactory`: `register()`, `create()`, `getAvailable()`
- **index.ts** — `registerAllProviders()`: OpenAI, Anthropic, Ollama, MiniMax, GitHub, Groq, Mistral, NVIDIA
- **ChatOptions** — `{ model?, temperature?, maxTokens?, tools?, systemPrompt?, thinking? }`

### Memory (`src/memory/`) — Core architecture
- **database.ts** — `PenceDatabase`: Schema v17. WAL mode, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON. sqlite-vec loaded. 20+ indexes. FTS sync triggers.
- **manager/index.ts** — `MemoryManager` (610 lines): Facade delegating to sub-modules
- **manager/MemoryStore.ts** — (822 lines): addMemory (mutex, semantic dedup cosine>0.80, FTS fallback Jaccard+containment, reconsolidation), deleteMemory, editMemory, decayMemories (Ebbinghaus R<0.1 archive, R<0.5 weaken)
- **manager/RetrievalService.ts** — (882 lines): searchMemories (FTS), semanticSearch (sqlite-vec cosine), hybridSearch (RRF + Ebbinghaus retention), graphAwareSearch (multi-hop BFS + archival fallback), archivalSearch, graphRAGSearch
- **retrievalOrchestrator.ts** — (753 lines): `getPromptContextBundle()` — IntentAnalyzer, RetrievalPrimer, ScoringPipeline, SpreadingActivationEngine, CoverageRepair, BudgetApplier, BehaviorDiscovery, RetrievalConfidenceScorer, PassageCritique, MultiHopRetrieval
- **embeddings.ts** — Providers: OpenAIEmbedding (1536d), MiniMaxEmbedding (1536d), VoyageEmbedding (3072d). `BaseHttpEmbedding` with exponential backoff.
- **ebbinghaus.ts** — Pure math: `computeRetention(stability, days)` = e^(-t/S), threshold 0.7, review factor 0.3567
- **graph.ts** — `MemoryGraphManager` (657 lines): entities, relations, proximity, PageRank, traversal, decay, export for D3.js
- **types.ts** — `MemoryType = 'episodic' | 'semantic'`, `BehaviorDiscoveryLifecycleState`, `MemoryRow`, `MessageRow`, `GraphNode`, `GraphEdge`

### GraphRAG (`src/memory/graphRAG/`) — 15 files
| File | Class | Purpose |
|------|-------|---------|
| GraphRAGEngine.ts | GraphRAGEngine | Main orchestrator (1000 lines) |
| GraphExpander.ts | GraphExpander | Multi-hop BFS traversal with caching |
| PageRankScorer.ts | PageRankScorer | PageRank scoring |
| CommunityDetector.ts | CommunityDetector | Modularity-based community detection |
| CommunitySummarizer.ts | CommunitySummarizer | LLM-based community summaries |
| GraphCache.ts | GraphCache | Traversal result caching |
| GraphWorker.ts | GraphWorker | Background PageRank + community detection |
| ShadowMode.ts | ShadowMode | Safe comparison testing |
| GlobalSearchEngine.ts | GlobalSearchEngine | Hierarchical search across communities |
| TokenPruner.ts | TokenPruner | Token budget management |
| config.ts | GraphRAGConfigManager | Rollout phases |
| monitoring.ts | GraphRAGMonitor | Alerting + metrics |
| rollback.ts | GraphRAGRollbackManager | Emergency rollback |

**Rollout Phases:** OFF (1) → SHADOW (2) → PARTIAL (3) → FULL (4)

### Retrieval Sub-module (`src/memory/retrieval/`) — 14 files
IntentAnalyzer, RetrievalPrimer, ScoringPipeline, SpreadingActivation, CoverageRepair, BudgetApplier, BehaviorDiscovery, RetrievalConfidenceScorer, PassageCritique, MultiHopRetrieval, ResponseVerifier (Agentic RAG self-evaluation), Orchestrator

### Autonomous (`src/autonomous/`)
- **queue.ts** — `TaskQueue`: SQLite-backed priority queue (P1_CRITICAL → P4_LOW)
- **worker.ts** — `BackgroundWorker`: memory decay, Ebbinghaus, embedding backfill, deep extraction, summarization, autonomous tick
- **curiosityEngine.ts** — `SubAgentManager`: autonomous sub-agents
- **urgeFilter.ts** — `FeedbackManager`: feedback signals, penalties/rewards

### Router (`src/router/`)
- **index.ts** — `MessageRouter`: channel registration, sendResponse with auto-reconnect
- **semantic.ts** — `SemanticRouter`: intent routing via embedding similarity (all-MiniLM-L6-v2). Worker thread architecture. LRU cache (30min TTL, 500 entries, 100MB). Fallback modes: 'llm', 'default', 'none'.

### Frontend (`src/web/react-app/`)
- **Vite config** — Output: `dist/web/public`. Dev proxy: `/api` → 3001, `/ws` → WS proxy. Manual chunks: vendor-react, vendor-radix, vendor-query, vendor-animation, vendor-d3, vendor-syntax, vendor-markdown, vendor-utils
- **App.tsx** — Views: chat, channels, mcp-marketplace, metrics
- **store/agentStore.ts** — Zustand with persist (localStorage `pence-agent-store-v2`). Slices: chatSlice, uiSlice, settingsSlice
- **hooks/** — useAgentSocket, useConversations, useConversationFilters, useMemoryGraph, useMessageBuilder, useSettingsForm, useStats, useFileUpload, mutations/, queries/
- **components/chat/** — 28 components: ChatWindow, ConversationPanel, MessagePanel, MessageBubble, InputPanel, SidebarMenu, SettingsDialog, MemoryGraphView, CodeBlock, CommandPalette, OnboardingDialog, etc.
- **components/mcp/MCPMarketplace/** — MCP server marketplace UI
- **components/ui/** — 19 Radix primitives + custom components

## Database Schema (v17)

### Core Tables
- `conversations` — Chat sessions (id, channel_type, channel_id, user_id, title, summary, message_count)
- `messages` — Individual messages (conversation_id, role, content, tool_calls, tool_results, attachments)
- `memories` — Long-term memories (user_id, category, content, importance, access_count, is_archived, stability, retrievability, next_review_at, review_count, confidence, review_profile, memory_type, provenance_*)
- `settings` — Key-value (schema_version, embedding_dimensions, sensitive_paths)

### Search & Vector
- `memories_fts` (FTS5), `messages_fts` (FTS5)
- `memory_embeddings` (vec0), `message_embeddings` (vec0)
- `embedding_cache` — Query hash → embedding (1hr TTL)

### Graph
- `memory_entities` — Named entities (person, technology, project, place, organization, concept)
- `memory_relations` — Memory-to-memory edges (source, target, relation_type, confidence, weight, decay_rate, page_rank_score)
- `memory_entity_links` — Memory-to-entity many-to-many
- `graph_communities` — Detected communities (modularity_score, level, parent_id)
- `graph_community_members`, `graph_community_summaries`
- `graph_traversal_cache` — Cached traversal results
- `memory_claims` — Extracted claims (subject, predicate, object, status, temporal bounds)

### System
- `mcp_servers`, `autonomous_tasks`, `token_usage`, `metrics`, `feedback`, `skills`, `scheduled_tasks`

## Build & Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Backend (tsx watch) + Frontend (vite, waits for health check) |
| `npm run build` | tsc + cp marketplace-catalog.json + vite build |
| `npm run start` | node dist/gateway/index.js |
| `npm run test` | Jest all tests |
| `npm run test:frontend` | Frontend tests only |
| `npm run test:mcp:e2e` | Playwright E2E |
| Single test | `npx jest --config jest.config.js --testPathPattern='tests/path/file.test.ts'` |

## Key Conventions

1. **Imports:** ALWAYS use `.js` extensions despite TypeScript source
2. **Config:** NEVER read `process.env` directly. Use `getConfig()` — Zod-validated singleton
3. **MCP tool naming:** `mcp:{serverName}:{toolName}`
4. **Result pattern:** Use `Result<T, E>` from `src/agent/mcp/result.ts` instead of throw/catch in MCP code
5. **Streaming:** Uses `TOOL_CALL_CLEAR_SIGNAL` to flush previous stream content on tool calls
6. **Ebbinghaus:** R(t) = e^(-t/S), threshold 0.7, stability backoff: importance * 2.0
7. **Behavior Discovery:** disabled → observe → candidate → shadow → limited → trusted
8. **Logger:** AsyncLocalStorage for trace context. Windows: `chcp 65001` for UTF-8
9. **Path aliases:** `@/*` → `src/*` (root), `@/*` → `src/web/react-app/src/*` (frontend)

## Test Files (77 total)

- Agent: 13 files (contextPreparer, fallbackParser, graphRAGManager, memoryExtractor, metricsTracker, toolManager)
- MCP: 14 files (unit + integration: adapter, client, command-validator, eventBus, registry, result, security, transport, database, lifecycle, marketplace, runtime, tool-execution)
- Autonomous: 4 files (curiosityEngine, queue, thinkEngine, urgeFilter)
- Memory: 29 files (core + GraphRAG 16 + retrieval sub-module 4)
- Gateway: 1 file (websocket)
- Frontend: 8 files (UI, integration, E2E)
- Benchmark: 2 files
- Observability: 1 file
- Utils: 3 files (costCalculator, datetime, logger)
