/**
 * MCP Context Token Ölçüm Scripti — Optimizasyon Sonrası
 * 
 * Compression + Cache sonrası token tüketimini ölçer.
 */

import { getBuiltinToolDefinitions } from './src/agent/prompt.js';

function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function estimateToolDefinitionTokens(tool: {name: string; description: string; parameters: Record<string, unknown>}): number {
    let total = 0;
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.description);
    total += estimateTokens(JSON.stringify(tool.parameters));
    total += 10; // JSON structure overhead
    return total;
}

function estimateCompressedToolDefinitionTokens(tool: {name: string; description: string; llmDescription?: string; parameters: Record<string, unknown>; llmParameters?: Record<string, unknown>}): number {
    let total = 0;
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.llmDescription ?? tool.description);
    total += estimateTokens(JSON.stringify(tool.llmParameters ?? tool.parameters));
    total += 10; // JSON structure overhead
    return total;
}

// Built-in tools
const builtinTools = getBuiltinToolDefinitions();

console.log('\n══════════════════════════════════════════════════════');
console.log('     MCP CONTEXT OPTİMİZASYONU — ÖLÇÜM RAPORU');
console.log('══════════════════════════════════════════════════════\n');

// ── Built-in Tools: Önce vs Sonra ──
console.log('📦 BUILT-IN TOOLS');
console.log('─────────────────────────────────────────────────────');
console.log('');
console.log('  Tool                    Önce       Sonra      Fark');
console.log('  ─────────────────────── ────────── ────────── ──────');

let totalBefore = 0;
let totalAfter = 0;

for (const tool of builtinTools) {
    const before = estimateToolDefinitionTokens(tool);
    const after = estimateCompressedToolDefinitionTokens(tool);
    const diff = before - after;
    totalBefore += before;
    totalAfter += after;
    console.log(`  ${tool.name.padEnd(23)} ${String(before).padStart(5)} t      ${String(after).padStart(5)} t     ${diff > 0 ? '-' : '+'}${Math.abs(diff)}`);
}

console.log('  ─────────────────────── ────────── ────────── ──────');
const builtinReduction = ((1 - totalAfter / totalBefore) * 100).toFixed(0);
console.log(`  TOPLAM                  ${String(totalBefore).padStart(5)} t      ${String(totalAfter).padStart(5)} t     %${builtinReduction} azalma`);

// ── MCP Tools Simülasyonu ──
console.log('\n🔌 MCP TOOLS (Senaryo Bazlı)');
console.log('─────────────────────────────────────────────────────');

const mockMCPTool = (serverName: string, toolName: string) => ({
    name: `mcp:${serverName}:${toolName}`,
    description: `MCP tool from ${serverName}: ${toolName} — performs ${toolName} operation on ${serverName} server`,
    llmDescription: `${toolName}: ${serverName}`,
    parameters: {
        type: 'object' as const,
        properties: {
            path: { type: 'string', description: `Path to ${toolName} on ${serverName}` },
            content: { type: 'string', description: `Content for ${toolName} operation` },
        },
        required: ['path'],
    },
    llmParameters: {
        type: 'object' as const,
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['path'],
    },
});

const scenarios = [
    { name: '1 MCP Server (5 tool)', servers: 1, toolsPerServer: 5 },
    { name: '2 MCP Server (5 tool)', servers: 2, toolsPerServer: 5 },
    { name: '3 MCP Server (5 tool)', servers: 3, toolsPerServer: 5 },
    { name: '5 MCP Server (5 tool)', servers: 5, toolsPerServer: 5 },
    { name: '3 MCP Server (10 tool)', servers: 3, toolsPerServer: 10 },
];

for (const scenario of scenarios) {
    const mcpTools: ReturnType<typeof mockMCPTool>[] = [];
    for (let s = 0; s < scenario.servers; s++) {
        for (let t = 0; t < scenario.toolsPerServer; t++) {
            mcpTools.push(mockMCPTool(`server${s+1}`, `tool${t+1}`));
        }
    }
    
    const mcpBefore = mcpTools.reduce((sum, t) => sum + estimateToolDefinitionTokens(t), 0);
    const mcpAfter = mcpTools.reduce((sum, t) => sum + estimateCompressedToolDefinitionTokens(t), 0);
    const totalAfterAll = totalAfter + mcpAfter;
    const reduction = ((1 - mcpAfter / mcpBefore) * 100).toFixed(0);
    
    console.log(`\n  ${scenario.name}:`);
    console.log(`    MCP önce:    ~${mcpBefore.toLocaleString('tr-TR')} token`);
    console.log(`    MCP sonra:   ~${mcpAfter.toLocaleString('tr-TR')} token (%${reduction} azalma)`);
    console.log(`    TOPLAM:      ~${totalAfterAll.toLocaleString('tr-TR')} token (built-in compressed + MCP compressed)`);
}

// ── Context Dağılımı ──
console.log('\n📊 CONTEXT DAĞILIMI (Optimizasyon Sonrası)');
console.log('─────────────────────────────────────────────────────');

const avgSystemPrompt = 800;
const avgMemories = 600;
const avgRecentContext = 400;
const avgConversationHistory = 3000;
const avgMCPToolsBefore = 2500;
const avgMCPToolsAfter = totalAfter + 600; // ~3 MCP server compressed

const totalBeforeAll = avgSystemPrompt + avgMemories + avgRecentContext + avgConversationHistory + avgMCPToolsBefore;
const totalAfterAll = avgSystemPrompt + avgMemories + avgRecentContext + avgConversationHistory + avgMCPToolsAfter;

console.log(`  Bileşen                 Önce        Sonra`);
console.log(`  ─────────────────────── ─────────── ──────────`);
console.log(`  Sistem prompt           ~${avgSystemPrompt.toLocaleString('tr-TR')} token  ~${avgSystemPrompt.toLocaleString('tr-TR')} token`);
console.log(`  Bellekler               ~${avgMemories.toLocaleString('tr-TR')} token  ~${avgMemories.toLocaleString('tr-TR')} token`);
console.log(`  Yakın geçmiş            ~${avgRecentContext.toLocaleString('tr-TR')} token  ~${avgRecentContext.toLocaleString('tr-TR')} token`);
console.log(`  Konuşma geçmişi         ~${avgConversationHistory.toLocaleString('tr-TR')} token  ~${avgConversationHistory.toLocaleString('tr-TR')} token`);
console.log(`  Tool tanımları          ~${avgMCPToolsBefore.toLocaleString('tr-TR')} token  ~${avgMCPToolsAfter.toLocaleString('tr-TR')} token ← OPTIMIZED`);
console.log(`  ─────────────────────── ─────────── ──────────`);
console.log(`  TOPLAM                  ~${totalBeforeAll.toLocaleString('tr-TR')} token  ~${totalAfterAll.toLocaleString('tr-TR')} token`);

const overallReduction = ((1 - totalAfterAll / totalBeforeAll) * 100).toFixed(0);
console.log(`\n  GENEL AZALMA: %${overallReduction}`);

// ── Cache Etkisi ──
console.log('\n💾 CACHE ETKİSİ (Tekrar Eden Mesajlar)');
console.log('─────────────────────────────────────────────────────');
console.log(`  İlk mesaj:    ~${totalAfterAll.toLocaleString('tr-TR')} token (tool listesi hesaplanır)`);
console.log(`  Tekrar mesaj: ~${(totalAfterAll - avgMCPToolsAfter).toLocaleString('tr-TR')} token (tool cache'ten gelir)`);
console.log(`  Cache kazanımı: ~${avgMCPToolsAfter.toLocaleString('tr-TR')} token tasarruf per mesaj`);

console.log('\n══════════════════════════════════════════════════════');
console.log(`✅ Optimizasyon: %${builtinReduction} built-in azalma, cache ile tekrar mesajlarda ~${avgMCPToolsAfter.toLocaleString('tr-TR')} token tasarruf`);
console.log('══════════════════════════════════════════════════════\n');
