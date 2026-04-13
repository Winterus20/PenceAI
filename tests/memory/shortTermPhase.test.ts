import {
    normalizeMemoryWriteInput,
    decideMemoryMerge,
    decideReconsolidationPilot,
    DEFAULT_RECONSOLIDATION_GUARDRAILS,
} from '../../src/memory/shortTermPhase.js';
import type { MemoryMergeDecisionInput, ReconsolidationDecisionInput } from '../../src/memory/shortTermPhase.js';

describe('normalizeMemoryWriteInput', () => {
    test('should normalize whitespace', () => {
        const result = normalizeMemoryWriteInput('hello   world', 'general', 5);
        expect(result.content).toBe('hello world');
        expect(result.reasons).toContain('content_normalized');
    });

    test('should normalize category from alias', () => {
        const result = normalizeMemoryWriteInput('test', 'fact', 5);
        expect(result.category).toBe('general');
        expect(result.reasons).toContain('category_normalized');
    });

    test('should clamp importance to [1, 10]', () => {
        const high = normalizeMemoryWriteInput('test', 'general', 15);
        expect(high.importance).toBe(10);
        expect(high.reasons).toContain('importance_clamped');

        const low = normalizeMemoryWriteInput('test', 'general', 0);
        expect(low.importance).toBe(1);
        expect(low.reasons).toContain('importance_clamped');
    });

    test('should reject empty content', () => {
        const result = normalizeMemoryWriteInput('', 'general', 5);
        expect(result.accepted).toBe(false);
        expect(result.reasons).toContain('empty_content_rejected');
    });

    test('should preserve original values', () => {
        const result = normalizeMemoryWriteInput('  original  ', 'fact', 12);
        expect(result.originalContent).toBe('  original  ');
        expect(result.originalCategory).toBe('fact');
        expect(result.originalImportance).toBe(12);
    });

    test('should accept valid input without modifications', () => {
        const result = normalizeMemoryWriteInput('clean content', 'general', 5);
        expect(result.accepted).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    test('should use default category and importance', () => {
        const result = normalizeMemoryWriteInput('test');
        expect(result.category).toBe('general');
        expect(result.importance).toBe(5);
    });

    test('should normalize preference alias', () => {
        const result = normalizeMemoryWriteInput('test', 'preferences', 5);
        expect(result.category).toBe('preference');
    });

    test('should normalize todo alias', () => {
        const result = normalizeMemoryWriteInput('test', 'todo', 5);
        expect(result.category).toBe('task');
    });
});

describe('decideMemoryMerge', () => {
    test('should detect exact normalized match', () => {
        const result = decideMemoryMerge({
            category: 'general',
            existingContent: 'Hello world',
            incomingContent: 'hello   world',
        });
        expect(result.shouldMerge).toBe(true);
        expect(result.reason).toBe('exact_normalized_match');
    });

    test('should apply strict matching for volatile categories with structured variance', () => {
        const result = decideMemoryMerge({
            category: 'event',
            existingContent: 'Meeting on 2024-01-15 at 3pm',
            incomingContent: 'Meeting on 2024-01-15 at 4pm',
            semanticSimilarity: 0.85,
            jaccardSimilarity: 0.70,
            containmentRatio: 0.80,
        });
        // Low similarity signals, volatile category with structured data
        expect(result.shouldMerge).toBe(false);
        expect(result.reason).toBe('volatile_category_preserve_distinct');
    });

    test('should allow merge for volatile with strong signals', () => {
        const result = decideMemoryMerge({
            category: 'event',
            existingContent: 'Meeting on 2024-01-15 at 3pm',
            incomingContent: 'Meeting on 2024-01-15 at 4pm with extra details',
            semanticSimilarity: 0.95,
            jaccardSimilarity: 0.90,
            containmentRatio: 0.95,
        });
        expect(result.shouldMerge).toBe(true);
        expect(result.reason).toBe('volatile_category_strict_match');
    });

    test('should merge when containment ratio is high', () => {
        const result = decideMemoryMerge({
            category: 'general',
            existingContent: 'The project deadline is next Friday and we need to prepare',
            incomingContent: 'project deadline',
            containmentRatio: 0.95,
        });
        expect(result.shouldMerge).toBe(true);
        expect(result.reason).toBe('incoming_contained_by_existing');
        expect(result.preferredContent).toBe('existing');
    });

    test('should allow default merge for non-volatile categories', () => {
        const result = decideMemoryMerge({
            category: 'concept',
            existingContent: 'Machine learning is a subset of AI',
            incomingContent: 'ML is part of artificial intelligence',
            semanticSimilarity: 0.80,
            jaccardSimilarity: 0.40,
            containmentRatio: 0.50,
        });
        expect(result.shouldMerge).toBe(true);
        expect(result.reason).toBe('default_merge_allowed');
    });

    test('should handle non-volatile category with structured data', () => {
        const result = decideMemoryMerge({
            category: 'general',
            existingContent: 'Meeting on 2024-01-15',
            incomingContent: 'Meeting on 2024-01-16',
            semanticSimilarity: 0.50,
            jaccardSimilarity: 0.30,
            containmentRatio: 0.40,
        });
        // Non-volatile, so default merge applies
        expect(result.shouldMerge).toBe(true);
    });
});

describe('decideReconsolidationPilot', () => {
    const baseInput: ReconsolidationDecisionInput = {
        memoryType: 'semantic',
        category: 'general',
        existingContent: 'The sky is blue',
        incomingContent: 'The sky is blue and clouds are white',
        confidence: 0.85,
        semanticSimilarity: 0.80,
        jaccardSimilarity: 0.60,
        containmentRatio: 0.75,
    };

    test('should skip for non-semantic memory types', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            memoryType: 'episodic',
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('episodic_memory_excluded');
        expect(result.proposalMode).toBe('skip');
    });

    test('should skip when confidence is below floor', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            confidence: 0.50,
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('low_confidence_guard');
    });

    test('should skip when confidence is null', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            confidence: null,
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('low_confidence_guard');
    });

    test('should skip for exact match with no new information', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'The sky is blue',
            incomingContent: 'The sky is blue',
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('exact_match_no_rewrite');
    });

    test('should skip on structured variance conflict with low containment', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'Meeting on 2024-01-15 at 3pm with team',
            incomingContent: 'Meeting on 2024-01-16 at 4pm with management',
            confidence: 0.85,
            semanticSimilarity: 0.70,
            jaccardSimilarity: 0.40,
            containmentRatio: 0.50,
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('conflict_guard_preserve_existing');
    });

    test('should commit update on high containment', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'The project deadline is next Friday and we need to prepare all documents',
            incomingContent: 'project deadline',
            confidence: 0.85,
            containmentRatio: 0.95,
            semanticSimilarity: 0.90,
        });
        expect(result.action).toBe('update');
        expect(result.reason).toBe('high_containment_guarded_update');
        expect(result.proposalMode).toBe('commit_update');
        expect(result.commitEligible).toBe(true);
    });

    test('should commit update on high similarity', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'The sky is blue',
            incomingContent: 'The sky is blue and very bright',
            confidence: 0.85,
            semanticSimilarity: 0.95,
            containmentRatio: 0.60,
        });
        expect(result.action).toBe('update');
        expect(result.reason).toBe('high_similarity_guarded_update');
        expect(result.proposalMode).toBe('commit_update');
    });

    test('should propose append on moderate semantic similarity', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'The sky is blue',
            incomingContent: 'Clouds form from water vapor',
            confidence: 0.85,
            semanticSimilarity: 0.90,
            containmentRatio: 0.30,
        });
        expect(result.action).toBe('append');
        expect(result.reason).toBe('novel_semantic_detail_append_first');
        expect(result.proposalMode).toBe('proposal_append');
        expect(result.shadowEligible).toBe(true);
    });

    test('should skip on weak signal', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'The sky is blue',
            incomingContent: 'Completely unrelated topic about databases',
            confidence: 0.85,
            semanticSimilarity: 0.20,
            jaccardSimilarity: 0.10,
            containmentRatio: 0.10,
        });
        expect(result.action).toBe('skip');
        expect(result.reason).toBe('weak_reconsolidation_signal');
        expect(result.eligible).toBe(false);
    });

    test('should include guardrails in decision', () => {
        const result = decideReconsolidationPilot(baseInput);
        expect(result.guardrails).toBeDefined();
        expect(result.guardrails.confidenceFloor).toBe(DEFAULT_RECONSOLIDATION_GUARDRAILS.confidenceFloor);
        expect(result.guardrails.semanticSimilarity).toBe(0.80);
    });

    test('should accept custom config overrides', () => {
        const result = decideReconsolidationPilot(baseInput, {
            confidenceFloor: 0.50,
        });
        expect(result.guardrails.confidenceFloor).toBe(0.50);
    });

    test('should be pilot active for semantic memories', () => {
        const result = decideReconsolidationPilot(baseInput);
        expect(result.pilotActive).toBe(true);
    });

    test('should prefer incoming when longer on high similarity', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'Short',
            incomingContent: 'This is a much longer version of the short text with more details',
            confidence: 0.90,
            semanticSimilarity: 0.95,
            containmentRatio: 0.50,
        });
        expect(result.preferredContent).toBe('incoming');
    });

    test('should prefer existing when longer on high similarity', () => {
        const result = decideReconsolidationPilot({
            ...baseInput,
            existingContent: 'This is a much longer version with lots of details',
            incomingContent: 'Short',
            confidence: 0.90,
            semanticSimilarity: 0.95,
            containmentRatio: 0.50,
        });
        expect(result.preferredContent).toBe('existing');
    });
});
