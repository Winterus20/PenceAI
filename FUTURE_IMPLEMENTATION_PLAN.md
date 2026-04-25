# PenceAI — Gelecek Uygulama Planı

> **Tarih:** 5 Nisan 2026 (Güncelleme: 19 Nisan 2026)
> **Kaynak:** [`TECHNOLOGY_RESEARCH_REPORT.md`](TECHNOLOGY_RESEARCH_REPORT.md), [RAGOps GitHub](https://github.com/ereztdev/RAGOps/), [ECC GitHub](https://github.com/affaan-m/everything-claude-code), [Claude Code Sızıntı Analizi](https://github.com/tanbiralam/claude-code) (31 Mart 2026)
> **Durum:** MCP, RAGOps ve Docker Compose Tamamlandı — Diğer Teknolojiler Planlanıyor

Bu dosya, değerli ancak implementasyon eforu gerektiren teknolojilerin detaylı planlarını içerir.
Geri döndüğünüzde bu dosyayı referans alarak uygulamaya başlayabilirsiniz.

---

## 📋 Öncelik Sırası

| # | Teknoloji | Öncelik | Tahmini Süre | Zorluk | Durum |
|---|-----------|---------|--------------|--------|-------|
| 1 | **Hook Execution Engine** (Claude Code İlhamlı) | 🔴 YÜKSEK | 3-5 gün | ⭐⭐⭐ | ✅ Tamamlandı |
| 2 | Context Compaction Engine | 🔴 YÜKSEK | 3-5 gün | ⭐⭐⭐ | ✅ Tamamlandı |
| 3 | Agentic RAG / Self-RAG | 🟡 ORTA | 1 hafta | ⭐⭐⭐ | ✅ Tamamlandı |
| 4 | memvid — Portable Memory Format | 🟡 ORTA | 2-3 hafta | ⭐⭐⭐ | ⏳ |
| 5 | ECC Continuous Learning | 🟡 ORTA | 1 hafta | ⭐⭐⭐ | ⏳ |
| 6 | GitNexus — Code Knowledge Graph | 🟡 ORTA | 1-2 hafta | ⭐⭐⭐ | ⏳ |
| 7 | AgentMemory — Persistent Memory | 🟡 ORTA | 1-2 hafta | ⭐⭐⭐ | ⏳ |
| 8 | MCP Resource & Prompt Support | 🟡 ORTA | 3-5 gün | ⭐⭐ | ⏳ |
| 9 | Karpathy LLM Wiki - Memory İyileştirmeleri | 🔴 YÜKSEK | 1-2 hafta | ⭐⭐⭐ | ✅ Tamamlandı |
| 10 | KinBot Mimarisi - Ajan Otonomi ve Memory İyileştirmeleri | 🔴 YÜKSEK | 1-2 hafta | ⭐⭐⭐ | ✅ Tamamlandı |
| 11 | Permission Ask Mode (WebSocket Approval) | 🟡 ORTA | 2-3 gün | ⭐⭐ | ✅ Tamamlandı |
| 12 | Plugin Manifest Sistemi | 🟢 DÜŞÜK | 1 hafta | ⭐⭐ | ⏳ |

---

## 1. Hook Execution Engine (Claude Code İlhamlı)

### Nedir?
[Anthropic'in Claude Code CLI](https://github.com/tanbiralam/claude-code) (v2.1.88) kaynak kodu 31 Mart 2026'de npm registry'deki `.map` dosyası aracılığıyla sızdırılmıştır. Bu analiz, Claude Code'un ~108KB'lık hook sistemi (`src/utils/hooks.ts`), permission mekanizması ve memory extraction mimarisinden PenceAI'ye uyarlanabilecek desenleri kapsar.

**Claude Code Hook Mimarisi (Kaynak: Sızdırılan Kaynak Kod):**

Claude Code'da hook'lar **shell command** olarak çalışır. JSON stdin alır, JSON stdout döndürür. Bu, bizim planladığımız TypeScript-native hook'lardan çok daha esnektir:

```typescript
// Claude Code hook execution modeli
type HookDecision = 'approve' | 'block' | 'ask'
type HookResult = {
  decision: HookDecision
  reason?: string
  updatedInput?: ToolInput  // ← Hook tool input'unu DEĞİŞTİREBİLİR!
}
```

**Claude Code Hook Event'leri (Kaynak: `src/types/hooks.ts`):**

| Event | Ne Zaman Çalışır | PenceAI'de Karşılığı |
|-------|-------------------|----------------------|
| `PreToolUse` | Tool çalışmadan önce | `eventBus 'preToolUse'` ✅ |
| `PostToolUse` | Tool başarılı çalıştıktan sonra | `eventBus 'postToolUse'` ✅ |
| `PostToolUseFailure` | Tool hata verdiğinde | ❌ YOK — Eklenecek |
| `UserPromptSubmit` | Kullanıcı mesaj gönderdiğinde | ❌ YOK — Eklenecek |
| `SessionStart` / `SessionEnd` | Oturum başlangıcı/bitişi | ❌ YOK — Eklenecek |
| `PreCompact` / `PostCompact` | Context sıkıştırma öncesi/sonrası | ❌ YOK — **Çok önemli** |
| `Stop` / `StopFailure` | Agent durduğunda | ❌ YOK — Eklenecek |
| `SubagentStart` / `SubagentStop` | Alt-agent başladığında/bittiğinde | ❌ YOK — Eklenecek |
| `PermissionRequest` / `PermissionDenied` | İzin talebi/red | ❌ YOK — Eklenecek |
| `ConfigChange` | Ayar değiştiğinde | ❌ YOK |
| `CwdChanged` | Çalışma dizini değiştiğinde | ❌ YOK |
| `FileChanged` | Dosya değiştiğinde | ❌ YOK |
| `Elicitation` | MCP elicitation | ❌ YOK |

### Neden Önemli?
- Mevcut [`eventBus.ts`](src/agent/mcp/eventBus.ts:1) altyapısı ile doğal uyum
- **Tool input modification** — hook'lar tool input'unu modify edebilir (Claude Code'dan ilham)
- **Tool permission system** — `ask` modu ile kullanıcıya onay sorulabilir (WebSocket üzerinden)
- **Context compaction hooks** — `PreCompact`/`PostCompact` ile token bütçesi yönetimi
- Security monitoring ile riskli işlemleri engelleme

### Sub-Task'lar

#### Faz 1: Hook Execution Engine Core (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Genişletilmiş hook registry ve execution engine oluştur
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/agent/mcp/hooks.ts`](src/agent/mcp/hooks.ts:1) ve [`src/agent/mcp/hookTypes.ts`](src/agent/mcp/hookTypes.ts:1)
- **İlgili Dosyalar:** [`eventBus.ts`](src/agent/mcp/eventBus.ts:1), [`security.ts`](src/agent/mcp/security.ts:1), [`command-validator.ts`](src/agent/mcp/command-validator.ts:1), [`runtime.ts`](src/agent/mcp/runtime.ts:1)
- **Detay:**

```typescript
// src/agent/mcp/hookTypes.ts (yeni dosya)

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PermissionRequest'
  | 'Permission Denied';

export type HookDecision = 'approve' | 'block' | 'ask';

export interface HookContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  callCount: number;
  workingDirectory?: string;
  result?: unknown;           // PostToolUse için
  error?: string;             // PostToolUseFailure için
  compactReason?: string;    // PreCompact/PostCompact için
}

export interface HookResult {
  decision: HookDecision;
  reason?: string;
  updatedInput?: Record<string, unknown>;  // Claude Code'dan ilham: input modify edebilir
  metadata?: Record<string, unknown>;
  async?: boolean;            // true = arka planda çalış, agent'ı bloklama
}

export interface MCPHook {
  name: string;
  matcher: string | RegExp;   // Tool name pattern ('Bash' veya /Edit|Write/)
  event: HookEvent;
  handler: (context: HookContext) => Promise<HookResult>;
  priority: number;           // Düşük = önce çalışır
  async?: boolean;            // Arka planda çalışsın mı?
}
```

```typescript
// src/agent/mcp/hooks.ts (yeni dosya)

import type { MCPHook, HookEvent, HookContext, HookResult } from './hookTypes.js';
import { logger } from '../../utils/logger.js';

export class HookRegistry {
  private hooks: MCPHook[] = [];

  register(hook: MCPHook): void {
    this.hooks.push(hook);
    this.hooks.sort((a, b) => a.priority - b.priority);
    logger.info({ hookName: hook.name, event: hook.event }, '[HookRegistry] Hook registered');
  }

  unregister(name: string): void {
    this.hooks = this.hooks.filter(h => h.name !== name);
  }

  async executePhase(
    event: HookEvent,
    context: HookContext,
  ): Promise<HookResult[]> {
    const matchingHooks = this.hooks
      .filter(h => h.event === event)
      .filter(h => this.matchesTool(h.matcher, context.toolName));

    const results: HookResult[] = [];

    for (const hook of matchingHooks) {
      try {
        const result = hook.async
          ? await this.executeAsync(hook, context)
          : await hook.handler(context);
        results.push(result);

        if (event === 'PreToolUse' && result.decision === 'block') {
          logger.warn({ hookName: hook.name, toolName: context.toolName, reason: result.reason },
            '[HookRegistry] Tool blocked by hook');
          break;
        }

        if (result.updatedInput && event === 'PreToolUse') {
          context.args = { ...context.args, ...result.updatedInput };
        }
      } catch (error) {
        logger.error({ hookName: hook.name, error }, '[HookRegistry] Hook execution failed');
        results.push({ decision: 'approve', reason: `Hook ${hook.name} failed, allowing by default` });
      }
    }

    return results;
  }

  private matchesTool(matcher: string | RegExp, toolName: string): boolean {
    if (typeof matcher === 'string') {
      return matcher === toolName || matcher === '*';
    }
    return matcher.test(toolName);
  }

  private async executeAsync(hook: MCPHook, context: HookContext): Promise<HookResult> {
    hook.handler(context).catch(err => {
      logger.debug({ hookName: hook.name, error: err }, '[HookRegistry] Async hook completed');
    });
    return { decision: 'approve' };
  }
}
```

#### Faz 2: Event Bus Genişletme ve Runtime Entegrasyonu (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Tüm hook event'lerini eventBus ve runtime'a entegre et
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Entegre hook sistemi
- **İlgili Dosyalar:** [`eventBus.ts`](src/agent/mcp/eventBus.ts:1), [`runtime.ts`](src/agent/mcp/runtime.ts:1), [`reactLoop.ts`](src/agent/reactLoop.ts:1)
- **Detay:**

```typescript
// src/agent/mcp/runtime.ts'e eklenecek

import { HookRegistry } from './hooks.js';
import type { HookEvent, HookContext } from './hookTypes.js';

const hookRegistry = new HookRegistry();

// PreToolUse — tool çalışmadan önce
eventBus.on('preToolUse', async (event) => {
  const context: HookContext = {
    toolName: event.toolName,
    args: event.args,
    sessionId: event.sessionId,
    callCount: event.callCount,
  };

  const results = await hookRegistry.executePhase('PreToolUse', context);

  const blocked = results.find(r => r.decision === 'block');
  if (blocked) {
    throw new Error(`Tool blocked: ${blocked.reason || 'No reason provided'}`);
  }

  // Input modification (Claude Code'dan ilham)
  const lastModification = results.find(r => r.updatedInput);
  if (lastModification?.updatedInput) {
    event.args = { ...event.args, ...lastModification.updatedInput };
  }
});

// PostToolUse — tool başarılı olduktan sonra
eventBus.on('postToolUse', async (event) => {
  await hookRegistry.executePhase('PostToolUse', {
    toolName: event.toolName,
    args: event.args,
    sessionId: event.sessionId,
    callCount: event.callCount,
    result: event.result,
  });
});

// PostToolUseFailure — tool hata verdiğinde
eventBus.on('tool:call_error', async (event) => {
  await hookRegistry.executePhase('PostToolUseFailure', {
    toolName: event.toolName,
    args: event.args,
    sessionId: event.sessionId,
    callCount: event.callCount,
    error: event.error,
  });
});

// Session lifecycle hooks
eventBus.on('session:start', async (event) => {
  await hookRegistry.executePhase('SessionStart', {
    toolName: '*',
    args: {},
    sessionId: event.sessionId,
    callCount: 0,
  });
});

eventBus.on('session:end', async (event) => {
  await hookRegistry.executePhase('SessionEnd', {
    toolName: '*',
    args: {},
    sessionId: event.sessionId,
    callCount: event.callCount,
  });
});
```

#### Faz 3: Yerleşik Hook'lar (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Üretim seviyesi hook'ları implement et
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/agent/mcp/builtInHooks.ts`](src/agent/mcp/builtInHooks.ts:1) dosyası
- **Detay:**

| Hook Adı | Event | Matcher | Davranış | Öncelik |
|----------|-------|---------|----------|---------|
| **Security Monitor** | `PreToolUse` | `Bash\|Write\|Edit` | Path traversal, secret pattern, SQL injection tespiti | High |
| **Context Budget Guard** | `PreCompact` | `*` | ~50 tool call'da context compaction önerir | High |
| **Console.log Detector** | `PreToolUse` | `Write\|Edit` | console.log tespiti ve uyarı | Medium |
| **Dev Server Blocker** | `PreToolUse` | `Bash` | `npm run dev` dışarıda çalıştırılmasını engeller | Medium |
| **Output Sanitizer** | `PostToolUse` | `*` | Çıktıda hassas bilgi varsa maskele (API key, password) | High |
| **Observation Capture** | `PostToolUse` | `*` | Tool call'ları otomatik observation olarak kaydet | High |
| **Observation Capture** | `PostToolUseFailure` | `*` | Hata durumlarını da observation olarak kaydet | High |
| **Session Summary** | `SessionEnd` | `*` | Oturum sonunda özet çıkar | Low |

```typescript
// src/agent/mcp/builtInHooks.ts (yeni dosya)

import type { MCPHook } from './hookTypes.js';
import { HookRegistry } from './hooks.js';

const SECURITY_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: 'OpenAI API Key' },
  { pattern: /Bearer [a-zA-Z0-9\-_]{20,}/g, name: 'Bearer Token' },
  { pattern: /password["']?\s*[:=]\s*["']?[^"'\s]+/gi, name: 'Password' },
  { pattern: /\.\.\//g, name: 'Path Traversal' },
  { pattern: /(;|\|)\s*(rm|del|format)\s/gi, name: 'Destructive Command' },
];

export function registerBuiltInHooks(registry: HookRegistry): void {
  // Security Monitor
  registry.register({
    name: 'security-monitor',
    event: 'PreToolUse',
    matcher: /^(Bash|Write|Edit)$/,
    priority: 0,
    handler: async (ctx) => {
      const argsStr = JSON.stringify(ctx.args);
      for (const { pattern, name } of SECURITY_PATTERNS) {
        if (pattern.test(argsStr)) {
          return { decision: 'block', reason: `Security: ${name} detected in tool input` };
        }
      }
      return { decision: 'approve' };
    },
  });

  // Output Sanitizer
  registry.register({
    name: 'output-sanitizer',
    event: 'PostToolUse',
    matcher: /.*/,
    priority: 10,
    handler: async (ctx) => {
      if (!ctx.result || typeof ctx.result !== 'string') return { decision: 'approve' };
      let sanitized = ctx.result;
      for (const { pattern } of SECURITY_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      if (sanitized !== ctx.result) {
        return { decision: 'approve', updatedInput: {}, metadata: { sanitized: true } };
      }
      return { decision: 'approve' };
    },
  });

  // Console.log Detector
  registry.register({
    name: 'console-log-detector',
    event: 'PreToolUse',
    matcher: /^(Write|Edit)$/,
    priority: 20,
    handler: async (ctx) => {
      const content = ctx.args.content || ctx.args.newString || '';
      if (typeof content === 'string' && /console\.log\s*\(/.test(content)) {
        return {
          decision: 'ask',
          reason: 'console.log detected in code. Consider removing or replacing with logger.',
        };
      }
      return { decision: 'approve' };
    },
  });
}
```

#### Faz 4: Config ve Feature Flag (Öncelik: 🟡 ORTA)
- **Hedef:** Hook sistemini config ile yönetilebilir yap
- **Süre:** 1 gün
- **Zorluk:** ⭐
- **Çıktı:** Config dosyaları güncellemesi
- **İlgili Dosyalar:** [`config.ts`](src/gateway/config.ts:1), [`.env.example`](.env.example:1)
- **Detay:**

```env
# .env.example'a eklenecek
ENABLE_HOOKS=true                          # Hook sistemini aç/kapa
HOOK_SECURITY_MONITOR=true                 # Security monitor hook
HOOK_OUTPUT_SANITIZER=true                 # Output sanitizer hook
HOOK_CONSOLE_LOG_DETECTOR=ask              # ask | approve | block
HOOK_DEV_SERVER_BLOCKER=true               # Dev server blocker
HOOK_CONTEXT_BUDGET_GUARD=true             # Context budget guard
HOOK_OBSERVATION_CAPTURE=true             # Observation capture hook
HOOK_SESSION_SUMMARY=true                  # Session summary hook
```

```typescript
// src/gateway/config.ts'e eklenecek
enableHooks: boolean;                         // Default: true
hookSecurityMonitor: boolean;                 // Default: true
hookOutputSanitizer: boolean;                 // Default: true
hookConsoleLogDetector: 'ask' | 'approve' | 'block';  // Default: 'ask'
hookDevServerBlocker: boolean;                // Default: true
hookContextBudgetGuard: boolean;              // Default: true
hookObservationCapture: boolean;             // Default: true
hookSessionSummary: boolean;                 // Default: true
```

### Riskler ve Mitigasyon

| Konu | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| **Shell Execution Güvenliği** | Hook'lar shell command çalıştırıyorsa injection riski | Yüksek | PenceAI sadece TypeScript handler kullanacak, shell execution AÇIK |
| **Input Modification Riski** | Hook'lar tool input değiştirebilir | Orta | Sadece config ile açık hook'lar input modify edebilir |
| **Performance Overhead** | Her tool call'da hook execution | Düşük | Hook'lar async ve öncelik sırasına göre çalışır |
| **Circular Hook** | Bir hook başka bir hook'u tetikleyebilir | Orta | Hook execution sırasında yeni hook kaydı yasakla |

### Claude Code ile Karşılaştırma

| Konu | Claude Code | PenceAI |
|------|-------------|---------|
| **Hook Runtime** | Shell command (bash/PowerShell) | TypeScript native handler |
| **Input Modification** | ✅ `updatedInput` ile | ✅ Planlanıyor |
| **Permission Mode** | `default`, `plan`, `bypass`, `auto` | Config-based `ask/approve/block` |
| **Event Çeşitliliği** | 20+ event | 14 event (başlangıç) |
| **Shell Execution** | ✅ Var (JSON stdin/stdout) | ❌ YOK — daha güvenli |
| **Feature Flags** | `bun:bundle` build-time | `getConfig()` runtime |

### Referanslar
- Claude Code Sızıntı Analizi: https://github.com/tanbiralam/claude-code (31 Mart 2026)
- ECC Repo: https://github.com/affaan-m/everything-claude-code
- ECC Website: https://ecc.tools

---

## 2. MCP Resource & Prompt Support

### Nedir?
Model Context Protocol (MCP) sadece araçları (tools) değil, aynı zamanda **Resources** (statik veri kaynakları) ve **Prompts** (hazır komut şablonları) da destekler. Bu yeteneklerin eklenmesi, agent'ın dış verilere ve yapılandırılmış komutlara erişimini tam potansiyeline ulaştırır.

### Neden Önemli?
- **Resources**: Veritabanı tabloları, dosya içerikleri veya API çıktıları "kaynak" olarak sunulabilir. Agent bu kaynakları `read_resource` ile okuyabilir.
- **Prompts**: Kullanıcıya veya agent'a rehberlik eden hazır prompt şablonları MCP server'larından çekilebilir.
- **Full Compliance**: MCP standartlarına %100 uyum sağlar.

### Sub-Task'lar

#### Faz 1: Resource Yönetimi (Öncelik: Orta)
- **Hedef:** MCP kaynaklarını listeleme ve okuma yeteneği ekle.
- **Süre:** 1-2 gün
- **İlgili Dosyalar:** `src/agent/mcp/client.ts`, `src/agent/mcp/registry.ts`
- **Detay:**
  - `listResources()` ve `readResource()` metodlarını `MCPClientManager`'a ekle.
  - Resource URI şemalarını (`file://`, `postgres://` vb.) tanıyan bir router oluştur.

#### Faz 2: Prompt Yönetimi (Öncelik: Orta)
- **Hedef:** Sunuculardan prompt şablonlarını çekme ve doldurma.
- **Süre:** 1 gün
- **Detay:**
  - `listPrompts()` ve `getPrompt()` metodlarını implement et.
  - UI tarafında kullanıcının bu şablonları seçebileceği bir arayüz taslağı oluştur.

#### Faz 3: LLM Entegrasyonu (Öncelik: Orta)
- **Hedef:** Agent'ın bu kaynakları ne zaman okuyacağına karar vermesi.
- **Süre:** 1-2 gün
- **Detay:**
  - Agent prompt'una "mevcut kaynaklar" listesini dahil et.
  - Kaynak okuma sonuçlarını context'e düzenli şekilde besle.

---

## 3. Agentic RAG / Self-RAG

### Nedir?
**Self-RAG** (Asai et al., 2023) ve **Agentic RAG**, LLM'in kendi retrieval stratejisini dinamik olarak seçtiği, getirdiği bilgiyi eleştirdiği ve çıktısını öz-değerlendirme ile iyileştirdiği gelişmiş RAG yaklaşımıdır.

Standart RAG: `Query → Retrieve → Generate → Respond` (sabit pipeline)
Agentic RAG: `Query → Think → Decide if Retrieve → Choose Retriever → Critique → Generate → Self-Evaluate → Revise → Respond` (dinamik döngü)

### Neden Önemli?
- **PenceAI'nin mevcut mimarisi ile doğal sinerji**: Dual-process (System1/System2), GraphRAG, Intent Analyzer zaten mevcut
- **Gereksiz retrieval'ı önler**: `[No Retrieval]` kararı ile parametrik bilgiye güven → %30-50 daha az retrieval call
- **Multi-hop reasoning iyileştirir**: Self-correction loop ile eksik bilgiyi tespit edip yeniden retrieval yapar
- **Hallüsinasyon azaltır**: `[Supported]` / `[Unsupported]` kritikleri ile üretilen yanıtın doğrulanması
- **[`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1) doğal genişletilebilir**: IntentAnalyzer zaten var, sadece Self-RAG token'ları ve critique pipeline eklenecek

### Mevcut Durum (PenceAI 1.5.0)
| Bileşen | Durum | Self-RAG İhtiyacı |
|---------|-------|-------------------|
| Intent Analyzer | ✅ Var (signals, recipe, cognitiveLoad) | Kritik → `[Retrieve]` kararı için kullanılacak |
| Dual-Process (System1/System2) | ✅ Var | Kritik → Hangi retriever'ın seçileceği |
| GraphRAG Engine | ✅ Var (expansion, PageRank, community) | Kritik → Retriever seçeneklerinden biri |
| Spreading Activation | ✅ Var | Kritik → Retriever seçeneklerinden biri |
| Coverage Repair (Second Pass) | ✅ Var | Beneficial → `[Critique]` ile entegre edilebilir |
| Budget Applier | ✅ Var | Beneficial → Self-RAG token budget ile birleştirilecek |
| Behavior Discovery Shadow | ✅ Var | Optional → Self-RAG performansını ölçmek için kullanılabilir |
| **Retrieval Decision** | ❌ Sabit (recipe-based) | **EKLENMELİ** → LLM-based `[Retrieve]` / `[No Retrieve]` |
| **Passage Critique** | ❌ Yok | **EKLENMELİ** → `[Relevant]` / `[Irrelevant]` |
| **Support Verification** | ❌ Yok | **EKLENMELİ** → `[Fully supported]` / `[No support]` |
| **Utility Scoring** | ❌ Yok | **EKLENMELİ** → `[Utility:1-5]` |
| **Self-Correction Loop** | ❌ Yok | **EKLENMELİ** → Revision mekanizması |

### Self-RAG vs Agentic RAG Karşılaştırması

| Özellik | Self-RAG (Asai 2023) | Agentic RAG (Survey 2025) | PenceAI Uyumu |
|---------|---------------------|---------------------------|---------------|
| **Retrieval Decision** | Özel token `[Retrieve]` | LLM tool call | PenceAI: LLM tool call yaklaşımı daha uygun |
| **Passage Critique** | Özel token `[Relevant]` | LLM evaluation prompt | PenceAI: LLM evaluation (mevcut extraction pipeline benzeri) |
| **Support Check** | Özel token `[Supported]` | Fact-checking tool | PenceAI: Mevcut tools.ts'e fact-check tool eklenebilir |
| **Utility Scoring** | Özel token `[Utility:1-5]` | LLM self-evaluation | PenceAI: LLM self-evaluation daha pratik |
| **Training Gerekli mi?** | ✅ Evet (SFT ile) | ❌ Hayır (prompt-based) | **PenceAI: Prompt-based yaklaşım tercih edilmeli** |
| **Multi-Hop** | Sınırlı | ✅ Full agentic loop | PenceAI: Agentic loop tercih edilmeli |
| **Retriever Selection** | Tek retriever | Dinamik seçer | PenceAI: Dual-process + GraphRAG = 3+ retriever |

> **KARAR**: PenceAI için **Agentic RAG (prompt-based, training-free)** yaklaşımı benimsenecektir. Self-RAG'in token-based yaklaşımı yerine, mevcut LLM provider'ları kullanarak tool-call + prompt pattern'i ile implement edilecektir. Bu, fine-tuning gerektirmez ve mevcut mimariye doğal uyum sağlar.

---

### Agentic RAG Mimarisi (PenceAI Uyarlaması)

```
┌─────────────────────────────────────────────────────────────┐
│                    Agentic RAG Loop                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                                           │
│  │ 1. THINK     │  ← IntentAnalyzer + LLM "Do I need       │
│  │   (Decide)   │     retrieval?" → Retrieve / NoRetrieve   │
│  └──────┬───────┘                                           │
│         │                                                    │
│    ┌────▼────────────┐                                       │
│    │ 2. SELECT       │  ← Hangi retriever?                   │
│    │   (Retriever)   │     System1 / System2 / GraphRAG / Web│
│    └────┬────────────┘                                       │
│         │                                                    │
│    ┌────▼────────────┐                                       │
│    │ 3. RETRIEVE     │  ← Paralel retrieval (multi-retriever)│
│    │   (Execute)     │     Hybrid / Graph / Spreading        │
│    └────┬────────────┘                                       │
│         │                                                    │
│    ┌────▼────────────┐                                       │
│    │ 4. CRITIQUE     │  ← LLM: "Is this relevant? Complete?" │
│    │   (Evaluate)    │     [Relevant/Irrelevant] [Complete/  │
│    │                 │      Partial/Missing]                  │
│    └────┬────────────┘                                       │
│         │                                                    │
│    ┌────▼────────────┐         ┌──────────────────────────┐  │
│    │ 5. GENERATE     │  NO     │ 6. REVISE (if critique   │  │
│    │   (Respond)     │────────→│    flagged gaps)          │  │
│    │                 │  YES    │   → New query → Goto 2   │  │
│    └────┬────────────┘         └──────────────────────────┘  │
│         │                                                    │
│    ┌────▼────────────┐                                       │
│    │ 7. VERIFY       │  ← LLM: "Is response supported?      │
│    │   (Self-Eval)   │     [Supported/Unsupported/Partial]"  │
│    │                 │     Utility: 1-5                      │
│    └────┬────────────┘                                       │
│         │                                                    │
│    ┌────▼────────────┐         ┌──────────────────────────┐  │
│    │ 8. RESPOND      │  FAIL   │ 9. REGENERATE (if verify │  │
│    │   (Output)      │────────→│     flagged)              │  │
│    │                 │  PASS   │   → Goto 5 with feedback  │  │
│    └─────────────────┘         └──────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Sub-Task'lar

#### Faz 1: Retrieval Decision Engine (Öncelik: 🔴 YÜKSEK)
- **Hedef:** LLM-based "retrieve or not" karar mekanizması
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/retrieval/RetrievalDecider.ts`](src/memory/retrieval/RetrievalDecider.ts:1) dosyası
- **İlgili Dosyalar:** [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1), [`retrieval/IntentAnalyzer.ts`](src/memory/retrieval/IntentAnalyzer.ts:1)

**Detay:**

Mevcut `IntentAnalyzer` deterministic signal üretiyor. Agentic RAG'de bu sinyalleri LLM'e sorarak "retrieve needed mı?" kararı verdiriyoruz.

```typescript
// src/memory/retrieval/RetrievalDecider.ts (YENİ DOSYA)

import type { RetrievalIntentSignals } from './types.js';
import type { LLMProvider } from '../../llm/provider.js';

export interface RetrievalDecision {
  needsRetrieval: boolean;
  confidence: number;            // 0-1 arası
  reason: string;                // "User asking about specific fact"
  suggestedRetrievers: RetrieverType[];
  skipReason?: string;           // Eğer retrieval gerekmiyorsa
}

export type RetrieverType = 'system1' | 'system2' | 'graphRAG' | 'web' | 'memory';

const RETRIEVAL_DECISION_PROMPT = `You are a Retrieval Decision Engine. Given a user query and context signals, decide:

1. **Do you need external retrieval?** 
   - If the answer is in your training knowledge and is factual/common → NoRetrieve
   - If it requires specific user memory, recent info, or niche knowledge → Retrieve

2. **Which retriever(s) should be used?**
   - system1: Fast vector search (simple queries)
   - system2: Deep hybrid search (complex queries)
   - graphRAG: Multi-hop, relationship queries
   - web: Real-time, current events
   - memory: User-specific memories

3. **Confidence** in your decision (0-1).

Output format:
<decision>Retrieve|NoRetrieve</decision>
<confidence>0.0-1.0</confidence>
<reason>Brief explanation</reason>
<retrievers>system1, graphRAG</retrievers>
`;

export class RetrievalDecider {
  constructor(
    private llmProvider: LLMProvider,
  ) {}

  async decide(
    query: string,
    signals: RetrievalIntentSignals,
    recentMessages: Array<{ role: string; content: string }>,
  ): Promise<RetrievalDecision> {
    const prompt = this.buildPrompt(query, signals, recentMessages);
    const response = await this.llmProvider.chat([
      { role: 'system', content: RETRIEVAL_DECISION_PROMPT },
      { role: 'user', content: prompt },
    ]);

    return this.parseResponse(response.content);
  }

  private buildPrompt(query: string, signals: RetrievalIntentSignals, recentMessages: Array<{ role: string; content: string }>): string {
    return `Query: "${query}"

Intent Signals:
- Entities: ${signals.entities.join(', ') || 'none'}
- Temporal: ${signals.temporalContext || 'none'}
- Memory Cues: ${signals.memoryCues || 'none'}
- Complexity: ${signals.complexity}

Recent Conversation:
${recentMessages.slice(-3).map(m => `${m.role}: ${m.content.substring(0, 100)}`).join('\n')}`;
  }

  private parseResponse(content: string): RetrievalDecision {
    const decisionMatch = content.match(/<decision>(Retrieve|NoRetrieve)<\/decision>/);
    const confidenceMatch = content.match(/<confidence>([0-9.]+)<\/confidence>/);
    const reasonMatch = content.match(/<reason>(.+?)<\/reason>/);
    const retrieversMatch = content.match(/<retrievers>(.+?)<\/retrievers>/);

    return {
      needsRetrieval: decisionMatch?.[1] === 'Retrieve',
      confidence: parseFloat(confidenceMatch?.[1] || '0.5'),
      reason: reasonMatch?.[1] || 'Unknown',
      suggestedRetrievers: (retrieversMatch?.[1] || 'system1').split(',').map(r => r.trim() as RetrieverType),
    };
  }
}
```

**Entegrasyon (`retrievalOrchestrator.ts` güncellemesi):**

```typescript
// getPromptContextBundle metoduna eklenecek:

// Phase 0: Agentic Retrieval Decision
const decider = new RetrievalDecider(this.deps.llmProvider);
const retrievalDecision = await decider.decide(query, signals, recentMessages);

if (!retrievalDecision.needsRetrieval) {
  // Fast path: Retrieval olmadan yanıt
  return this.buildResponseWithoutRetrieval(query, signals, recentMessages);
}

// Phase 1: Intent analysis (mevcut)
const analysis = this.intentAnalyzer.analyze(query, recentMessages);

// Phase 2: Retriever selection based on decision
const selectedRetrievers = retrievalDecision.suggestedRetrievers;
```

**Test Senaryoları:**
| Senaryo | Beklenen Karar | Retriever |
|---------|----------------|-----------|
| "Merhaba, nasılsın?" | NoRetrieve | - |
| "Dün anlattığım projenin adı neydi?" | Retrieve | system1, memory |
| "Python'da async/await nasıl çalışır?" | NoRetrieve (parametrik bilgi) | - |
| "2026'daki en son AI haberleri?" | Retrieve | web, graphRAG |
| "Yigit'in tercihleri ve proje detayları" | Retrieve | system2, graphRAG |

---

#### Faz 2: Passage Critique Engine (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Getirilen bilgilerin alaka düzeyini ve completeness'ini değerlendir
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/retrieval/PassageCritique.ts`](src/memory/retrieval/PassageCritique.ts:1) dosyası
- **İlgili Dosyalar:** [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1), [`ScoringPipeline.ts`](src/memory/retrieval/ScoringPipeline.ts:1)

**Detay:**

Mevcut `ScoringPipeline` scoring yapıyor ama "bu passage yeterli mi?" sorusunu sormuyor. Passage Critique, her getirilen belleği tek tek değerlendirip eksik/yanlış/alakasız olanları filtreler.

```typescript
// src/memory/retrieval/PassageCritique.ts (YENİ DOSYA)

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';

export interface PassageEvaluation {
  memoryId: number;
  relevance: 'Relevant' | 'Irrelevant' | 'PartiallyRelevant';
  relevanceScore: number;        // 0-1
  completeness: 'Complete' | 'Partial' | 'Insufficient';
  completenessScore: number;     // 0-1
  issues: string[];              // ["Outdated", "Too generic", "Missing specifics"]
  keep: boolean;                 // Final decision
}

export interface CritiqueResult {
  evaluations: PassageEvaluation[];
  keptCount: number;
  filteredCount: number;
  overallCompleteness: number;   // 0-1 (kept passages' avg)
  needsMoreRetrieval: boolean;   // Hiçbiri yeterli değilse
  missingInfo: string[];         // Ne eksik?
}

const PASSAGE_CRITIQUE_PROMPT = `You are a Passage Critique Engine. Evaluate each retrieved passage for a given query.

For EACH passage, assess:
1. **Relevance**: Does this passage directly address the query?
   - Relevant: Directly addresses
   - PartiallyRelevant: Partially addresses, but has gaps
   - Irrelevant: Does not address

2. **Completeness**: Does this passage provide enough detail?
   - Complete: Sufficient detail to answer
   - Partial: Some detail, but missing specifics
   - Insufficient: Not enough information

3. **Issues**: List any problems (outdated, contradictory, too generic, etc.)

Output format (JSON array):
[
  {
    "memoryId": 123,
    "relevance": "Relevant|PartiallyRelevant|Irrelevant",
    "relevanceScore": 0.85,
    "completeness": "Complete|Partial|Insufficient",
    "completenessScore": 0.7,
    "issues": ["Too generic"],
    "keep": true
  }
]

Be STRICT. Only keep passages that are both Relevant (score > 0.6) AND at least Partial completeness (score > 0.4).`;

export class PassageCritique {
  constructor(
    private llmProvider: LLMProvider,
  ) {}

  async evaluate(
    query: string,
    passages: MemoryRow[],
  ): Promise<CritiqueResult> {
    if (passages.length === 0) {
      return {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0,
        needsMoreRetrieval: true,
        missingInfo: ['No passages retrieved'],
      };
    }

    const prompt = this.buildPrompt(query, passages);
    const response = await this.llmProvider.chat([
      { role: 'system', content: PASSAGE_CRITIQUE_PROMPT },
      { role: 'user', content: prompt },
    ]);

    const evaluations = this.parseResponse(response.content, passages);
    const kept = evaluations.filter(e => e.keep);

    return {
      evaluations,
      keptCount: kept.length,
      filteredCount: evaluations.length - kept.length,
      overallCompleteness: kept.length > 0
        ? kept.reduce((sum, e) => sum + e.completenessScore, 0) / kept.length
        : 0,
      needsMoreRetrieval: kept.length === 0 || (kept.length > 0 && kept.every(e => e.completenessScore < 0.6)),
      missingInfo: this.extractMissingInfo(query, evaluations),
    };
  }

  private buildPrompt(query: string, passages: MemoryRow[]): string {
    return `Query: "${query}"

Retrieved Passages (${passages.length}):
${passages.map((p, i) => `[${i + 1}] ID: ${p.id}\n${p.content.substring(0, 300)}`).join('\n\n')}`;
  }

  private parseResponse(content: string, passages: MemoryRow[]): PassageEvaluation[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.defaultEvaluations(passages);
      return JSON.parse(jsonMatch[0]);
    } catch {
      return this.defaultEvaluations(passages);
    }
  }

  private defaultEvaluations(passages: MemoryRow[]): PassageEvaluation[] {
    return passages.map(p => ({
      memoryId: p.id,
      relevance: 'PartiallyRelevant' as const,
      relevanceScore: 0.5,
      completeness: 'Partial' as const,
      completenessScore: 0.5,
      issues: ['Critique parse failed, keeping as fallback'],
      keep: true,
    }));
  }

  private extractMissingInfo(query: string, evaluations: PassageEvaluation[]): string[] {
    const incomplete = evaluations.filter(e => !e.keep || e.completeness === 'Insufficient');
    if (incomplete.length > 0) {
      return [`Passages retrieved but insufficient to answer: "${query}"`];
    }
    return [];
  }
}
```

**Entegrasyon (`retrievalOrchestrator.ts` güncellemesi):**

```typescript
// Retrieval sonrası critique çalıştır
const critique = new PassageCritique(this.deps.llmProvider);
const critiqueResult = await critique.evaluate(query, relevantMemories);

// Filter out irrelevant passages
const filteredMemories = relevantMemories.filter(m =>
  critiqueResult.evaluations.find(e => e.memoryId === m.id && e.keep)
);

// Check if more retrieval needed
if (critiqueResult.needsMoreRetrieval) {
  // Multi-hop: Yeni query ile tekrar retrieval
  const refinedResults = await this.multiHopRetrieval(query, critiqueResult.missingInfo);
  // Merge results
}
```

---

#### Faz 4: Multi-Hop Retrieval Loop (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Kritik sonucu "eksik" ise yeni sorgu ile tekrar retrieval yap
- **Süre:** 4-5 gün
- **Zorluk:** ⭐⭐⭐⭐
- **Çıktı:** [`src/memory/retrieval/MultiHopRetrieval.ts`](src/memory/retrieval/MultiHopRetrieval.ts:1) dosyası
- **İlgili Dosyalar:** [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1), [`GraphRAGEngine.ts`](src/memory/graphRAG/GraphRAGEngine.ts:1)

**Detay:**

Self-RAG'in en güçlü yanı: Tek retrieval yetmezse, model "ne eksik?" diye analiz eder ve yeni bir query ile tekrar retrieval yapar. Bu loop maksimum 3 kez tekrarlanır.

```typescript
// src/memory/retrieval/MultiHopRetrieval.ts (YENİ DOSYA)

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';
import type { CritiqueResult } from './PassageCritique.js';
import type { RetrievalDecision, RetrieverType } from './RetrievalDecider.js';

interface MultiHopResult {
  memories: MemoryRow[];
  hops: HopEntry[];
  finalCompleteness: number;
  exhaustedMaxHops: boolean;
}

interface HopEntry {
  hopNumber: number;
  query: string;
  retrieverUsed: RetrieverType;
  resultsCount: number;
  critiqueResult: CritiqueResult;
}

const QUERY_REFINEMENT_PROMPT = `Based on the query and what's missing from the retrieved passages, generate a new, more targeted search query.

Original Query: "{query}"
Missing Information: {missingInfo}
Previous Results: {summary}

Generate a DIFFERENT query that would find the missing information. Be specific and targeted.

Output: <query>your refined query here</query>`;

export class MultiHopRetrieval {
  constructor(
    private llmProvider: LLMProvider,
    private maxHops: number = 3,
  ) {}

  async execute(
    originalQuery: string,
    initialResult: MemoryRow[],
    initialCritique: CritiqueResult,
    retrieveFn: (query: string, retrievers: RetrieverType[]) => Promise<MemoryRow[]>,
  ): Promise<MultiHopResult> {
    const hops: HopEntry[] = [];
    let currentMemories = initialResult;
    let currentCritique = initialCritique;
    let currentQuery = originalQuery;

    for (let hop = 1; hop <= this.maxHops; hop++) {
      if (!currentCritique.needsMoreRetrieval) {
        break; // Yeterli bilgi var
      }

      // 1. Generate refined query
      const refinedQuery = await this.generateRefinedQuery(
        originalQuery,
        currentCritique.missingInfo,
        currentMemories,
      );

      // 2. Decide which retrievers to use
      const retrievers = this.selectRetrieversForHop(hop, originalQuery);

      // 3. Execute retrieval
      const newMemories = await retrieveFn(refinedQuery, retrievers);

      // 4. Critique new results
      const newCritique = await this.critiqueFn(refinedQuery, newMemories);

      // 5. Merge (dedup by ID)
      const existingIds = new Set(currentMemories.map(m => m.id));
      const uniqueNew = newMemories.filter(m => !existingIds.has(m.id));
      currentMemories = [...currentMemories, ...uniqueNew];

      // 6. Record hop
      hops.push({
        hopNumber: hop,
        query: refinedQuery,
        retrieverUsed: retrievers,
        resultsCount: newMemories.length,
        critiqueResult: newCritique,
      });

      currentCritique = newCritique;
      currentQuery = refinedQuery;
    }

    return {
      memories: currentMemories,
      hops,
      finalCompleteness: currentCritique.overallCompleteness,
      exhaustedMaxHops: hops.length === this.maxHops && currentCritique.needsMoreRetrieval,
    };
  }

  private async generateRefinedQuery(
    originalQuery: string,
    missingInfo: string[],
    previousResults: MemoryRow[],
  ): Promise<string> {
    const prompt = QUERY_REFINEMENT_PROMPT
      .replace('{query}', originalQuery)
      .replace('{missingInfo}', missingInfo.join('; '))
      .replace('{summary}', previousResults.slice(0, 2).map(m => m.content.substring(0, 150)).join(' | '));

    const response = await this.llmProvider.chat([
      { role: 'system', content: 'You are a query refinement engine.' },
      { role: 'user', content: prompt },
    ]);

    const match = response.content.match(/<query>(.+?)<\/query>/);
    return match?.[1] || originalQuery;
  }

  private selectRetrieversForHop(hop: number, originalQuery: string): RetrieverType[] {
    // İlk hop: system1 (hızlı)
    // İkinci hop: system2 (derin)
    // Üçüncü hop: graphRAG (ilişkisel)
    if (hop === 1) return ['system2'];
    if (hop === 2) return ['graphRAG'];
    return ['system1', 'system2', 'graphRAG']; // Son çare: hepsi
  }
}
```

**Entegrasyon:**

```typescript
// retrievalOrchestrator.ts içinde:
if (critiqueResult.needsMoreRetrieval) {
  const multiHop = new MultiHopRetrieval(this.deps.llmProvider, { maxHops: 3 });
  const multiHopResult = await multiHop.execute(
    query,
    filteredMemories,
    critiqueResult,
    async (q, retrievers) => this.executeRetrievalForRetrievers(q, retrievers),
  );
  relevantMemories = multiHopResult.memories;
}
```

---

#### Faz 5: Self-Evaluation & Response Verification (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Üretilen yanıtı doğruluk ve destek açısından kontrol et
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/retrieval/ResponseVerifier.ts`](src/memory/retrieval/ResponseVerifier.ts:1) dosyası
- **İlgili Dosyalar:** [`runtime.ts`](src/agent/runtime.ts:1) (ReAct loop sonu)

**Detay:**

Agent yanıtı ürettikten sonra, bu yanıtın retrieval sonuçlarıyla desteklenip desteklenmediğini kontrol eder. Desteklenmiyorsa, yanıtı yeniden üretir.

```typescript
// src/memory/retrieval/ResponseVerifier.ts (YENİ DOSYA)

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';

export interface VerificationResult {
  isSupported: 'FullySupported' | 'PartiallySupported' | 'Unsupported';
  supportScore: number;          // 0-1
  utilityScore: number;          // 1-5
  hallucinations: string[];      // Desteklenmeyen iddialar
  needsRegeneration: boolean;
  feedback: string;              // "Add more specifics about X"
}

const VERIFICATION_PROMPT = `You are a Response Verification Engine. Evaluate the generated response against the retrieved memories.

TASKS:
1. **Support Check**: Is each claim in the response supported by the memories?
   - FullySupported: All claims backed by retrieved info
   - PartiallySupported: Most claims backed, some gaps
   - Unsupported: Claims not backed by memories (HALLUCINATION)

2. **Utility Score**: How useful is this response for the query? (1-5)
   - 5: Complete, actionable, accurate
   - 4: Mostly complete, minor gaps
   - 3: Partially answers, significant gaps
   - 2: Barely relevant
   - 1: Completely off-topic

3. **Hallucination Check**: List any unsupported claims.

4. **Decision**: Does this need regeneration?

Output format (JSON):
{
  "isSupported": "FullySupported|PartiallySupported|Unsupported",
  "supportScore": 0.85,
  "utilityScore": 4,
  "hallucinations": ["Claim X not supported by memory"],
  "needsRegeneration": false,
  "feedback": "Response is well-supported"
}`;

export class ResponseVerifier {
  constructor(
    private llmProvider: LLMProvider,
  ) {}

  async verify(
    query: string,
    response: string,
    memories: MemoryRow[],
  ): Promise<VerificationResult> {
    const prompt = this.buildPrompt(query, response, memories);
    const result = await this.llmProvider.chat([
      { role: 'system', content: VERIFICATION_PROMPT },
      { role: 'user', content: prompt },
    ]);

    return this.parseResponse(result.content);
  }

  private buildPrompt(query: string, response: string, memories: MemoryRow[]): string {
    return `Query: "${query}"

Generated Response:
${response}

Retrieved Memories (${memories.length}):
${memories.map(m => `- ${m.content.substring(0, 200)}`).join('\n')}`;
  }

  private parseResponse(content: string): VerificationResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.defaultResult();
      return JSON.parse(jsonMatch[0]);
    } catch {
      return this.defaultResult();
    }
  }

  private defaultResult(): VerificationResult {
    return {
      isSupported: 'PartiallySupported',
      supportScore: 0.5,
      utilityScore: 3,
      hallucinations: [],
      needsRegeneration: false,
      feedback: 'Verification parse failed, assuming partial support',
    };
  }
}
```

**Entegrasyon (`runtime.ts` güncellemesi):**

```typescript
// processMessage veya runReActLoop sonunda:
const verifier = new ResponseVerifier(this.llmProvider);
const verification = await verifier.verify(query, generatedResponse, usedMemories);

if (verification.needsRegeneration) {
  // Regenerate with feedback
  const retryPrompt = `${generatedResponse}\n\n⚠️ Self-Evaluation: ${verification.feedback}\nHallucinations: ${verification.hallucinations.join(', ')}\n\nPlease revise your response to address these issues.`;
  generatedResponse = await this.regenerateResponse(retryPrompt, usedMemories);
}
```

---

#### Faz 6: Config, Feature Flag ve Production Aktifleştirme (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Agentic RAG'ı feature flag ile yönetilebilir yap ve production'a aç
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Config dosyaları, `.env` değişkenleri, `retrievalOrchestrator.ts` entegrasyonu tamamlanır
- **İlgili Dosyalar:** [`config.ts`](src/gateway/config.ts:1), [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1), [`.env.example`](.env.example:1)

**Detay:**

Shadow mode yok — sistem feature flag ile **doğrudan aktif** edilecek. Kullanıcı `.env`'den açıp kapatabilir.

```env
# .env.example'a eklenecek
ENABLE_AGENTIC_RAG=true               # Default: açık (kullanıcı kapatabilir)
AGENTIC_RAG_MAX_HOPS=3                # Multi-hop maksimum tekrar
AGENTIC_RAG_DECISION_CONFIDENCE=0.7   # Retrieval decision confidence threshold
AGENTIC_RAG_CRITIQUE_RELEVANCE_FLOOR=0.6  # Passage relevance floor
AGENTIC_RAG_VERIFICATION_REGEN_LIMIT=1    # Maksimum regenerasyon sayısı
```

**Config entegrasyonu (`config.ts`):**
```typescript
// src/gateway/config.ts'e eklenecek
enableAgenticRAG: boolean;        // Default: true
agenticRAGMaxHops: number;        // Default: 3
agenticRAGDecisionConfidence: number;  // Default: 0.7
agenticRAGCritiqueRelevanceFloor: number;  // Default: 0.6
agenticRAGVerificationRegenLimit: number;  // Default: 1
```

**`retrievalOrchestrator.ts` içinde kullanım:**
```typescript
// getPromptContextBundle başında:
if (!this.deps.config.enableAgenticRAG) {
  // Eski (klasik) retrieval pipeline'a düş
  return this.getClassicPromptContextBundle(request);
}

// Agentic RAG pipeline
const retrievalDecision = await this.decider.decide(query, signals, recentMessages);
// ... 4 fazlı pipeline ...
```

**Geriye uyumluluk:** `ENABLE_AGENTIC_RAG=false` yapıldığında eski retrieval pipeline aynen çalışmaya devam eder. Hiçbir kullanıcı etkilenmez.

---

### Agentic RAG Pipeline Özeti

```
Query → [RetrievalDecider] → Retrieve? → NO → Direct Response
                                    ↓ YES
                           [RetrieverSelector] → system1/system2/graphRAG
                                    ↓
                           [MultiHopRetrieval] → Retrieve → Critique
                                    ↓ (if incomplete)
                              Loop (max 3 hops)
                                    ↓
                           [PassageCritique] → Filter + Identify gaps
                                    ↓
                           [AgentResponse] → LLM generates answer
                                    ↓
                           [ResponseVerifier] → Support check + Utility
                                    ↓ (if unsupported)
                              Regenerate (max 1)
                                    ↓
                           Final Response → User
```

### Riskler ve Mitigasyon

| Risk | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| **LLM Call Overhead** | Her decision/critique/verification = ekstra LLM call | 🔴 Yüksek | Lightweight decision (cached patterns), throttle, confidence threshold |
| **Infinite Retrieval Loop** | Multi-hop sürekli yeni retrieval yapar | 🟡 Orta | `maxHops=3` hard limit + early stopping |
| **Latency Artışı** | 3-4 ekstra LLM call = 5-10s ek gecikme | 🔴 Yüksek | Async critique, parallel retrievers, streaming response |
| **Critique False Positives** | İyi passage'ları filtreler | 🟡 Orta | Configurable floor, fallback pool, shadow mode validation |
| **Token Tüketimi** | Her LLM call = token maliyeti | 🟡 Orta | Token budget tracking, user-facing cost display |
| **Regeneration Loop** | Sürekli regenerasyon | 🟢 Düşük | `maxRegen=1` hard limit |
| **Provider Compatibility** | Tüm provider'lar bu pattern'i desteklemeyebilir | 🟢 Düşük | LLMProvider interface'e `supportsToolCall()` ekle |

### Başarı Metrikleri (Production'da İzlenecek)

| Metrik | Mevcut (Baseline) | Hedef (Agentic RAG) |
|--------|-------------------|---------------------|
| Retrieval Call / Query | 1.0 | 0.6-1.5 (dynamic) |
| Response Completeness | 0.65 | 0.80+ |
| Hallucination Rate | ~8% | <3% |
| Avg Latency | 2-3s | 4-7s (kabul edilebilir) |
| User Satisfaction (est.) | 3.5/5 | 4.2/5 |
| Token Cost / Query | 1500 | 2500-3500 (trade-off) |

### Bağımlılık Sırası

1. **Faz 1**: RetrievalDecider → Temel karar mekanizması
2. **Faz 2**: PassageCritique → Retrieval sonrası değerlendirme
3. **Faz 3**: ResponseVerifier → Yanıt doğrulama (paralel geliştirilebilir)
4. **Faz 4**: MultiHopRetrieval → Eksik bilgi için loop (Faz 2'ye bağımlı)
5. **Faz 5**: Self-Evaluation → Agent runtime entegrasyonu (Faz 3 ile paralel)
6. **Faz 6**: Config + Feature Flag → `ENABLE_AGENTIC_RAG=true` ile production'a aç

### Referanslar
- Self-RAG Paper: https://arxiv.org/abs/2310.11511
- Agentic RAG Survey: https://arxiv.org/abs/2501.09136
- A-RAG (2026): https://arxiv.org/abs/2602.03442
- Kore AI Agentic RAG: https://www.kore.ai/blog/what-is-agentic-rag

---

## 4. memvid — Portable Memory Format

### Nedir?
memvid, AI ajanları için taşınabilir, tek dosya tabanlı (`.mv2`) bir bellek storage formatıdır.
Smart Frames, append-only mimari, hybrid search ve deterministic time-travel özellikleri sunar.

### Neden Önemli?
- **Portable bellek export/import**: Kullanıcılar belleklerini tek dosya olarak paylaşabilir/yedekleyebilir
- **Smart Frame veri modeli**: Self-contained bellek birimleri serialization'ı basitleştirir
- **Deterministic replay**: Bellek durumunu geri alabilme (time-travel debugging)
- **Segment-based indexing**: Büyük bellek setlerinde performans artışı

### Mevcut Durum
- [`types.ts`](src/memory/types.ts:1) — `MemoryRow` tipi mevcut, ancak self-contained değil
- [`database.ts`](src/memory/database.ts:1) — SQLite tabanlı storage
- [`graph.ts`](src/memory/graph.ts:1) — Graph tabanlı bellek ilişkileri
- Export/import özelliği yok
- Snapshot/time-travel özelliği yok

### Sub-Task'lar

#### Faz 1: Smart Frame Veri Modeli Adaptasyonu (Öncelik: Yüksek)
- **Hedef:** Smart Frame interface'ini tanımla
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Smart Frame tipi
- **İlgili Dosyalar:** [`types.ts`](src/memory/types.ts:1)
- **Detay:**
```typescript
// src/memory/types.ts'e ekle
interface SmartFrame {
  id: string;
  timestamp: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  relations: Array<{ targetId: string; type: string; weight: number }>;
  checksum: string; // Integrity için
  // Self-contained: tüm gerekli bilgiler bu objede
}
```

#### Faz 2: Portable Export Formatı (Öncelik: Yüksek)
- **Hedef:** Export/Import fonksiyonlarını yaz
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/memory/export.ts`](src/memory/export.ts:1) dosyası
- **Detay:**
```typescript
// src/memory/export.ts
interface PenceAIMemoryFile {
  version: '1.0.0';
  createdAt: number;
  frames: SmartFrame[];
  graph: { nodes: string[]; edges: Array<[string, string, string]> };
  checksum: string;
}

async function exportMemories(filter?: MemoryFilter): Promise<PenceAIMemoryFile>;
async function importMemories(file: PenceAIMemoryFile): Promise<ImportResult>;
```

#### Faz 3: Deterministic Time-Travel / Snapshot Layer (Öncelik: Orta)
- **Hedef:** Snapshot oluştur ve geri yükle
- **Süre:** 3-5 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/snapshot.ts`](src/memory/snapshot.ts:1) dosyası
- **Detay:**
```typescript
// src/memory/snapshot.ts
interface MemorySnapshot {
  id: string;
  timestamp: number;
  walPosition: number; // SQLite WAL pozisyonu
  frameChecksums: Map<string, string>;
}

async function createSnapshot(): Promise<MemorySnapshot>;
async function restoreSnapshot(snapshot: MemorySnapshot): Promise<void>;
async function listSnapshots(): Promise<MemorySnapshot[]>;
```

#### Faz 4: Segment-Based Indexing (Öncelik: Düşük)
- **Hedef:** Bellek segmentleri oluştur
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Segment indexing sistemi
- **Detay:**
```typescript
// Büyük bellek setlerini segmentlere ayır
interface MemorySegment {
  id: string;
  name: string;
  frameIds: string[];
  createdAt: number;
  updatedAt: number;
}

// Segment bazlı arama ile performans artışı
async function searchInSegment(segmentId: string, query: string): Promise<SearchResult[]>;
```

#### Faz 5: API Endpoints (Öncelik: Düşük)
- **Hedef:** REST API endpoint'leri ekle
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** API routes
- **İlgili Dosyalar:** [`routes.ts`](src/gateway/routes.ts:1)
- **Detay:**
```typescript
// src/gateway/routes.ts'e ekle
POST /api/memory/export      // Tüm bellekleri export et
POST /api/memory/import      // Bellek dosyası import et
POST /api/memory/snapshot    // Snapshot oluştur
GET  /api/memory/snapshots   // Snapshot listesini al
POST /api/memory/snapshot/:id/restore  // Snapshot'a geri dön
```

### Riskler ve Mitigasyon
| Risk | Mitigasyon |
|------|------------|
| Mevcut `MemoryRow` ile uyumsuzluk | Adapter pattern ile geçiş |
| Büyük dosya boyutu | Compression (gzip) + chunked export |
| Snapshot storage overhead | Incremental snapshots + cleanup policy |
| Import çakışmaları | Upsert logic + conflict resolution |

### Referanslar
- memvid: https://github.com/memvid/memvid
- Smart Frames: https://github.com/memvid/memvid#smart-frames

---

## 5. ECC Continuous Learning

### Nedir?
ECC'nin continuous learning skill'i, agent'ın kullanıcı etkileşimlerinden öğrenmesini ve pattern'leri hafızaya kaydetmesini sağlar.

### Neden Önemli?
- Kullanıcı tercihlerini otomatik öğrenir
- Tekrarlayan düzeltmeleri pattern olarak kaydeder
- [`memory/manager`](src/memory/manager/index.ts:1) ile doğal entegrasyon

### Sub-Task'lar

#### Faz 1: Learning Session Yönetimi (Öncelik: Yüksek)
- **Hedef:** Learning session başlat/bitir mekanizması
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/memory/continuous-learning.ts`](src/memory/continuous-learning.ts:1) dosyası
- **İlgili Dosyalar:** [`manager/index.ts`](src/memory/manager/index.ts:1), [`autonomous/worker.ts`](src/autonomous/worker.ts:1)
- **Detay:**
```typescript
// src/memory/continuous-learning.ts (yeni dosya)

interface LearningSession {
  id: string;
  startTime: number;
  endTime?: number;
  observations: LearningObservation[];
  insights: string[];
}

interface LearningObservation {
  timestamp: number;
  type: 'pattern' | 'preference' | 'correction';
  data: Record<string, unknown>;
}

class ContinuousLearningEngine {
  private currentSession: LearningSession | null = null;

  startSession(): LearningSession {
    this.currentSession = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      observations: [],
      insights: [],
    };
    return this.currentSession;
  }

  observe(observation: LearningObservation): void {
    if (!this.currentSession) return;
    this.currentSession.observations.push(observation);
  }

  async endSession(): Promise<string[]> {
    if (!this.currentSession) return [];

    this.currentSession.endTime = Date.now();

    // Pattern analysis
    const insights = await this.analyzePatterns(this.currentSession.observations);

    // Store insights to memory
    for (const insight of insights) {
      await this.memoryManager.storeLearning({
        type: 'insight',
        content: insight,
        timestamp: Date.now(),
      });
    }

    this.currentSession = null;
    return insights;
  }

  private async analyzePatterns(observations: LearningObservation[]): Promise<string[]> {
    // Pattern detection logic
    // Örn: Kullanıcı her zaman X tipinde düzeltme yapıyor → preference öğren
    const insights: string[] = [];

    const corrections = observations.filter(o => o.type === 'correction');
    if (corrections.length > 3) {
      insights.push(`Kullanıcı ${corrections.length} kez düzeltme yaptı, bu pattern'i öğren`);
    }

    return insights;
  }
}
```

#### Faz 2: Pattern Detection (Öncelik: Orta)
- **Hedef:** Kullanıcı pattern'lerini tespit et
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** Pattern detection algoritması
- **Detay:**
  - Tekrarlanan düzeltme pattern'leri
  - Kullanıcı tercihleri
  - Sık kullanılan komutlar

#### Faz 3: Memory Integration (Öncelik: Orta)
- **Hedef:** Öğrenilen pattern'leri memory'ye kaydet
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Memory entegrasyonu
- **İlgili Dosyalar:** [`manager/index.ts`](src/memory/manager/index.ts:1)

### Riskler ve Mitigasyon

| Risk | Açıklama | Risk Seviyesi |
|------|----------|---------------|
| False positive pattern detection | Yanlış öğrenilen pattern'ler | Orta |
| Storage overhead | Çok fazla observation | Düşük |

### Referanslar
- ECC Continuous Learning: https://github.com/affaan-m/everything-claude-code

---

## 6. GitNexus — Code Knowledge Graph & MCP Entegrasyonu

### Nedir?
[GitNexus](https://github.com/abhigyanpatwari/GitNexus), kod tabanlarını **bilgi grafiğine (knowledge graph)** dönüştüren ve AI agent'larına derin kod farkındalığı sağlayan bir araçtır. 22.2k+ yıldızlı, aktif bir açık kaynak projesidir.

**Temel Özellikler:**
- **Tree-sitter** ile çoklu dil AST parsing (14+ dil: TypeScript, Python, Java, Go, Rust, C#, vb.)
- **LadybugDB** (eski adıyla KuzuDB) ile embedded graph veritabanı
- **MCP (Model Context Protocol)** üzerinden AI agent entegrasyonu
- **Precomputed Relational Intelligence**: İlişkileri index zamanında önceden hesaplar
- **16 MCP Tool**: `query`, `context`, `impact`, `detect_changes`, `rename`, `cypher` vb.
- **4 Agent Skill**: Exploring, Debugging, Impact Analysis, Refactoring

### Neden Önemli?
- **Mevcut MCP altyapısı ile doğal uyum**: PenceAI zaten MCP runtime'a sahip
- **Kod analizi yeteneği**: PenceAI'nin bellek sistemi + GitNexus'un kod grafiği = güçlü sinerji
- **Precomputed intelligence**: Query zamanında graph expansion yerine index zamanında hesaplama
- **Impact analysis**: Değişikliklerin blast radius'unu önceden görme

### Mevcut Durum
- [`src/agent/mcp/index.ts`](src/agent/mcp/index.ts:1) — MCP modülü mevcut
- [`src/agent/mcp/runtime.ts`](src/agent/mcp/runtime.ts:1) — MCP runtime
- [`src/memory/graphRAG/GraphRAGEngine.ts`](src/memory/graphRAG/GraphRAGEngine.ts:1) — GraphRAG engine
- Kod parsing/analiz yeteneği yok
- Impact analysis yok
- Process tracing yok

### Sub-Task'lar

#### Faz 1: MCP Köprüsü (Öncelik: Yüksek — Hızlı Kazanım)
- **Hedef:** GitNexus'u MCP server olarak PenceAI'ye bağla
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/agent/mcp/gitnexus-bridge.ts`](src/agent/mcp/gitnexus-bridge.ts:1) dosyası
- **İlgili Dosyalar:** [`mcp/index.ts`](src/agent/mcp/index.ts:1), [`mcp/runtime.ts`](src/agent/mcp/runtime.ts:1)
- **Detay:**
```bash
# GitNexus kurulumu
npm install -g gitnexus

# Proje indexleme (örnek)
cd /path/to/project
gitnexus analyze
```

```typescript
// src/agent/mcp/gitnexus-bridge.ts (yeni dosya)

interface GitNexusConfig {
  enabled: boolean;
  mcpCommand: string;      // Default: 'gitnexus'
  mcpArgs: string[];       // Default: ['mcp']
  indexedRepos: string[];  // Indexlenmiş repo yolları
}

class GitNexusBridge {
  private client: MCPClient | null = null;
  private config: GitNexusConfig;

  constructor(config: GitNexusConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    this.client = new MCPClient({
      command: this.config.mcpCommand,
      args: this.config.mcpArgs,
    });

    await this.client.connect();
    logger.info('[GitNexusBridge] MCP server connected');
  }

  // Tool: query - Process-grouped hybrid search
  async queryCodebase(query: string, repo?: string): Promise<QueryResult> {
    return this.client?.callTool('query', { query, repo });
  }

  // Tool: context - 360-degree symbol view
  async getSymbolContext(symbolName: string, repo?: string): Promise<SymbolContext> {
    return this.client?.callTool('context', { name: symbolName, repo });
  }

  // Tool: impact - Blast radius analysis
  async analyzeImpact(target: string, direction: 'upstream' | 'downstream', repo?: string): Promise<ImpactResult> {
    return this.client?.callTool('impact', { target, direction, repo });
  }
}
```

**Config:**
```env
# .env.example'a ekle
ENABLE_GITNEXUS=true
GITNEXUS_MCP_COMMAND=gitnexus
GITNEXUS_MCP_ARGS=["mcp"]
GITNEXUS_INDEXED_REPOS=["/path/to/repo1", "/path/to/repo2"]
```

#### Faz 2: Precomputed Intelligence Konsepti (Öncelik: Yüksek)
- **Hedef:** GitNexus'un "index zamanında önceden hesaplama" yaklaşımını PenceAI GraphRAG'a uyarla
- **Süre:** 3-5 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/graphRAG/PrecomputedIndexer.ts`](src/memory/graphRAG/PrecomputedIndexer.ts:1) dosyası
- **İlgili Dosyalar:** [`GraphRAGEngine.ts`](src/memory/graphRAG/GraphRAGEngine.ts:1), [`CommunityDetector.ts`](src/memory/graphRAG/CommunityDetector.ts:1)
- **Detay:**
```typescript
// src/memory/graphRAG/PrecomputedIndexer.ts (yeni dosya)

interface PrecomputedIndex {
  clusters: Cluster[];
  processes: Process[];
  symbolGraph: SymbolGraph;
  confidenceScores: Map<string, number>;
  lastIndexed: number;
}

class PrecomputedIndexer {
  async buildIndex(): Promise<PrecomputedIndex> {
    const index: PrecomputedIndex = {
      clusters: await this.detectClusters(),
      processes: await this.traceProcesses(),
      symbolGraph: await this.buildSymbolGraph(),
      confidenceScores: await this.computeConfidenceScores(),
      lastIndexed: Date.now(),
    };

    await this.persistIndex(index);
    return index;
  }

  // GitNexus'tan ilham: Leiden community detection
  private async detectClusters(): Promise<Cluster[]> {
    // Mevcut CommunityDetector'ı kullan
    // Ama index zamanında çalıştır, query zamanında değil
    return this.communityDetector.detect();
  }
}
```

#### Faz 3: Confidence Scoring (Öncelik: Orta)
- **Hedef:** Graph edge'lerine güven metriği ekle
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Confidence scoring sistemi
- **İlgili Dosyalar:** [`graph.ts`](src/memory/graph.ts:1)
- **Detay:**
```typescript
// src/memory/graph.ts'e eklenecek

interface GraphEdge {
  id: number;
  source: number;
  target: number;
  type: 'CALLS' | 'IMPORTS' | 'REFERENCES' | 'EXTENDS' | 'SIMILAR';
  weight: number;
  confidence: number;  // YENİ: 0-1 arası güven skoru
  createdAt: number;
}

// Edge oluştururken confidence hesapla
function createEdge(source: number, target: number, type: string, weight: number): GraphEdge {
  return {
    id: generateId(),
    source,
    target,
    type: type as GraphEdge['type'],
    weight,
    confidence: computeConfidence(type, weight),
    createdAt: Date.now(),
  };
}
```

#### Faz 4: Process Tracing (Öncelik: Düşük)
- **Hedef:** Conversation flow analysis için process tracing
- **Süre:** 1 hafta
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/graphRAG/ProcessTracer.ts`](src/memory/graphRAG/ProcessTracer.ts:1) dosyası
- **Detay:**
```typescript
// src/memory/graphRAG/ProcessTracer.ts (yeni dosya)

interface ConversationProcess {
  id: string;
  name: string;              // Örn: "Login Discussion", "Bug Investigation"
  entryPoint: number;        // İlk mesaj ID'si
  steps: ProcessStep[];
  crossTopic: boolean;       // Birden fazla topic'e yayılıyor mu?
  confidence: number;
}

class ProcessTracer {
  async traceConversation(conversationId: string): Promise<ConversationProcess[]> {
    // Entry point'leri bul (yeni konu başlangıçları)
    // Process'leri takip et
  }
}
```

### Riskler ve Mitigasyon

| Risk | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| **Ek Bağımlılık** | GitNexus ayrı bir npm paketi gerektirir | Orta | Optional dependency, feature flag |
| **Index Süresi** | Büyük projelerde indexleme uzun sürebilir | Orta | Incremental indexing, background worker |
| **Memory Overhead** | Precomputed index bellek kullanır | Düşük | TTL cache, lazy loading |
| **License** | PolyForm Noncommercial | Düşük | Ticari kullanım için konaklabs.com ile iletişime geç |

### Referanslar
- GitNexus: https://github.com/abhigyanpatwari/GitNexus
- MCP Protocol: https://modelcontextprotocol.io/

---

## 7. AgentMemory — Persistent Memory for AI Agents

### Nedir?
[AgentMemory](https://github.com/rohitg00/agentmemory), AI kodlama ajanları için **kalıcı bellek (persistent memory)** sistemi sağlayan bir araçtır. iii-engine altyapısı üzerine kuruludur.

**Temel Özellikler:**
- **41 MCP Tool** + 6 Resource + 3 Prompt
- **Triple-stream retrieval**: BM25 + Vector + Knowledge Graph
- **4-tier memory consolidation**: Working → Episodic → Semantic → Procedural
- **Otomatik gözlem yakalama**: 12 hook ile her tool use, file edit, test run, error kaydedilir
- **LLM compression**: Ham gözlemler yapılandırılmış gerçeklere sıkıştırılır
- **Provenance-tracked citations**: Her bellek kaynak gözleme kadar izlenebilir
- **Cascading staleness**: Eski bilgiler otomatik olarak stale işaretlenir
- **581 test**, sıfır harici DB bağımlılığı

**Benchmark Sonuçları (240 gözlem, 30 session):**
| Sistem | Recall@10 | NDCG@10 | MRR | Token/query |
|--------|-----------|---------|-----|-------------|
| Built-in (grep) | 55.8% | 80.3% | 82.5% | 19,462 |
| AgentMemory BM25 | 55.9% | 82.7% | 95.5% | 1,571 |
| AgentMemory + Embeddings | **64.1%** | **94.9%** | **100.0%** | **1,571** |

**%92 daha az token kullanımı** ile daha iyi sonuçlar.

### Neden Önemli?
- **Otomatik bellek yakalama**: Manuel giriş gerektirmez, her tool use otomatik kaydedilir
- **Token verimliliği**: %92 daha az token ile daha iyi retrieval sonuçları
- **4-tier consolidation**: Bellek kalitesini zamanla artırır
- **Auto-forgetting**: Storage temiz kalır, eski bilgiler otomatik temizlenir

### Mevcut Durum
- [`src/memory/manager/index.ts`](src/memory/manager/index.ts:1) — MemoryManager mevcut
- [`src/memory/retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1) — Retrieval orchestrator
- [`src/agent/mcp/eventBus.ts`](src/agent/mcp/eventBus.ts:1) — Event bus (hook desteği için uygun)
- Otomatik observation capture yok
- 4-tier consolidation yok
- Triple-stream retrieval yok (sadece BM25 + Vector)
- Auto-forgetting mekanizması sınırlı

### Sub-Task'lar

#### Faz 1: Hook-based Observation Capture (Öncelik: Yüksek — Hızlı Kazanım)
- **Hedef:** Her MCP tool call öncesi/sonrası otomatik observation kaydet
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/memory/observation/capture.ts`](src/memory/observation/capture.ts:1) dosyası
- **İlgili Dosyalar:** [`eventBus.ts`](src/agent/mcp/eventBus.ts:1), [`security.ts`](src/agent/mcp/security.ts:1)
- **Detay:**
```typescript
// src/memory/observation/capture.ts (yeni dosya)

interface Observation {
  id: string;
  sessionId: string;
  timestamp: number;
  type: 'tool_use' | 'tool_result' | 'tool_failure' | 'user_prompt' | 'session_event';
  toolName?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  hash: string;  // SHA-256 dedup için
  privacyFiltered: boolean;
}

class ObservationCapture {
  private recentHashes: Set<string> = new Set();

  async capture(event: ToolEvent): Promise<Observation | null> {
    // 1. Privacy filter
    const sanitized = this.applyPrivacyFilter(event);
    
    // 2. Dedup check (SHA-256, 5min window)
    const hash = this.computeHash(sanitized);
    if (this.recentHashes.has(hash)) {
      return null; // Duplicate
    }
    this.recentHashes.add(hash);
    
    // 3. Store observation
    const observation: Observation = {
      id: crypto.randomUUID(),
      sessionId: event.sessionId,
      timestamp: Date.now(),
      type: event.type,
      toolName: event.toolName,
      input: sanitized.input,
      output: sanitized.output,
      error: sanitized.error,
      hash,
      privacyFiltered: sanitized.wasFiltered,
    };
    
    await this.storeObservation(observation);
    return observation;
  }

  private applyPrivacyFilter(event: ToolEvent): SanitizedEvent {
    const patterns = [
      /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI API key
      /Bearer [a-zA-Z0-9\-_]{20,}/g,    // Bearer token
      /password["']?\s*[:=]\s*["']?[^"'\s]+/gi,
      /<private>.*?<\/private>/gs,
    ];
    // ... filter logic
  }
}
```

**Event Bus Entegrasyonu:**
```typescript
// src/agent/mcp/eventBus.ts'e eklenecek

import { ObservationCapture } from '../../memory/observation/capture.js';

const observationCapture = new ObservationCapture();

// PreToolUse hook
eventBus.on('preToolUse', async (event) => {
  await observationCapture.capture({
    ...event,
    type: 'tool_use',
  });
});

// PostToolUse hook
eventBus.on('postToolUse', async (event) => {
  await observationCapture.capture({
    ...event,
    type: 'tool_result',
  });
});
```

**Config:**
```env
# .env.example'a ekle
ENABLE_OBSERVATION_CAPTURE=true
OBSERVATION_DEDUP_WINDOW_MS=300000
OBSERVATION_MAX_PER_SESSION=500
```

#### Faz 2: 4-Tier Memory Consolidation (Öncelik: Yüksek)
- **Hedef:** Bellekleri 4 katmana ayır ve zamanla konsolide et
- **Süre:** 1 hafta
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/memory/consolidation/pipeline.ts`](src/memory/consolidation/pipeline.ts:1) dosyası
- **İlgili Dosyalar:** [`manager/index.ts`](src/memory/manager/index.ts:1), [`autonomous/worker.ts`](src/autonomous/worker.ts:1)
- **Detay:**
```typescript
// src/memory/consolidation/pipeline.ts (yeni dosya)

interface MemoryTier {
  name: 'working' | 'episodic' | 'semantic' | 'procedural';
  ttlDays: number;
  maxItems: number;
  decayRate: number;
  promotionThreshold: number;
}

const TIER_CONFIGS: Record<string, MemoryTier> = {
  working: {
    name: 'working',
    ttlDays: 1,
    maxItems: 100,
    decayRate: 0.5,
    promotionThreshold: 0.7,
  },
  episodic: {
    name: 'episodic',
    ttlDays: 30,
    maxItems: 1000,
    decayRate: 0.1,
    promotionThreshold: 0.8,
  },
  semantic: {
    name: 'semantic',
    ttlDays: 365,
    maxItems: 5000,
    decayRate: 0.01,
    promotionThreshold: 0.9,
  },
  procedural: {
    name: 'procedural',
    ttlDays: 9999,
    maxItems: 1000,
    decayRate: 0.001,
    promotionThreshold: 0.95,
  },
};

class ConsolidationPipeline {
  // Working → Episodic: Session sonunda
  async promoteToEpisodic(sessionId: string): Promise<void> {
    const observations = await this.getObservations(sessionId);
    // LLM compression ile yapılandırılmış bellek çıkar
  }

  // Episodic → Semantic: Pattern detection ile
  async promoteToSemantic(): Promise<void> {
    // Benzer bellekleri grupla, genel kural/pattern çıkar
  }

  // Decay: Ebbinghaus forgetting + strength-based
  async applyDecay(): Promise<void> {
    // Her tier için decay uygula
  }
}
```

**Background Worker Entegrasyonu:**
```typescript
// src/autonomous/worker.ts'e eklenecek

import { ConsolidationPipeline } from '../memory/consolidation/pipeline.js';

const consolidationPipeline = new ConsolidationPipeline();

// Her session sonunda episodic consolidation
worker.on('sessionEnd', async (sessionId) => {
  await consolidationPipeline.promoteToEpisodic(sessionId);
});

// Günlük decay
worker.schedule('daily', async () => {
  await consolidationPipeline.applyDecay();
});

// Haftalık semantic/procedural promotion
worker.schedule('weekly', async () => {
  await consolidationPipeline.promoteToSemantic();
  await consolidationPipeline.promoteToProcedural();
});
```

#### Faz 3: Triple-Stream Retrieval (Öncelik: Orta)
- **Hedef:** Mevcut BM25 + Vector'a Graph stream ekle
- **Süre:** 3-5 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** Triple-stream retrieval fonksiyonu
- **İlgili Dosyalar:** [`retrievalOrchestrator.ts`](src/memory/retrievalOrchestrator.ts:1)
- **Detay:**
```typescript
// src/memory/retrievalOrchestrator.ts'e eklenecek

interface RetrievalStream {
  name: 'bm25' | 'vector' | 'graph';
  weight: number;
  results: MemoryRow[];
}

async function tripleStreamRetrieval(
  query: string,
  config: RRFConfig = { k: 60, maxResultsPerSession: 3 }
): Promise<RetrievalResult> {
  // Stream 1: BM25 (mevcut)
  const bm25Results = await this.bm25Search(query);
  
  // Stream 2: Vector (mevcut)
  const vectorResults = await this.vectorSearch(query);
  
  // Stream 3: Graph (YENİ)
  const graphResults = await this.graphTraversal(query);
  
  // RRF Fusion
  const fusedResults = reciprocalRankFusion(
    [
      { name: 'bm25', weight: 0.3, results: bm25Results },
      { name: 'vector', weight: 0.4, results: vectorResults },
      { name: 'graph', weight: 0.3, results: graphResults },
    ],
    config
  );
  
  return diversifyBySession(fusedResults, config.maxResultsPerSession);
}
```

#### Faz 4: Auto-Forgetting + Project Profiles (Öncelik: Düşük)
- **Hedef:** Otomatik bellek temizleme ve proje profili
- **Süre:** 3-5 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/memory/autoforget.ts`](src/memory/autoforget.ts:1) dosyası
- **Detay:**
```typescript
// src/memory/autoforget.ts (yeni dosya)

interface AutoForgetConfig {
  ttlDays: number;           // Default: 90
  minImportance: number;     // Default: 3
  maxObservationsPerProject: number;  // Default: 10000
  contradictionThreshold: number;     // Default: 0.9
}

class AutoForgetter {
  async run(dryRun: boolean = false): Promise<AutoForgetResult> {
    const result: AutoForgetResult = {
      ttlExpired: [],
      contradictions: [],
      lowValue: [],
      capEvictions: [],
    };
    
    // 1. TTL expiry
    // 2. Contradiction detection (Jaccard > 0.9)
    // 3. Low-value eviction (90 gün + importance < 3)
    // 4. Per-project cap
    
    return result;
  }
}

// Project Profile
interface ProjectProfile {
  topConcepts: Array<{ name: string; count: number }>;
  topFiles: Array<{ path: string; touchCount: number }>;
  codingConventions: string[];
  commonErrors: Array<{ error: string; count: number; fix: string }>;
  sessionCount: number;
}
```

### Riskler ve Mitigasyon

| Risk | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| **LLM Compression Maliyeti** | Her observation için LLM call | Orta | Batch compression, caching |
| **Storage Overhead** | Otomatik capture çok veri üretir | Orta | Auto-forgetting, cap limits |
| **Privacy Leak** | API key'ler yanlışlıkla kaydedilebilir | Yüksek | Privacy filter, regex patterns |
| **False Positive Dedup** | Benzer ama farklı event'ler dedup'lanabilir | Düşük | Hash window ayarlanabilir |
| **Decay Over-Aggressive** | Önemli bellekler silinebilir | Orta | Configurable decay rate, manual override |

### Referanslar
- AgentMemory: https://github.com/rohitg00/agentmemory
- iii-engine: https://iii.dev

---

## 8. Karpathy LLM Wiki - Memory Mimari İyileştirmeleri ✅ Tamamlandı

### Nedir?
Andrej Karpathy'nin "LLM Wiki" konseptinden PenceAI'ye uyarlanan bellek ve tutarlılık iyileştirmeleridir. Sistem genelinde global tutarlılık, çelişki tespiti, insan-yapay zeka işbirliği ve kaynak izlenebilirliği sağlar.

### Neden Önemli?
- **Global Tutarlılık:** Mevcut bellek sistemindeki ikili birleştirme yerine, tüm graph üzerinde yapısal çelişki taraması (weekly lint pass) sağlar.
- **Kullanıcı Kontrolü:** Belleklerde "Black box" yaklaşımından çıkıp, kullanıcının belleğe müdahale edebildiği "Wiki" modeline geçer.
- **Periyodik Bakım (Linting):** Çelişen, eskimiş veya kopuk bağları (orphaned pages) arka planda tespit eder.
- **Provenance (Kaynak İzlenebilirliği):** Hangi belleğin hangi konuşmadan, hangi LLM modeli üzerinden geldiği açıkça versiyonlanmış olur.

### Sub-Task'lar

#### Faz 1: Global Çelişki Tespiti ve Lint Pass (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Tüm bellekleri tarayıp, eski vs yeni farklılıklarını belirleyen LLM-tabanlı çelişki dedektörü kurmak.
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** BackgroundWorker lint task'ı ve `memory:lint` CLI komutu.
- **Detay:**
  - Sadece semantik arama ile değil, LLM yardımı ile "Kullanıcı eskiden Python kullanıyordu, şimdi Rust" gibi çelişkili veya güncellenmesi gereken kısımlar saptanacak (Weekly Lint Pass).
  - BackgroundWorker'a "lint pass" logic'i entegre edilecek ve review queue için bayraklanacak.

#### Faz 2: Kullanıcı Odaklı Memory Editing (Öncelik: 🟡 ORTA)
- **Hedef:** Frontend Memory Dialog arayüzünden kullanıcıya belleklere detaylı müdahale yetkisi tanımak.
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** API Endpoint'leri ve yeni Memory Dialog aksiyonları.
- **Detay:**
  - Bellek birleştirme, düzenleme, kategori değiştirme ve çelişki çözümleme endpointleri örneğin `/api/memories/contradictions/resolve` eklenecek.
  - UI'da "Çelişkili Bellekler" bildirim ve onaylama akışı.

#### Faz 3: Kaynak İzlenebilirliği (Provenance) (Öncelik: 🟡 ORTA)
- **Hedef:** Her belleğin ve ilişkili node verisinin kaynak ağacını sıkı şekilde kaydetmek.
- **Süre:** 2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Schema değişiklikleri ve `memory_revisions` tablosu.
- **Detay:**
  - DB'ye `memory_revisions` tablosu eklenecek.
  - `provenance_trace` alanıyla JSON olarak provider, model ve hash'li prompt verileri izlenebilecek.

#### Faz 4: İnsan Okunabilir Format ve Adaptive Scale (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** Wiki benzeri export yetenekleri ve data scale durumuna uygun RAG routing'i.
- **Süre:** 2 gün
- **Zorluk:** ⭐
- **Çıktı:** İlgili CLI komutları ve Retrieval Strategy Routing.
- **Detay:**
  - CLI `memory:export-md`, `memory:export-obsidian` modülleri eklenecek.
  - Minimal ve basit/küçük hafıza setlerinde gereksiz GraphRAG / Embedding atlanıp, adaptif strateji (Keyword Based Only) uygulanacak.

---

## 9. KinBot Mimarisi - Ajan Otonomi ve Memory İyileştirmeleri

### Nedir?
Açık kaynaklı KinBot projesi incelemelerinden (Tekillik, sqlite-vec, cron-based wakeups, telescopic compacting) elde edilen mimari derslerin PenceAI platformuna aktarılmasıdır.

### Neden Önemli?
- **Otonomi:** LLM ajanlarının şu anki tamamen pasif reaktif doğasından çıkıp, belirledikleri bir zamanda veya periyodik olarak uyanıp inisiyatif alması elzemdir.
- **Güvenli Otonomi:** Yetenekli ajanların sunucuda kendi başına her işlemi yapabilmesini kontrol etmek için bir Onay Kapısı (Approval Gate / Human-in-the-loop) oluşturulmalıdır.
- **Bellek Koruma:** GraphRAG yapısındaki token sıkıştırmalarının bilgi kaybı/kesintiler yaşatmaması için "Telescopic Compacting" yapısı kritik seviyede önemlidir.

### Sub-Task'lar

#### Faz 1: Telescopic Session Compacting (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Sohbet hafızasının veya RAG node'larının token sınırını aştığı durumlarda kesip atmak (truncation) yerine çok seviyeli tarihsel özetlere (Telescopic Merge) dönüştürülmesi.
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐⭐
- **Detay:**
  - Mevcut session memory sliding window yapısı yerine, token bütçesinin belirli bir kısmı dolunca eski konuşmaların gruplanarak LLM'ye özetletilmesi ve `telescopic_summaries` tablosuna aktarılması.
  - Ajanın bağlamına bu özetlerin (Telescopic Nodes) eklenmesi, orijinal mesajların ise asla silinmeden "Archive" olarak SQLite'ta kalması.

#### Faz 2: Cron ve Wakeups - Proaktif Ajan (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Autonomous ThinkEngine ve UrgeFilter mekanizmasına ajanların kendi kendilerini uyandırabilecekleri bir zamanlayıcı sistemi entegre etmek.
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Detay:**
  - `wake_me_in`, `wake_me_every` ve `create_cron` isimli native tool'ların eklenmesi.
  - Arka planda `croner` paketi veya native Timer mekanizması ile bir "Scheduled Events Loop" kurulması ve süresi geldiğinde ajan queue'suna tetikleme isteği gönderilmesi.
  - Ajanın "Sabah sistemleri kontrol edeyim" veya "Kullanıcıya günlük özet sunayım" inisiyatifini alabilmesinin sağlanması.

#### Faz 3: Approval Gate (Human-In-The-Loop) (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Autonomous Loop içinde kritik MCP işlemleri veya sistem araçları (crontab modifikasyonu, dış server ekleme) yapılmadan önce akışı durdurup onay istemek.
- **Süre:** 2 gün
- **Zorluk:** ⭐⭐
- **Detay:**
  - `prompt_human` (Kullanıcıdan onay al) adlı native tool eklenmesi.
  - Ajan bu tool'u çağırdığında Web/CLI UI tarafında bir prompt modal/bildirim çıkartıp işlem sırasının bloklanması.
  - Kabul/Ret cevabının doğrudan tool response olarak agent'a geri gönderilip, re-plan yapmasının sağlanması.

#### Faz 4: sqlite-vec Entegrasyonu ve Secret Redaction (Öncelik: 🟡 ORTA)
- **Hedef:** Tekil node süreç yapısı korunarak (zero-external cloud db), SQL içinden harici framework kullanmaksızın vektör aramasını `sqlite-vec` ile yapmak ve Loglanacak tüm çıktıları otomatize filtrelemek.
- **Süre:** 3-4 gün
- **Zorluk:** ⭐⭐⭐
- **Detay:**
  - GraphRAG içinde pgvector benzeri embedding depolamasını `sqlite-vec` ile desteklemek.
  - Belleğe veya loglara alınacak API anahtarları vs. için AES Vault kullanımı ve log redaction middleware geliştirilmesi.

---

## 10. Permission Ask Mode (WebSocket Approval)

### Nedir?
Claude Code kaynak kodundan (`src/types/permissions.ts`) ilham alınarak, PenceAI'de tool çağrılarında kullanıcı onay akışı (human-in-the-loop) oluşturulmasıdır. Claude Code `default`, `plan`, `bypassPermissions`, `auto` modlarına sahiptir. PenceAI'de bu, WebSocket üzerinden kullanıcıya soru sorulacak şekilde uygulanacaktır.

### Neden Önemli?
- Mevcut PenceAI'de tool onay mekanizması sınırlı (`executeShell` confirm, `deleteMemory` confirm)
- Riskli işlemler (dosya silme, shell komutu, MCP tool çağrısı) için kullanıcı onayı gerekli
- Claude Code'daki `PermissionRequest`/`PermissionDenied` event'leri hook sistemi ile entegre

### Sub-Task'lar

#### Faz 1: Permission Context ve Ask Modu (Öncelik: 🟡 ORTA)
- **Hedef:** Tool çağrılarında `ask` modu ile WebSocket onay akışı
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/agent/permissionManager.ts`](src/agent/permissionManager.ts:1) ve WebSocket message type'ları
- **İlgili Dosyalar:** [`websocket.ts`](src/gateway/websocket.ts:1), [`toolManager.ts`](src/agent/toolManager.ts:1), [`hooks.ts`](src/agent/mcp/hooks.ts:1)
- **Detay:**

```typescript
// src/agent/permissionManager.ts (yeni dosya)

type PermissionMode = 'auto' | 'ask' | 'restrict';

interface PermissionRule {
  toolName: string | RegExp;
  mode: PermissionMode;
  source: 'config' | 'hook' | 'user';
  condition?: (args: Record<string, unknown>) => boolean;
}

interface PermissionResult {
  behavior: 'allow' | 'deny' | 'ask';
  message?: string;
  suggestions?: string[];
  updatedInput?: Record<string, unknown>;
}

class PermissionManager {
  private rules: PermissionRule[] = [];
  private wsClient: WebSocketClient;

  registerRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  async checkPermission(toolName: string, args: Record<string, unknown>): Promise<PermissionResult> {
    const matchingRules = this.rules
      .filter(r => this.matchesTool(r.toolName, toolName))
      .sort((a, b) => this.priorityOf(b.source) - this.priorityOf(a.source));

    for (const rule of matchingRules) {
      if (rule.condition && !rule.condition(args)) continue;

      switch (rule.mode) {
        case 'auto':
          return { behavior: 'allow' };
        case 'restrict':
          return { behavior: 'deny', message: `Tool ${toolName} is restricted` };
        case 'ask':
          return await this.askUserViaWebSocket(toolName, args);
      }
    }

    return { behavior: 'allow' };
  }

  private async askUserViaWebSocket(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      this.wsClient.send({
        type: 'permission_request',
        requestId,
        toolName,
        args: this.sanitizeForDisplay(args),
      });

      const timeout = setTimeout(() => {
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }, 60000);

      this.wsClient.once(`permission_response_${requestId}`, (response) => {
        clearTimeout(timeout);
        if (response.approved) {
          resolve({ behavior: 'allow', updatedInput: response.updatedInput });
        } else {
          resolve({ behavior: 'deny', message: response.reason || 'User denied permission' });
        }
      });
    });
  }
}
```

---

## 11. Context Compaction Engine (Claude Code İlhamlı)

### Nedir?
Claude Code kaynak kodundaki `src/services/compact/compact.ts` (~30KB) modülünden ilham alınarak, PenceAI'de context bütçesi aşıldığında akıllı sıkıştırma yapılmasıdır. Claude Code'daki compact sisteminin kilit desenleri:

1. **Full Compaction**: Tüm history'yi özetle, compact boundary işaretle
2. **File State Restoration**: Compact sonrası son 5 okunan dosyayı geri yükle (max 50KB)
3. **Skill Preservation**: Compact'tan etkilenmemesi için skill'leri attachment olarak koru (25K token budget, 5K/skill)
4. **Deferred Tool Re-announcement**: Compact sonrası ertelenmiş tool'ları tekrar bildir
5. **PreCompact/PostCompact hooks**: Hook sistemiyle entegrasyon

### Neden Önemli?
- Mevcut [`contextPreparer.ts`](src/agent/contextPreparer.ts:1) sadece token hesaplama yapıyor, sıkıştırma yok
- Uzun konuşmalarda context bütçesi hızla tükeniyor
- Claude Code'daki dosya geri yükleme ve skill preservation desenleri çok değerli

### Sub-Task'lar

#### Faz 1: Compact Engine Core (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Akıllı context sıkıştırma motoru oluştur
- **Süre:** 3-5 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/agent/compactEngine.ts`](src/agent/compactEngine.ts:1) dosyası
- **İlgili Dosyalar:** [`contextPreparer.ts`](src/agent/contextPreparer.ts:1), [`runtimeContext.ts`](src/agent/runtimeContext.ts:1), [`reactLoop.ts`](src/agent/reactLoop.ts:1)
- **Detay:**

```typescript
// src/agent/compactEngine.ts (yeni dosya)

interface CompactOptions {
  maxTokens: number;
  preserveRecentMessages: number;
  preserveFileAttachments: boolean;
  preserveSkills: boolean;
  preserveToolDefinitions: boolean;
}

interface CompactResult {
  summary: string;
  originalTokenCount: number;
  compactedTokenCount: number;
  preservedFiles: string[];
  preservedSkills: string[];
  boundaryMessageId: string;
}

class CompactEngine {
  async compactConversation(
    messages: LLMMessage[],
    options: CompactOptions,
  ): Promise<CompactResult> {
    // 1. PreCompact hooks çalıştır
    await hookRegistry.executePhase('PreCompact', { toolName: '*', args: {}, sessionId: this.sessionId, callCount: 0, compactReason: 'token_budget_exceeded' });

    // 2. LLM ile history özetle (forked agent pattern)
    const summary = await this.generateSummary(messages, options);

    // 3. Compact boundary message oluştur
    const boundaryId = crypto.randomUUID();

    // 4. Dosya attachment'larını geri yükle (son 5 dosya, max 50KB)
    const preservedFiles = await this.preserveFileAttachments(messages);

    // 5. Skill'leri koru (25K token budget, 5K/skill)
    const preservedSkills = await this.preserveSkills(messages);

    // 6. Tool definition'ları yeniden bildir
    await this.announceDeferredTools();

    // 7. PostCompact hooks çalıştır
    await hookRegistry.executePhase('PostCompact', { toolName: '*', args: {}, sessionId: this.sessionId, callCount: 0 });

    return {
      summary,
      originalTokenCount: this.countTokens(messages),
      compactedTokenCount: this.countTokens(this.buildCompactedMessages(summary, preservedFiles, preservedSkills)),
      preservedFiles: preservedFiles.map(f => f.path),
      preservedSkills,
      boundaryMessageId: boundaryId,
    };
  }

  private async preserveFileAttachments(messages: LLMMessage[]): Promise<FileAttachment[]> {
    // Son 5 dosyayı koru, max 50KB toplam
    const recentFiles = messages
      .filter(m => m.attachments?.length)
      .slice(-5)
      .flatMap(m => m.attachments!)
      .filter(a => a.size < 10240);

    return recentFiles.slice(0, 5);
  }

  private async preserveSkills(messages: LLMMessage[]): Promise<string[]> {
    // Skill'leri compact'tan koru (25K token budget)
    const invokedSkills = new Set<string>();
    for (const m of messages) {
      if (m.metadata?.invokedSkill) {
        invokedSkills.add(m.metadata.invokedSkill);
      }
    }
    return Array.from(invokedSkills);
  }
}
```

#### Faz 2: Token Budget Tracker (Öncelik: 🔴 YÜKSEK)
- **Hedef:** Token bütçesini izle ve compact gerektiğinde tetikle
- **Süre:** 1-2 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Token budget tracker
- **İlgili Dosyalar:** [`contextPreparer.ts`](src/agent/contextPreparer.ts:1), [`metricsTracker.ts`](src/agent/metricsTracker.ts:1)

---

## 12. Plugin Manifest Sistemi (Claude Code İlhamlı)

### Nedir?
Claude Code kaynak kodundaki (`src/utils/plugins/pluginLoader.ts` — ~60KB) plugin sistemi, agent'ın yeteneklerini **modüler, keşfedilebilir ve kullanıcı tarafından genişletilebilir** hale getirir. Plugin'ler `.md` dosyaları ile tanımlanır; slash commands, agent'lar, skill'ler, hook'lar ve output stilleri içerir.

**Claude Code Plugin Dizin Yapısı:**
```
my-plugin/
├── .claude-plugin/plugin.json   # Manifest (Zod ile validate)
├── commands/                    # Slash komutları (.md dosyaları)
├── agents/                      # Agent tanımları (.md dosyaları)
├── skills/                      # Skill dizini
├── hooks/hooks.json             # Hook tanımları
└── output-styles/               # Çıktı stilleri
```

**Zod-Validasyonlu Manifest:**
```typescript
PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  hooks: z.string().optional(),        // hooks.json yolu
  commands: CommandsSchema.optional(), // Slash komutları
  agents: AgentsSchema.optional(),     // Agent tanımları
  skills: SkillsSchema.optional(),     // Skill tanımları
  userConfig: UserConfigSchema.optional(), // Kullanıcı yapılandırması
})
```

### Neden Önemli?
- **Mevcut MCP marketplace altyapısı ile doğal uyum**: [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1) zaten plugin keşfi yapıyor
- **`.md` tabanlı skill tanımları**: MCP Prompt/Resource desteği ile birleştirilebilir
- **Kullanıcı genişletilebilirliği**: Harici plugin'ler yükleme, marketplace'ten indirme
- **Zod validasyonlu manifest**: Güvenli plugin yükleme, bozuk plugin'leri otomatik reddetme
- **Hook entegrasyonu**: Plugin'ler kendi hook'larını kaydedebilir (Madde 1 ile doğrudan entegrasyon)

### Mevcut Durum
- [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1) — Plugin keşfi ve yükleme altyapısı var
- [`marketplace-catalog.json`](src/agent/mcp/marketplace-catalog.json:1) — Plugin kataloğu var
- Plugin manifest validasyonu yok
- `.md` tabanlı skill/command parsing yok
- Plugin lifecycle (install/uninstall/enable/disable) yok
- User config yönetimi yok

### Sub-Task'lar

#### Faz 1: Plugin Manifest ve Zod Schema (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** Plugin manifest schema'sını tanımla ve validasyonu implement et
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/agent/mcp/pluginManifest.ts`](src/agent/mcp/pluginManifest.ts:1) dosyası
- **İlgili Dosyalar:** [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1), [`marketplace-catalog.json`](src/agent/mcp/marketplace-catalog.json:1)
- **Detay:**

```typescript
// src/agent/mcp/pluginManifest.ts (yeni dosya)

import { z } from 'zod';

// Plugin manifest schema
const PluginCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  filePath: z.string(),
  category: z.string().optional(),
});

const PluginSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  filePath: z.string(),
  triggers: z.array(z.string()).optional(),
});

const PluginAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  filePath: z.string(),
  capabilities: z.array(z.string()).optional(),
});

const PluginHookEntrySchema = z.object({
  event: z.string(),
  matchers: z.array(z.string()),
  command: z.string(),
  priority: z.number().optional(),
});

const PluginUserConfigSchema = z.object({
  settings: z.record(z.unknown()).optional(),
  envVars: z.array(z.string()).optional(),
});

export const PluginManifestSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  commands: z.array(PluginCommandSchema).optional(),
  skills: z.array(PluginSkillSchema).optional(),
  agents: z.array(PluginAgentSchema).optional(),
  hooks: z.array(PluginHookEntrySchema).optional(),
  userConfig: PluginUserConfigSchema.optional(),
  dependencies: z.array(z.string()).optional(),
  minPenceAIVersion: z.string().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginCommand = z.infer<typeof PluginCommandSchema>;
export type PluginSkill = z.infer<typeof PluginSkillSchema>;
export type PluginAgent = z.infer<typeof PluginAgentSchema>;
export type PluginHookEntry = z.infer<typeof PluginHookEntrySchema>;

// Plugin validation
export function validatePluginManifest(raw: unknown): PluginManifest {
  return PluginManifestSchema.parse(raw);
}

export function validatePluginManifestSafe(raw: unknown): z.SafeParseReturnType<unknown, PluginManifest> {
  return PluginManifestSchema.safeParse(raw);
}
```

#### Faz 2: Plugin Loader ve Discovery (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** Plugin dizinlerini keşfet, manifest'leri yükle ve validasyon yap
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** [`src/agent/mcp/pluginLoader.ts`](src/agent/mcp/pluginLoader.ts:1) dosyası
- **İlgili Dosyalar:** [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1), [`pluginManifest.ts`](src/agent/mcp/pluginManifest.ts:1)
- **Detay:**

```typescript
// src/agent/mcp/pluginLoader.ts (yeni dosya)

import type { PluginManifest } from './pluginManifest.js';
import { validatePluginManifestSafe } from './pluginManifest.js';
import { logger } from '../../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

export interface PluginInfo {
  manifest: PluginManifest;
  directory: string;
  enabled: boolean;
  installedAt: number;
}

export class PluginLoader {
  private plugins: Map<string, PluginInfo> = new Map();
  private pluginDirs: string[];

  constructor(pluginDirs: string[]) {
    this.pluginDirs = pluginDirs;
  }

  async discoverPlugins(): Promise<PluginInfo[]> {
    const discovered: PluginInfo[] = [];

    for (const dir of this.pluginDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const pluginInfo = await this.loadPlugin(path.join(dir, entry.name));
            if (pluginInfo) {
              discovered.push(pluginInfo);
            }
          }
        }
      } catch (error) {
        logger.debug({ dir, error }, '[PluginLoader] Directory not accessible');
      }
    }

    return discovered;
  }

  private async loadPlugin(pluginDir: string): Promise<PluginInfo | null> {
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const raw = JSON.parse(content);
      const result = validatePluginManifestSafe(raw);

      if (!result.success) {
        logger.warn({ pluginDir, errors: result.error.errors },
          '[PluginLoader] Invalid plugin manifest, skipping');
        return null;
      }

      const pluginInfo: PluginInfo = {
        manifest: result.data,
        directory: pluginDir,
        enabled: true,
        installedAt: Date.now(),
      };

      this.plugins.set(result.data.name, pluginInfo);
      logger.info({ pluginName: result.data.name, version: result.data.version },
        '[PluginLoader] Plugin loaded');
      return pluginInfo;
    } catch (error) {
      logger.debug({ pluginDir, error }, '[PluginLoader] No manifest found, skipping');
      return null;
    }
  }

  async enablePlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = true;
    return true;
  }

  async disablePlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = false;
    return true;
  }

  getEnabledPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).filter(p => p.enabled);
  }

  getPlugin(name: string): PluginInfo | undefined {
    return this.plugins.get(name);
  }
}
```

#### Faz 3: Skill ve Command Parsing (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** `.md` dosyalarını parse et ve MCP Prompt/Resource'a dönüştür
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐⭐
- **Çıktı:** [`src/agent/mcp/pluginSkillParser.ts`](src/agent/mcp/pluginSkillParser.ts:1) ve [`src/agent/mcp/pluginCommandParser.ts`](src/agent/mcp/pluginCommandParser.ts:1)
- **İlgili Dosyalar:** [`pluginLoader.ts`](src/agent/mcp/pluginLoader.ts:1), MCP registry
- **Detay:**

```typescript
// src/agent/mcp/pluginSkillParser.ts (yeni dosya)

import type { PluginSkill } from './pluginManifest.js';
import fs from 'fs/promises';

interface ParsedSkill {
  name: string;
  description: string;
  triggers: string[];
  content: string;
  instructions: string;
}

export class PluginSkillParser {
  async parseSkill(skill: PluginSkill, pluginDir: string): Promise<ParsedSkill | null> {
    const filePath = `${pluginDir}/${skill.filePath}`;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.extractSkillInfo(content, skill);
    } catch (error) {
      return null;
    }
  }

  private extractSkillInfo(content: string, skill: PluginSkill): ParsedSkill {
    // Frontmatter parsing
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let frontmatter: Record<string, string> = {};
    let body = content;

    if (frontmatterMatch) {
      const [, fm, rest] = frontmatterMatch;
      for (const line of fm.split('\n')) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          frontmatter[key.trim()] = valueParts.join(':').trim();
        }
      }
      body = rest;
    }

    return {
      name: frontmatter.name || skill.name,
      description: frontmatter.description || skill.description,
      triggers: skill.triggers || [],
      content: body,
      instructions: body,
    };
  }
}
```

#### Faz 4: Plugin Lifecycle ve Marketplace Entegrasyonu (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** Plugin install/uninstall/enable/disable lifecycle'ını marketplace'e bağla
- **Süre:** 2-3 gün
- **Zorluk:** ⭐⭐
- **Çıktı:** Marketplace entegrasyonu
- **İlgili Dosyalar:** [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1), [`pluginLoader.ts`](src/agent/mcp/pluginLoader.ts:1)
- **Detay:**

```typescript
// src/agent/mcp/marketplace-service.ts'e eklenecek

import { PluginLoader } from './pluginLoader.js';
import { PluginSkillParser } from './pluginSkillParser.js';
import { HookRegistry } from './hooks.js';

class MarketplaceService {
  private pluginLoader: PluginLoader;
  private skillParser: PluginSkillParser;
  private hookRegistry: HookRegistry;

  async installPlugin(pluginUrl: string): Promise<InstallResult> {
    // 1. Download plugin
    // 2. Extract to plugin directory
    // 3. Load manifest
    // 4. Parse skills and commands
    // 5. Register hooks
    // 6. Update catalog
  }

  async uninstallPlugin(name: string): Promise<boolean> {
    // 1. Disable plugin
    // 2. Unregister hooks
    // 3. Remove from catalog
    // 4. Delete files
  }

  async enablePlugin(name: string): Promise<boolean> {
    // 1. Enable in loader
    // 2. Register hooks
    // 3. Parse and register skills
  }

  async disablePlugin(name: string): Promise<boolean> {
    // 1. Disable in loader
    // 2. Unregister hooks
    // 3. Unregister skills
  }
}
```

#### Faz 5: Config ve Feature Flag (Öncelik: 🟢 DÜŞÜK)
- **Hedef:** Plugin sistemini config ile yönetilebilir yap
- **Süre:** 1 gün
- **Zorluk:** ⭐
- **Çıktı:** Config dosyaları güncellemesi
- **İlgili Dosyalar:** [`config.ts`](src/gateway/config.ts:1), [`.env.example`](.env.example:1)
- **Detay:**

```env
# .env.example'a eklenecek
ENABLE_PLUGINS=true                          # Plugin sistemini aç/kapa
PLUGIN_DIRS=["./plugins", "~/.penceai/plugins"]  # Plugin dizinleri
PLUGIN_AUTO_DISCOVER=true                    # Başlangıçta otomatik keşfet
PLUGIN_MAX_INSTALLED=20                      # Maksimum yüklü plugin sayısı
```

```typescript
// src/gateway/config.ts'e eklenecek
enablePlugins: boolean;                      // Default: true
pluginDirs: string[];                        // Default: ['./plugins', '~/.penceai/plugins']
pluginAutoDiscover: boolean;                 // Default: true
pluginMaxInstalled: number;                  // Default: 20
```

### Riskler ve Mitigasyon

| Konu | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| **Güvenlik** | Kötü niyetli plugin'ler zararlı hook/command çalıştırabilir | Yüksek | Manifest validasyonu + allowlist + sandbox execution |
| **Version Compatibility** | Plugin PenceAI versiyonu ile uyumsuz olabilir | Orta | `minPenceAIVersion` field + version check |
| **Dependency Hell** | Plugin'ler birbirine bağımlı olabilir | Orta | Dependency resolution + circular dependency detection |
| **Storage** | Çok fazla plugin disk kullanabilir | Düşük | `pluginMaxInstalled` limit + cleanup |
| **Performance** | Plugin discovery başlangıçta yavaşlatabilir | Düşük | Lazy loading + caching |

### Claude Code ile Karşılaştırma

| Konu | Claude Code | PenceAI |
|------|-------------|---------|
| **Manifest Format** | `.claude-plugin/plugin.json` | Aynı format, Zod validasyonlu |
| **Skill Format** | `.md` frontmatter | `.md` frontmatter + MCP Prompt mapping |
| **Plugin Discovery** | Dizin tarama | Dizin tarama + marketplace catalog |
| **Hook Integration** | `hooks.json` → shell commands | `hooks.json` → TypeScript handlers |
| **User Config** | Plugin-specific settings | `getConfig()` ile merkezi |
| **Installation** | Manuel dizin kopyalama | Marketplace'ten install/uninstall |

### Referanslar
- Claude Code Plugin Loader: `src/utils/plugins/pluginLoader.ts` (sızdırılan kaynak kod)
- MCP Marketplace: [`marketplace-service.ts`](src/agent/mcp/marketplace-service.ts:1)

---

## 📋 Claude Code Kaynak Kod Analizi Özeti

> **Kaynak:** 31 Mart 2026'da `@anthropic-ai/claude-code` npm paketindeki `.map` dosyasından sızdırılan ~1,900 TypeScript dosyası, 512K satır kod.
> **Repo:** https://github.com/tanbiralam/claude-code
> **Versiyon:** v2.1.88
> **Runtime:** Bun, UI: React + Ink, Schema: Zod v4

### Mimari Özeti

| Bileşen | Boyut | Açıklama |
|---------|-------|----------|
| `QueryEngine.ts` | ~46KB | Ana LLM query lifecycle motoru |
| `Tool.ts` | ~29KB | Tool tip sistemi ve `buildTool` helper |
| `commands.ts` | ~25KB | Slash command registry |
| `bootstrap/state.ts` | ~56KB | Merkezi state monolith |
| `utils/hooks.ts` | ~108KB | Hook execution engine |
| `utils/plugins/pluginLoader.ts` | ~60KB | Plugin keşif ve yükleme |
| `bridge/bridgeMain.ts` | ~115KB | IDE bridge orchestrator |
| `services/compact/compact.ts` | ~30KB | Context compaction engine |
| `services/extractMemories/` | 2 dosya | Otomatik memory extraction |
| `memdir/` | 4 dosya | Dosya tabanlı persistent memory |

### PenceAI'ye Doğrudan Uygulanabilecek Desenler

| Desen | Kaynak | Öncelik | Uygulanabilirlik | Durum |
|-------|--------|---------|-----------------|-------|
| **Hook Execution Engine** (shell + JSON I/O yerine TypeScript handler) | `utils/hooks.ts` | 🔴 Yüksek | ✅ Mevcut eventBus'a eklenebilir | 📝 Planlandı (Madde 3) |
| **Tool Input Modification** (hook input modify edebilir) | `utils/hooks.ts` | 🔴 Yüksek | 🆕 Yeni konsept | 📝 Planlandı (Madde 3) |
| **Permission Ask Mode** (WebSocket onay akışı) | `types/permissions.ts` | 🟡 Orta | ✅ toolManager'a eklenebilir | 📝 Planlandı (Madde 14) |
| **Context Compaction** (dosya geri yükleme, skill preservation) | `services/compact/compact.ts` | 🔴 Yüksek | ✅ contextPreparer'a eklenebilir | 📝 Planlandı (Madde 15) |
| **Forked Agent Pattern** (izole context ile bellek çıkarımı) | `services/extractMemories/` | 🟡 Orta | Alt-agent gerektirir | ⏳ Gelecek |
| **Memory Manifest Pre-injection** (ls yapmadan dizin listesi) | `memdir/memoryScan.ts` | 🟢 Düşük | Farklı mimari | ⏳ Gelecek |
| **Plugin Manifest + Market** (Zod-validasyonlu manifest) | `utils/plugins/pluginLoader.ts` | 🟢 Düşük | MCP marketplace genişletmesi | ⏳ Gelecek |
| **Feature Flags** (build-time dead code elimination) | `bun:bundle` | 🟢 Düşük | `getConfig()` ile zaten yapıyoruz | ✅ Mevcut |

### Claude Code Tool Listesi (Karşılaştırma)

| Claude Code Tool | PenceAI Karşılığı | Fark |
|-----------------|-------------------|------|
| BashTool | `executeShell` | Benzer |
| FileReadTool | `readFile` | Benzer |
| FileWriteTool | `writeFile` | Benzer |
| FileEditTool | `editFile` (partial) | Claude Code: string replacement |
| GlobTool | `listDirectory` | Claude Code: glob pattern destekli |
| GrepTool | `searchMemory` + sistem grep | Farklı kapsam |
| WebFetchTool | `webTool` | Benzer |
| WebSearchTool | `webSearch` | Benzer |
| AgentTool | ❌ Yok | Claude Code: sub-agent spawn |
| SkillTool | ❌ Yok | Claude Code: `.md` skill dosyaları |
| MCPTool | `mcp:{server}:{tool}` | Benzer |
| LSPTool | ❌ Yok | Language Server Protocol |
| TaskCreateTool/TaskUpdateTool | ❌ Yok | Task management |
| SendMessageTool | ❌ Yok | Inter-agent mesajlaşma |
| TeamCreateTool/TeamDeleteTool | ❌ Yok | Agent swarm yönetimi |
| EnterWorktreeTool/ExitWorktreeTool | ❌ Yok | Git worktree izolasyonu |
| ToolSearchTool | ❌ Yok | Deferred tool discovery |

---

## 📝 Notlar

### Genel Prensipler
1. **Feature Flag ile Geçiş:** Her özellik `ENABLE_X=true` ile açılmalı
2. **Parallel Çalışma:** Eski sistem yeni sistemle parallel çalışabilmeli
3. **Geriye Uyumluluk:** Mevcut kullanıcılar etkilenmemeli
4. **Dokümantasyon:** Her özellik için README güncellenmeli
5. **Claude Code İlhamı:** Sızdırılan kaynak koddan desen uyarlamaları, kod kopyalaması değil

### Bağımlılık Sırası
1. **✅ MCP** → Tamamlandı, temel altyapı hazır
2. **✅ Docker Compose** → Tamamlandı, deployment altyapısı hazır
3. **✅ RAGOps Pattern'leri** → Tamamlandı, evaluation gate + phrase bonus aktif
4. **Hook Execution Engine** → Hızlı kazanım, mevcut eventBus üzerine inşa edilir, tüm diğer sistemlerin temeli
5. **Context Compaction Engine** → Hook sistemi (PreCompact/PostCompact) ile entegre, token bütçesi yönetimi
6. **Permission Ask Mode** → Hook sistemi (PermissionRequest) ile entegre, WebSocket onay akışı
7. **GitNexus MCP Köprüsü** → MCP altyapısı üzerine inşa edilir
8. **AgentMemory Hook-based Capture** → Hook sistemi (PostToolUse) üzerine inşa edilir
9. **ECC Continuous Learning** → Bellek sistemi ile entegre
10. **AgentMemory 4-Tier Consolidation** → Observation capture'a bağımlı
11. **GitNexus Precomputed Intelligence** → GraphRAG ile entegre
12. **Agentic RAG** → En karmaşık, retrieval pipeline'ı hazır olduğunda
13. **Karpathy LLM Wiki Architecture** → ✅ Tamamlandı (Faz 1 Lint Pass eklendi)
14. **KinBot Mimarisi Dersleri** → Telescopic Compacting (Faz 12 ile örtüşüyor), Cron/Wakeups ve Approval Gate (Faz 13 ile örtüşüyor)
15. **Plugin Manifest Sistemi** → MCP marketplace hazır olduğunda

### Test Stratejisi
- Her özellik için unit test
- Integration test (MCP server'ları)
- E2E test (Docker compose ile full stack)
- Benchmark (retrieval performance karşılaştırması)
- Hook test'i: Her hook event'i için mock context ile test

---

> **Bu dosya canlı bir dokümandır.** Her implementasyon sonrası güncellenmelidir.
> **Son güncelleme:** 24 Nisan 2026 — Karpathy LLM Wiki tamamlandı.
