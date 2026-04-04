
import { MemoryManager } from '../memory/manager.js';
import { PenceDatabase } from '../memory/database.js';
import { LLMProviderFactory, registerAllProviders } from '../llm/index.js';
import { createEmbeddingProvider } from '../memory/embeddings.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../memory/graphRAG/config.js';
import { GraphRAGRollbackManager, RollbackReason } from '../memory/graphRAG/rollback.js';
import { GraphRAGMonitor, AlertSeverity } from '../memory/graphRAG/monitoring.js';

async function runMaintenance() {
    console.log('--- PençeAI Memory Graph Maintenance ---');

    try {
        const config = getConfig();
        registerAllProviders();

        const llm = await LLMProviderFactory.create(config.defaultLLMProvider);
        const embedding = createEmbeddingProvider();

        // PenceDatabase instantiation
        const penceDb = new PenceDatabase(config.dbPath, embedding?.dimensions || 1536);

        const memory = new MemoryManager(penceDb);

        console.log('Memory system initialized.');

        console.log('\n1. Checking for missing graph relations (Backfill)...');
        const backfilled = await memory.ensureAllMemoryGraphRelations();
        console.log(`Successfully created ${backfilled} missing relations.`);

        console.log('\n2. Processing relationship decay (Ebbinghaus)...');
        const decayResult = memory.decayRelationships();
        console.log(`Checked ${decayResult.checked} relations, pruned ${decayResult.pruned} weak ones.`);

        console.log('\nMaintenance completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Maintenance failed:', err);
        process.exit(1);
    }
}

// ============ GraphRAG Rollout CLI Komutları ============

async function graphRAGStatus() {
    const config = GraphRAGConfigManager.getConfig();
    const phase = GraphRAGConfigManager.getCurrentPhase();

    console.log(`\n📊 GraphRAG Status:`);
    console.log(`  Phase: ${GraphRAGRolloutPhase[phase]} (${phase})`);
    console.log(`  Enabled: ${config.enabled}`);
    console.log(`  Shadow Mode: ${config.shadowMode}`);
    console.log(`  Sample Rate: ${(config.sampleRate * 100).toFixed(0)}%`);
    console.log(`  Max Hops: ${config.maxHops}`);
    console.log(`  Token Budget: ${config.tokenBudget}`);
    console.log(`  Timeout: ${config.timeoutMs}ms`);
    console.log(`  PageRank: ${config.usePageRank}`);
    console.log(`  Communities: ${config.useCommunities}`);
    console.log(`  Fallback: ${config.fallbackEnabled}`);
}

async function graphRAGAdvance() {
    const newPhase = GraphRAGConfigManager.advancePhase();
    console.log(`\n🚀 GraphRAG phase advanced to: ${GraphRAGRolloutPhase[newPhase]}`);
    await graphRAGStatus();
}

async function graphRAGSetPhase(phase: number) {
    if (isNaN(phase) || phase < 1 || phase > 4) {
        console.error('\n❌ Invalid phase. Use 1 (OFF), 2 (SHADOW), 3 (PARTIAL), or 4 (FULL).');
        process.exit(1);
    }

    GraphRAGConfigManager.setRolloutPhase(phase as GraphRAGRolloutPhase);
    console.log(`\n✅ GraphRAG phase set to: ${GraphRAGRolloutPhase[phase]}`);
    await graphRAGStatus();
}

// ============ FULL Phase Hazırlık CLI Komutları ============

async function graphRAGReadiness() {
    const config = GraphRAGConfigManager.getConfig();
    const phase = GraphRAGConfigManager.getCurrentPhase();
    const metrics = GraphRAGMonitor.getMetrics();
    const lastRollback = GraphRAGRollbackManager.getLastRollbackTime();

    console.log('\n🔍 GraphRAG FULL Phase Readiness Check:');
    console.log('=========================================');

    // Mevcut phase kontrolü
    const isAtPartial = phase === GraphRAGRolloutPhase.PARTIAL;
    console.log(`\n📌 Current Phase: ${GraphRAGRolloutPhase[phase]} ${isAtPartial ? '✅ Ready for FULL' : '⚠️ Not at PARTIAL'}`);

    // Config kontrolü
    console.log('\n📋 Configuration Check:');
    const fullConfig = {
        sampleRate: 1.0,
        maxHops: 3,
        tokenBudget: 48000,
        timeoutMs: 8000,
    };

    console.log(`  Sample Rate: ${(config.sampleRate * 100).toFixed(0)}% → ${(fullConfig.sampleRate * 100).toFixed(0)}% ${config.sampleRate === fullConfig.sampleRate ? '✅' : '❌'}`);
    console.log(`  Max Hops: ${config.maxHops} → ${fullConfig.maxHops} ${config.maxHops === fullConfig.maxHops ? '✅' : '❌'}`);
    console.log(`  Token Budget: ${config.tokenBudget} → ${fullConfig.tokenBudget} ${config.tokenBudget === fullConfig.tokenBudget ? '✅' : '❌'}`);
    console.log(`  Timeout: ${config.timeoutMs}ms → ${fullConfig.timeoutMs}ms ${config.timeoutMs === fullConfig.timeoutMs ? '✅' : '❌'}`);

    // Metrics kontrolü
    console.log('\n📊 Current Metrics:');
    console.log(`  Total Queries: ${metrics.totalQueries}`);
    console.log(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}% ${metrics.errorRate < 0.05 ? '✅' : '❌ (>5%)'}`);
    console.log(`  P95 Latency: ${metrics.p95Latency.toFixed(0)}ms ${metrics.p95Latency < 3000 ? '✅' : '❌ (>3000ms)'}`);
    console.log(`  Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}% ${metrics.cacheHitRate > 0.5 ? '✅' : '⚠️ (<50%)'}`);
    console.log(`  Avg Token Usage: ${metrics.avgTokenUsage.toFixed(0)} ${metrics.avgTokenUsage < 40000 ? '✅' : '⚠️ (>40000)'}`);

    // Rollback history
    if (lastRollback) {
        console.log(`\n⚠️  Last Rollback: ${lastRollback.toISOString()}`);
    } else {
        console.log('\n✅ No rollback history');
    }

    // Genel değerlendirme
    const allChecks = [
        isAtPartial,
        config.sampleRate === fullConfig.sampleRate,
        config.maxHops === fullConfig.maxHops,
        config.tokenBudget === fullConfig.tokenBudget,
        config.timeoutMs === fullConfig.timeoutMs,
        metrics.errorRate < 0.05,
    ];

    const passedChecks = allChecks.filter(Boolean).length;
    const totalChecks = allChecks.length;

    console.log(`\n📈 Readiness Score: ${passedChecks}/${totalChecks}`);

    if (passedChecks === totalChecks) {
        console.log('\n🎉 FULL phase\'e geçmeye hazırsınız!');
        console.log('   Kullanım: npm run graphrag:go-full');
    } else {
        console.log('\n⚠️  Bazı kontroller başarısız. FULL phase\'e geçmeden önce düzeltin.');
    }
}

async function graphRAGGoFull() {
    const currentPhase = GraphRAGConfigManager.getCurrentPhase();

    if (currentPhase === GraphRAGRolloutPhase.FULL) {
        console.log('\n✅ Already at FULL phase');
        return;
    }

    if (currentPhase !== GraphRAGRolloutPhase.PARTIAL) {
        console.log('\n⚠️  FULL phase\'e geçmeden önce PARTIAL phase\'de olmalısınız');
        console.log('   Önce: npm run graphrag:set-phase 3');
        return;
    }

    // Onay iste
    console.log('\n⚠️  GraphRAG FULL phase\'e geçiliyor...');
    console.log('   - Sample Rate: %100');
    console.log('   - Max Hops: 3');
    console.log('   - Token Budget: 48000');
    console.log('   - Timeout: 8000ms');
    console.log('\n   Bu değişiklik production\'da tüm sorguları etkileyecek!');

    // CLI'de onay için environment variable kontrolü
    const forceConfirm = process.env.GRAPHRAG_CONFIRM !== 'yes';
    if (forceConfirm) {
        console.log('\n   Onaylamak için: GRAPHRAG_CONFIRM=yes npm run graphrag:go-full');
        return;
    }

    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
    console.log('\n🚀 GraphRAG FULL phase\'e geçti!');
    await graphRAGStatus();
}

async function graphRAGEmergencyRollback() {
    console.log('\n🚨 EMERGENCY ROLLBACK başlatılıyor...');

    const currentPhase = GraphRAGConfigManager.getCurrentPhase();
    console.log(`   Current Phase: ${GraphRAGRolloutPhase[currentPhase]}`);

    await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.MANUAL_TRIGGER,
        'cli',
    );

    const newPhase = GraphRAGConfigManager.getCurrentPhase();
    console.log(`\n✅ Rollback completed: ${GraphRAGRolloutPhase[newPhase]}`);

    const lastRollback = GraphRAGRollbackManager.getLastRollbackTime();
    if (lastRollback) {
        console.log(`   Rollback Time: ${lastRollback.toISOString()}`);
    }
}

async function graphRAGMetrics() {
    const metrics = GraphRAGMonitor.getMetrics();
    const alerts = GraphRAGMonitor.getRecentAlerts(10);

    console.log('\n📊 GraphRAG Metrics Report:');
    console.log('===========================');
    console.log(`  Total Queries: ${metrics.totalQueries}`);
    console.log(`  GraphRAG Queries: ${metrics.graphRAGQueries}`);
    console.log(`  Fallback Queries: ${metrics.fallbackQueries}`);
    console.log(`  Avg Latency: ${metrics.avgLatency.toFixed(0)}ms`);
    console.log(`  P95 Latency: ${metrics.p95Latency.toFixed(0)}ms`);
    console.log(`  P99 Latency: ${metrics.p99Latency.toFixed(0)}ms`);
    console.log(`  Avg Token Usage: ${metrics.avgTokenUsage.toFixed(0)}`);
    console.log(`  Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);

    if (alerts.length > 0) {
        console.log('\n🚨 Recent Alerts:');
        for (const alert of alerts) {
            const icon = alert.severity === AlertSeverity.CRITICAL ? '🔴' : '🟡';
            console.log(`  ${icon} [${alert.severity.toUpperCase()}] ${alert.message}`);
            console.log(`     Time: ${alert.timestamp.toISOString()}`);
        }
    } else {
        console.log('\n✅ No recent alerts');
    }
}

// CLI argument parsing
const command = process.argv[2];

if (command) {
    switch (command) {
        case 'graphrag-status':
            await graphRAGStatus();
            break;
        case 'graphrag-advance':
            await graphRAGAdvance();
            break;
        case 'graphrag-set-phase':
            await graphRAGSetPhase(parseInt(process.argv[3], 10));
            break;
        case 'graphrag-readiness':
            await graphRAGReadiness();
            break;
        case 'graphrag-go-full':
            await graphRAGGoFull();
            break;
        case 'graphrag-emergency-rollback':
            await graphRAGEmergencyRollback();
            break;
        case 'graphrag-metrics':
            await graphRAGMetrics();
            break;
        default:
            // Eğer GraphRAG komutu değilse, mevcut maintenance'i çalıştır
            await runMaintenance();
            break;
    }
} else {
    // Komut yoksa mevcut maintenance'i çalıştır
    await runMaintenance();
}
