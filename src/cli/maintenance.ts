
import { MemoryManager } from '../memory/manager.js';
import { PenceDatabase } from '../memory/database.js';
import { LLMProviderFactory, registerAllProviders } from '../llm/index.js';
import { createEmbeddingProvider } from '../memory/embeddings.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';

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

runMaintenance();
