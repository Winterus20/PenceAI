# PenceAI Proje Haritası

> **Son Güncelleme:** 4 Nisan 2026
> **Versiyon:** 1.4.0
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
- 🕸️ **GraphRAG**: Graph-aware retrieval, PageRank skorlama, topluluk tespiti ve gölge mod test altyapısı
- 🎨 **Modern UI/UX**: Markdown render sistemi, syntax highlighting, avatar sistemi ve akıcı animasyonlar
- ⚡ **Frontend Optimizasyonu**: Component decomposition, React.memo ile render performansı ve sanallaştırılmış mesaj akışı
- 🔌 **Stabil WebSocket**: Stale closure korumalı, buffer optimizasyonlu gerçek zamanlı iletişim katmanı

---

## Mimari Genel Bakış

```mermaid
graph TB
    subgraph "Frontend Layer"
        WEB[React Web Arayüzü]
        WS[WebSocket Client]
    end
    
    subgraph "Gateway Layer"
        GW[Gateway Entry Point]
        ROUTES[REST Routes]
        WSH[WebSocket Handler]
        CONFIG[Config Manager]
        BOOTSTRAP[Bootstrap Utils]
        ENVUTILS[Env Utils]
        USERNAME[User Name Resolver]
    end
    
    subgraph "Core Layer"
        ROUTER[Message Router]
        AGENT[Agent Runtime]
        LLM[LLM Provider Factory]
    end
    
    subgraph "Memory Layer"
        MM[Memory Manager]
        MG[Memory Graph]
        EMB[Embeddings]
        RET[Retrieval Orchestrator]
        STM[Short Term Phase]
        EXT[Extraction Pipeline]
    end
    
    subgraph "Autonomous Layer"
        THINK[Think Engine]
        CURIO[Curiosity Engine]
        URGE[Urge Filter]
        QUEUE[Task Queue]
        WORKER[Background Worker]
    end
    
    subgraph "Data Layer"
        DB[(SQLite Database)]
        VEC[(Vector Store)]
        FTS[(Full-Text Search)]
    end
    
    WEB --> ROUTES
    WEB --> WS
    WS --> WSH
    WSH --> ROUTER
    ROUTES --> MM
    ROUTER --> AGENT
    AGENT --> LLM
    AGENT --> MM
    MM --> MG
    MM --> RET
    RET --> EMB
    MM --> DB
    MG --> DB
    EMB --> VEC
    THINK --> MM
    THINK --> QUEUE
    CURIO --> AGENT
    URGE --> THINK
    WORKER --> QUEUE
```

### Veri Akışı

```mermaid
sequenceDiagram
    participant U as Kullanıcı
    participant W as Web UI
    participant G as Gateway
    participant O as Observability
    participant R as Router
    participant A as Agent
    participant L as LLM
    participant M as Memory

    U->>W: Mesaj gönder (traceId)
    W->>G: WebSocket mesajı + traceId
    G->>O: Trace başlat
    O->>R: Route mesaj (trace context)
    R->>M: Bağlam getir
    M-->>R: Bellekler + Geçmiş
    R->>A: Agent çalıştır
    A->>L: LLM isteği (auto-traced)
    L-->>A: Yanıt (traced)
    A->>M: Bellek kaydet
    A-->>O: Trace sonlandır
    O-->>G: Trace metadata
    G-->>W: Stream yanıt
    W-->>U: Gerçek zamanlı görüntüle
```

---

## Modül Yapısı

### 1. Agent Modülü (`src/agent/`)

Ana ajan mantığını ve LLM etkileşimini yöneten modül.

| Dosya | Açıklama |
|-------|----------|
| [`prompt.ts`](src/agent/prompt.ts) | Sistem prompt'ları ve LLM araç tanımları |
| [`runtime.ts`](src/agent/runtime.ts) | ReAct döngüsünü uygulayan ana runtime sınıfı |
| [`runtimeContext.ts`](src/agent/runtimeContext.ts) | Konuşma geçmişi budama ve bağlam formatlama |
| [`tools.ts`](src/agent/tools.ts) | Yerleşik araç implementasyonları ve güvenlik kontrolleri |

#### `prompt.ts` - Prompt Yönetimi

```typescript
// Ana fonksiyonlar
buildSystemPrompt()           // Kullanıcı bilgileri, bellekler ve bağlam ile sistem prompt'u oluşturur
getBuiltinToolDefinitions()   // Yerleşik araç tanımlarını döndürür

// Prompt şablonları
buildLightExtractionPrompt()   // Hafif bilgi çıkarımı
buildDeepExtractionPrompt()    // Derin bilgi çıkarımı
buildSummarizationPrompt()     // Özetleme
buildEntityExtractionPrompt()  // Entity çıkarımı
```

#### `runtime.ts` - Agent Runtime

```typescript
class AgentRuntime {
  // Ana metotlar
  processMessage()           // Kullanıcı mesajını işler
  runReActLoop()            // Reason-Act-Observe döngüsü
  
  // Bellek çıkarımı
  extractMemoriesLight()     // Hafif bellek çıkarımı (throttle: her 3 mesajda bir)
  extractMemoriesDeep()      // Derin bellek çıkarımı (konuşma sonunda)
  summarizeConversation()    // Konuşma özetleme
  processRawTextForMemories() // Düz metinden bellek çıkarımı
  
  // Graph işleme
  processMemoryGraphWithLLM() // Entity extraction ve graph güncelleme
  
  // Optimizasyonlar
  slidingWindowPrune()       // 128K token limit için context budama
  parallelFetch()            // Paralel bellek ve bağlam çekme
  joinUIContent()            // Markdown yapılarını koruyan içerik birleştirme
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

#### `runtimeContext.ts` - Context Yönetimi

```typescript
// Ana fonksiyonlar
pruneConversationHistory()     // Sliding window context budama (atomik çift-korumalı)
formatRecentContextMessages()  // Son mesajları prompt formatına dönüştürme

// Tipler
interface HistoryPruneResult {
  history: ConversationMessage[];
  prunedChunkCount: number;
  repairedAssistantCount: number;
  skippedToolCount: number;
}
```

---

### 2. LLM Modülü (`src/llm/`)

Çoklu LLM sağlayıcı desteği için soyutlama katmanı.

| Dosya | Açıklama |
|-------|----------|
| [`provider.ts`](src/llm/provider.ts) | Soyut temel sınıf ve fabrika pattern'i |
| [`index.ts`](src/llm/index.ts) | Tüm provider'ları dışa aktarır |
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
  
  // Ana metotlar
  abstract chat(messages, options): Promise<LLMResponse>;
  chatStream?(messages, options, onToken): Promise<LLMResponse>;
  abstract healthCheck(): Promise<boolean>;
  
  // Yardımcı metotlar
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

Bilişsel bellek sistemi ve bilgi yönetimi.

| Dosya | Açıklama |
|-------|----------|
| [`database.ts`](src/memory/database.ts) | SQLite veritabanı bağlantısı ve şema |
| [`graph.ts`](src/memory/graph.ts) | Bellek grafi yönetimi |
| [`ebbinghaus.ts`](src/memory/ebbinghaus.ts) | Ebbinghaus unutma eğrisi |
| [`embeddings.ts`](src/memory/embeddings.ts) | Embedding provider'ları |
| [`contextUtils.ts`](src/memory/contextUtils.ts) | Bağlam hesaplama yardımcıları |
| [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts) | Bellek getirme stratejileri |
| [`shortTermPhase.ts`](src/memory/shortTermPhase.ts) | Kısa vadeli bellek fazı |
| [`types.ts`](src/memory/types.ts) | Tip tanımları |

#### Manager Alt Modülü (`src/memory/manager/`)

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/memory/manager/index.ts) | MemoryManager ana giriş noktası (Facade Pattern) |
| [`ConversationManager.ts`](src/memory/manager/ConversationManager.ts) | Konuşma yönetimi |
| [`MemoryStore.ts`](src/memory/manager/MemoryStore.ts) | Bellek depolama işlemleri |
| [`RetrievalService.ts`](src/memory/manager/RetrievalService.ts) | Bellek getirme servisi |
| [`types.ts`](src/memory/manager/types.ts) | Manager tip tanımları |

#### Extraction Pipeline (`src/memory/extraction/`)

| Dosya | Açıklama |
|-------|----------|
| [`pipeline.ts`](src/memory/extraction/pipeline.ts) | Ana pipeline orchestrator |
| [`types.ts`](src/memory/extraction/types.ts) | Extraction tip tanımları |
| [`steps/datetime.ts`](src/memory/extraction/steps/datetime.ts) | Tarih/saat çıkarımı (chrono-node) |
| [`steps/knownEntities.ts`](src/memory/extraction/steps/knownEntities.ts) | Bilinen entity eşleştirme |
| [`steps/network.ts`](src/memory/extraction/steps/network.ts) | Ağ analizi (URL, email, IP) |
| [`steps/llmFallback.ts`](src/memory/extraction/steps/llmFallback.ts) | LLM tabanlı çıkarım |

#### Bellek Katmanları

```mermaid
graph LR
    subgraph "Input"
        MSG[Kullanıcı Mesajı]
    end
    
    subgraph "Short-Term Memory"
        STM[Working Memory]
        NORM[Normalization]
        RECON[Reconsolidation]
    end
    
    subgraph "Long-Term Memory"
        LTM[Uzun Vadeli Bellek]
        ENT[Entities]
        REL[Relations]
    end
    
    subgraph "Retrieval"
        SEM[Semantic Search]
        LEX[Lexical Search]
        RRF[RRF Fusion]
    end
    
    MSG --> STM
    STM --> NORM
    NORM --> RECON
    RECON --> LTM
    LTM --> ENT
    LTM --> REL
    
    SEM --> RRF
    LEX --> RRF
    RRF --> STM
```

#### `manager/index.ts` - MemoryManager (Facade)

```typescript
class MemoryManager {
  // Konuşma yönetimi
  getOrCreateConversation()
  beginConversationTurn()
  addMessage()
  getConversationHistory()
  updateConversationSummary()
  
  // Bellek CRUD
  addMemory()              // Semantik dedup + reconsolidation pilot
  deleteMemory()
  editMemory()
  
  // Arama
  searchMemories()         // FTS tam metin arama
  semanticSearch()         // Embedding benzerlik arama
  hybridSearch()           // FTS + Semantik + RRF fusion
  graphAwareSearch()       // Graph-aware hibrit arama
  hybridSearchMessages()   // Mesajlarda hibrit arama
  
  // Prompt context
  getPromptContextBundle() // Çok aşamalı bellek getirme
  
  // Graph yönetimi
  processMemoryGraph()
  getMemoryGraph()
  decayRelationships()
  
  // Ebbinghaus
  decayMemories()
  executeEbbinghausUpdates()
  getMemoriesDueForReview()
  
  // Feedback
  saveFeedback()
  getFeedbacks()
}
```

#### `ebbinghaus.ts` - Unutma Eğrisi

```typescript
// Ebbinghaus matematik fonksiyonları
computeRetention(stability, daysSince)         // Hatırlama olasılığı: R(t) = e^(-t/S)
computeNextReview(stability)                   // Sonraki gözden geçirme tarihi
computeNewStability(currentStability, R)       // Yeni stabilite: S_new = S * (1 + 0.9 * R)
daysSinceAccess(lastAccessedStr)               // Son erişimden bu yana geçen gün

// Review politikaları
const REVIEW_POLICIES = {
  strict:   { initialStabilityMultiplier: 0.9, retentionFloor: 0.8 },
  standard: { initialStabilityMultiplier: 1.0, retentionFloor: 0.7 },
  volatile: { initialStabilityMultiplier: 0.7, retentionFloor: 0.62 },
  durable:  { initialStabilityMultiplier: 1.2, retentionFloor: 0.6 },
};
```

#### `retrievalOrchestrator.ts` - Getirme Stratejileri

```typescript
class MemoryRetrievalOrchestrator {
  // Dual-process mimarisi
  async getPromptContextBundle(request): Promise<PromptContextBundle> {
    // 1. Intent sinyalleri tespiti
    // 2. Recipe seçimi (preference_recall, conversation_followup, exploratory, default)
    // 3. Bilişsel yük değerlendirmesi
    // 4. Retrieval priming (entity hints, topic hints)
    // 5. Graph-aware search
    // 6. Spreading activation (graph propagation)
    // 7. Deterministic second pass (coverage gap filling)
    // 8. Behavior discovery shadow comparison
    // 9. Memory explanation generation
  }
}
```

#### `shortTermPhase.ts` - Reconsolidation Pilot

```typescript
// Bellek birleştirme kararları
function decideMemoryMerge(input): MemoryMergeDecision
function decideReconsolidationPilot(input): ReconsolidationDecision

// Reconsolidation aksiyonları
type ReconsolidationProposalMode = 'skip' | 'proposal_append' | 'commit_update';

// Guardrail'ler
interface ReconsolidationGuardrailSnapshot {
  confidenceFloor: number;           // 0.78
  strictContainmentFloor: number;    // 0.92
  structuredVarianceSimilarityFloor: number; // 0.95
  highSimilaritySemanticFloor: number;       // 0.93
  appendSemanticFloor: number;               // 0.86
}
```

---

### 3.1. GraphRAG Modülü (`src/memory/graphRAG/`)

Graph-augmented retrieval sistemi. Graph yapısını kullanarak daha alakalı bellekleri getirme, topluluk tespiti ve optimizasyon sağlar.

| Dosya | Açıklama |
|-------|----------|
| [`GraphRAGEngine.ts`](src/memory/graphRAG/GraphRAGEngine.ts) | Ana Graph RAG motoru - graph-aware retrieval |
| [`GraphExpander.ts`](src/memory/graphRAG/GraphExpander.ts) | Graph genişletme ve node keşfi |
| [`GraphCache.ts`](src/memory/graphRAG/GraphCache.ts) | Graph sonuçları önbellekleme |
| [`GraphWorker.ts`](src/memory/graphRAG/GraphWorker.ts) | Arka plan graph işlemleri |
| [`PageRankScorer.ts`](src/memory/graphRAG/PageRankScorer.ts) | PageRank tabanlı node skorlama |
| [`CommunityDetector.ts`](src/memory/graphRAG/CommunityDetector.ts) | Topluluk tespiti (community detection) |
| [`CommunitySummarizer.ts`](src/memory/graphRAG/CommunitySummarizer.ts) | Topluluk özetleme |
| [`TokenPruner.ts`](src/memory/graphRAG/TokenPruner.ts) | Token budama optimizasyonu |
| [`ShadowMode.ts`](src/memory/graphRAG/ShadowMode.ts) | Gölge mod test altyapısı |
| [`BehaviorDiscoveryShadow.ts`](src/memory/graphRAG/BehaviorDiscoveryShadow.ts) | Davranış keşif gölge modu |
| [`config.ts`](src/memory/graphRAG/config.ts) | GraphRAG konfigürasyonu |
| [`index.ts`](src/memory/graphRAG/index.ts) | Modül giriş noktası |
| [`monitoring.ts`](src/memory/graphRAG/monitoring.ts) | İzleme ve metrikler |
| [`rollback.ts`](src/memory/graphRAG/rollback.ts) | Geri alma mekanizması |

#### GraphRAG Mimarisi

```typescript
class GraphRAGEngine {
  // Ana retrieval
  async graphAwareSearch(query, options): Promise<GraphSearchResult[]>;
  async spreadingActivation(seedNodes, options): Promise<Map<number, number>>;
  
  // Graph genişletme
  async expandFromEntities(entities, options): Promise<GraphExpansionResult>;
  
  // Önbellekleme
  getCachedResult(cacheKey): GraphCacheEntry | null;
  setCachedResult(cacheKey, result): void;
}

class PageRankScorer {
  computePageRank(graph, options): Map<number, number>;
  scoreNode(nodeId, context): number;
}

class CommunityDetector {
  detectCommunities(graph, options): Community[];
  getCommunityForNode(nodeId): Community | null;
}

class CommunitySummarizer {
  summarizeCommunity(community): Promise<string>;
  generateSummary(nodes, edges): Promise<CommunitySummary>;
}

class TokenPruner {
  pruneResults(results, maxTokens): SearchResult[];
  estimateTokenCount(text): number;
}
```

#### Shadow Mode Test Altyapısı

```typescript
class ShadowMode {
  // Gölge modda yeni stratejiyi çalıştır
  async runShadow(strategy, input): Promise<ShadowResult>;
  
  // Sonuçları karşılaştır
  compareResults(baseline, shadow): ShadowComparison;
  
  // Metrikleri kaydet
  recordMetrics(comparison): void;
}

class BehaviorDiscoveryShadow {
  // Yeni davranış kalıplarını keşfet
  async discoverPatterns(input): Promise<BehaviorPattern[]>;
  
  // Shadow modda karşılaştır
  async compareWithBaseline(patterns): Promise<BehaviorComparison>;
}
```

---

### 4. Router Modülü (`src/router/`)

Mesaj yönlendirme ve semantik intent eşleştirme.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/router/index.ts) | Mesaj yönlendirme ve kanal yönetimi |
| [`types.ts`](src/router/types.ts) | Router ve LLM tip tanımları |
| [`semantic.ts`](src/router/semantic.ts) | Semantik intent eşleştirme |
| [`embedding-worker.ts`](src/router/embedding-worker.ts) | Worker thread embedding |

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
  
  // Worker thread: Xenova/all-MiniLM-L6-v2 (INT8 quantized)
}
```

---

### 5. Gateway Modülü (`src/gateway/`)

HTTP/WebSocket sunucusu ve uygulama başlatma.

| Dosya | Açıklama |
|-------|----------|
| [`index.ts`](src/gateway/index.ts) | Ana giriş noktası |
| [`routes.ts`](src/gateway/routes.ts) | REST API route tanımları |
| [`websocket.ts`](src/gateway/websocket.ts) | WebSocket bağlantı yönetimi |
| [`config.ts`](src/gateway/config.ts) | Uygulama konfigürasyonu |
| [`bootstrap.ts`](src/gateway/bootstrap.ts) | Başlatma yardımcıları |
| [`envUtils.ts`](src/gateway/envUtils.ts) | .env dosyası işlemleri |
| [`userName.ts`](src/gateway/userName.ts) | Kullanıcı adı çözümleme |

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
  openaiApiKey?: string;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  githubToken?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
  nvidiaApiKey?: string;
  ollamaBaseUrl: string;
  enableOllamaTools: boolean;
  enableNvidiaTools: boolean;
  
  // Embedding
  embeddingProvider: 'minimax' | 'openai' | 'none';
  embeddingModel: string;
  
  // Security
  allowShellExecution: boolean;
  fsRootDir?: string;
  dashboardPassword?: string;
  braveSearchApiKey?: string;
  jinaReaderApiKey?: string;
  sensitivePaths: string[];
  
  // Advanced
  systemPrompt?: string;
  autonomousStepLimit: number;
  memoryDecayThreshold: number;
  semanticSearchThreshold: number;
  logLevel: 'debug' | 'info' | 'error';
  temperature: number;
  maxTokens: number;
}
```

---

### 6. Autonomous Modülü (`src/autonomous/`)

Otonom düşünme ve görev yönetimi.

| Dosya | Açıklama |
|-------|----------|
| [`thinkEngine.ts`](src/autonomous/thinkEngine.ts) | İç Ses Motoru (Inner Monologue) |
| [`curiosityEngine.ts`](src/autonomous/curiosityEngine.ts) | Merak motoru (Sub-Agent) |
| [`urgeFilter.ts`](src/autonomous/urgeFilter.ts) | Dürtü Eşiği ve Aksiyon Filtresi |
| [`queue.ts`](src/autonomous/queue.ts) | Öncelik tabanlı görev kuyruğu |
| [`worker.ts`](src/autonomous/worker.ts) | Arka plan görev çalıştırıcısı |
| [`index.ts`](src/autonomous/index.ts) | Modül giriş noktası |

#### Otonom Düşünme Akışı

```mermaid
flowchart TB
    subgraph "Think Engine"
        SEED[Select Seed Memory]
        WALK[Graph Walk]
        CHAIN[Build Thought Chain]
        THINK[Generate Thought]
    end
    
    subgraph "Urge Filter"
        SCORE[Calculate Urge Score]
        THRESH[Threshold Check]
        FEED[Feedback Manager]
    end
    
    subgraph "Action"
        EXEC[Execute Action]
        CURIO[Curiosity Engine]
        SUB[Sub-Agent Research]
    end
    
    SEED --> WALK
    WALK --> CHAIN
    CHAIN --> THINK
    THINK --> SCORE
    SCORE --> THRESH
    THRESH -->|Pass| EXEC
    THRESH -->|Fail| FEED
    FEED --> SEED
    EXEC --> CURIO
    CURIO --> SUB
```

#### `thinkEngine.ts` - İç Ses Motoru

```typescript
// Ana fonksiyonlar
selectSeed(db): ThoughtSeed | null           // Tohum seçimi (3 strateji)
graphWalk(db, seedId, maxDepth): Association[]  // BFS çağrışım gezintisi
buildThoughtChain(seed, associations, emotion): ThoughtChain
synthesizeThoughtPrompt(chain): string       // LLM prompt sentezi
think(db, emotion): ThoughtLogEntry | null   // Ana düşünme fonksiyonu

// Sabitler
const FRESHNESS_THRESHOLD = 0.3;             // Ebbinghaus tazelik eşiği
const MAX_HOP_DEPTH = 2;                     // Maksimum graph derinliği
const MAX_ASSOCIATIONS = 8;                  // Maksimum çağrışım sayısı
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
  
  // Run loop
  private async runLoop(): Promise<void>;
  private interrupt(reason: string): void;
}
```

#### `urgeFilter.ts` - Dürtü Filtresi

```typescript
// 3 Katmanlı Filtre:
// 1. Mutlak Kurallar (Hard Logic) — Sessiz saat, arousal taban
// 2. Deterministik Skorlama — Confirmation bias önlemi
// 3. Geri Bildirim Döngüsü — Kullanıcı davranışına göre uyarlanır

// Formül: Skor = (İlgi × 0.6) + (Zaman Hassasiyeti × 0.4) - (İsteksizlik Cezası)
function computeUrgeScore(evaluation, reluctancePenalty): number;
function computeEffectiveThreshold(feedbackAdjustment): number;
function decideAction(score, threshold): ActionDecision;
function filterThought(evaluation, feedbackState, currentHour): FilterResult;

// Feedback loop
class FeedbackManager {
  applySignal(signal: UserBehaviorSignal): FeedbackState;
  applyDecay(): void;
  reset(): void;
}
```

---

### 7. Observability Modülü (`src/observability/`)

OpenTelemetry tabanlı LLM observability altyapısı. Langfuse ile trace, metric ve evaluation sağlar.

| Dosya | Açıklama |
|-------|----------|
| [`langfuse.ts`](src/observability/langfuse.ts) | Langfuse OpenTelemetry SDK entegrasyonu |
| [`src/llm/observability.ts`](src/llm/observability.ts) | LLM provider trace helper'ları |

#### Trace Hiyerarşisi

```
Trace: user-message-{uuid}
 ├─ Span: agent.processMessage
 │  ├─ Span: memory.getPromptContextBundle
 │  ├─ Span: llm.chat (OpenAI, Anthropic, etc.)
 │  ├─ Span: tool.execute (varsa)
 │  └─ Span: memory.addMemory
```

#### LLM Provider Coverage: 8/8 ✅

| Provider | Trace Method |
|----------|--------------|
| OpenAI | observeOpenAI() wrapper |
| Anthropic | withTrace() helper |
| Ollama | withTrace() helper |
| MiniMax | withTrace() helper |
| Groq, Mistral, NVIDIA, GitHub | Extends OpenAI → auto-traced |

#### Feature Flag

```env
LANGFUSE_ENABLED=false          # Default: kapalı (zero overhead)
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

---

### 8. Web Arayüzü (`src/web/`)

#### React Uygulaması (`src/web/react-app/`)

| Dosya | Açıklama |
|-------|----------|
| [`src/App.tsx`](src/web/react-app/src/App.tsx) | Ana giriş noktası |
| [`src/main.tsx`](src/web/react-app/src/main.tsx) | React bootstrap |
| [`src/hooks/useAgentSocket.ts`](src/web/react-app/src/hooks/useAgentSocket.ts) | WebSocket hook |
| [`src/hooks/useConversationFilters.ts`](src/web/react-app/src/hooks/useConversationFilters.ts) | Konuşma filtreleme hook'u |
| [`src/hooks/useFileUpload.ts`](src/web/react-app/src/hooks/useFileUpload.ts) | Dosya yükleme hook'u |
| [`src/hooks/useMessageBuilder.ts`](src/web/react-app/src/hooks/useMessageBuilder.ts) | Mesaj oluşturma hook'u |
| [`src/hooks/useSettingsForm.ts`](src/web/react-app/src/hooks/useSettingsForm.ts) | Ayarlar form hook'u |
| [`src/store/agentStore.ts`](src/web/react-app/src/store/agentStore.ts) | Zustand state |
| [`src/lib/api-client.ts`](src/web/react-app/src/lib/api-client.ts) | API istemcisi |
| [`src/lib/utils.ts`](src/web/react-app/src/lib/utils.ts) | Yardımcı fonksiyonlar (stripThinkTags, formatRelativeTime, formatFileSize) |
| [`src/lib/queryClient.ts`](src/web/react-app/src/lib/queryClient.ts) | React Query client |

##### Bileşenler (`src/components/chat/`)

| Bileşen | Açıklama |
|---------|----------|
| [`ChatWindow.tsx`](src/web/react-app/src/components/chat/ChatWindow.tsx) | Ana sohbet arayüzü ve layout yönetimi |
| [`MessageStream.tsx`](src/web/react-app/src/components/chat/MessageStream.tsx) | Mesaj akışı (Virtuoso, empty state redesign, quick actions) |
| [`MessageBubble.tsx`](src/web/react-app/src/components/chat/MessageBubble.tsx) | [NEW] Tekil mesaj bileşeni (Memoize edilmiş, avatar ve animasyon desteği) |
| [`CodeBlock.tsx`](src/web/react-app/src/components/chat/CodeBlock.tsx) | [NEW] Syntax highlighting (Prism) ve kopyalama desteği sunan kod bloğu |
| [`MessagePanel.tsx`](src/web/react-app/src/components/chat/MessagePanel.tsx) | Mesaj paneli (scroll container) |
| [`ConversationListItem.tsx`](src/web/react-app/src/components/chat/ConversationListItem.tsx) | Konuşma listesi öğesi (Relative time desteği) |
| [`ConversationPanel.tsx`](src/web/react-app/src/components/chat/ConversationPanel.tsx) | Konuşma paneli ve tarih bazlı gruplama |
| [`InputPanel.tsx`](src/web/react-app/src/components/chat/InputPanel.tsx) | Giriş paneli (Glow-pulse send butonu, auto-resize) |
| [`ChannelsView.tsx`](src/web/react-app/src/components/chat/ChannelsView.tsx) | Kanal görünümü |
| [`MemoryDialog.tsx`](src/web/react-app/src/components/chat/MemoryDialog.tsx) | Bellek yönetimi |
| [`MemoryGraphView.tsx`](src/web/react-app/src/components/chat/MemoryGraphView.tsx) | Bellek grafiği görünümü |
| [`MemoryGraphControls.tsx`](src/web/react-app/src/components/chat/MemoryGraphControls.tsx) | Bellek grafiği kontrolleri |
| [`MemoryGraphLegend.tsx`](src/web/react-app/src/components/chat/MemoryGraphLegend.tsx) | Bellek grafiği lejantı |
| [`MemoryNodeDetails.tsx`](src/web/react-app/src/components/chat/MemoryNodeDetails.tsx) | Bellek düğüm detayları |
| [`MemorySettings.tsx`](src/web/react-app/src/components/chat/MemorySettings.tsx) | Bellek ayarları |
| [`SettingsDialog.tsx`](src/web/react-app/src/components/chat/SettingsDialog.tsx) | Ayarlar |
| [`LLMSettings.tsx`](src/web/react-app/src/components/chat/LLMSettings.tsx) | LLM ayarları |
| [`SecuritySettings.tsx`](src/web/react-app/src/components/chat/SecuritySettings.tsx) | Güvenlik ayarları |
| [`ConfirmDialog.tsx`](src/web/react-app/src/components/chat/ConfirmDialog.tsx) | Onay dialogu |
| [`ExportDialog.tsx`](src/web/react-app/src/components/chat/ExportDialog.tsx) | Dışa aktarma dialogu |
| [`ImageLightbox.tsx`](src/web/react-app/src/components/chat/ImageLightbox.tsx) | Resim görüntüleyici |
| [`OnboardingDialog.tsx`](src/web/react-app/src/components/chat/OnboardingDialog.tsx) | İlk kurulum |

##### UI Bileşenleri (`src/components/ui/`)

| Bileşen | Kaynak |
|---------|--------|
| `button.tsx` | Radix UI |
| `dialog.tsx` | Radix UI |
| `input.tsx` | Radix UI |
| `textarea.tsx` | Radix UI |
| `scroll-area.tsx` | Radix UI |
| [`Toast.tsx`](src/web/react-app/src/components/ui/Toast.tsx) | Bildirim bileşeni |
| [`ErrorBoundary.tsx`](src/web/react-app/src/components/ui/ErrorBoundary.tsx) | Hata sınırı bileşeni |
| [`skeleton.tsx`](src/web/react-app/src/components/ui/skeleton.tsx) | Yükleme iskeleti |

##### Query Hooks (`src/hooks/queries/`)

| Dosya | Açıklama |
|-------|----------|
| [`useConversations.ts`](src/web/react-app/src/hooks/queries/useConversations.ts) | Konuşma listesi query |
| [`useMemories.ts`](src/web/react-app/src/hooks/queries/useMemories.ts) | Bellek listesi query |
| [`useSettings.ts`](src/web/react-app/src/hooks/queries/useSettings.ts) | Ayarlar query |
| [`useLLMProviders.ts`](src/web/react-app/src/hooks/queries/useLLMProviders.ts) | LLM provider'ları query |
| [`useMemoryGraph.ts`](src/web/react-app/src/hooks/queries/useMemoryGraph.ts) | Bellek grafiği query |
| [`useSensitivePaths.ts`](src/web/react-app/src/hooks/queries/useSensitivePaths.ts) | Hassas dizinler query |
| [`useStats.ts`](src/web/react-app/src/hooks/queries/useStats.ts) | İstatistikler query |

##### Mutation Hooks (`src/hooks/mutations/`)

| Dosya | Açıklama |
|-------|----------|
| [`useCreateMemory.ts`](src/web/react-app/src/hooks/mutations/useCreateMemory.ts) | Yeni bellek oluşturma |
| [`useUpdateMemory.ts`](src/web/react-app/src/hooks/mutations/useUpdateMemory.ts) | Bellek güncelleme |
| [`useDeleteMemory.ts`](src/web/react-app/src/hooks/mutations/useDeleteMemory.ts) | Bellek silme |
| [`useDeleteConversation.ts`](src/web/react-app/src/hooks/mutations/useDeleteConversation.ts) | Konuşma silme |
| [`useBulkDeleteConversations.ts`](src/web/react-app/src/hooks/mutations/useBulkDeleteConversations.ts) | Toplu konuşma silme |
| [`useUpdateSettings.ts`](src/web/react-app/src/hooks/mutations/useUpdateSettings.ts) | Ayarlar güncelleme |
| [`useAddSensitivePath.ts`](src/web/react-app/src/hooks/mutations/useAddSensitivePath.ts) | Hassas dizin ekleme |
| [`useRemoveSensitivePath.ts`](src/web/react-app/src/hooks/mutations/useRemoveSensitivePath.ts) | Hassas dizin silme |

##### Servis Katmanı (`src/services/`)

| Dosya | Açıklama |
|-------|----------|
| [`conversationService.ts`](src/web/react-app/src/services/conversationService.ts) | Konuşma API servisleri |
| [`memoryService.ts`](src/web/react-app/src/services/memoryService.ts) | Bellek API servisleri |
| [`settingsService.ts`](src/web/react-app/src/services/settingsService.ts) | Ayarlar API servisi |
| [`statsService.ts`](src/web/react-app/src/services/statsService.ts) | İstatistik API servisi |

##### Provider (`src/providers/`)

| Dosya | Açıklama |
|-------|----------|
| [`QueryProvider.tsx`](src/web/react-app/src/providers/QueryProvider.tsx) | React Query provider |

##### Store Slices (`src/store/slices/`)

| Dosya | Açıklama |
|-------|----------|
| [`chatSlice.ts`](src/web/react-app/src/store/slices/chatSlice.ts) | Sohbet state slice |
| [`settingsSlice.ts`](src/web/react-app/src/store/slices/settingsSlice.ts) | Ayarlar state slice |
| [`uiSlice.ts`](src/web/react-app/src/store/slices/uiSlice.ts) | UI state slice |

##### Styles Klasörü (`src/web/react-app/src/styles/`)

| Dosya | Açıklama |
|-------|----------|
| [`dialog.ts`](src/web/react-app/src/styles/dialog.ts) | Dialog stilleri |

### 8. Utils Modülü (`src/utils/`)

| Dosya | Açıklama |
|-------|----------|
| [`datetime.ts`](src/utils/datetime.ts) | Tarih/saat yardımcıları |
| [`logger.ts`](src/utils/logger.ts) | Yapılandırılmış loglama |

#### `logger.ts` - Loglama Sistemi

```typescript
// Pino tabanlı yapılandırılmış loglama
// Transport: pino-pretty (dev) + pino-roll (prod)
// AsyncLocalStorage ile trace ID desteği

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const context = asyncLocalStorage.getStore();
    return context ? { traceId: context.traceId } : {};
  },
}, transport);

// Trace ID ile çalıştırma
runWithTraceId(traceId, () => {
  logger.info({ msg: 'Operation completed' });
});
```

---

### 9. CLI Modülü (`src/cli/`)

| Dosya | Açıklama |
|-------|----------|
| [`maintenance.ts`](src/cli/maintenance.ts) | Bellek grafiği bakım aracı |

```bash
# Kullanım
npx tsx src/cli/maintenance.ts

# İşlevler
# 1. Missing graph relations backfill
# 2. Relationship decay (Ebbinghaus)
```

---

### 10. Tests (`tests/`)

| Dosya | Açıklama |
|-------|----------|
| [`gateway/websocket.test.ts`](tests/gateway/websocket.test.ts) | WebSocket testleri |
| [`memory/memoryType.test.ts`](tests/memory/memoryType.test.ts) | Bellek türü testleri |
| [`memory/hybridSearch.test.ts`](tests/memory/hybridSearch.test.ts) | Hibrit arama testleri |
| [`memory/graphSearch.test.ts`](tests/memory/graphSearch.test.ts) | Graph arama testleri |
| [`memory/retrievalEdgeCases.test.ts`](tests/memory/retrievalEdgeCases.test.ts) | Retrieval edge case testleri |
| [`memory/reconsolidationPilot.test.ts`](tests/memory/reconsolidationPilot.test.ts) | Reconsolidation pilot testleri |
| [`memory/retrievalOrchestrator.observability.test.ts`](tests/memory/retrievalOrchestrator.observability.test.ts) | Gözlemlenebilirlik testleri |
| [`benchmark/retrievalBenchmark.test.ts`](tests/benchmark/retrievalBenchmark.test.ts) | Retrieval benchmark testleri |
| [`benchmark/fixtures/benchmarkDataset.ts`](tests/benchmark/fixtures/benchmarkDataset.ts) | Benchmark veri seti |
| [`benchmark/utils/metrics.ts`](tests/benchmark/utils/metrics.ts) | Metrik hesaplama |
| [`benchmark/utils/baselines.ts`](tests/benchmark/utils/baselines.ts) | Baseline karşılaştırmaları |

#### GraphRAG Testleri (`tests/memory/graphRAG/`)

| Dosya | Açıklama |
|-------|----------|
| [`GraphRAGEngine.test.ts`](tests/memory/graphRAG/GraphRAGEngine.test.ts) | Graph RAG motor testleri |
| [`GraphExpander.test.ts`](tests/memory/graphRAG/GraphExpander.test.ts) | Graph genişletme testleri |
| [`GraphCache.test.ts`](tests/memory/graphRAG/GraphCache.test.ts) | Graph önbellek testleri |
| [`GraphWorker.test.ts`](tests/memory/graphRAG/GraphWorker.test.ts) | Graph worker testleri |
| [`PageRankScorer.test.ts`](tests/memory/graphRAG/PageRankScorer.test.ts) | PageRank skorlama testleri |
| [`CommunityDetector.test.ts`](tests/memory/graphRAG/CommunityDetector.test.ts) | Topluluk tespiti testleri |
| [`CommunitySummarizer.test.ts`](tests/memory/graphRAG/CommunitySummarizer.test.ts) | Topluluk özetleme testleri |
| [`TokenPruner.test.ts`](tests/memory/graphRAG/TokenPruner.test.ts) | Token budama testleri |
| [`ShadowMode.test.ts`](tests/memory/graphRAG/ShadowMode.test.ts) | Gölge mod testleri |
| [`behaviorDiscoveryShadow.test.ts`](tests/memory/graphRAG/behaviorDiscoveryShadow.test.ts) | Davranış keşif testleri |
| [`FullPhase.test.ts`](tests/memory/graphRAG/FullPhase.test.ts) | Tam faz entegrasyon testleri |
| [`memoryGraphVisualization.test.ts`](tests/memory/graphRAG/memoryGraphVisualization.test.ts) | Görselleştirme testleri |
| [`retrievalIntegration.test.ts`](tests/memory/graphRAG/retrievalIntegration.test.ts) | Retrieval entegrasyon testleri |
| [`retrievalOrchestrator.integration.test.ts`](tests/memory/graphRAG/retrievalOrchestrator.integration.test.ts) | Retrieval orchestrator entegrasyon testleri |
| [`spreadingActivation.test.ts`](tests/memory/graphRAG/spreadingActivation.test.ts) | Yayılım aktivasyon testleri |

#### GraphRAG Benchmark Testleri (`tests/benchmark/graphRAG/`)

| Dosya | Açıklama |
|-------|----------|
| [`retrievalBenchmark.test.ts`](tests/benchmark/graphRAG/retrievalBenchmark.test.ts) | GraphRAG retrieval benchmark testleri |

---

## Veritabanı Şeması

### Entity-Relationship Diyagramı

```mermaid
erDiagram
    CONVERSATIONS {
        string id PK
        string title
        string channel_type
        string channel_id
        string user_id
        string user_name
        string summary
        int is_summarized
        int message_count
        datetime created_at
        datetime updated_at
    }
    
    MESSAGES {
        int id PK
        string conversation_id FK
        string role
        text content
        text tool_calls
        text tool_results
        text attachments
        datetime created_at
    }
    
    MEMORIES {
        int id PK
        string user_id
        text content
        string category
        int importance
        int access_count
        int is_archived
        float stability
        float retrievability
        int next_review_at
        int review_count
        float max_importance
        string provenance_source
        string provenance_conversation_id
        int provenance_message_id
        float confidence
        string review_profile
        string memory_type
        datetime created_at
        datetime updated_at
    }
    
    MEMORY_ENTITIES {
        int id PK
        string name
        string type
        string normalized_name
        datetime created_at
    }
    
    MEMORY_RELATIONS {
        int id PK
        int source_memory_id FK
        int target_memory_id FK
        string relation_type
        float confidence
        string description
        float decay_rate
        int access_count
        datetime last_accessed_at
        datetime created_at
    }
    
    MEMORY_EMBEDDINGS {
        int rowid PK
        blob embedding
    }
    
    MEMORY_ENTITY_LINKS {
        int memory_id FK
        int entity_id FK
    }
    
    AUTONOMOUS_TASKS {
        string id PK
        string type
        int priority
        text payload
        string status
        datetime added_at
        datetime updated_at
    }
    
    FEEDBACK {
        int id PK
        string message_id
        string conversation_id
        string type
        string comment
        datetime created_at
    }
    
    SETTINGS {
        string key PK
        text value
        datetime updated_at
    }
    
    CONVERSATIONS ||--o{ MESSAGES : contains
    CONVERSATIONS ||--o{ MEMORIES : has
    MEMORIES ||--o{ MEMORY_EMBEDDINGS : embedded_as
    MEMORIES ||--o{ MEMORY_ENTITY_LINKS : has
    MEMORY_ENTITIES ||--o{ MEMORY_ENTITY_LINKS : linked_to
    MEMORY_ENTITIES ||--o{ MEMORY_RELATIONS : source
    MEMORY_ENTITIES ||--o{ MEMORY_RELATIONS : target
```

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
| AI SDK | openai | 4.77+ | OpenAI API |
| AI Inference | @azure-rest/ai-inference | 1.0+ | Azure AI Inference |
| Embedding | @xenova/transformers | 2.17+ | ONNX embedding |
| NLP | chrono-node | 2.9+ | Tarih ayrıştırma |
| Validation | zod | 3.25+ | Runtime validation |
| Web Scraping | linkedom | 0.18+ | HTML parsing |
| Web Scraping | @mozilla/readability | 0.6+ | Article extraction |
| Markdown | turndown | 7.2+ | HTML to Markdown |
| Tokenizer | gpt-tokenizer | 3.4+ | Token counting |
| Logging | pino | 10.3+ | Yapılandırılmış loglama |
| Logging | pino-roll | 4.0+ | Log rotasyonu |
| Utility | uuid | 11.1+ | UUID oluşturma |
| Utility | validator | 13.15+ | String validation |
| Config | dotenv | 16.4+ | Ortam değişkenleri |

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
| Syntax Highlighting | react-syntax-highlighter | 15.x | Prism tabanlı kod renklendirme |
| Animation | framer-motion | 12.x | UI animasyonları |
| Virtualization | react-virtuoso | 4.x | Sanal liste render |
| Visualization | d3 | 7.x | Bellek grafiği görselleştirme |

---

## API Endpoints

### REST API

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/api/stats` | GET | Sistem istatistikleri |
| `/api/channels` | GET | Kanal durumu |
| `/api/conversations` | GET | Konuşma listesi |
| `/api/conversations` | DELETE | Toplu konuşma silme |
| `/api/conversations/:id` | GET | Konuşma detayı |
| `/api/conversations/:id` | DELETE | Konuşma silme |
| `/api/conversations/:id/messages` | GET | Mesaj geçmişi |
| `/api/memories` | GET | Bellek listesi |
| `/api/memories` | POST | Yeni bir tane bellek ekle |
| `/api/memories/search` | GET | Bellek arama |
| `/api/memories/:id` | PUT | Bellek güncelle |
| `/api/memories/:id` | DELETE | Bellek silme |
| `/api/memory-graph` | GET | Bellek grafiği verisi |
| `/api/health` | GET | Sağlık kontrolü |
| `/api/settings` | GET | Ayarları getir |
| `/api/settings` | POST | Ayarları güncelle |
| `/api/settings/sensitive-paths` | GET | Hassas dizinleri getir |
| `/api/settings/sensitive-paths` | POST | Hassas dizin ekle |
| `/api/settings/sensitive-paths` | DELETE | Hassas dizin sil |
| `/api/llm/providers` | GET | Kullanılabilir LLM provider'ları |
| `/api/feedback` | POST | Kullanıcı geri bildirimi kaydet |
| `/api/feedback/:conversationId` | GET | Konuşma geri bildirimlerini getir |
| `/api/onboarding/process` | POST | Onboarding biyografi işleme |

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
| `agent_event` | Server → Client | Agent olayları (thinking, tool_start, tool_end, iteration) |
| `clear_stream` | Server → Client | Stream temizleme sinyali |
| `replace_stream` | Server → Client | Stream değiştirme |
| `confirm_request` | Server → Client | Onay isteği |
| `error` | Server → Client | Hata mesajı |
| `stats` | Server → Client | Sistem istatistikleri |

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

// Engellenen yollar
const blockedAbsolute = [
  'C:\\Windows\\System32\\config',
  '/etc/shadow', '/etc/passwd',
];
```

---

## Geliştirici Notları

### Proje Başlatma

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusu (backend + frontend)
npm run dev
```

### Mimari Kararlar

1. **Facade Pattern**: MemoryManager, alt modülleri tek bir arayüz altında toplar.
2. **Worker Thread Isolation**: Embedding işlemleri ana thread'i bloklamaz.
3. **Dual-Process Retrieval**: System1 (hızlı) ve System2 (derin) bellek getirme modları.
4. **GraphRAG Integration**: Graph-aware retrieval ile bellek getirme iyileştirildi.

---

> Bu doküman PenceAI projesinin tamamını anlamak için tek bir referans noktası olarak hazırlanmıştır. Son güncelleme: Nisan 2026.
