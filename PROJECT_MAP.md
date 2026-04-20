# PenceAI Proje Haritası

> **Son Güncelleme:** 19 Nisan 2026
> **Versiyon:** 1.7.0
> **Lisans:** MIT

---

## 📋 İçindekiler

1. [Proje Özeti](#proje-özeti)
2. [Mimari Genel Bakış](#mimari-genel-bakış)
3. [Modül Yapısı](#modül-yapısı)
4. [Veritabanı Şeması](#veritabanı-şeması)
5. [Teknoloji Yığını](#teknoloji-yığını)
6. [API Endpoints](#api-endpoints)
7. [WebSocket Protokolü](#websocket-protokolü)
8. [Güvenlik](#güvenlik)
9. [Test Yapısı](#test-yapısı)
10. [Geliştirici Notları](#geliştirici-notları)

---

## Proje Özeti

**PenceAI**, self-hosted ve local-first bir AI agent platformudur. End-to-end TypeScript mimarisi ile çoklu LLM provider desteği, bilişsel bellek katmanı ve otonom düşünme mekanizması sunar.

### Temel Özellikler

- 🧠 **Bilişsel Bellek Sistemi**: Ebbinghaus unutma eğrisi tabanlı uzun vadeli bellek yönetimi
- 🔄 **ReAct Döngüsü**: Reason → Act → Observe paradigması ile otonom ajan davranışı
- 🔗 **Çoklu LLM Desteği**: OpenAI, Anthropic, Ollama, Groq, Mistral, NVIDIA NIM, MiniMax, GitHub Models
- 💾 **Local-First**: Tüm veriler yerel SQLite veritabanında saklanır
- 🎯 **Semantik Router**: Intent eşleştirme için ONNX tabanlı embedding modeli
- 🤖 **Otonom Düşünme**: Inner Monologue ve Merak motoru ile bağımsız düşünme
- 🧩 **Reconsolidation Pilot**: Bellek birleştirme ve güncelleme güvenlik mekanizması
- 📊 **Retrieval Orchestration**: Dual-process (System1/System2) bellek getirme mimarisi
- 🕸️ **GraphRAG**: Graph-aware retrieval (PageRank, topluluk tespiti), deterministic RAG pattern'leri (Evaluation Gate, Phrase Bonus Scoring) ve gölge mod test altyapısı
- 🔌 **MCP Marketplace**: Model Context Protocol entegrasyonu, genişletilebilir araç ekosistemi
- 🛡️ **Agentic RAG**: Passage Critique, Response Verification ve Multi-Hop Retrieval ile kendi kendini doğrulayan RAG
- 📈 **Yerel Metrics Sistemi**: Provider bazlı token tüketimi, maliyet hesaplama ve performans metrikleri
- 📊 **Observability UI**: Yerel metrikler, real-time dashboard ve hata analizi arayüzü
- 📡 **Multi-Channel Support**: Discord ve WebSocket kanal entegrasyonları
- 🎨 **Modern UI/UX**: Markdown render sistemi, syntax highlighting, avatar sistemi ve akıcı animasyonlar
- ⚡ **Frontend Optimizasyonu**: Component decomposition, React.memo ile render performansı ve sanallaştırılmış mesaj akışı
- 🔌 **Stabil WebSocket**: Stale closure korumalı, buffer optimizasyonlu gerçek zamanlı iletişim katmanı

---

## Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  React Web   │  │  WebSocket   │  │  Zustand + ReactQuery │ │
│  │  Arayüzü     │  │  Client      │  │  State Management     │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────┘ │
└─────────┼─────────────────┼────────────────────────────────────┘
          │                 │
┌─────────▼─────────────────▼────────────────────────────────────┐
│                      Gateway Layer                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐ │
│  │ REST API │ │WebSocket │ │ Config   │ │ Controllers       │ │
│  │ Routes   │ │ Handler  │ │ Manager  │ │ (MCP, Memory)     │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬──────────┘ │
│       │            │            │                │             │
│  ┌────▼────┐ ┌─────▼────┐ ┌────▼─────┐ ┌───────▼──────────┐ │
│  │Bootstrap│ │EnvUtils  │ │UserName  │ │AttachmentProcessor│ │
│  └─────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────┬──────────┬──────────┬──────────────────────────────┘
          │          │          │
┌─────────▼──────────▼──────────▼──────────────────────────────┐
│                      Core Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Message    │  │    Agent     │  │     LLM Provider  │  │
│  │   Router     │  │   Runtime    │  │     Factory       │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         │                 │                     │            │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌─────────▼─────────┐  │
│  │  Semantic    │  │  ReAct Loop  │  │  8 Providers:     │  │
│  │  Router      │  │  ToolManager │  │  OpenAI/Anthropic/│  │
│  │  (Worker)    │  │  ContextPrep │  │  Ollama/Groq/     │  │
│  └──────────────┘  │  MemoryExt   │  │  Mistral/NVIDIA/  │  │
│                    │  MetricsTrk  │  │  MiniMax/GitHub   │  │
│                    └──────────────┘  └───────────────────┘  │
└─────────┬──────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                      Memory Layer                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MemoryManager (Facade)                   │   │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────────┐ │   │
│  │  │Conversation│ │  Memory    │ │   Retrieval      │ │   │
│  │  │ Manager    │ │  Store     │ │   Service        │ │   │
│  │  └────────────┘ └────────────┘ └──────────────────┘ │   │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────────┐ │   │
│  │  │ Feedback   │ │ Spreading  │ │  TokenUsage      │ │   │
│  │  │ Service    │ │ Activation │ │  Service         │ │   │
│  │  └────────────┘ └────────────┘ └──────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Retrieval Orchestrator (Dual-Process)       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │
│  │  │  Intent  │ │  Primer  │ │ Scoring  │ │Spreading│ │   │
│  │  │ Analyzer │ │          │ │ Pipeline │ │Activatn │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │
│  │  │ Coverage │ │  Budget  │ │ Behavior │ │Agentic  │ │   │
│  │  │  Repair  │ │ Applier  │ │Discovery │ │  RAG    │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              GraphRAG Engine                          │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │
│  │  │  Graph   │ │  Graph   │ │PageRank  │ │Community│ │   │
│  │  │ Expander │ │  Cache   │ │ Scorer   │ │Detector │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │
│  │  │Community │ │  Token   │ │  Shadow  │ │Behavior │ │   │
│  │  │Summarizer│ │  Pruner  │ │  Mode    │ │Disc.Shd │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │  Ebbinghaus│ │Embeddings│ │  Graph   │ │  Extraction  │ │
│  │  Decay     │ │Providers │ │ Manager  │ │  Pipeline    │ │
│  └────────────┘ └──────────┘ └──────────┘ └──────────────┘ │
└──────────────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                    Autonomous Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Think Engine │  │  Curiosity   │  │   Urge Filter     │  │
│  │ (Inner Voice)│  │  Engine      │  │  (3-Katmanlı)     │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         │                 │                     │            │
│  ┌──────▼─────────────────▼─────────────────────▼─────────┐  │
│  │              Task Queue (P1-P4 Öncelik)                 │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────────┐  │
│  │           Background Worker (Hardware Aware)            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                      Data Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │    SQLite     │  │  sqlite-vec  │  │   FTS5 Index      │  │
│  │  (WAL mode)   │  │ (Vector DB)  │  │ (Full-Text Search)│  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Veri Akışı

```
Kullanıcı → Web UI → WebSocket → Gateway → Router → Memory (bağlam getir)
    → Agent Runtime → LLM Provider → Yanıt üret
    → Memory (bellek kaydet) → WebSocket → Stream yanıt → Kullanıcı
```

Detaylı akış:
1. Kullanıcı mesaj gönderir (traceId ile)
2. WebSocket mesajı + traceId Gateway'e ulaşır
3. Observability trace başlatılır
4. Router mesajı route eder (trace context ile)
5. Memory'den bağlam getirilir (bellekler + geçmiş)
6. Agent çalışır: ContextPreparer → ReActLoop → LLM çağrısı
7. LLM yanıtı alınır (traced)
8. Bellek kaydedilir (MemoryExtractor ile)
9. Trace sonlandırılır, metadata döner
10. Stream yanıt WebSocket üzerinden kullanıcıya gönderilir

---

## Modül Yapısı

### 1. Agent Modülü (`src/agent/`)

Ana ajan mantığını, ReAct döngüsünü ve LLM etkileşimini yöneten modül.

| Dosya | Açıklama |
|-------|----------|
| [`runtime.ts`](src/agent/runtime.ts) | Ana runtime sınıfı — ReAct döngüsü, GraphRAG entegrasyonu, Agentic RAG |
| [`reactLoop.ts`](src/agent/reactLoop.ts) | ReAct döngüsü implementasyonu — iteratif LLM çağrısı ve araç yürütme |
| [`prompt.ts`](src/agent/prompt.ts) | Sistem prompt'ları, araç tanımları ve extraction prompt şablonları |
| [`tools.ts`](src/agent/tools.ts) | Yerleşik araç implementasyonları ve Zod güvenlik şemaları |
| [`toolManager.ts`](src/agent/toolManager.ts) | Birleşik araç yönetimi — built-in + MCP araçlarını koordine eder |
| [`toolPromptBuilder.ts`](src/agent/toolPromptBuilder.ts) | Native tool API desteği olmayan modeller için fallback prompt enjeksiyonu |
| [`contextPreparer.ts`](src/agent/contextPreparer.ts) | LLM bağlam hazırlama — prompt oluşturma, bellek ilişkileri, token hesaplama |
| [`memoryExtractor.ts`](src/agent/memoryExtractor.ts) | Bellek çıkarım motoru — hafif/derin tarama, graph kuyruğu, merge fonksiyonu |
| [`metricsTracker.ts`](src/agent/metricsTracker.ts) | Oturum bazlı metrik takibi — token, maliyet, performans zamanlamaları |
| [`graphRAGManager.ts`](src/agent/graphRAGManager.ts) | GraphRAG retrieval yöneticisi — shadow mode ve graph-aware arama |
| [`fallbackParser.ts`](src/agent/fallbackParser.ts) | Fallback araç çağrısı ayrıştırma — tool_code, JSON, fonksiyon çağrısı formatları |
| [`runtimeContext.ts`](src/agent/runtimeContext.ts) | Konuşma geçmişi budama ve bağlam formatlama |
| [`compactEngine.ts`](src/agent/compactEngine.ts) | Bağlam sıkıştırma motoru — token optimizasyonu ve context window yönetimi |

#### `runtime.ts` - Agent Runtime

```typescript
class AgentRuntime {
  // Ana bileşenler
  private llm: LLMProvider;
  private memory: MemoryManager;
  private toolManager: ToolManager;
  private graphRAGManager: GraphRAGManager;
  private contextPreparer: ContextPreparer;
  private memoryExtractor: MemoryExtractor;
  private responseVerifier?: ResponseVerifier;  // Agentic RAG
  private metricsTracker: MetricsTracker;

  // Ana metotlar
  processMessage()       // Kullanıcı mesajını işler
  runReActLoop()         // Reason-Act-Observe döngüsü (ReActLoop'a delege)

  // GraphRAG
  setGraphRAGComponents() // GraphRAG motorunu dış bağımlılıklarla bağlar
}
```

#### `reactLoop.ts` - ReAct Döngüsü

```typescript
class ReActLoop {
  async execute(input: ReActLoopInput): Promise<ReActLoopResult>;
  // Her iterasyonda:
  // 1. Tool definitions güncellenir (MCP araçları dinamik)
  // 2. LLM çağrılır (streaming veya normal)
  // 3. Tool call tespiti (native veya fallback parser)
  // 4. Araç yürütülür, sonuç mesajlara eklenir
  // 5. TOOL_CALL_CLEAR_SIGNAL ile stream temizlenir
}
```

#### `tools.ts` - Yerleşik Araçlar

| Araç | Açıklama | Güvenlik |
|------|----------|----------|
| `readFile` | Dosya okuma | Path validation + Zod schema |
| `writeFile` | Dosya yazma | Path validation + confirm |
| `listDirectory` | Dizin listeleme | Path validation |
| `searchMemory` | Bellek arama | Read-only, graph-aware |
| `deleteMemory` | Bellek silme | Confirm required |
| `saveMemory` | Bellek kaydetme | Validation + mergeFn |
| `searchConversation` | Konuşma arama | Read-only, hybrid search |
| `webTool` | Web isteği | URL validation, quick/deep mode |
| `executeShell` | Komut çalıştırma | Blocked commands + path extraction |
| `webSearch` | Web arama | Brave Search API, rate limited |

#### `toolManager.ts` - Araç Yöneticisi

```typescript
class ToolManager {
  // Built-in + MCP araçlarını birleştirir
  ensureTools()                      // Araçları başlat (built-in + MCP)
  getEffectiveToolDefinitions()      // Tüm araç tanımlarını döndür (önbellekli)
  executeTool()                      // Araç yürüt (built-in veya MCP)
  compressToolDefinitions()          // Token tasarrufu için açıklama kısaltma
  pruneExcessTools()                 // MAX_TOOLS_IN_CONTEXT (20) sınırı
}
```

#### `memoryExtractor.ts` - Bellek Çıkarım Motoru

```typescript
class MemoryExtractor {
  // Hafif tarama: her 3 mesajda bir (EXTRACTION_INTERVAL = 3)
  pushExtractionContext()            // Çıkarım bağlamını kuyruğa ekle
  checkAndPrepareExtraction()        // Eşik kontrolü ve birleştirme

  // Derin tarama: konuşma sonunda
  extractMemoriesDeep()              // Derin bellek çıkarımı
  summarizeConversation()            // Konuşma özetleme

  // Graph kuyruğu
  enqueueGraphTask()                 // Graph işlemini kuyruğa ekle (retry: 3)

  // Merge fonksiyonu
  createMergeFn()                    // LLM tabanlı bellek birleştirme
}
```

---

### 2.1. MCP (Model Context Protocol) Modülü (`src/agent/mcp/`)

Harici araç sunucularını standart Model Context Protocol üzerinden entegre eden genişletilebilir araç ekosistemi.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/agent/mcp/index.ts) | MCP modülü public API — tüm export'ları tek noktadan sağlar |
| [`client.ts`](src/agent/mcp/client.ts) | MCP sunucu yöneticisi — başlatma, durum takibi, araç çağrıları, description stripping |
| [`adapter.ts`](src/agent/mcp/adapter.ts) | MCP araçlarını ToolExecutor interface'ine adapte eder |
| [`runtime.ts`](src/agent/mcp/runtime.ts) | MCP runtime — agent ile MCP entegrasyonu, lifecycle yönetimi |
| [`registry.ts`](src/agent/mcp/registry.ts) | Unified tool registry — built-in + MCP araçlarını tek noktada birleştirir |
| [`transport.ts`](src/agent/mcp/transport.ts) | MCP transport layer — stdio ve SSE iletişim, hassas env filtreleme |
| [`security.ts`](src/agent/mcp/security.ts) | Güvenlik katmanı — tehlikeli pattern engelleme, concurrency limiter, rate limiter |
| [`config.ts`](src/agent/mcp/config.ts) | MCP yapılandırma yönetimi — Zod ile env parse ve validation |
| [`contracts.ts`](src/agent/mcp/contracts.ts) | Interface contract'ları — MCPManagerContract, ToolRegistryContract, TransportContract |
| [`eventBus.ts`](src/agent/mcp/eventBus.ts) | Typed event bus — lifecycle ve runtime event'leri, circular dependency kırıcı |
| [`watcher.ts`](src/agent/mcp/watcher.ts) | .env dosya izleyici — MCP hot reloading, debounce ile değişiklik algılama |
| [`hooks.ts`](src/agent/mcp/hooks.ts) | MCP lifecycle hooks — sunucu başlatma/durdurma hook'ları |
| [`hookTypes.ts`](src/agent/mcp/hookTypes.ts) | Hook tip tanımları — MCPHook, HookCallback, HookPriority |
| [`builtInHooks.ts`](src/agent/mcp/builtInHooks.ts) | Yerleşik hook implementasyonları — varsayılan lifecycle hook'ları |
| [`command-validator.ts`](src/agent/mcp/command-validator.ts) | Komut doğrulama — OWASP CWE-78 koruması, merkezi allowlist |
| [`result.ts`](src/agent/mcp/result.ts) | Result pattern — `Result<T, E>`, `success()`, `error()`, `tryAsync()` |
| [`types.ts`](src/agent/mcp/types.ts) | MCP tip tanımları — MCPServerConfigSchema, UnifiedToolDefinition, MCPEventType |
| [`marketplace-types.ts`](src/agent/mcp/marketplace-types.ts) | Marketplace tip tanımları — MCPServerCatalogEntry, MCPServerRecord, lifecycle status |
| [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts) | Marketplace servisi — local catalog yükleme, registry API entegrasyonu, TTL önbellek |
| [`marketplace-catalog.json`](src/agent/mcp/marketplace-catalog.json) | Marketplace kataloğu — mevcut MCP sunucuları |
| [`marketplace-catalog.schema.json`](src/agent/mcp/marketplace-catalog.schema.json) | Katalog JSON şeması |

#### MCP Event Tipleri

```typescript
// Lifecycle events
'server:activated'    | 'server:deactivated'
'server:installed'    | 'server:uninstalled'

// Runtime events
'server:connected'    | 'server:disconnected'  | 'server:error'
'tool:call_start'     | 'tool:call_end'        | 'tool:call_error'

// Discovery
'tools:discovered'
```

#### Güvenlik Katmanları

1. **Command Validation**: Allowlist — `['npx', 'node', 'python', 'python3', 'curl']`
2. **Dangerous Pattern Blocking**: Path traversal, null byte, command injection, SQL injection, XSS
3. **Argument Validation**: JSON boyut limiti (65KB), circular reference kontrolü
4. **Concurrency Limiter**: Semaphore-based, `MCP_MAX_CONCURRENT` ayarı
5. **Rate Limiter**: Zaman penceresi bazlı araç çağrı sınırlama
6. **Defense in Depth**: Manager + Adapter seviyesinde çift validasyon

#### Result Pattern

```typescript
type Result<T, E = Error> = SuccessResult<T> | ErrorResult<E>;
function success<T>(data: T): Result<T>;
function error<E>(err: E): Result<never, E>;
function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>>;
```

---

### 2.2. LLM Modülü (`src/llm/`)

Çoklu LLM sağlayıcı desteği için soyutlama katmanı.

| Dosya | Açıklama |
|-------|----------|
| [`provider.ts`](src/llm/provider.ts) | Soyut temel sınıf, fabrika pattern'i ve `TOOL_CALL_CLEAR_SIGNAL` |
| [`index.ts`](src/llm/index.ts) | Tüm provider'ları dışa aktarır ve `registerAllProviders()` |
| [`openai.ts`](src/llm/openai.ts) | OpenAI provider |
| [`anthropic.ts`](src/llm/anthropic.ts) | Anthropic provider |
| [`ollama.ts`](src/llm/ollama.ts) | Ollama yerel provider |
| [`minimax.ts`](src/llm/minimax.ts) | MiniMax provider |
| [`github.ts`](src/llm/github.ts) | GitHub Models provider |
| [`groq.ts`](src/llm/groq.ts) | Groq provider |
| [`mistral.ts`](src/llm/mistral.ts) | Mistral AI provider |
| [`nvidia.ts`](src/llm/nvidia.ts) | NVIDIA NIM provider |

#### Provider Mimarisi

```typescript
abstract class LLMProvider {
  abstract readonly name: string;
  abstract readonly supportedModels: string[];
  get supportsNativeToolCalling(): boolean;  // Alt sınıflar override eder
  get defaultModel(): string;

  abstract chat(messages, options): Promise<LLMResponse>;
  chatStream?(messages, options, onToken): Promise<LLMResponse>;
  abstract healthCheck(): Promise<boolean>;
  protected resolveModel(requestedModel?): string;
}

class LLMProviderFactory {
  static register(name, factory): void;
  static async create(name): Promise<LLMProvider>;
  static getAvailable(): string[];
}
```

#### Desteklenen Modeller

| Provider | Modeller |
|----------|----------|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo, o1, o1-mini |
| **Anthropic** | claude-sonnet-4-20250514, claude-3-5-haiku-20241022, claude-3-opus-20240229 |
| **Ollama** | llama3.3, llama3.1, mistral, codellama, deepseek-r1, qwen2.5 |
| **MiniMax** | MiniMax-M2.5, MiniMax-M2.5-highspeed, MiniMax-M2.1, MiniMax-M2 |
| **GitHub** | gpt-4o, gpt-4.1, o1, o3, llama-3.x, phi-4, deepseek-r1, mistral-large |
| **Groq** | llama-3.3-70b-versatile, groq/compound, llama-4-scout, qwen3-32b |
| **Mistral** | mistral-large-latest, codestral-latest, devstral-latest, magistral-medium |
| **NVIDIA** | llama-4-maverick, deepseek-v3.2, qwen3.5-397b, gemma-3-27b, phi-4-multimodal |

---

### 3. Memory Modülü (`src/memory/`)

Bilişsel bellek sistemi, bilgi yönetimi ve retrieval orchestration.

| Dosya | Açıklama |
|-------|----------|
| [`database.ts`](src/memory/database.ts) | SQLite veritabanı bağlantısı, şema yönetimi (v17), sqlite-vec entegrasyonu |
| [`graph.ts`](src/memory/graph.ts) | Bellek grafi yönetimi — entity, ilişki, proximity, Ebbinghaus stability |
| [`ebbinghaus.ts`](src/memory/ebbinghaus.ts) | Ebbinghaus unutma eğrisi — saf matematik fonksiyonları |
| [`embeddings.ts`](src/memory/embeddings.ts) | Embedding provider'ları — OpenAI, MiniMax, Voyage, retry mekanizması |
| [`contextUtils.ts`](src/memory/contextUtils.ts) | RRF fusion, bellek yazma meta verisi, konuşma bağlam yardımcıları |
| [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts) | Dual-process retrieval orchestrator — tüm alt modülleri koordine eder |
| [`shortTermPhase.ts`](src/memory/shortTermPhase.ts) | Reconsolidation pilot — bellek birleştirme kararları ve güvenlik eşikleri |
| [`types.ts`](src/memory/types.ts) | Tüm bellek tip tanımları — MemoryRow, BehaviorDiscoveryTrace, MemoryType |

#### Manager Alt Modülü (`src/memory/manager/`)

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/memory/manager/index.ts) | MemoryManager ana giriş noktası (Facade Pattern) |
| [`ConversationManager.ts`](src/memory/manager/ConversationManager.ts) | Konuşma CRUD — oluşturma, 2 saat timeout, mesaj ekleme, özet |
| [`MemoryStore.ts`](src/memory/manager/MemoryStore.ts) | Bellek saklama — semantik dedup, Ebbinghaus decay, ayarlar, kilit mekanizması |
| [`RetrievalService.ts`](src/memory/manager/RetrievalService.ts) | Arama servisleri — FTS, semantik, hibrit, graph-aware, mesaj arama |
| [`FeedbackService.ts`](src/memory/manager/FeedbackService.ts) | Kullanıcı feedback yönetimi — kaydetme, konuşma/mesaj bazlı sorgulama |
| [`SpreadingActivationService.ts`](src/memory/manager/SpreadingActivationService.ts) | Klasik iterative spreading activation — graph üzerinde activation yayma |
| [`TokenUsageService.ts`](src/memory/manager/TokenUsageService.ts) | LLM token kullanım takibi — kayıt, dönemsel istatistik, günlük rapor |
| [`types.ts`](src/memory/manager/types.ts) | Manager tip tanımları — PromptContextBundle, AddMemoryResult, DecayResult |

#### Extraction Pipeline (`src/memory/extraction/`)

| Dosya | Açıklama |
|-------|----------|
| [`pipeline.ts`](src/memory/extraction/pipeline.ts) | Ana pipeline orchestrator — adım adım çıkarım, early exit |
| [`types.ts`](src/memory/extraction/types.ts) | Extraction tipleri — ExtractedEntity, ExtractedRelation, ExtractedClaim, RawLlmRelation |

##### Extraction Steps (`src/memory/extraction/steps/`)

| Dosya | Açıklama |
|-------|----------|
| [`claimExtractor.ts`](src/memory/extraction/steps/claimExtractor.ts) | Claim çıkarımı — olgu ve iddia tespiti |
| [`datetime.ts`](src/memory/extraction/steps/datetime.ts) | Tarih/saat çıkarımı — chrono-node ile temporal entity tespiti |
| [`knownEntities.ts`](src/memory/extraction/steps/knownEntities.ts) | Bilinen entity eşleştirme — mevcut entity'lerle karşılaştırma |
| [`llmFallback.ts`](src/memory/extraction/steps/llmFallback.ts) | LLM fallback extraction — regex başarısız olduğunda LLM tabanlı extraction |
| [`network.ts`](src/memory/extraction/steps/network.ts) | Network/ilişki çıkarımı — entity'ler arası bağlantı tespiti |

#### Retrieval Alt Modülü (`src/memory/retrieval/`)

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/memory/retrieval/index.ts) | Retrieval barrel export — tüm alt modülleri dışa aktarır |
| [`Orchestrator.ts`](src/memory/retrieval/Orchestrator.ts) | Re-export — gerçek implementasyon `retrievalOrchestrator.ts` |
| [`IntentAnalyzer.ts`](src/memory/retrieval/IntentAnalyzer.ts) | Regex tabanlı niyet sinyali tespiti (8 sinyal), recipe seçimi, GraphRAG recipe'leri |
| [`RetrievalPrimer.ts`](src/memory/retrieval/RetrievalPrimer.ts) | Priming bonus hesaplama — entity, topic, type, provenance, review ağırlıkları |
| [`ScoringPipeline.ts`](src/memory/retrieval/ScoringPipeline.ts) | Sıralama pipeline'ı — signal + priming + activation + importance + access skorları |
| [`SpreadingActivation.ts`](src/memory/retrieval/SpreadingActivation.ts) | Retrieval-time spreading activation — seed seçimi, komşu genişleme, bonus hesaplama |
| [`CoverageRepair.ts`](src/memory/retrieval/CoverageRepair.ts) | Coverage gap tespiti ve 2. geçiş düzeltme — tip, konuşma, kategori kapsamı |
| [`BudgetApplier.ts`](src/memory/retrieval/BudgetApplier.ts) | Bilişsel yük bazlı bütçe uygulama — high/medium/low load profilleri |
| [`BehaviorDiscovery.ts`](src/memory/retrieval/BehaviorDiscovery.ts) | Davranış keşif shadow modu — sinyal toplama, shadow plan oluşturma |
| [`RetrievalConfidenceScorer.ts`](src/memory/retrieval/RetrievalConfidenceScorer.ts) | Deterministik retrieval karar motoru — ağırlıklı puanlama, zorunlu koşullar |
| [`PassageCritique.ts`](src/memory/retrieval/PassageCritique.ts) | Agentic RAG Faz 2 — LLM ile passage değerlendirme (relevance + completeness) |
| [`ResponseVerifier.ts`](src/memory/retrieval/ResponseVerifier.ts) | Agentic RAG Faz 3 — yanıt doğrulama, hallüsinasyon tespiti, utility skoru |
| [`MultiHopRetrieval.ts`](src/memory/retrieval/MultiHopRetrieval.ts) | Agentic RAG Faz 4 — eksik bilgi için çok adımlı arama, refined query üretimi |
| [`types.ts`](src/memory/retrieval/types.ts) | Retrieval tip tanımları — 35+ interface, DualProcessMode, BudgetProfileName |

#### Bellek Katmanları

```
Input (Kullanıcı Mesajı)
    ↓
Short-Term Memory (Working Memory)
    ↓ Normalization
    ↓ Reconsolidation Guardrails
    ↓
Long-Term Memory (episodic / semantic)
    ↓ Entity & Relation Extraction
    ↓
Retrieval: FTS + Semantic → RRF Fusion → Graph-Aware
```

#### `manager/index.ts` - MemoryManager (Facade)

```typescript
class MemoryManager {
  // Konuşma yönetimi (→ ConversationManager)
  getOrCreateConversation()  beginConversationTurn()  addMessage()
  getConversationHistory()   updateConversationSummary() updateConversationTitle()
  deleteConversation()       getRecentConversations()

  // Bellek CRUD (→ MemoryStore)
  addMemory()    // Semantik dedup + reconsolidation pilot
  deleteMemory() editMemory()

  // Arama (→ RetrievalService)
  searchMemories()         // FTS tam metin arama
  semanticSearch()         // Embedding benzerlik arama
  hybridSearch()           // FTS + Semantik + RRF fusion
  graphAwareSearch()       // Graph-aware hibrit arama
  hybridSearchMessages()   // Mesajlarda hibrit arama

  // Prompt context
  getPromptContextBundle() // Çok aşamalı bellek getirme

  // Graph yönetimi (→ MemoryGraphManager)
  processMemoryGraph()     getMemoryGraph()       decayRelationships()
  getMemoryNeighborsBatch() ensureAllMemoryGraphRelations()

  // Ebbinghaus
  decayMemories()          executeEbbinghausUpdates()  getMemoriesDueForReview()

  // Feedback (→ FeedbackService)
  saveFeedback()           getFeedbacks()

  // Token Usage (→ TokenUsageService)
  saveTokenUsage()         getTokenUsageStats()   getDailyUsage()
}
```

#### `ebbinghaus.ts` - Unutma Eğrisi

```typescript
// R(t) = e^(-t/S)  — Hatırlama olasılığı
computeRetention(stability, daysSince)

// t_review = -S * ln(0.7) ≈ S * 0.3567
computeNextReview(stability)

// S_new = S * (1 + 0.9 * R)
computeNewStability(currentStability, currentRetention)

// Review politikaları
const REVIEW_POLICIES = {
  strict:    { initialStabilityMultiplier: 0.9, retentionFloor: 0.8 },
  standard:  { initialStabilityMultiplier: 1.0, retentionFloor: 0.7 },
  volatile:  { initialStabilityMultiplier: 0.7, retentionFloor: 0.62 },
  durable:   { initialStabilityMultiplier: 1.2, retentionFloor: 0.6 },
};
```

#### `shortTermPhase.ts` - Reconsolidation Pilot

```typescript
// Guardrail eşikleri
const DEFAULT_RECONSOLIDATION_GUARDRAILS = {
  confidenceFloor: 0.78,
  strictContainmentFloor: 0.92,
  structuredVarianceSimilarityFloor: 0.95,
  highSimilaritySemanticFloor: 0.93,
  highSimilarityJaccardFloor: 0.85,
  appendSemanticFloor: 0.86,
  appendJaccardFloor: 0.72,
};

// Bellek birleştirme kararları
decideMemoryMerge(input): MemoryMergeDecision
decideReconsolidationPilot(input): ReconsolidationDecision

// Aksiyon modları
type ReconsolidationProposalMode = 'skip' | 'proposal_append' | 'commit_update';
```

#### Agentic RAG (5 Faz)

```
Faz 1: RetrievalConfidenceScorer — Deterministik retrieval kararı
Faz 2: PassageCritique — LLM ile passage değerlendirme (relevance + completeness)
Faz 3: ResponseVerifier — Yanıt doğrulama, hallüsinasyon tespiti
Faz 4: MultiHopRetrieval — Eksik bilgi için çok adımlı arama
Faz 5: Tüm bileşenlerin orchestrator ile entegrasyonu
```

---

### 3.1. GraphRAG Modülü (`src/memory/graphRAG/`)

Graph-augmented retrieval sistemi. Graph yapısını kullanarak daha alakalı bellekleri getirme, topluluk tespiti ve optimizasyon sağlar.

| Dosya | Açıklama |
|-------|----------|
| [`GraphRAGEngine.ts`](src/memory/graphRAG/GraphRAGEngine.ts) | Ana Graph RAG motoru — graph-aware retrieval, RRF Phrase Bonus, Evaluation Gate |
| [`GlobalSearchEngine.ts`](src/memory/graphRAG/GlobalSearchEngine.ts) | Global arama motoru — graph-wide topluluk bazlı arama ve özetleme |
| [`GraphExpander.ts`](src/memory/graphRAG/GraphExpander.ts) | Graph genişletme ve node keşfi |
| [`GraphCache.ts`](src/memory/graphRAG/GraphCache.ts) | Graph sonuçları önbellekleme |
| [`GraphWorker.ts`](src/memory/graphRAG/GraphWorker.ts) | Arka plan graph işlemleri |
| [`PageRankScorer.ts`](src/memory/graphRAG/PageRankScorer.ts) | PageRank tabanlı node skorlama |
| [`CommunityDetector.ts`](src/memory/graphRAG/CommunityDetector.ts) | Topluluk tespiti (community detection) |
| [`CommunitySummarizer.ts`](src/memory/graphRAG/CommunitySummarizer.ts) | Topluluk özetleme |
| [`TokenPruner.ts`](src/memory/graphRAG/TokenPruner.ts) | Token budama optimizasyonu |
| [`ShadowMode.ts`](src/memory/graphRAG/ShadowMode.ts) | Gölge mod test altyapısı |
| [`BehaviorDiscoveryShadow.ts`](src/memory/graphRAG/BehaviorDiscoveryShadow.ts) | Davranış keşif gölge modu |
| [`config.ts`](src/memory/graphRAG/config.ts) | GraphRAG konfigürasyonu ve rollout faz yönetimi |
| [`index.ts`](src/memory/graphRAG/index.ts) | Modül giriş noktası |
| [`monitoring.ts`](src/memory/graphRAG/monitoring.ts) | İzleme ve metrikler |
| [`rollback.ts`](src/memory/graphRAG/rollback.ts) | Geri alma mekanizması |

#### GraphRAG Rollout Fazları

```
disabled → observe → candidate → shadow → limited → trusted
```

#### Behavior Discovery Lifecycle

```
disabled → observe → candidate → shadow → limited → trusted
```

---

### 4. Router Modülü (`src/router/`)

Mesaj yönlendirme ve semantik intent eşleştirme.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/router/index.ts) | Mesaj yöneticisi — kanal kaydı, mesaj yönlendirme, race condition koruması |
| [`types.ts`](src/router/types.ts) | Router ve LLM tip tanımları — UnifiedMessage, Channel, ToolCall, LLMMessage |
| [`semantic.ts`](src/router/semantic.ts) | Semantik intent eşleştirme — worker thread, önbellek, fallback, timeout |
| [`embedding-worker.ts`](src/router/embedding-worker.ts) | Worker thread embedding — Xenova/all-MiniLM-L6-v2 (INT8 quantized) |

#### Semantic Router

```typescript
class SemanticRouter {
  // Intent eşleştirme
  async route(message, context): Promise<{ handled: boolean, response: string | null }> {
    // 1. Input embedding (worker thread)
    // 2. Cosine similarity with cached intent examples
    // 3. Threshold filtering (0.82)
    // 4. Return matched intent action result
  }

  registerIntent(intent: SemanticIntent): void;

  // Yapılandırma
  timeout: { initialLoadMs: 120000, normalMs: 15000, maxRetries: 3 }
  cache:   { ttlMinutes: 30, maxEntries: 500, maxMemoryMB: 100 }
  fallback: { mode: 'llm' | 'default' | 'none' }
}
```

#### Kanal Tipleri

```typescript
type ChannelType = 'web' | 'telegram' | 'discord' | 'whatsapp';
```

---

### 5. Gateway Modülü (`src/gateway/`)

HTTP/WebSocket sunucusu, REST API ve uygulama başlatma.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/gateway/index.ts) | Ana giriş noktası — Express sunucu başlatma |
| [`routes.ts`](src/gateway/routes.ts) | REST API route tanımları — controller tabanlı yapı |
| [`websocket.ts`](src/gateway/websocket.ts) | WebSocket bağlantı yönetimi — chat, onay, düşünme modu, timeout |
| [`config.ts`](src/gateway/config.ts) | Zod-validasyonlu uygulama konfigürasyonu singleton |
| [`bootstrap.ts`](src/gateway/bootstrap.ts) | Dashboard auth, public dizin çözümleme, WebSocket yükseltme |
| [`envUtils.ts`](src/gateway/envUtils.ts) | .env dosyası atomik yazma — temp file + rename, Windows EPERM fallback |
| [`userName.ts`](src/gateway/userName.ts) | Kullanıcı adı çözümleme — fallback zinciri |
| [`intents.ts`](src/gateway/intents.ts) | Lokal semantik intent'ler — kuyruk temizleme, worker durumu |
| [`attachmentProcessor.ts`](src/gateway/attachmentProcessor.ts) | WebSocket ek dosya işleme — metin, görsel, binary, boyut limiti |

#### Controllers (`src/gateway/controllers/`)

| Dosya | Açıklama |
|-------|----------|
| [`mcpController.ts`](src/gateway/controllers/mcpController.ts) | MCP sunucu yönetimi API — marketplace, CRUD, activate/deactivate |
| [`memoryController.ts`](src/gateway/controllers/memoryController.ts) | Bellek yönetimi API — konuşmalar, bellekler, graph, istatistikler |

#### Services (`src/gateway/services/`)

| Dosya | Açıklama |
|-------|----------|
| [`mcpService.ts`](src/gateway/services/mcpService.ts) | MCP servis katmanı — DB CRUD, lifecycle, marketplace entegrasyonu |

#### Channels (`src/gateway/channels/`)

| Dosya | Açıklama |
|-------|----------|
| [`discord.ts`](src/gateway/channels/discord.ts) | Discord kanalı — DM yetki kontrolü, mention/reply algılama, mesaj bölme |

#### Jobs (`src/gateway/jobs/`)

| Dosya | Açıklama |
|-------|----------|
| [`systemTasks.ts`](src/gateway/jobs/systemTasks.ts) | Sistem bakım görevleri |
| [`autonomousWorker.ts`](src/gateway/jobs/autonomousWorker.ts) | Otonom görev arka plan çalıştırıcısı — periyodik task execution |

#### Konfigürasyon (`config.ts`)

```typescript
interface AppConfig {
  port: number;                    // Sunucu portu (default: 3000)
  host: string;                    // Host adresi
  dbPath: string;                  // Veritabanı yolu
  projectRoot: string;
  defaultUserName: string;

  // LLM
  defaultLLMProvider: 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'github' | 'groq' | 'mistral' | 'nvidia';
  defaultLLMModel: string;
  openaiApiKey?: string;  anthropicApiKey?: string;  minimaxApiKey?: string;
  githubToken?: string;   groqApiKey?: string;       mistralApiKey?: string;
  nvidiaApiKey?: string;  ollamaBaseUrl: string;
  enableOllamaTools: boolean;  enableNvidiaTools: boolean;

  // Embedding
  embeddingProvider: 'minimax' | 'openai' | 'voyage' | 'none';
  embeddingModel: string;  voyageApiKey?: string;

  // Channels
  telegramBotToken?: string;  telegramAllowedUsers: string[];
  discordBotToken?: string;   discordAllowedUsers: string[];
  whatsappEnabled: boolean;

  // Security
  allowShellExecution: boolean;  fsRootDir?: string;
  dashboardPassword?: string;    braveSearchApiKey?: string;
  jinaReaderApiKey?: string;     sensitivePaths: string[];

  // Advanced
  systemPrompt?: string;         autonomousStepLimit: number;
  memoryDecayThreshold: number;  semanticSearchThreshold: number;
  logLevel: 'debug' | 'info' | 'error';
  temperature: number;           maxTokens: number;
}
```

---

### 6. Autonomous Modülü (`src/autonomous/`)

Otonom düşünme ve görev yönetimi.

| Dosya | Açıklama |
|-------|----------|
| [`thinkEngine.ts`](src/autonomous/thinkEngine.ts) | İç Ses Motoru — tohum seçimi, graph-walk, düşünce sentezi |
| [`curiosityEngine.ts`](src/autonomous/curiosityEngine.ts) | Merak motoru — alt-ajan araştırma görevleri, fixation keşfi |
| [`urgeFilter.ts`](src/autonomous/urgeFilter.ts) | Dürtü Eşiği — 3 katmanlı filtre, feedback döngüsü |
| [`queue.ts`](src/autonomous/queue.ts) | Öncelik tabanlı görev kuyruğu — SQLite checkpointing |
| [`worker.ts`](src/autonomous/worker.ts) | Arka plan görev çalıştırıcısı — hardware aware, graceful interrupt |
| [`index.ts`](src/autonomous/index.ts) | Modül giriş noktası — barrel re-export |

#### Otonom Düşünme Akışı

```
Think Engine: Seed Seçimi → Graph Walk → Düşünce Sentezi
    ↓
Urge Filter: Mutlak Kurallar → Deterministik Skorlama → Feedback Döngüsü
    ↓
Aksiyon: send / digest / discard / blocked
    ↓
Curiosity Engine: Fixation keşfi → ResearchTask → Sub-Agent araştırma
```

#### `thinkEngine.ts` - İç Ses Motoru

```typescript
// Tohum türleri
type SeedType = 'time_context' | 'recent_memory' | 'high_importance' | 'random_walk';

// Sabitler
const FRESHNESS_THRESHOLD = 0.3;  // Ebbinghaus tazelik eşiği
const MAX_HOP_DEPTH = 2;          // Maksimum graph derinliği
const MAX_ASSOCIATIONS = 8;       // Maksimum çağrışım sayısı

// Ana fonksiyonlar
selectSeed(db): ThoughtSeed | null
graphWalk(db, seedId, maxDepth): Association[]
buildThoughtChain(seed, associations, emotion): ThoughtChain
think(db, emotion): ThoughtLogEntry | null
```

#### `queue.ts` - Görev Kuyruğu

```typescript
enum TaskPriority {
  P1_CRITICAL = 1,  // Conflict resolution, user direct requests
  P2_HIGH = 2,      // Semantic routing fallback, initial graph extraction
  P3_NORMAL = 3,    // Routine memory consolidation, decay processing
  P4_LOW = 4        // Deep philosophical analysis, slow background tasks
}

class TaskQueue {
  enqueue(task): void;
  dequeue(): AutonomousTask | undefined;
  registerHandler(type, handler): void;
  markCompleted(taskId): void;
  markFailed(taskId): void;
  clear(): void;
  // SQLite checkpointing
  private syncToDb(task, status, payloadStr?): void;
  loadPendingTasks(): void;
}
```

#### `worker.ts` - Arka Plan Çalıştırıcısı

```typescript
class BackgroundWorker {
  start(): void;
  stop(): void;
  registerUserActivity(): void;  // Kullanıcı aktivitesi → graceful interrupt

  // Hardware monitoring
  private isHardwareOverloaded(): boolean;  // CPU load + memory check

  // Yapılandırma
  idleThresholdMs: 3600000      // 1 saat sonra arka plan başlar
  boredomThresholdMs: 900000    // 15 dk max çalışma
  cpuLoadThreshold: cores * 0.8 // %80 CPU sınırı
  checkIntervalMs: 60000        // Dakikada bir kontrol
  maxIterationsPerLoop: 5       // Döngü başına max görev
}
```

#### `urgeFilter.ts` - Dürtü Filtresi

```typescript
// 3 Katmanlı Filtre:
// 1. Mutlak Kurallar (Hard Logic) — Sessiz saat, arousal taban
// 2. Deterministik Skorlama — Confirmation bias önlemi
// 3. Geri Bildirim Döngüsü — Kullanıcı davranışına göre uyarlanır

// Formül: Skor = (İlgi × 0.6) + (Zaman Hassasiyeti × 0.4) - (İsteksizlik Cezası)
computeUrgeScore(evaluation, reluctancePenalty): number
computeEffectiveThreshold(feedbackAdjustment): number
decideAction(score, threshold): ActionDecision  // 'send' | 'digest' | 'discard' | 'blocked'
filterThought(evaluation, feedbackState, currentHour): FilterResult

// Feedback loop
class FeedbackManager {
  applySignal(signal: UserBehaviorSignal): FeedbackState;
  applyDecay(): void;
  reset(): void;
}
```

---

### 7. Observability Modülü (`src/observability/`)

Yerel metrik tabanlı LLM observability altyapısı. Tüm veriler yerel SQLite'da saklanır.

| Dosya | Açıklama |
|-------|----------|
| [`metricsCollector.ts`](src/observability/metricsCollector.ts) | Yerel metrics toplama, saklama ve sorgulama |

#### Metrik Hiyerarşisi

```
MessageMetrics:
├─ conversationId, messageId, timestamp
├─ Performance: total, retrieval, graphRAG, llmCalls[], agentic, tools, toolCalls
├─ Cost: total, totalTokens, promptTokens, completionTokens
└─ Context: historyTokens, userMessageTokens, systemPromptTokens
```

#### Cost Calculation

[`costCalculator.ts`](src/utils/costCalculator.ts) — Provider/model bazlı fiyatlandırma ($/1K tokens)

#### LLM Provider Coverage: 8/8 ✅

| Provider | Cost Tracking |
|----------|---------------|
| OpenAI | calculateCost() ile |
| Anthropic | calculateCost() ile |
| Ollama | calculateCost() ile (local = $0) |
| MiniMax | calculateCost() ile |
| Groq, Mistral, NVIDIA, GitHub | calculateCost() ile |

---

### 8. Web Arayüzü (`src/web/react-app/`)

React 19 + Vite 6 + Tailwind CSS 4 tabanlı modern SPA.

| Bileşen Kategorisi | Açıklama |
|--------------------|----------|
| `src/App.tsx` | Ana uygulama bileşeni — route ve layout yönetimi |
| `src/main.tsx` | Uygulama giriş noktası — React DOM render |
| `src/pages/MetricsPage.tsx` | Metrikler sayfası — observability dashboard |
| `src/components/chat/` | Sohbet bileşenleri — ChatWindow, MessageStream, MessageBubble, CodeBlock, InputPanel, MemoryGraphView, MemorySettings, SecuritySettings, LLMSettings, SettingsDialog, OnboardingDialog, ObservabilityDialog, CommandPalette, MetricsPanel, ToolCallIndicator, MemorySourcePills, MemoryDialog, ImageLightbox, ExportDialog, ConfirmDialog, ConversationPanel, ConversationListItem, ChannelsView, MemoryGraphControls, MemoryGraphLegend, MemoryNodeDetails, SidebarMenu, MessagePanel |
| `src/components/mcp/` | MCP bileşenleri — MCPMarketplace (InstalledTab, MarketplaceTab) |
| `src/components/settings/` | Ayarlar bileşenleri — UsageStatsCard |
| `src/components/ui/` | UI bileşenleri — Radix UI tabanlı (button, dialog, input, textarea, scroll-area, Toast, ErrorBoundary, alert-dialog, badge, CanvasPanel, dropdown-menu, label, select, separator, skeleton, slider, switch, tabs, tooltip) |
| `src/hooks/` | Custom hooks — useAgentSocket, useConversationFilters, useConversations, useFileUpload, useMemoryGraph, useMessageBuilder, useSettingsForm, useStats |
| `src/hooks/queries/` | React Query hooks — useConversations, useMemories, useSettings, useMCPServers, useMetrics, useObservability, useStats, useUsageStats, useLLMProviders, useSensitivePaths, useMemoryGraph |
| `src/hooks/mutations/` | Mutation hooks — useCreateMemory, useUpdateMemory, useDeleteMemory, useDeleteConversation, useBulkDeleteConversations, useUpdateSettings, useAddSensitivePath, useRemoveSensitivePath |
| `src/store/` | Zustand store — agentStore (chatSlice, settingsSlice, uiSlice), types |
| `src/services/` | API servisleri — conversationService, memoryService, settingsService, statsService, mcpService, observabilityService |
| `src/lib/` | Yardımcılar — api-client, utils, queryClient |
| `src/providers/` | React Query provider |
| `src/styles/` | Stil dosyaları — dialog.ts |

---

### 9. Utils Modülü (`src/utils/`)

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/utils/index.ts) | Barrel re-export |
| [`datetime.ts`](src/utils/datetime.ts) | Tarih/saat yardımcıları |
| [`logger.ts`](src/utils/logger.ts) | Pino tabanlı yapılandırılmış loglama, AsyncLocalStorage trace ID, Windows UTF-8 |
| [`costCalculator.ts`](src/utils/costCalculator.ts) | Token maliyet hesaplama — provider/model bazlı fiyatlandırma |

#### `logger.ts` - Loglama Sistemi

```typescript
// Pino tabanlı, AsyncLocalStorage ile trace ID desteği
// Transport: pino-pretty (dev) + pino-roll (prod)
// Windows: chcp 65001 ile UTF-8 console desteği

runWithTraceId(traceId, () => {
  logger.info({ msg: 'Operation completed' });
});
```

---

### 10. CLI Modülü (`src/cli/`)

| Dosya | Açıklama |
|-------|----------|
| [`maintenance.ts`](src/cli/maintenance.ts) | Bellek grafi bakım aracı + GraphRAG CLI komutları |

```bash
# Kullanım
npx tsx src/cli/maintenance.ts

# İşlevler
# 1. Missing graph relations backfill
# 2. Relationship decay (Ebbinghaus)

# GraphRAG CLI Komutları
npm run graphrag:status              # GraphRAG durum kontrolü
npm run graphrag:advance             # GraphRAG faz ilerletme
npm run graphrag:set-phase           # GraphRAG faz ayarlama
npm run graphrag:readiness           # GraphRAG hazırlık kontrolü
npm run graphrag:go-full             # GraphRAG tam aktif moda geçme
npm run graphrag:emergency-rollback  # Acil geri alma
npm run graphrag:metrics             # GraphRAG metrikleri
```

---

## Veritabanı Şeması

**Mevcut Şema Versiyonu:** 17 ([`LATEST_SCHEMA_VERSION`](src/memory/database.ts:40))

### Tablolar

| Tablo | Açıklama | Anahtar Alanlar |
|-------|----------|-----------------|
| `conversations` | Konuşmalar | id (PK), channel_type, channel_id, user_id, user_name, title, summary |
| `messages` | Mesajlar | id (PK), conversation_id (FK), role, content, tool_calls, tool_results, attachments |
| `memories` | Bellekler | id (PK), user_id, content, category, importance, stability, retrievability, memory_type, confidence, review_profile, provenance_* |
| `memory_entities` | Entity'ler | id (PK), name, type, normalized_name |
| `memory_relations` | İlişkiler | id (PK), source_memory_id (FK), target_memory_id (FK), relation_type, confidence, decay_rate |
| `memory_embeddings` | Vektörler | rowid (PK), embedding (blob) — sqlite-vec |
| `memory_entity_links` | Entity-Bellek bağlantıları | memory_id (FK), entity_id (FK) |
| `autonomous_tasks` | Otonom görevler | id (PK), type, priority, payload, status |
| `feedback` | Kullanıcı geri bildirimi | id (PK), message_id, conversation_id, type, comment |
| `settings` | Ayarlar (KV) | key (PK), value |
| `mcp_servers` | MCP sunucuları | name (PK), command, args, env, status, source, tool_count |
| `token_usage` | Token kullanımı | id (PK), provider, model, prompt_tokens, completion_tokens, estimated_cost_usd |
| `graph_traversal_cache` | Graph önbellek | key (PK), result, expires_at |
| `graph_communities` | Topluluklar | id (PK), name, description, node_count, modularity |
| `graph_community_members` | Topluluk üyeleri | community_id (FK), node_id |
| `graph_community_summaries` | Topluluk özetleri | community_id (PK), summary, summary_model, tokens_used |

### İlişkiler

```
conversations ||--o{ messages : contains
conversations ||--o{ memories : has
memories ||--o{ memory_embeddings : embedded_as
memories ||--o{ memory_entity_links : has
memory_entities ||--o{ memory_entity_links : linked_to
memory_entities ||--o{ memory_relations : source
memory_entities ||--o{ memory_relations : target
```

### SQLite Pragmaları

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

### FTS5 Index'leri

`memories` ve `messages` tablolarında content sync trigger'ları (AFTER INSERT/DELETE/UPDATE) ile otomatik güncellenir.

---

## Teknoloji Yığını

### Backend

| Kategori | Teknoloji | Versiyon | Amaç |
|----------|-----------|----------|------|
| Runtime | Node.js | 22+ | JavaScript runtime |
| Language | TypeScript | 5.7+ | Tip güvenli geliştirme |
| Framework | Express | 4.21+ | HTTP sunucusu |
| WebSocket | ws | 8.18+ | Gerçek zamanlı iletişim |
| Database | better-sqlite3 | 11.7+ | SQLite veritabanı |
| Vectors | sqlite-vec | 0.1.7+ | Vektör depolama |
| AI SDK | @anthropic-ai/sdk | 0.39+ | Anthropic API |
| AI SDK | openai | 4.77+ | OpenAI API |
| AI Inference | @azure-rest/ai-inference | 1.0+ | Azure AI Inference |
| MCP SDK | @modelcontextprotocol/sdk | 1.29+ | Model Context Protocol |
| Embedding | @xenova/transformers | 2.17+ | ONNX embedding (worker thread) |
| NLP | chrono-node | 2.9+ | Tarih ayrıştırma |
| Validation | zod | 3.25+ | Runtime validation |
| Web Scraping | linkedom + @mozilla/readability | 0.18+ / 0.6+ | HTML parsing + article extraction |
| Markdown | turndown | 7.2+ | HTML to Markdown |
| Tokenizer | gpt-tokenizer | 3.4+ | Token counting |
| Logging | pino + pino-roll | 10.3+ / 4.0+ | Yapılandırılmış loglama + rotasyon |
| Utility | uuid | 11.1+ | UUID oluşturma |
| Utility | validator | 13.15+ | String validation |
| Config | dotenv | 16.4+ | Ortam değişkenleri |
| CORS | cors | 2.8+ | Cross-origin resource sharing |
| Discord | discord.js | 14.26+ | Discord bot |

### Frontend

| Kategori | Teknoloji | Versiyon | Amaç |
|----------|-----------|----------|------|
| Framework | React | 19.x | UI framework |
| Language | TypeScript | 5.x | Tip güvenli geliştirme |
| Build | Vite | 6.x | Build tool |
| Styling | Tailwind CSS | 4.x | Utility-first CSS (@tailwindcss/postcss) |
| State | Zustand | 5.x | Global state yönetimi |
| Data Fetching | @tanstack/react-query | 5.x | Server state yönetimi ve önbellekleme |
| UI | Radix UI | 1.x | Erişilebilir bileşenler |
| Icons | Lucide React | 0.x | İkon seti |
| Markdown | react-markdown + remark-gfm | 10.x / 4.x | Markdown render (GFM destekli) |
| Syntax Highlighting | react-syntax-highlighter | 16.x | Prism tabanlı kod renklendirme |
| Animation | framer-motion | 12.x | UI animasyonları |
| Virtualization | react-virtuoso | 4.x | Sanal liste render |
| Visualization | d3 | 7.x | Bellek grafiği görselleştirme |

### Test & Development

| Kategori | Teknoloji | Versiyon | Amaç |
|----------|-----------|----------|------|
| Testing Framework | Jest | 29.7+ | Unit ve integration testler |
| E2E Testing | Playwright | 1.59+ | End-to-end testler |
| React Testing | @testing-library/react | 16.3+ | React bileşen testleri |
| User Events | @testing-library/user-event | 14.6+ | Kullanıcı etkileşim simülasyonu |
| Mocking | msw | 2.12+ | API mocking |
| DOM | jsdom | 29+ | Headless browser environment |
| TypeScript | ts-jest | 29.2+ | Jest TypeScript integration (useESM: true, isolatedModules: true) |
| Dev Server | concurrently | 8.2+ | Parallel process yönetimi |
| Env | cross-env | 10.1+ | Cross-platform env variables |
| File Ops | shx | 0.3+ | Shell file operations |
| Wait | wait-on | 9.0+ | Server readiness check |

---

## API Endpoints

### REST API

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/api/health` | GET | Sağlık kontrolü |
| `/api/stats` | GET | Sistem istatistikleri |
| `/api/channels` | GET | Kanal durumu |
| `/api/conversations` | GET | Konuşma listesi |
| `/api/conversations/:id/messages` | GET | Mesaj geçmişi |
| `/api/conversations/:id` | PATCH | Konuşma başlığı güncelle |
| `/api/conversations/:id` | DELETE | Konuşma silme |
| `/api/conversations` | DELETE | Toplu konuşma silme |
| `/api/memories` | GET | Bellek listesi |
| `/api/memories` | POST | Yeni bellek ekle |
| `/api/memories/search` | GET | Bellek arama |
| `/api/memories/:id` | PUT | Bellek güncelle |
| `/api/memories/:id` | DELETE | Bellek silme |
| `/api/memory-graph` | GET | Bellek grafiği verisi |
| `/api/settings` | GET | Ayarları getir |
| `/api/settings` | POST | Ayarları güncelle |
| `/api/settings/sensitive-paths` | GET | Hassas dizinleri getir |
| `/api/settings/sensitive-paths` | POST | Hassas dizin ekle |
| `/api/settings/sensitive-paths` | DELETE | Hassas dizin sil |
| `/api/llm/providers` | GET | Kullanılabilir LLM provider'ları |
| `/api/feedback` | POST | Kullanıcı geri bildirimi kaydet |
| `/api/feedback/:conversationId` | GET | Konuşma geri bildirimlerini getir |
| `/api/onboarding/process` | POST | Onboarding biyografi işleme |
| `/api/mcp/servers` | GET | MCP sunucu listesi |
| `/api/mcp/servers` | POST | Yeni MCP sunucu ekle |
| `/api/mcp/servers/:name` | GET | MCP sunucu detayı |
| `/api/mcp/servers/:name` | PUT | MCP sunucu güncelle |
| `/api/mcp/servers/:name` | DELETE | MCP sunucu sil |
| `/api/mcp/servers/:name/activate` | POST | MCP sunucu aktifleştir |
| `/api/mcp/servers/:name/deactivate` | POST | MCP sunucu devre dışı bırak |
| `/api/mcp/tools` | GET | Tüm MCP araçları listele |
| `/api/mcp/marketplace` | GET | Marketplace kataloğu |
| `/api/mcp/marketplace/:name/install` | POST | Marketplace'den sunucu yükle |
| `/api/metrics/all` | GET | Tüm metrikler (limit param) |
| `/api/metrics/:conversationId` | GET | Konuşma bazlı metrikler |
| `/api/metrics/summary` | GET | Özet metrikler (days param) |
| `/api/metrics/provider-stats` | GET | Provider bazlı istatistikler |
| `/api/metrics/error-stats` | GET | Hata istatistikleri |
| `/api/usage/stats` | GET | Token usage istatistikleri |
| `/api/usage/daily` | GET | Günlük kullanım raporu |

---

## WebSocket Protokolü

### Mesaj Tipleri

| Tip | Yön | Açıklama |
|-----|-----|----------|
| `chat` | Client → Server | Kullanıcı mesajı |
| `set_thinking` | Client → Server | Düşünme modu ayarla |
| `confirm_response` | Client → Server | Onay yanıtı |
| `token` | Server → Client | Stream token |
| `response` | Server → Client | Tam yanıt |
| `agent_event` | Server → Client | Agent olayları (thinking, tool_start, tool_end, iteration, metrics) |
| `clear_stream` | Server → Client | Stream temizleme sinyali |
| `replace_stream` | Server → Client | Stream değiştirme |
| `confirm_request` | Server → Client | Onay isteği |
| `error` | Server → Client | Hata mesajı |
| `stats` | Server → Client | Sistem istatistikleri |

### WebSocket Yapılandırması

```typescript
const WS_CONFIG = {
  confirmationTimeoutMs: 60000,  // Onay isteği zaman aşımı
  maxMessageLength: 50000,       // Maksimum mesaj uzunluğu (karakter)
};
const MESSAGE_PROCESSING_TIMEOUT_MS = 300000; // 5 dakika
```

---

## Güvenlik

### Path Validation

```typescript
// İzin verilen kök dizin (FS_ROOT_DIR)
const resolved = path.resolve(filePath);
const root = path.resolve(config.fsRootDir);
if (!resolved.startsWith(root)) {
  throw new Error(`Erişim reddedildi`);
}
```

### MCP Command Allowlist

```typescript
const ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3', 'curl'];
// OWASP CWE-78: OS Command Injection koruması
```

### MCP Security Katmanları

- Tehlikeli pattern regex engelleme (path traversal, null byte, command injection, SQL injection, XSS)
- Concurrency limiter (semaphore-based)
- Rate limiter (zaman penceresi bazlı)
- Argument boyut limiti (65KB)
- Circular reference kontrolü

### Dashboard Auth

- Basic HTTP Authentication
- WebSocket protocol-based auth (`auth-{password}`)
- Health endpoint muafiyeti

---

## Test Yapısı

### Test Kategorileri

| Klasör | Açıklama |
|--------|----------|
| `tests/agent/` | Agent modülü testleri — contextPreparer, fallbackParser, graphRAGManager, memoryExtractor, metricsTracker, toolManager |
| `tests/agent/mcp/` | MCP testleri — adapter, client, command-validator, config, eventBus, registry, result, security, transport + integration testleri |
| `tests/autonomous/` | Otonom modül testleri — curiosityEngine, queue, thinkEngine, urgeFilter |
| `tests/memory/` | Bellek testleri — contextUtils, ebbinghaus, graphSearch, hybridSearch, memoryType, reconsolidationPilot, retrievalEdgeCases, retrievalIntegration, shortTermPhase |
| `tests/memory/graphRAG/` | GraphRAG testleri — 20+ test dosyası (Engine, Expander, Cache, Worker, PageRank, Community, TokenPruner, ShadowMode, monitoring, rollback, vb.) |
| `tests/memory/retrieval/` | Retrieval testleri — MultiHopRetrieval, PassageCritique, ResponseVerifier, RetrievalConfidenceScorer |
| `tests/benchmark/` | Benchmark testleri — retrieval benchmark, GraphRAG benchmark |
| `tests/gateway/` | Gateway testleri — websocket |
| `tests/observability/` | Observability testleri — metricsCollector |
| `tests/utils/` | Yardımcı testleri — costCalculator |
| `tests/frontend/` | Frontend testleri — ui, integration, e2e, setup |
| `tests/e2e/` | Playwright E2E testleri — MCP API, edge cases, multi-server, lifecycle, settings, websocket |

### Test Komutları

```bash
# Tüm testler
npm test

# Tek bir test dosyası
npx jest --config jest.config.js --testPathPattern='tests/path/to/file.test.ts'

# Frontend testleri
npm run test:frontend
npm run test:ui
npm run test:integration

# MCP E2E testleri (Playwright)
npm run test:mcp:e2e
npm run test:mcp:e2e:ui
npm run test:mcp:e2e:headed
npm run test:mcp:e2e:report
npm run test:mcp:e2e:debug
```

### Jest Konfigürasyonu

```javascript
// jest.config.js
{
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',     // .js uzantılarını strip et
    '^@/(.*)$': '<rootDir>/src/web/react-app/src/$1',
  },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, isolatedModules: true }] },
  testMatch: ['**/tests/**/*.test.ts'],
}
```

---

## Geliştirici Notları

### Proje Başlatma

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusu (backend + frontend)
npm run dev

# Sadece backend
npm run dev:backend-only

# Production build
npm run build

# Production start
npm run start
```

### Build Süreci

```bash
npm run build
# 1. tsc — TypeScript derlemesi
# 2. shx cp — marketplace-catalog.json → dist/agent/mcp/
# 3. cd src/web/react-app && npm run build — Vite build → dist/web/public
```

### Çevre Değişkenleri

```bash
# .env.example'den .env dosyası oluşturun

# --- Sunucu ---
PORT=3001
HOST=localhost
DB_PATH=./data/penceai.db

# --- LLM ---
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
# ... (diğer provider anahtarları)

# --- Embedding ---
EMBEDDING_PROVIDER=openai       # minimax | openai | voyage | none
EMBEDDING_MODEL=text-embedding-3-small

# --- MCP ---
ENABLE_MCP=true
MCP_SERVERS=                    # JSON array formatında
MCP_TIMEOUT=30000
MCP_MAX_CONCURRENT=5

# --- Agentic RAG ---
AGENTIC_RAG_ENABLED=true
AGENTIC_RAG_MAX_HOPS=3
AGENTIC_RAG_DECISION_CONFIDENCE=0.5
AGENTIC_RAG_CRITIQUE_RELEVANCE_FLOOR=0.5

# --- Güvenlik ---
ALLOW_SHELL_EXECUTION=false
DASHBOARD_PASSWORD=
BRAVE_SEARCH_API_KEY=
```

### Mimari Kararlar

1. **Facade Pattern**: [`MemoryManager`](src/memory/manager/index.ts), alt modülleri tek bir arayüz altında toplar
2. **Worker Thread Isolation**: [`embedding-worker.ts`](src/router/embedding-worker.ts) — embedding işlemleri ana thread'i bloklamaz
3. **Dual-Process Retrieval**: System1 (hızlı) ve System2 (derin) bellek getirme modları
4. **GraphRAG Integration**: Graph-aware retrieval ile bellek getirme iyileştirildi
5. **MCP Protocol**: Standart Model Context Protocol ile genişletilebilir araç ekosistemi
6. **Observability First**: Yerel SQLite tabanlı metrik, token ve maliyet takibi
7. **Multi-Channel Architecture**: Discord ve WebSocket kanal desteği
8. **Cost Calculator**: Provider/model bazlı gerçek zamanlı maliyet hesaplama
9. **Voyage AI Embeddings**: Yeni embedding provider desteği
10. **Barrel Exports**: Modüler export yapısı ile daha iyi developer experience
11. **Agentic RAG**: Self-verifying RAG — PassageCritique, ResponseVerifier, MultiHopRetrieval
12. **Result Pattern**: MCP modülünde throw/catch yerine `Result<T, E>` pattern
13. **ReAct Loop Extraction**: Runtime'dan ayrıştırılmış ReActLoop sınıfı
14. **ContextPreparer**: Bağlam hazırlama mantığının runtime'dan ayrıştırılması
15. **MemoryExtractor**: Bellek çıkarım mantığının runtime'dan ayrıştırılması
16. **MetricsTracker**: Oturum bazlı metrik takibinin runtime'dan ayrıştırılması

### Kritik Import Kuralı

Tüm import'lar `.js` uzantısı kullanır (ESM `"type": "module"`):

```typescript
import { MemoryManager } from '../memory/manager.js';  // ✅ Doğru
import { MemoryManager } from '../memory/manager';      // ❌ Yanlış
```

### Config Erişimi

`process.env` doğrudan okunmaz. [`getConfig()`](src/gateway/config.ts) kullanılır (Zod-validasyonlu singleton).

---

> Bu doküman PenceAI projesinin tamamını anlamak için tek bir referans noktası olarak hazırlanmıştır. Son güncelleme: 19 Nisan 2026.
