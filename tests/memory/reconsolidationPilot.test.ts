import { decideReconsolidationPilot } from '../../src/memory/shortTermPhase.js';

describe('reconsolidation pilot', () => {
    test('produces append-first decision for semantic memories with moderate novelty', () => {
        const decision = decideReconsolidationPilot({
            memoryType: 'semantic',
            category: 'preference',
            existingContent: 'Kullanıcı backend geliştirmeyi seviyor',
            incomingContent: 'Kullanıcı backend geliştirmeyi seviyor ve test otomasyonunu önemsiyor',
            confidence: 0.9,
            semanticSimilarity: 0.88,
            jaccardSimilarity: 0.74,
        });

        expect(decision).toMatchObject({
            pilotActive: true,
            eligible: true,
            action: 'append',
            reason: 'novel_semantic_detail_append_first',
            safetyReasons: ['append_first_guard'],
            preferredContent: 'longer',
            proposalMode: 'proposal_append',
            commitEligible: false,
            shadowEligible: true,
            guardrails: {
                confidenceFloor: 0.78,
                appendSemanticFloor: 0.86,
                appendJaccardFloor: 0.72,
                observedConfidence: 0.9,
                semanticSimilarity: 0.88,
                jaccardSimilarity: 0.74,
                incomingAddsNewInformation: true,
            },
        });
        expect(decision.candidateContent).toContain('[reconsolidated]');
    });

    test('does not apply reconsolidation to episodic memories', () => {
        const decision = decideReconsolidationPilot({
            memoryType: 'episodic',
            category: 'follow_up',
            existingContent: 'Dün deploy sonrası hatayı konuştuk',
            incomingContent: 'Dün deploy sonrası hatayı tekrar ele aldık',
            confidence: 0.95,
            semanticSimilarity: 0.91,
        });

        expect(decision).toMatchObject({
            pilotActive: true,
            eligible: false,
            action: 'skip',
            reason: 'episodic_memory_excluded',
            safetyReasons: ['memory_type_not_semantic'],
            preferredContent: 'existing',
            candidateContent: null,
            proposalMode: 'skip',
            commitEligible: false,
            shadowEligible: false,
            guardrails: {
                observedConfidence: 0.95,
                semanticSimilarity: 0.91,
                incomingAddsNewInformation: true,
            },
        });
    });

    test('skips reconsolidation under low confidence instead of overwriting', () => {
        const decision = decideReconsolidationPilot({
            memoryType: 'semantic',
            category: 'profile',
            existingContent: 'Kullanıcı TypeScript ve Node.js kullanıyor',
            incomingContent: 'Kullanıcı TypeScript ve Node.js tercih ediyor',
            confidence: 0.6,
            semanticSimilarity: 0.94,
            jaccardSimilarity: 0.86,
        });

        expect(decision).toMatchObject({
            pilotActive: true,
            eligible: false,
            action: 'skip',
            reason: 'low_confidence_guard',
            safetyReasons: ['confidence_below_floor'],
            preferredContent: 'existing',
            candidateContent: null,
            proposalMode: 'skip',
            commitEligible: false,
            shadowEligible: false,
            guardrails: {
                observedConfidence: 0.6,
                confidenceFloor: 0.78,
                jaccardSimilarity: 0.86,
            },
        });
    });

    test('returns no-rewrite reason for exact semantic matches', () => {
        const decision = decideReconsolidationPilot({
            memoryType: 'semantic',
            category: 'preference',
            existingContent: 'Kullanıcı kısa yanıtları seviyor',
            incomingContent: 'Kullanıcı kısa yanıtları seviyor',
            confidence: 0.92,
            semanticSimilarity: 1,
        });

        expect(decision).toMatchObject({
            pilotActive: true,
            eligible: true,
            action: 'skip',
            reason: 'exact_match_no_rewrite',
            safetyReasons: ['no_new_information'],
            preferredContent: 'existing',
            candidateContent: null,
            proposalMode: 'skip',
            commitEligible: false,
            shadowEligible: false,
            guardrails: {
                observedConfidence: 0.92,
                semanticSimilarity: 1,
                incomingAddsNewInformation: false,
            },
        });
    });

    test('returns conflict guard reason when structured semantic memories disagree', () => {
        const decision = decideReconsolidationPilot({
            memoryType: 'semantic',
            category: 'profile',
            existingContent: 'Kullanıcı 21 yaşında',
            incomingContent: 'Kullanıcı 23 yaşında',
            confidence: 0.93,
            semanticSimilarity: 0.9,
            jaccardSimilarity: 0.67,
            containmentRatio: 0.67,
        });

        expect(decision).toMatchObject({
            pilotActive: true,
            eligible: true,
            action: 'skip',
            reason: 'conflict_guard_preserve_existing',
            safetyReasons: ['structured_variance_conflict'],
            preferredContent: 'existing',
            candidateContent: null,
            proposalMode: 'skip',
            commitEligible: false,
            shadowEligible: false,
            guardrails: {
                observedConfidence: 0.93,
                containmentRatio: 0.67,
                structuredVariance: true,
                structuredVarianceSimilarityFloor: 0.95,
            },
        });
    });
});
