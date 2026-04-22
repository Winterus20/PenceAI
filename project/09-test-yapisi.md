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

---
[← İçindekilere Dön](./README.md)