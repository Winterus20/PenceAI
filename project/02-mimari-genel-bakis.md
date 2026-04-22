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
│  ┌──────────────┐  └──────────────┘  └───────────────────┘  │
│  │ Smart Search │                                          │
│  │ (Multi-Src)  │                                          │
│  └──────────────┘                                          │
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
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Embedding   │  │   Metrics    │  │  Memory Claims    │  │
│  │   Cache      │  │   Store      │  │  (Subject/Pred/   │  │
│  │              │  │              │  │   Object)         │  │
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

---
[← İçindekilere Dön](./README.md)