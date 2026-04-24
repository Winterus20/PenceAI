## Geliştirici Notları

### Proje Başlatma

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusu (backend + frontend)
npm run dev

# Sadece backend
npm run dev:backend

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
17. **Smart Search Engine**: Intent bazlı routing ile çoklu kaynak arama (DuckDuckGo, Wikipedia, HackerNews, Reddit)
18. **Think Tag Extraction**: LLM thinking content ayrıştırma yardımcısı (`thinkTags.ts`)
19. **Conversation Branching**: Konuşma dallanma desteği — fork, branch yönetimi, ağaç görünümü
20. **Backward Compatibility Re-export**: `memory/manager.ts` — yeni modül yapısından geriye uyumlu export
21. **Message Embeddings**: Mesajlarda semantik arama için ayrı vektör tablosu
22. **GraphRAG Hierarchical Communities**: Çok seviyeli topluluk hiyerarşisi (level, parent_id)
23. **Claim Extraction**: Bellek iddia (claim) çıkarma ve doğrulama altyapısı
24. **LLM Prompt Cache**: SQLite tabanlı prompt-response önbellekleme — TTL + LRU eviction
25. **Context Compaction**: Token threshold aşıldığında otomatik bağlam sıkıştırma
26. **Hook Execution Engine**: Tool call lifecycle'ında security, sanitization, budget guard
27. **Error Module**: Hiyerarşik error sınıfları (AppError, LLMError, DatabaseError, vb.)

### Kritik Import Kuralı

Tüm import'lar `.js` uzantısı kullanır (ESM `"type": "module"`):

```typescript
import { MemoryManager } from '../memory/manager.js';  // ✅ Doğru
import { MemoryManager } from '../memory/manager';      // ❌ Yanlış
```

### Config Erişimi

`process.env` doğrudan okunmaz. [`getConfig()`](src/gateway/config.ts) kullanılır (Zod-validasyonlu singleton).

---

> Bu doküman PenceAI projesinin tamamını anlamak için tek bir referans noktası olarak hazırlanmıştır. Son güncelleme: 24 Nisan 2026.

---
[← İçindekilere Dön](./README.md)