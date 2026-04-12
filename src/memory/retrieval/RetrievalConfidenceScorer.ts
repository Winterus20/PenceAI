/**
 * RetrievalConfidenceScorer - Deterministik retrieval karar motoru
 * 
 * LLM-based RetrievalDecider yerine deterministik puanlama sistemi.
 * Signal'lara ağırlıklı puan vererek retrieval yapılıp yapılmayacağına karar verir.
 * 
 * PUANLAMA:
 * - STRONG (+0.3): hasRecallCue, hasPersonalReference, hasFollowUpCue
 * - MEDIUM (+0.15): hasAnalyticalCue, hasContextualQuestion, queryLength > 100, clauseCount >= 3
 * - WEAK (+0.1): hasQuestion, hasRecentContext
 * 
 * THRESHOLD: 0.6 (üzerinde retrieval yapılır)
 */

import type { RetrievalIntentSignals } from './types.js';

export interface RetrievalConfidenceResult {
    score: number;           // 0-1 arası
    needsRetrieval: boolean; // score > 0.6 ise true
    reasons: string[];       // Hangi sinyaller tetikledi
}

export interface RetrievalConfidenceConfig {
    threshold: number;       // Default: 0.6
    recentMessagesCount?: number; // Aktif konuşma mesaj sayısı
}

const DEFAULT_CONFIG: RetrievalConfidenceConfig = {
    threshold: 0.6,
    recentMessagesCount: 0,
};

/**
 * Zorunlu retrieval koşullarını kontrol et
 * Bu koşullar sağlanırsa puan ne olursa olsun retrieval yapılır
 */
function checkMandatoryRetrievalConditions(query: string, recentMessagesCount: number = 0): { mandatory: boolean; reasons: string[] } {
    const normalizedQuery = query.toLowerCase();
    const reasons: string[] = [];

    // Zaman referansı
    if (/dun|evvelsi gun|gecen|once|sonra|demin|az once/.test(normalizedQuery)) {
        reasons.push('temporal_reference');
    }

    // Kişisel referans
    if (/yigit|benim|bana|bende/.test(normalizedQuery)) {
        reasons.push('personal_reference');
    }

    // Kısa soru (bağlamsal olabilir)
    if (query.includes('?') && query.trim().length < 30) {
        reasons.push('short_question');
    }

    // Dolaylı referans
    if (/o proje|o konu|o sey|onun hakkinda|bununla ilgili|bu konuda/.test(normalizedQuery)) {
        reasons.push('implicit_reference');
    }

    // Aktif konuşmada kısa yanıt — kullanıcı muhtemelen AI'nın yanıtına cevap veriyor
    // Bu durumda retrieval gerekli çünkü bağlam korunmalı
    if (recentMessagesCount >= 3 && query.trim().length < 20) {
        reasons.push('active_context_response');
    }

    // Örtük bağlam referansı — tek kelimelik yanıtlar
    if (/^(evet|hayır|tamam|olur|peki|tabii|tabi|tabii ki|tabi ki|doğru|dogru|yanlış|yanlis|hay hayır|hay hayir|aynen|aynen öyle|aynen boyle|böyle|boyle|işte|iste|eh|hee|hee evet|hee hayır|hee hayir|ım|hı|hıhı|hmm|heeey|hey|tamamdır|tamm|ok|oke|okay|yes|no|yeah|nope|sure|maybe|belki|galiba|sanırım|sanirim|umutluyum|eminim|bilmiyorum|fikir yok|katılıyorum|katiliyorum|katılmıyorum|katilmiyorum)\b/i.test(query.trim())) {
        reasons.push('implicit_context_reference');
    }

    return {
        mandatory: reasons.length > 0,
        reasons,
    };
}

/**
 * Confidence score hesapla
 */
export function computeRetrievalConfidence(
    signals: RetrievalIntentSignals,
    query: string,
    config?: Partial<RetrievalConfidenceConfig>,
): RetrievalConfidenceResult {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    let score = 0;
    const reasons: string[] = [];

    // STRONG sinyalleri (+0.3 her biri)
    if (signals.hasRecallCue) {
        score += 0.3;
        reasons.push('explicit_recall');
    }
    if (signals.hasPersonalReference) {
        score += 0.3;
        reasons.push('personal_reference');
    }
    if (signals.hasFollowUpCue) {
        score += 0.3;
        reasons.push('temporal_followup');
    }

    // MEDIUM sinyalleri (+0.15 her biri)
    if (signals.hasAnalyticalCue) {
        score += 0.15;
        reasons.push('analytical_needs_context');
    }
    if (signals.hasContextualQuestion) {
        score += 0.15;
        reasons.push('contextual_question');
    }
    if (signals.queryLength > 100) {
        score += 0.15;
        reasons.push('long_query_contextual');
    }
    if (signals.clauseCount >= 3) {
        score += 0.15;
        reasons.push('multi_clause_complex');
    }

    // WEAK sinyalleri (+0.1 her biri)
    if (signals.hasQuestion) {
        score += 0.1;
        reasons.push('question_may_need_context');
    }
    if (signals.hasRecentContext) {
        score += 0.1;
        reasons.push('active_conversation');
    }

    // Cap at 1.0
    score = Math.min(1.0, score);

    // Zorunlu retrieval koşullarını kontrol et
    const mandatory = checkMandatoryRetrievalConditions(query, finalConfig.recentMessagesCount);
    if (mandatory.mandatory) {
        return {
            score: 1.0,
            needsRetrieval: true,
            reasons: [...reasons, ...mandatory.reasons.map(r => `mandatory:${r}`)],
        };
    }

    return {
        score,
        needsRetrieval: score > finalConfig.threshold,
        reasons,
    };
}
