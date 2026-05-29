import { getConfig } from '../../gateway/config.js';
import { composePromptUnlimited } from './builders/index.js';
import { buildBasePromptFragment, BASE_SYSTEM_PROMPT } from './builders/basePrompt.js';
import { buildRulesFragment } from './builders/rules.js';
import { buildMemoryContextFragment } from './builders/memoryContext.js';
import { buildSummaryContextFragment } from './builders/summaryContext.js';
import { buildRecentContextFragment } from './builders/recentContext.js';
import { buildReviewContextFragment } from './builders/reviewContext.js';
import { buildArchivalContextFragment } from './builders/archivalContext.js';
import { buildFollowUpContextFragment } from './builders/followUpContext.js';

export { BASE_SYSTEM_PROMPT };

export interface SystemPromptContext {
    userName: string;
    memories?: string[];
    recentContext?: string[];
    conversationSummaries?: Array<{ title: string; summary: string; updated_at: string }>;
    reviewMemories?: string[];
    memoryRelations?: Array<{ source: string; target: string; relation: string; description: string }>;
    archivalMemories?: string[];
    followUpMemories?: string[];
}

/**
 * Sistem prompt'u oluşturur.
 *
 * Modüler builder mimarisi kullanır:
 * - Her context bloğu bağımsız bir PromptFragment döndürür
 * - composePromptUnlimited() önceliğe göre sıralar ve birleştirir
 * - Token bütçesi contextPreparer.ts seviyesinde yönetilir
 */
export function buildSystemPrompt(context: SystemPromptContext): string {
    const {
        userName,
        memories = [],
        recentContext = [],
        conversationSummaries = [],
        reviewMemories = [],
        memoryRelations = [],
        archivalMemories = [],
        followUpMemories = [],
    } = context;

    const config = getConfig();
    const customPrompt = config.systemPrompt && config.systemPrompt.trim() !== '' ? config.systemPrompt : undefined;

    const fragments = [
        buildBasePromptFragment(userName, customPrompt),
        buildRulesFragment(),
        buildMemoryContextFragment({ memories, memoryRelations }),
        buildRecentContextFragment({ recentContext }),
        buildSummaryContextFragment({ conversationSummaries }),
        buildReviewContextFragment({ reviewMemories }),
        buildArchivalContextFragment({ archivalMemories }),
        buildFollowUpContextFragment({ followUpMemories }),
    ];

    const { prompt } = composePromptUnlimited(fragments);
    return prompt;
}
