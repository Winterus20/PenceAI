# MCP (Model Context Protocol) Modülü

## Genel Bakış

MCP modülü, PenceAI agent'ın harici araçları ve servisleri keşfetmesini, yüklemesini ve kullanmasını sağlar. Model Context Protocol standardını uygulayarak, agent'ın farklı MCP sunucularıyla iletişim kurmasını ve bu sunuculardaki araçları çağırmasını mümkün kılar.

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Runtime                             │
├─────────────────────────────────────────────────────────────┤
│  UnifiedToolRegistry                                         │
│  ├── Built-in Tools (memory, file, shell, etc.)             │
│  └── MCP Tools (via MCPClientManager)                       │
├─────────────────────────────────────────────────────────────┤
│  MCPClientManager                                            │
│  ├── Server A (filesystem)                                   │
│  ├── Server B (github)                                       │
│  └── Server C (custom)                                       │
├─────────────────────────────────────────────────────────────┤
│  Transport Layer (stdio, SSE)                                │
└─────────────────────────────────────────────────────────────┘
```

## Modül Yapısı

| Dosya | Açıklama |
|-------|----------|
| [`client.ts`](../../src/agent/mcp/client.ts) | MCPClientManager — Server yönetimi ve araç çağrıları |
| [`registry.ts`](../../src/agent/mcp/registry.ts) | UnifiedToolRegistry — Built-in ve MCP araç birleştirme |
| [`adapter.ts`](../../src/agent/mcp/adapter.ts) | Tool Adapter — MCP araçlarını ToolExecutor'a dönüştürme |
| [`transport.ts`](../../src/agent/mcp/transport.ts) | Transport — stdio/SSE bağlantı yönetimi |
| [`security.ts`](../../src/agent/mcp/security.ts) | Security — Command allowlist ve env sanitization |
| [`config.ts`](../../src/agent/mcp/config.ts) | Config — MCP server konfigürasyonu |
| [`types.ts`](../../src/agent/mcp/types.ts) | Types — TypeScript tip tanımları |
| [`result.ts`](../../src/agent/mcp/result.ts) | Result — Either pattern hata yönetimi |
| [`eventBus.ts`](../../src/agent/mcp/eventBus.ts) | Event Bus — Modüller arası event yayınlama |
| [`command-validator.ts`](../../src/agent/mcp/command-validator.ts) | Command Validator — Komut doğrulama |
| [`marketplace-service.ts`](../../src/agent/mcp/marketplace-service.ts) | Marketplace — MCP server marketplace |

## Kurulum

### Environment Variables

```env
# MCP Server'ları (JSON array)
MCP_SERVERS=[{"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/allowed/path"]}]

# MCP'yi etkinleştir
ENABLE_MCP=true
```

### Server Konfigürasyonu

```typescript
import { MCPServerConfigSchema } from './agent/mcp/types.js';

const serverConfig = {
  name: 'filesystem',           // Unique server adı
  command: 'npx',               // Çalıştırılacak komut
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
  env: { /* opsiyonel env değişkenleri */ },
  cwd: '/working/dir',          // opsiyonel çalışma dizini
  timeout: 30000,               // opsiyonel timeout (ms)
};

// Zod validation
const validated = MCPServerConfigSchema.parse(serverConfig);
```

### Command Allowlist

Güvenlik nedeniyle sadece şu komutlar izinlidir:

- `npx` — npm package çalıştırma
- `node` — Node.js çalıştırma
- `python` — Python çalıştırma
- `python3` — Python3 çalıştırma
- `curl` — HTTP istekleri

### Environment Variable Filtering

Child process'e sadece güvenli env değişkenleri aktarılır. Aşağıdaki pattern'ler filtrelenir:

- `*_API_KEY` — API anahtarları
- `*_TOKEN` — Token'lar
- `*_SECRET` — Gizli anahtarlar
- `*_PASSWORD` — Şifreler
- `*_PRIVATE_KEY` — Özel anahtarlar
- `MCP_SERVERS` — MCP konfigürasyonu
- `DATABASE_URL` — Veritabanı bağlantıları

## API Reference

### MCPClientManager

```typescript
import { MCPClientManager } from './agent/mcp/client.js';

const manager = new MCPClientManager();

// Server'ları başlat
const connectedCount = await manager.initialize(configs);

// Araç listesi
const tools = manager.listTools();

// Belirli server'ın araçları
const serverTools = manager.getServerTools('filesystem');

// Araç çağrısı
const result = await manager.callTool('mcp:filesystem:readFile', { path: '/tmp/test.txt' });

// Server durumu
const status = manager.getServerStatus('filesystem');
const allStatuses = manager.getAllServerStatuses();

// Araç kontrolü
const exists = manager.hasTool('mcp:filesystem:readFile');

// Kapat
await manager.shutdown();
```

### UnifiedToolRegistry

```typescript
import { getUnifiedToolRegistry } from './agent/mcp/registry.js';

const registry = getUnifiedToolRegistry();

// Built-in araçları kaydet
registry.registerBuiltins(memoryManager, confirmCallback, mergeFn);

// MCP Manager'ı bağla
await registry.registerMCPManager(mcpManager);

// Tüm araç tanımları
const definitions = registry.getAllToolDefinitions();

// Araç çalıştır
const result = await registry.executeTool('mcp:filesystem:readFile', { path: '/tmp' });

// Araç kontrolü
const exists = registry.hasTool('mcp:filesystem:readFile');

// Araç sayısı
const count = registry.toolCount;
```

### Event Bus

```typescript
import { getMCPEventBus } from './agent/mcp/eventBus.js';

const eventBus = getMCPEventBus();

// Event dinle
eventBus.on('server:activated', (payload) => {
  console.log(`Server ${payload.name} activated with ${payload.toolCount} tools`);
});

eventBus.on('server:deactivated', (payload) => {
  console.log(`Server ${payload.name} deactivated`);
});

eventBus.on('server:installed', (payload) => {
  console.log(`Server ${payload.name} installed`);
});

eventBus.on('server:uninstalled', (payload) => {
  console.log(`Server ${payload.name} uninstalled`);
});

eventBus.on('tools:discovered', (payload) => {
  console.log(`Tools discovered: ${payload.tools.join(', ')}`);
});

eventBus.on('error', (payload) => {
  console.error(`Error on ${payload.serverName}: ${payload.error}`);
});

// Tek seferlik dinleyici
eventBus.once('server:installed', (payload) => {
  // Sadece ilk kurulumda çalışır
});
```

### Result Pattern

```typescript
import { success, error, isSuccess, isError, unwrap, unwrapOr, tryAsync } from './agent/mcp/result.js';

// Success result
const ok = success(42);
isSuccess(ok); // true
unwrap(ok);    // 42

// Error result
const err = error(new Error('failed'));
isError(err);  // true

// Unwrap with default
unwrapOr(err, 0); // 0

// Async try
const result = await tryAsync(() => fetch('/api/data'));
if (isSuccess(result)) {
  const data = unwrap(result);
  // ...
}
```

## Güvenlik

### Command Allowlist

Sadece izin verilen komutlar çalıştırılabilir. Yeni komut eklemek için `MCPServerConfigSchema` içindeki allowlist'i güncelleyin.

### Environment Variable Filtering

Child process'e aktarılan env değişkenleri whitelist ile kontrol edilir. Hassas değişkenler otomatik olarak filtrelenir.

### Rate Limiting

Her server için araç çağrıları timeout ile sınırlıdır (varsayılan: 30 saniye).

## Troubleshooting

### Server Bağlanamıyor

1. `MCP_SERVERS` env değişkenini kontrol edin
2. Command'ın allowlist'te olduğundan emin olun
3. Log'larda `[MCP:client]` prefix'ini arayın
4. Server'ın doğru yüklendiğini doğrulayın

### Tool Call Başarısız

1. Tool name'in doğru formatında olduğundan emin olun (`mcp:{server}:{tool}`)
2. Input schema'yı kontrol edin
3. Rate limit aşılmış olabilir
4. Server bağlantı durumunu kontrol edin

### Araç Keşfedilemedi

1. Server'ın connected durumunda olduğundan emin olun
2. `manager.listTools()` ile tüm araçları listeleyin
3. Server loglarını kontrol edin

## Test

```bash
# MCP testlerini çalıştır
npm test -- --testPathPattern=tests/agent/mcp

# Belirli test dosyası
npm test -- --testPathPattern=client.test.ts

# Coverage ile
npm test -- --testPathPattern=tests/agent/mcp --coverage
```

### Test Dosyaları

| Dosya | Kapsam |
|-------|--------|
| [`client.test.ts`](../../tests/agent/mcp/client.test.ts) | MCPClientManager initialization, server management, tool calls |
| [`registry.test.ts`](../../tests/agent/mcp/registry.test.ts) | UnifiedToolRegistry registration, execution, singleton |
| [`adapter.test.ts`](../../tests/agent/mcp/adapter.test.ts) | Tool adapter conversion, executor behavior |
| [`result.test.ts`](../../tests/agent/mcp/result.test.ts) | Result pattern utilities |
| [`eventBus.test.ts`](../../tests/agent/mcp/eventBus.test.ts) | Event bus singleton, emit/listen, lifecycle |
| [`config.test.ts`](../../tests/agent/mcp/config.test.ts) | Configuration validation |
| [`security.test.ts`](../../tests/agent/mcp/security.test.ts) | Security checks, env sanitization |
| [`transport.test.ts`](../../tests/agent/mcp/transport.test.ts) | Transport security, env validation |
| [`command-validator.test.ts`](../../tests/agent/mcp/command-validator.test.ts) | Command validation logic |
