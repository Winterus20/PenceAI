import type { MemoryConsolidationPayload, MemoryRow, MemoryEntityRow } from '../../memory/types.js';
import type { LLMProvider } from '../../llm/provider.js';
import type { MemoryManager } from '../../memory/manager/index.js';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

const CONSOLIDATION_PROMPT = `
Sen "PenceAI" bellek konsolidasyon motorusun. Aşağıda aynı kategoriye ait parça parça "epizodik" (zamanlı) anılar ve bu anılara bağlı varlıklar (entities) verilmiştir.
Senin görevin:
1. Bu epizodik anılardaki ortak temaları, kalıcı olguları (facts) ve temel tercihleri çıkararak bunları 1 veya en fazla 3 adet geniş ve genelgeçer "Semantik" (semantic) anı cümlesine dönüştürmek.
2. Bağlı varlıklarda eş anlamlı veya aynı kişiyi/kavramı işaret eden birden fazla isim varsa (örn: "JS", "JavaScript", "Javascript") bunları "entity_merge" nesnesinde birleştirmek.

ÇIKTI FORMATI (YALNIZCA JSON):
{
  "semanticMemories": [
    { "content": "Kullanıcının projelerinde genel olarak JavaScript ve React kullandığı, son dönemde performans optimizasyonlarına ağırlık verdiği biliniyor.", "category": "...", "importance": 8 }
  ],
  "entityMerges": [
    { "keepEntityId": 12, "mergeAndRemoveEntityIds": [45, 87] }
  ],
  "consumedMemoryIds": [1, 2, 5, 8]
}
`;

export async function handleMemoryConsolidation(
    payload: MemoryConsolidationPayload,
    signal: AbortSignal,
    db: Database.Database,
    llm: LLMProvider,
    memoryManager: MemoryManager
): Promise<void> {
    const { category } = payload;
    logger.info(`[ConsolidationTask] Starting consolidation for category: ${category}`);

    // 1. Fetch episodic memories for the category
    const memories = db.prepare(`
        SELECT * FROM memories 
        WHERE is_archived = 0 AND memory_type = 'episodic' AND category = ?
        ORDER BY created_at ASC
    `).all(category) as MemoryRow[];

    if (memories.length < 5) {
        logger.info(`[ConsolidationTask] Not enough memories to consolidate (${memories.length}). Skipping.`);
        return;
    }

    // 2. Fetch related entities
    const memoryIds = memories.map(m => m.id);
    const placeholders = memoryIds.map(() => '?').join(',');
    const entities = db.prepare(`
        SELECT DISTINCT me.* FROM memory_entities me
        JOIN memory_entity_links mel ON me.id = mel.entity_id
        WHERE mel.memory_id IN (${placeholders})
    `).all(...memoryIds) as MemoryEntityRow[];

    // 3. Prepare LLM prompt
    const memoryText = memories.map(m => `ID: ${m.id} | Content: ${m.content}`).join('\n');
    const entityText = entities.map(e => `ID: ${e.id} | Name: ${e.name} | Type: ${e.type}`).join('\n');

    const userPrompt = `
KATEGORİ: ${category}

ANILAR:
${memoryText}

BAĞLI VARLIKLAR:
${entityText}
`;

    // 4. Call LLM
    try {
        const response = await llm.chat([
            { role: 'system', content: CONSOLIDATION_PROMPT },
            { role: 'user', content: userPrompt }
        ], { temperature: 0.3 });

        if (signal.aborted) return;

        // 5. Parse response
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in LLM response');
        }

        const result = JSON.parse(jsonMatch[0]);

        // 6. DB Transaction
        db.transaction(() => {
            // A. Add new semantic memories
            for (const sm of result.semanticMemories || []) {
                db.prepare(`
                    INSERT INTO memories (user_id, category, content, importance, memory_type, stability, next_review_at, provenance_source)
                    VALUES (?, ?, ?, ?, 'semantic', 30, ?, ?)
                `).run(
                    'default',
                    category,
                    sm.content,
                    sm.importance || 7,
                    Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
                    'consolidation'
                );
            }

            // B. Archive consumed memories
            if (result.consumedMemoryIds && result.consumedMemoryIds.length > 0) {
                const consumedPlaceholders = result.consumedMemoryIds.map(() => '?').join(',');
                db.prepare(`
                    UPDATE memories SET is_archived = 1 WHERE id IN (${consumedPlaceholders})
                `).run(...result.consumedMemoryIds);
            }

            // C. Entity Merging
            for (const merge of result.entityMerges || []) {
                const keepId = merge.keepEntityId;
                for (const dropId of merge.mergeAndRemoveEntityIds || []) {
                    // Update links
                    db.prepare(`
                        INSERT OR IGNORE INTO memory_entity_links (memory_id, entity_id)
                        SELECT memory_id, ? FROM memory_entity_links WHERE entity_id = ?
                    `).run(keepId, dropId);
                    
                    db.prepare(`DELETE FROM memory_entity_links WHERE entity_id = ?`).run(dropId);
                    
                    // Update relations (if entities are source/target in any relation table extension)
                    // Currently relations are between memories, but if we have entity relations, update them here.
                    
                    // Delete dropped entity
                    db.prepare(`DELETE FROM memory_entities WHERE id = ?`).run(dropId);
                }
            }
        })();

        logger.info(`[ConsolidationTask] Successfully consolidated ${result.consumedMemoryIds?.length || 0} memories into ${result.semanticMemories?.length || 0} semantic memories.`);
    } catch (err) {
        logger.error({ err, category }, '[ConsolidationTask] Error during consolidation');
        throw err;
    }
}
