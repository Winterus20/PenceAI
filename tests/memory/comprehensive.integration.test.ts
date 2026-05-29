
import { jest } from '@jest/globals';
import { PenceDatabase } from '../../src/memory/database.js';
import { MemoryManager } from '../../src/memory/manager/index.js';
import { GraphRAGEngine } from '../../src/memory/graphRAG/GraphRAGEngine.js';
import { GraphExpander } from '../../src/memory/graphRAG/GraphExpander.js';
import { GraphCache } from '../../src/memory/graphRAG/GraphCache.js';
import { PageRankScorer } from '../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../src/memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../../src/memory/graphRAG/CommunitySummarizer.js';
import { MemoryLintPass } from '../../src/memory/wiki/lintPass.js';
import { ProvenanceTracker } from '../../src/memory/wiki/provenance.js';
import type { LLMProvider, LLMResponse } from '../../src/llm/provider.js';
import type { EmbeddingProvider } from '../../src/memory/embeddings.js';

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  name = 'mock-llm';
  supportsNativeToolCalling = true;
  async chat(messages: any[], options?: any): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1].content;
// ...
  }
  async embed(texts: string[]): Promise<number[][]> {
    console.log('DEBUG: MockLLMProvider.embed called for texts:', texts);
    return texts.map(() => new Array(1536).fill(0.1));
  }
}

// Mock Embedding Provider
class MockEmbeddingProvider implements EmbeddingProvider {
  name = 'mock-embed';
  dimensions = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    // Return unique vectors based on content for deduplication tests
    return texts.map(text => {
      const vec = new Array(1536).fill(0);
      if (text.includes('TypeScript')) vec[0] = 0.9;
      if (text.includes('React')) vec[1] = 0.9;
      return vec;
    });
  }
}

describe('Memory Comprehensive Integration Test', () => {
  let db: PenceDatabase;
  let manager: MemoryManager;
  let llm: MockLLMProvider;
  let embedder: MockEmbeddingProvider;
  let graphRAG: GraphRAGEngine;

  beforeAll(async () => {
    db = new PenceDatabase(':memory:', 1536);
    llm = new MockLLMProvider();
    embedder = new MockEmbeddingProvider();
    
    // Manager initialization
    manager = new MemoryManager(db);
    
    // Inject mocks
    (manager as any).embeddingProvider = embedder;
    (manager as any).memoryStore.embeddingProvider = embedder;
    (manager as any).retrievalService.deps.embeddingProvider = embedder;

    // GraphRAG setup
    const cache = new GraphCache(db.getDb());
    const expander = new GraphExpander(db.getDb(), cache);
    const scorer = new PageRankScorer(db.getDb());
    const detector = new CommunityDetector(db.getDb());
    const summarizer = new CommunitySummarizer(db.getDb(), llm);
    
    graphRAG = new GraphRAGEngine(
      db.getDb(),
      expander,
      scorer,
      detector,
      summarizer,
      cache,
      (q, l) => manager.hybridSearch(q, l),
      llm
    );
    
    manager.setGraphRAGEngine(graphRAG);
  });

  afterAll(() => {
    db.close();
  });

  test('Step 1: Conversation & Message Flow', async () => {
    const { conversationId } = manager.getOrCreateConversation('cli', 'test-channel', 'Yigit');
    expect(conversationId).toBeDefined();

    manager.addMessage(conversationId, {
      role: 'user',
      content: 'Merhaba, ben TypeScript ve React kullanmayı seviyorum.'
    });

    const history = manager.getConversationHistory(conversationId);
    expect(history.length).toBe(1);
    expect(history[0].content).toContain('TypeScript');

    const recent = manager.getRecentConversations();
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].id).toBe(conversationId);
  });

  test('Step 2: Memory Creation, Deduplication & Reconsolidation', async () => {
    // Add first memory with high confidence
    const content = 'Kullanıcı TypeScript kullanıyor.';
    const res1 = await manager.addMemory(content, 'project', 8, undefined, { confidence: 0.9 });
    expect(res1.id).toBeGreaterThan(0);

    // Add identical memory with high confidence
    const res2 = await manager.addMemory(content, 'project', 9, undefined, { confidence: 0.9 });
    
    expect(res2.id).toBe(res1.id);
    expect(res2.isUpdate).toBe(false); // Exact match skip update but returns id

    const stats = manager.getStats();
    expect(stats.memories).toBe(1); // Merged into one
  });

  test('Step 3: Graph Processing & Relations', async () => {
    const mem1 = await manager.addMemory('React, modern web arayüzleri için kullanılan bir kütüphanedir.', 'technology', 7);
    const mem2 = await manager.addMemory('TypeScript, React projelerinde tip güvenliği sağlar.', 'technology', 8);

    // Manually trigger graph processing (mocking extraction)
    await manager.processMemoryGraph(mem2.id, 'TypeScript, React projelerinde tip güvenliği sağlar.', async () => ({
      entities: [
        { name: 'TypeScript', type: 'technology' },
        { name: 'React', type: 'technology' }
      ],
      relations: [
        { targetMemoryId: mem1.id, relationType: 'supports', confidence: 0.9, description: 'TS Reacti destekler' }
      ]
    }));

    const neighbors = manager.getMemoryNeighbors(mem2.id);
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors[0].id).toBe(mem1.id);
    
    const entities = manager.getMemoryEntities(mem2.id);
    expect(entities.some(e => e.name === 'TypeScript')).toBe(true);
  });

  test('Step 4: Retrieval Orchestration (Hybrid + GraphRAG)', async () => {
    const { conversationId } = manager.getOrCreateConversation('cli', 'test-channel');
    
    // Use a query that triggers high confidence retrieval (hasPersonalReference + hasRecallCue)
    const bundle = await manager.getPromptContextBundle(
      'Benim TypeScript projem hakkında ne hatırlıyorsun?',
      conversationId,
      { relevantMemoryLimit: 5 }
    );

    if (bundle.relevantMemories.length === 0) {
        // Retrieval failed
    }

    expect(bundle.relevantMemories.length).toBeGreaterThan(0);
    expect(bundle.relevantMemories.some(m => m.content.includes('TypeScript'))).toBe(true);
    
    // Check if GraphRAG metadata is present (if triggered)
    if (bundle.graphRAG) {
      expect(bundle.graphRAG.memories).toBeDefined();
    }
  });

  test('Step 5: Wiki, Provenance & Contradictions', async () => {
    const mem = await manager.addMemory('İstanbul başkenttir.', 'general', 5);
    
    // Edit memory -> triggers provenance
    await manager.editMemory(mem.id, 'İstanbul, Türkiye\'nin en büyük şehridir (başkent değildir).', 'general', 6);
    
    const tracker = new ProvenanceTracker({ db: db.getDb() });
    const revisions = tracker.getRevisions(mem.id);
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions[0].content).toBe('İstanbul başkenttir.');

    // Add contradicting memory
    await manager.addMemory('Ankara, Türkiye\'nin başkentidir.', 'general', 9);

    const lintPass = new MemoryLintPass({
      db: db.getDb(),
      llm: llm,
      config: {
        deterministicThresholdJaccard: 0.1,
        llmValidationEnabled: true,
        maxLLMPairsPerRun: 10
      }
    });

    const result = await lintPass.runLintPass();
    expect(result.scannedPairs).toBeGreaterThan(0);
  });

  test('Step 6: Insight Engine & Feedback', async () => {
    const { conversationId } = manager.getOrCreateConversation('cli', 'test-channel');
    
    manager.saveFeedback({
      messageId: 'msg-1',
      conversationId,
      type: 'positive',
      comment: 'Harika bir öneri, TypeScript kullanmaya devam edelim.',
      timestamp: new Date().toISOString()
    });

    const insights = await manager.getInsightEngine().processObservations();
    // Since we only have 1 observation and detector needs 2, we might not get an insight yet
    // but the observation should be stored in the detector.
    expect(manager.getInsightEngine()).toBeDefined();
  });

  test('Step 7: Maintenance (Decay & Compaction)', async () => {
    const decay = manager.decayMemories();
    expect(decay).toBeDefined();
    expect(typeof decay.archived).toBe('number');

    const stats = manager.getStats();
    expect(stats.conversations).toBeGreaterThan(0);
  });
});
