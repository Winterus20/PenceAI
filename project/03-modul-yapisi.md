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

```typescript
class ContextPreparer {
  prepare(params: ContextPrepareParams): PreparedContext;
  // System prompt oluşturma: buildSystemPrompt() + GraphRAG community summaries + MCP listesi
  // Bellek ilişkileri: getMemoryRelationsForPrompt() — komşu bellekler arası bağlantılar
  // Token hesaplama: systemPrompt + userMsg + pastHistory token ayrımı
  // Image attachment işleme: son kullanıcı mesajına imageBlocks ekleme
  // Telescopic summaries: historyToKeep filtreleme (end_msg_id bazlı)
  getTotalContextTokens(prepared: PreparedContext): number;
}
```

| [`memoryExtractor.ts`](src/agent/memoryExtractor.ts) | Bellek çıkarım motoru — hafif/derin tarama, graph kuyruğu, merge fonksiyonu |
| [`metricsTracker.ts`](src/agent/metricsTracker.ts) | Oturum bazlı metrik takibi — token, maliyet, performans zamanlamaları |

```typescript
class MetricsTracker {
  reset(startTimeMs: number): void;
  recordPerf(key: string, ms: number): void;
  setContextTokens(info: { systemPrompt: number; userMsg: number; pastHistory: number }): void;
  recordLlmCall(provider, model, promptTokens, completionTokens, durationMs): number; // returns callCost
  addToolTime(durationMs: number): void;
  incrementToolCallCount(): number;
  recordCompaction(data: { originalTokens, compactedTokens, durationMs, messagesCompacted, summaryLength }): void;
  buildMetricsEvent(conversationId: string): AgentEvent;
  buildPerformanceLog(): string;
  buildCostLog(): string | null;
  saveToDatabase(conversationId: string): Promise<void>;
}
```

| [`graphRAGManager.ts`](src/agent/graphRAGManager.ts) | GraphRAG retrieval yöneticisi — shadow mode ve graph-aware arama |

```typescript
class GraphRAGManager {
  setEngine(engine: GraphRAGEngine, shadow?: ShadowMode): void;
  async retrieve(query, contextBundle, relevantMemories, recentMessageCount): Promise<GraphRAGRetrieveResult>;
  // Shadow mode: config.shadowMode aktifse shadow query çalıştırır
  // Sample rate: Math.random() < config.sampleRate ile kontrollü retrieval
  // Skip logic: aktif bağlam + kısa query (<15 karakter) → GraphRAG atlanabilir
  // Memory merge: graphRAGResult.memories'i relevantMemories ile birleştirir
  formatCommunitySummaries(summaries): string | null;
  shouldAddToSystemPrompt(graphRAGResult): boolean;
}
```

| [`fallbackParser.ts`](src/agent/fallbackParser.ts) | Fallback araç çağrısı ayrıştırma — tool_code, JSON, fonksiyon çağrısı formatları |

```typescript
// Fallback parser fonksiyonları
function extractFallbackToolCalls(content: string, knownToolNames: Set<string>): FallbackToolCallResult;
// 1. ```tool_code ... ``` bloklarını ara
// 2. tool_code inline formatını ara
// 3. JSON bloklarını parse et (name/arguments/function pattern)
// 4. Greedy JSON fallback ({...} bloklarını dene)
// 5. Fonksiyon çağrısı formatını parse et: toolName(arg1="val", ...)

function parseFallbackArgs(toolName: string, argsString: string): Record<string, unknown>;
// JSON objesi, key=value çiftleri, veya primaryParam fallback

function getPrimaryParam(toolName: string): string;
// readFile/writeFile/editFile → 'path', searchFiles → 'pattern', executeShell → 'command', ...
```

| [`runtimeContext.ts`](src/agent/runtimeContext.ts) | Konuşma geçmişi budama ve bağlam formatlama |

```typescript
function pruneConversationHistory(history, estimateMessageTokens, maxHistoryTokens): HistoryPruneResult;
// Chunk bazlı budama: assistant+tool çiftleri birlikte tutulur
// Sondan başa token biriktirme: maxHistoryTokens aşılınca budama
// Validasyon: eşsiz assistant(toolCalls) → tool result eşleşmesi kontrolü
// Repair: eşleşmeyen assistant mesajları toolCalls'i temizlenir

function formatRecentContextMessages(messages: RecentPromptMessage[]): string[];
// [Tarih] [Konuşma Başlığı] Kullanıcı/Sen: içerik formatı
```

| [`compactEngine.ts`](src/agent/compactEngine.ts) | Bağlam sıkıştırma motoru — token optimizasyonu ve context window yönetimi |

```typescript
class CompactEngine {
  async compactIfNeeded(llmMessages, conversationHistory, sessionId, sessionToolCallCount): Promise<CompactResult>;
  // Threshold kontrolü: yaklaşık tahmin (char/4) → tam sayım (threshold'a yakınsa)
  // Teleskopik compaction: recent (1h) / medium (24h) / old (>24h) zaman dilimleri
  // Artımlı özetleme: mevcut boundary özeti varsa genişletir, yoksa taze özet üretir
  // Konuşma tipi tespiti: technical (toolDensity > 0.3 || codeDensity > 0.2) vs conversational
  // Fallback: LLM özetleme başarısız olursa heuristic summary
}
```

#### Search Alt Modülü (`src/agent/search/`)

Çoklu kaynak web arama motoru. Intent bazlı routing ile sorguları uygun kaynaklara yönlendirir ve sonuçları birleştirir.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/agent/search/index.ts) | SmartSearchEngine — çoklu kaynak arama motoru, Brave API fallback |
| [`router.ts`](src/agent/search/router.ts) | Intent bazlı arama routing — sorgu niyetine göre kaynak seçimi |
| [`merger.ts`](src/agent/search/merger.ts) | Sonuç birleştirme ve sıralama — çoklu kaynak sonuçlarını merge |
| [`types.ts`](src/agent/search/types.ts) | Arama tip tanımları — SearchResult, SearchQuery, SearchSource, SourceHealth |

##### Search Sources (`src/agent/search/sources/`)

| Dosya | Açıklama |
|-------|----------|
| [`duckduckgo.ts`](src/agent/search/sources/duckduckgo.ts) | DuckDuckGo arama adaptörü — HTML scraping tabanlı |
| [`wikipedia.ts`](src/agent/search/sources/wikipedia.ts) | Wikipedia arama adaptörü — MediaWiki API |
| [`hackernews.ts`](src/agent/search/sources/hackernews.ts) | Hacker News arama adaptörü — Algolia API |
| [`reddit.ts`](src/agent/search/sources/reddit.ts) | Reddit arama adaptörü — Reddit JSON API |

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
  private compactEngine: CompactEngine;
  private responseVerifier?: ResponseVerifier;  // Agentic RAG
  private metricsTracker: MetricsTracker;
  private feedbackManager?: FeedbackManager;
  private taskQueue?: TaskQueue;

  // Ana metotlar
  processMessage()       // Kullanıcı mesajını işler (içinde ReActLoop.execute() çağrır)

  // GraphRAG
  setGraphRAGComponents() // GraphRAG motorunu dış bağımlılıklarla bağlar
  setAgenticRAGVerifier() // Agentic RAG verifier'ı yapılandırır

  // Autonomous
  setAutonomousManagers() // FeedbackManager bağlar
  setTaskQueue()          // Arka plan görev kuyruğu bağlar
}

// processMessage() akışı:
// 1. beginConversationTurn() — konuşma başlatma / geçmiş yükleme
// 2. Context compaction — compactEngine.compactIfNeeded() + sliding window fallback
// 3. getPromptContextBundle() — bellek retrieval (FTS + semantik + graph-aware)
// 4. GraphRAG retrieve — graphRAGManager.retrieve()
// 5. ContextPreparer.prepare() — system prompt + llmMessages oluşturma
// 6. ReActLoop.execute() — iteratif LLM çağrısı ve araç yürütme
// 7. Agentic RAG verification — responseVerifier.verify() (varsa)
// 8. Metrics kaydetme — metricsTracker.saveToDatabase()
// 9. Background extraction — memoryExtractor.pushExtractionContext()
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
  // 6. Context compaction — token bütçesi aşılırsa compactEngine devreye girer
}

interface ReActLoopInput {
  llm: LLMProvider;
  toolManager: ToolManager;
  metricsTracker: MetricsTracker;
  memory: MemoryManager;
  conversationId: string;
  finalSystemPrompt: string;
  llmMessages: LLMMessage[];
  maxIterations: number;
  isToolingDisabled: boolean;
  onEvent?: AgentEventCallback;
  thinking?: boolean;
  isFirstMessage: boolean;
  contextTokenInfo: { systemPromptTokens: number; userMsgTokens: number; pastHistoryTokens: number };
  compactEngine: CompactEngine;
  compactThreshold: number;
  confirmCallback?: ConfirmCallback;
}
```

#### `tools.ts` - Yerleşik Araçlar

| Araç | Açıklama | Güvenlik |
|------|----------|----------|
| `readFile` | Dosya okuma | Path validation + Zod schema |
| `writeFile` | Dosya yazma | Path validation + confirm |
| `editFile` | Dosya düzenleme (metin değiştirme) | Path validation + confirm + oldText uzunluk kısıtı |
| `appendFile` | Dosyaya ekleme (sonuna yaz) | Path validation + confirm |
| `searchFiles` | Dosya arama (glob pattern) | Path validation |
| `listDirectory` | Dizin listeleme | Path validation |
| `searchMemory` | Bellek arama | Read-only, graph-aware |
| `deleteMemory` | Bellek silme | Confirm required |
| `saveMemory` | Bellek kaydetme | Validation + mergeFn |
| `searchConversation` | Konuşma arama | Read-only, hybrid search |
| `webTool` | Web isteği | URL validation, quick/deep mode |
| `executeShell` | Komut çalıştırma | Blocked commands + path extraction |
| `webSearch` | Web arama | Brave Search API, rate limited |
| `prompt_human` | Kullanıcıya proaktif soru sorma | Zorunlu question parametresi |
| `wake_me_in` | Gelecekte uyan ve görev yürüt | Zod validation |
| `wake_me_every` | Düzenli cron görevi | Zod validation |
| `cancel_timer` | Zamanlayıcı iptal | Zod validation |
| `list_timers` | Aktif zamanlayıcıları listele | Zod validation |

#### `toolManager.ts` - Araç Yöneticisi

```typescript
class ToolManager {
  // Built-in + MCP araçlarını birleştirir
  ensureTools()                      // Araçları başlat (built-in + MCP)
  getEffectiveToolDefinitions()      // Tüm araç tanımlarını döndür (önbellekli hash + LRU)
  executeToolsWithEvents()           // Araç yürüt + event emit + hook çağrıları
  getMcpListPrompt()                 // Aktif MCP sunucularının listesi prompt'u
  compressToolDefinitions()          // Token tasarrufu için açıklama kısaltma
  pruneExcessTools()                 // MAX_TOOLS_IN_CONTEXT (20) sınırı

  // Session tracking
  setSessionId()                     // Hook context için session ID ayarla
  sessionTotalToolTime               // Toplam araç çalışma süresi (ms)
  sessionToolCallCount               // Toplam araç çağrı sayısı
  resetSessionTracking()             // Session istatistiklerini sıfırla
}
```

#### `memoryExtractor.ts` - Bellek Çıkarım Motoru

```typescript
class MemoryExtractor {
  // Hafif tarama: adaptif interval (MIN=2, MAX=5, DEFAULT=3)
  pushExtractionContext()            // Çıkarım bağlamını kuyruğa ekle
  checkAndPrepareExtraction()        // Adaptif interval kontrolü ve birleştirme
  getAdaptiveInterval()              // Dinamik extraction interval hesaplama

  // Derin tarama: konuşma sonunda
  extractMemoriesDeep()              // Derin bellek çıkarımı
  summarizeConversation()            // Konuşma özetleme
  processRawTextForMemories()        // Ham metinden bellek çıkarımı

  // Graph kuyruğu
  enqueueGraphTask()                 // Graph işlemini kuyruğa ekle (retry: MAX_GRAPH_QUEUE_RETRIES=3)
  getDeadLetterQueue()               // Kalıcı başarısız görevlerin izlenmesi

  // Merge fonksiyonu
  createMergeFn()                    // LLM tabanlı bellek birleştirme

  // Embedding cache
  getCachedEmbedding()               // LRU cache'lenmiş embedding getirici
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

### 2.2. LLM Cache Modülü (`src/llm/`)

LLM prompt önbellekleme sistemi. Aynı prompt+model kombinasyonu için API maliyetini $0'a düşürür, yanıt süresini 10-20ms'ye indirir.

| Dosya | Açıklama |
|-------|----------|
| [`llmCache.ts`](src/llm/llmCache.ts) | SQLite tabanlı LLM cache — MD5(prompt+model) → response eşleştirme, TTL, LRU eviction |
| [`cachedProvider.ts`](src/llm/cachedProvider.ts) | Cache-aware LLM provider wrapper — tüm provider'ları otomatik önbellekleme ile sarar |

---

### 2.3. LLM Modülü (`src/llm/`)

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
| [`database.ts`](src/memory/database.ts) | SQLite veritabanı bağlantısı, şema yönetimi (v19), sqlite-vec entegrasyonu |
| [`graph.ts`](src/memory/graph.ts) | Bellek grafi yönetimi — entity, ilişki, proximity, Ebbinghaus stability |
| [`ebbinghaus.ts`](src/memory/ebbinghaus.ts) | Ebbinghaus unutma eğrisi — saf matematik fonksiyonları |
| [`embeddings.ts`](src/memory/embeddings.ts) | Embedding provider'ları — OpenAI, MiniMax, Voyage, retry mekanizması |
| [`contextUtils.ts`](src/memory/contextUtils.ts) | RRF fusion, bellek yazma meta verisi, konuşma bağlam yardımcıları |
| [`manager.ts`](src/memory/manager.ts) | Backward compatibility giriş noktası — `manager/index.ts`'den re-export |
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
| [`errorHandler.ts`](src/gateway/errorHandler.ts) | Express global hata yakalama — AppError operational vs 500 ayrımı |

#### Controllers (`src/gateway/controllers/`)

| Dosya | Açıklama |
|-------|----------|
| [`mcpController.ts`](src/gateway/controllers/mcpController.ts) | MCP sunucu yönetimi API — marketplace, CRUD, activate/deactivate |
| [`memoryController.ts`](src/gateway/controllers/memoryController.ts) | Bellek yönetimi API — konuşmalar, bellekler, graph, istatistikler |

#### Middleware (`src/gateway/middleware/`)

| Dosya | Açıklama |
|-------|----------|
| [`validate.ts`](src/gateway/middleware/validate.ts) | Zod tabanlı request validation — body, query, params schema'ları |

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
| `src/services/` | API servisleri — index (barrel export), conversationService, memoryService, settingsService, statsService, mcpService, observabilityService |
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
| [`thinkTags.ts`](src/utils/thinkTags.ts) | Think tag çıkarım yardımcısı — `<think>` etiketlerini LLM yanıtından ayıklama |

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

---
[← İçindekilere Dön](./README.md)