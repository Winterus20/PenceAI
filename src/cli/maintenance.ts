
import { MemoryManager } from '../memory/manager.js';
import { PenceDatabase } from '../memory/database.js';
import { LLMProviderFactory, registerAllProviders } from '../llm/index.js';
import { createEmbeddingProvider } from '../memory/embeddings.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../memory/graphRAG/config.js';
import { defaultRollbackManager, RollbackReason } from '../memory/graphRAG/rollback.js';
import { defaultMonitor, AlertSeverity } from '../memory/graphRAG/monitoring.js';

async function runMaintenance() {
    logger.info('--- PençeAI Memory Graph Maintenance ---');

    try {
        const config = getConfig();
        registerAllProviders();

        const llm = await LLMProviderFactory.create(config.defaultLLMProvider);
        const embedding = createEmbeddingProvider();

        // PenceDatabase instantiation
        const penceDb = new PenceDatabase(config.dbPath, embedding?.dimensions || 1536);

        const memory = new MemoryManager(penceDb);

        logger.info('Memory system initialized.');

        logger.info('\n1. Checking for missing graph relations (Backfill)...');
        const backfilled = await memory.ensureAllMemoryGraphRelations();
        logger.info(`Successfully created ${backfilled} missing relations.`);

        logger.info('\n2. Processing relationship decay (Ebbinghaus)...');
        const decayResult = memory.decayRelationships();
        logger.info(`Checked ${decayResult.checked} relations, pruned ${decayResult.pruned} weak ones.`);

        logger.info('\nMaintenance completed successfully.');
        process.exit(0);
    } catch (err) {
        logger.error({ err }, 'Maintenance failed');
        process.exit(1);
    }
}

// ============ GraphRAG Rollout CLI Komutları ============

async function graphRAGStatus() {
    const config = GraphRAGConfigManager.getConfig();
    const phase = GraphRAGConfigManager.getCurrentPhase();

    logger.info(`\n📊 GraphRAG Status:`);
    logger.info(`  Phase: ${GraphRAGRolloutPhase[phase]} (${phase})`);
    logger.info(`  Enabled: ${config.enabled}`);
    logger.info(`  Shadow Mode: ${config.shadowMode}`);
    logger.info(`  Sample Rate: ${(config.sampleRate * 100).toFixed(0)}%`);
    logger.info(`  Max Hops: ${config.maxHops}`);
    logger.info(`  Token Budget: ${config.tokenBudget}`);
    logger.info(`  Timeout: ${config.timeoutMs}ms`);
    logger.info(`  PageRank: ${config.usePageRank}`);
    logger.info(`  Communities: ${config.useCommunities}`);
    logger.info(`  Fallback: ${config.fallbackEnabled}`);
}

async function graphRAGAdvance() {
    const newPhase = GraphRAGConfigManager.advancePhase();
    logger.info(`\n🚀 GraphRAG phase advanced to: ${GraphRAGRolloutPhase[newPhase]}`);
    await graphRAGStatus();
}

async function graphRAGSetPhase(phase: number) {
    if (isNaN(phase) || phase < 1 || phase > 4) {
        logger.error('\n❌ Invalid phase. Use 1 (OFF), 2 (SHADOW), 3 (PARTIAL), or 4 (FULL).');
        process.exit(1);
    }

    GraphRAGConfigManager.setRolloutPhase(phase as GraphRAGRolloutPhase);
    logger.info(`\n✅ GraphRAG phase set to: ${GraphRAGRolloutPhase[phase]}`);
    await graphRAGStatus();
}

// ============ FULL Phase Hazırlık CLI Komutları ============

async function graphRAGReadiness() {
    const config = GraphRAGConfigManager.getConfig();
    const phase = GraphRAGConfigManager.getCurrentPhase();
    const metrics = defaultMonitor.getMetrics();
    const lastRollback = defaultRollbackManager.getLastRollbackTime();

    logger.info('\n🔍 GraphRAG FULL Phase Readiness Check:');
    logger.info('=========================================');

    // Mevcut phase kontrolü
    const isAtPartial = phase === GraphRAGRolloutPhase.PARTIAL;
    logger.info(`\n📌 Current Phase: ${GraphRAGRolloutPhase[phase]} ${isAtPartial ? '✅ Ready for FULL' : '⚠️ Not at PARTIAL'}`);

    // Config kontrolü
    logger.info('\n📋 Configuration Check:');
    const fullConfig = {
        sampleRate: 1.0,
        maxHops: 3,
        tokenBudget: 48000,
        timeoutMs: 8000,
    };

    logger.info(`  Sample Rate: ${(config.sampleRate * 100).toFixed(0)}% → ${(fullConfig.sampleRate * 100).toFixed(0)}% ${config.sampleRate === fullConfig.sampleRate ? '✅' : '❌'}`);
    logger.info(`  Max Hops: ${config.maxHops} → ${fullConfig.maxHops} ${config.maxHops === fullConfig.maxHops ? '✅' : '❌'}`);
    logger.info(`  Token Budget: ${config.tokenBudget} → ${fullConfig.tokenBudget} ${config.tokenBudget === fullConfig.tokenBudget ? '✅' : '❌'}`);
    logger.info(`  Timeout: ${config.timeoutMs}ms → ${fullConfig.timeoutMs}ms ${config.timeoutMs === fullConfig.timeoutMs ? '✅' : '❌'}`);

    // Metrics kontrolü
    logger.info('\n📊 Current Metrics:');
    logger.info(`  Total Queries: ${metrics.totalQueries}`);
    logger.info(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}% ${metrics.errorRate < 0.05 ? '✅' : '❌ (>5%)'}`);
    logger.info(`  P95 Latency: ${metrics.p95Latency.toFixed(0)}ms ${metrics.p95Latency < 3000 ? '✅' : '❌ (>3000ms)'}`);
    logger.info(`  Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}% ${metrics.cacheHitRate > 0.5 ? '✅' : '⚠️ (<50%)'}`);
    logger.info(`  Avg Token Usage: ${metrics.avgTokenUsage.toFixed(0)} ${metrics.avgTokenUsage < 40000 ? '✅' : '⚠️ (>40000)'}`);

    // Rollback history
    if (lastRollback) {
        logger.info(`\n⚠️  Last Rollback: ${lastRollback.toISOString()}`);
    } else {
        logger.info('\n✅ No rollback history');
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

    logger.info(`\n📈 Readiness Score: ${passedChecks}/${totalChecks}`);

    if (passedChecks === totalChecks) {
        logger.info('\n🎉 FULL phase\'e geçmeye hazırsınız!');
        logger.info('   Kullanım: npm run graphrag:go-full');
    } else {
        logger.info('\n⚠️  Bazı kontroller başarısız. FULL phase\'e geçmeden önce düzeltin.');
    }
}

async function graphRAGGoFull() {
    const currentPhase = GraphRAGConfigManager.getCurrentPhase();

    if (currentPhase === GraphRAGRolloutPhase.FULL) {
        logger.info('\n✅ Already at FULL phase');
        return;
    }

    if (currentPhase !== GraphRAGRolloutPhase.PARTIAL) {
        logger.info('\n⚠️  FULL phase\'e geçmeden önce PARTIAL phase\'de olmalısınız');
        logger.info('   Önce: npm run graphrag:set-phase 3');
        return;
    }

    // Onay iste
    logger.info('\n⚠️  GraphRAG FULL phase\'e geçiliyor...');
    logger.info('   - Sample Rate: %100');
    logger.info('   - Max Hops: 3');
    logger.info('   - Token Budget: 48000');
    logger.info('   - Timeout: 8000ms');
    logger.info('\n   Bu değişiklik production\'da tüm sorguları etkileyecek!');

    // CLI'de onay için environment variable kontrolü
    const forceConfirm = process.env.GRAPHRAG_CONFIRM !== 'yes';
    if (forceConfirm) {
        logger.info('\n   Onaylamak için: GRAPHRAG_CONFIRM=yes npm run graphrag:go-full');
        return;
    }

    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
    logger.info('\n🚀 GraphRAG FULL phase\'e geçti!');
    await graphRAGStatus();
}

async function graphRAGEmergencyRollback() {
    logger.info('\n🚨 EMERGENCY ROLLBACK başlatılıyor...');

    const currentPhase = GraphRAGConfigManager.getCurrentPhase();
    logger.info(`   Current Phase: ${GraphRAGRolloutPhase[currentPhase]}`);

    await defaultRollbackManager.emergencyRollback(
        RollbackReason.MANUAL_TRIGGER,
        'cli',
    );

    const newPhase = GraphRAGConfigManager.getCurrentPhase();
    logger.info(`\n✅ Rollback completed: ${GraphRAGRolloutPhase[newPhase]}`);

    const lastRollback = defaultRollbackManager.getLastRollbackTime();
    if (lastRollback) {
        logger.info(`   Rollback Time: ${lastRollback.toISOString()}`);
    }
}

async function graphRAGMetrics() {
    const metrics = defaultMonitor.getMetrics();
    const alerts = defaultMonitor.getRecentAlerts(10);

    logger.info('\n📊 GraphRAG Metrics Report:');
    logger.info('===========================');
    logger.info(`  Total Queries: ${metrics.totalQueries}`);
    logger.info(`  GraphRAG Queries: ${metrics.graphRAGQueries}`);
    logger.info(`  Fallback Queries: ${metrics.fallbackQueries}`);
    logger.info(`  Avg Latency: ${metrics.avgLatency.toFixed(0)}ms`);
    logger.info(`  P95 Latency: ${metrics.p95Latency.toFixed(0)}ms`);
    logger.info(`  P99 Latency: ${metrics.p99Latency.toFixed(0)}ms`);
    logger.info(`  Avg Token Usage: ${metrics.avgTokenUsage.toFixed(0)}`);
    logger.info(`  Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
    logger.info(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);

    if (alerts.length > 0) {
        logger.info('\n🚨 Recent Alerts:');
        for (const alert of alerts) {
            const icon = alert.severity === AlertSeverity.CRITICAL ? '🔴' : '🟡';
            logger.info(`  ${icon} [${alert.severity.toUpperCase()}] ${alert.message}`);
            logger.info(`     Time: ${alert.timestamp.toISOString()}`);
        }
    } else {
        logger.info('\n✅ No recent alerts');
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
            await graphRAGSetPhase(parseInt(process.argv[3] ?? '', 10));
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
