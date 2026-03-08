import { PenceDatabase } from '../src/memory/database.js';
import { MemoryManager } from '../src/memory/manager.js';
import { AgentRuntime } from '../src/agent/runtime.ts';
import { LLMProviderFactory } from '../src/llm/provider.ts';
import { registerAllProviders } from '../src/llm/index.ts';
import { getConfig, loadConfig } from '../src/gateway/config.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function runTests() {
    await loadConfig();
    registerAllProviders();
    console.log("Deep Memory System Test Started...");

    // Create temp db for testing to avoid polluting real db
    const testDbPath = path.resolve('data/test_memory_ai.sqlite');
    console.log(`Using test database at ${testDbPath}`);
    const db = new PenceDatabase(testDbPath, 1536);
    const manager = new MemoryManager(db);

    const config = getConfig();
    const llmName = config.defaultLLMProvider || 'openai';
    console.log(`Using LLM Provider: ${llmName}`);
    const llm = await LLMProviderFactory.create(llmName);
    const agent = new AgentRuntime(llm, manager);

    console.log("Testing Semantic Deduplication (adding similar concepts)");
    await manager.addMemory("Kullanıcı yapay zeka alanında araştırmalar yapıyor", "user_fact", 5);
    const m2 = await manager.addMemory("Kullanıcı AI teknolojileri üzerine çalışıyor", "user_fact", 5);

    const summaries = manager.getRecentConversationSummaries();
    console.log(`recent summaries: ${JSON.stringify(summaries)}`);

    const memories = manager.getUserMemories(10);
    console.log(`Current User Memories Count: ${memories.length}`);
    for (const m of memories) {
        console.log(`- Memory ID: ${m.id} | Content: ${m.content} | Access: ${m.access_count} | Stability: ${m.stability}`);
    }

    console.log(`Testing Graph Entity Extraction with LLM on Memory ID ${m2.id}...`);
    // @ts-ignore
    await agent.processMemoryGraphWithLLM(m2.id, "Kullanıcı AI teknolojileri üzerine çalışıyor. Apple ve Microsoft'u karşılaştırır.");

    console.log("Testing Proximity \u0026 Graph Relations");
    // @ts-ignore
    await manager.graph.ensureAllMemoryGraphRelations();

    // @ts-ignore
    const graph = manager.graph.getMemoryGraph();
    console.log(`Graph Nodes: ${graph.nodes.length} | Graph Edges: ${graph.edges.length}`);
    for (const n of graph.nodes) {
        console.log(`  Node: ${n.name} (${n.type})`);
    }
    for (const e of graph.edges) {
        console.log(`  Edge: ${e.source} -[${e.relation}]-> ${e.target} | conf: ${e.confidence}`);
    }

    console.log("Testing Deep Scan (Ebbinghaus) Update Execution");
    // Manually push an update
    // @ts-ignore
    manager._enqueueEbbinghausToWorker([memories[0]?.id || 1]);

    console.log("Test finished.");
}

runTests().catch(console.error);
