/**
 * Dürtü Eşiği ve Aksiyon Filtresi (Urge Threshold & Action Filter)
 * =================================================================
 *
 * PençeAI'nin otonom düşüncelerini dış dünyaya yansıtıp yansıtmayacağını
 * belirleyen kademeli filtre sistemi.
 *
 * 3 Katmanlı Filtre:
 *   1. Mutlak Kurallar (Hard Logic) — Sessiz saat, arousal taban
 *   2. Deterministik Skorlama — Confirmation bias önlemi (LLM'e bırakılmaz)
 *   3. Geri Bildirim Döngüsü — Kullanıcı davranışına göre uyarlanır
 *
 * Formül:
 *   Skor = (İlgi × 0.6) + (Zaman Hassasiyeti × 0.4) - (İsteksizlik Cezası)
 *   Eşik = baz eşik + (feedback ayarı)
 *   Skor >= Eşik → aksiyon al (send / digest)
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';


// ═══════════════════════════════════════════════════════════
//  Tipler
// ═══════════════════════════════════════════════════════════

/** Aksiyon kararı — düşüncenin kaderi */
export type ActionDecision =
    | 'send'         // Hemen mesaj gönder
    | 'digest'       // Günlük özet havuzuna ekle
    | 'discard'      // At — değmez
    | 'blocked';     // Hard rule tarafından engellendi

/** Filtre sonucu — karar + gerekçeler */
export interface FilterResult {
    decision: ActionDecision;
    score: number;           // Hesaplanan dürtü skoru [0, 1]
    threshold: number;       // O anki aktif eşik [0, 1]
    reasons: string[];       // Kararın nedenleri (debug/log)
    blockedBy?: string;      // Hard rule adı (blocked ise)
}

/** Düşünce değerlendirme girdisi */
export interface ThoughtEvaluation {
    relevanceScore: number;      // Kullanıcı ilgi alanıyla örtüşme [0, 1]
    timeSensitivity: number;     // Zaman hassasiyeti [0, 1] (1 = çok acil)
    sourceType: 'thought_chain' | 'research_report' | 'news' | 'reminder';
}

/** Kullanıcı davranış sinyali */
export interface UserBehaviorSignal {
    type: 'message_read' | 'message_replied' | 'message_ignored' | 'busy_signal' | 'active_chat';
    timestamp: number;        // Unix timestamp ms
    responseTimeMs?: number;  // Yanıt süresi (message_replied için)
}

/** Geri bildirim döngüsü durumu */
export interface FeedbackState {
    thresholdAdjustment: number;  // Eşik ayarı [-0.3, +0.3]
    reluctancePenalty: number;    // İsteksizlik cezası [0, 0.5]
    lastSignalAt: number;        // Son sinyal zamanı (Unix ms)
    signalHistory: UserBehaviorSignal[];  // Son N sinyal
}

// ═══════════════════════════════════════════════════════════
//  Sabitler
// ═══════════════════════════════════════════════════════════

/** UrgeFilter yapılandırma seçenekleri — runtime'da değiştirilebilir */
export interface UrgeFilterConfig {
    quietHoursStart: number;
    quietHoursEnd: number;
    baseThreshold: number;
    digestThreshold: number;
    weightRelevance: number;
    weightTimeSensitivity: number;
    maxReluctancePenalty: number;
    maxThresholdAdjustment: number;
    signalHistorySize: number;
    signalMaxAgeMs: number;
}

/** Varsayılan urge filter yapılandırması */
export const DEFAULT_URGE_CONFIG: Readonly<UrgeFilterConfig> = {
    quietHoursStart: 2,       // 02:00
    quietHoursEnd: 8,         // 08:00
    baseThreshold: 0.45,
    digestThreshold: 0.25,
    weightRelevance: 0.6,
    weightTimeSensitivity: 0.4,
    maxReluctancePenalty: 0.5,
    maxThresholdAdjustment: 0.3,
    signalHistorySize: 20,
    signalMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
};

/** Sessiz saatler (gece) — bu aralıkta mesaj atılmaz */
export const QUIET_HOURS_START = DEFAULT_URGE_CONFIG.quietHoursStart;
export const QUIET_HOURS_END = DEFAULT_URGE_CONFIG.quietHoursEnd;

/** Baz dürtü eşiği — bu skor geçilirse aksiyon al */
export const BASE_THRESHOLD = DEFAULT_URGE_CONFIG.baseThreshold;

/** Digest eşiği — bu skor ile ana eşik arasındaysa günlük özete ekle */
export const DIGEST_THRESHOLD = DEFAULT_URGE_CONFIG.digestThreshold;

/** Skor ağırlıkları */
export const WEIGHT_RELEVANCE = DEFAULT_URGE_CONFIG.weightRelevance;
export const WEIGHT_TIME_SENSITIVITY = DEFAULT_URGE_CONFIG.weightTimeSensitivity;

/** Maksimum isteksizlik cezası */
export const MAX_RELUCTANCE_PENALTY = DEFAULT_URGE_CONFIG.maxReluctancePenalty;

/** Maksimum eşik ayarı (feedback loop sınırı) */
export const MAX_THRESHOLD_ADJUSTMENT = DEFAULT_URGE_CONFIG.maxThresholdAdjustment;

/** Sinyal geçmişi pencere boyutu */
export const SIGNAL_HISTORY_SIZE = DEFAULT_URGE_CONFIG.signalHistorySize;

/** Maksimum yaş için feedback sinyalleri (7 gün ms cinsinden) */
export const SIGNAL_MAX_AGE_MS = DEFAULT_URGE_CONFIG.signalMaxAgeMs;

// ═══════════════════════════════════════════════════════════
//  Saf Fonksiyonlar — Hard Logic (Mutlak Kurallar)
// ═══════════════════════════════════════════════════════════

/**
 * Sessiz saat kontrolü — gece yarısından sonra sessiz periyotta mıyız?
 *
 * @param hour — saat (UTC veya yerel saat)
 * @param userTimezoneOffset — kullanıcının saat dilimi ofseti (örn: +3). Belirtilmezse `hour` yerel saat kabul edilir.
 * @returns true ise mesaj gönderilmez
 */
export function isQuietHour(hour: number, userTimezoneOffset?: number): boolean {
    let localHour = hour;
    if (userTimezoneOffset !== undefined) {
        localHour = (hour + userTimezoneOffset + 24) % 24;
    }
    return localHour >= QUIET_HOURS_START && localHour < QUIET_HOURS_END;
}

/**
 * Tüm hard rule'ları kontrol eder.
 *
 * @param hour — current hour (UTC veya local)
 * @param userTimezoneOffset — kullanıcının timezone offset'i
 * @returns null = geçti, string = engelleyen kural adı
 */
export function checkHardRules(hour: number, userTimezoneOffset?: number): string | null {
    if (isQuietHour(hour, userTimezoneOffset)) {
        return `quiet_hours (${QUIET_HOURS_START}:00-${QUIET_HOURS_END}:00)`;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
//  Saf Fonksiyonlar — Deterministik Skorlama
// ═══════════════════════════════════════════════════════════

/**
 * Dürtü skoru hesaplar — LLM'e bırakılmaz, saf matematik.
 *
 * Formül:
 *   rawScore = (relevance × 0.6) + (timeSensitivity × 0.4)
 *   finalScore = rawScore - reluctancePenalty
 *   clamp(finalScore, 0, 1)
 *
 * @param evaluation — düşünce değerlendirme girdisi
 * @param reluctancePenalty — kullanıcı isteksizlik cezası [0, 0.5]
 * @returns normalizelenmiş skor [0, 1]
 */
export function computeUrgeScore(
    evaluation: ThoughtEvaluation,
    reluctancePenalty: number = 0
): number {
    const rawScore =
        (evaluation.relevanceScore * WEIGHT_RELEVANCE) +
        (evaluation.timeSensitivity * WEIGHT_TIME_SENSITIVITY);

    const finalScore = rawScore - reluctancePenalty;
    return Math.max(0, Math.min(1, finalScore));
}

/**
 * Aktif eşiği hesaplar — baz eşik + feedback ayarı.
 *
 * @param feedbackAdjustment — geri bildirim eşik ayarı [-0.3, +0.3]
 * @returns efektif eşik [0.15, 0.75]
 */
export function computeEffectiveThreshold(feedbackAdjustment: number = 0): number {
    const threshold = BASE_THRESHOLD + feedbackAdjustment;
    return Math.max(0.15, Math.min(0.75, threshold)); // Makul aralıkta tut
}

/**
 * Skor ve eşiğe göre aksiyon kararı verir.
 *
 * @param score     — hesaplanan dürtü skoru
 * @param threshold — aktif eşik
 * @returns ActionDecision
 */
export function decideAction(score: number, threshold: number): ActionDecision {
    if (score >= threshold) return 'send';
    if (score >= DIGEST_THRESHOLD) return 'digest';
    return 'discard';
}

// ═══════════════════════════════════════════════════════════
//  Saf Fonksiyonlar — Geri Bildirim Döngüsü (Feedback Loop)
// ═══════════════════════════════════════════════════════════

/**
 * Kullanıcı davranış sinyaline göre feedback state'i günceller.
 * Immutable — yeni state döner, eskisini değiştirmez.
 *
 * Sinyal Etkileri:
 *   message_replied  → isteksizlik azalır, eşik düşer (konuşkan kullanıcı)
 *   active_chat      → isteksizlik sıfırlanır, eşik düşer
 *   message_read     → hafif isteksizlik artışı (okudu ama yazmadı)
 *   message_ignored  → isteksizlik artar, eşik yükselir
 *   busy_signal      → isteksizlik ciddi artar, eşik ciddi yükselir
 */
export function applyBehaviorSignal(
    state: FeedbackState,
    signal: UserBehaviorSignal
): FeedbackState {
    const newHistory = [...state.signalHistory, signal].slice(-SIGNAL_HISTORY_SIZE);

    let adjDelta = 0;       // Eşik ayarı değişimi
    let penaltyDelta = 0;   // İsteksizlik cezası değişimi

    switch (signal.type) {
        case 'active_chat':
            adjDelta = -0.05;
            penaltyDelta = -state.reluctancePenalty; // Sıfırla
            break;

        case 'message_replied':
            adjDelta = -0.02;
            penaltyDelta = -0.05;
            // Hızlı yanıt bonus
            if (signal.responseTimeMs && signal.responseTimeMs < 60_000) {
                adjDelta -= 0.02; // 1 dk altında yanıt → ekstra eşik düşüşü
            }
            break;

        case 'message_read':
            adjDelta = 0.01;
            penaltyDelta = 0.03;
            break;

        case 'message_ignored':
            adjDelta = 0.03;
            penaltyDelta = 0.08;
            break;

        case 'busy_signal':
            adjDelta = 0.06;
            penaltyDelta = 0.15;
            break;
    }

    const newAdjustment = clamp(
        state.thresholdAdjustment + adjDelta,
        -MAX_THRESHOLD_ADJUSTMENT,
        MAX_THRESHOLD_ADJUSTMENT
    );

    const newPenalty = clamp(
        state.reluctancePenalty + penaltyDelta,
        0,
        MAX_RELUCTANCE_PENALTY
    );

    return {
        thresholdAdjustment: newAdjustment,
        reluctancePenalty: newPenalty,
        lastSignalAt: signal.timestamp,
        signalHistory: newHistory,
    };
}

/**
 * Feedback state'i zamanla doğal olarak nötrleşir (cooldown).
 * Uzun süre sinyal gelmezse isteksizlik ve eşik ayarı yavaşça sıfıra döner.
 *
 * @param state — mevcut feedback state
 * @param hoursSinceLastSignal — son sinyalden bu yana geçen saat
 * @returns güncellenmiş feedback state
 */
export function decayFeedbackState(
    state: FeedbackState,
    hoursSinceLastSignal: number
): FeedbackState {
    if (hoursSinceLastSignal <= 0) return state;

    // Her saat %10 azalma
    const factor = Math.exp(-0.1 * hoursSinceLastSignal);
    const cutoff = Date.now() - SIGNAL_MAX_AGE_MS;

    return {
        ...state,
        thresholdAdjustment: state.thresholdAdjustment * factor,
        reluctancePenalty: state.reluctancePenalty * factor,
        signalHistory: state.signalHistory.filter(s => s.timestamp > cutoff),
    };
}

// ═══════════════════════════════════════════════════════════
//  Ana Filtre Fonksiyonu
// ═══════════════════════════════════════════════════════════

/**
 * Düşünceyi 3 katmanlı filtreden geçirir ve aksiyon kararı verir.
 * Tamamen deterministik — LLM çağrısı yapmaz.
 *
 * Akış:
 *   1. Hard Rules → engelliyorsa → blocked
 *   2. Deterministik Skor → hesapla
 *   3. Feedback-adjusted Threshold → karşılaştır
 *   4. send / digest / discard
 *
 * @param evaluation    — düşünce değerlendirme girdisi
 * @param feedbackState — geri bildirim döngüsü durumu
 * @param currentHour   — mevcut saat (0-23), varsayılan: şimdiki saat
 * @param userTimezoneOffset — kullanıcının saat dilimi ofseti
 * @returns FilterResult
 */
export function filterThought(
    evaluation: ThoughtEvaluation,
    feedbackState: FeedbackState,
    currentHour?: number,
    userTimezoneOffset?: number
): FilterResult {
    const hour = currentHour ?? new Date().getHours();
    const reasons: string[] = [];

    // ── Katman 1: Hard Rules ──────────────────
    const blockedBy = checkHardRules(hour, userTimezoneOffset);
    if (blockedBy) {
        return {
            decision: 'blocked',
            score: 0,
            threshold: 0,
            reasons: [`Hard rule engeli: ${blockedBy}`],
            blockedBy,
        };
    }

    // ── Katman 2: Deterministik Skor ──────────
    const score = computeUrgeScore(evaluation, feedbackState.reluctancePenalty);
    reasons.push(
        `Skor: ${score.toFixed(3)} = ` +
        `(ilgi:${evaluation.relevanceScore.toFixed(2)} × ${WEIGHT_RELEVANCE}) + ` +
        `(zaman:${evaluation.timeSensitivity.toFixed(2)} × ${WEIGHT_TIME_SENSITIVITY}) - ` +
        `(ceza:${feedbackState.reluctancePenalty.toFixed(2)})`
    );

    // ── Katman 3: Feedback-Adjusted Threshold ─
    const threshold = computeEffectiveThreshold(feedbackState.thresholdAdjustment);
    reasons.push(`Eşik: ${threshold.toFixed(3)} = baz:${BASE_THRESHOLD} + ayar:${feedbackState.thresholdAdjustment.toFixed(2)}`);

    // ── Karar ─────────────────────────────────
    const decision = decideAction(score, threshold);
    reasons.push(`Karar: ${decision} (skor:${score.toFixed(3)} vs eşik:${threshold.toFixed(3)})`);

    return { decision, score, threshold, reasons };
}

// ═══════════════════════════════════════════════════════════
//  Feedback State Manager (DB Persistence)
// ═══════════════════════════════════════════════════════════

/** Başlangıç feedback state'i */
export const INITIAL_FEEDBACK_STATE: Readonly<FeedbackState> = {
    thresholdAdjustment: 0,
    reluctancePenalty: 0,
    lastSignalAt: 0,
    signalHistory: [],
};

/**
 * Feedback durumunu veritabanından yükler/kaydeder.
 */
export class FeedbackManager {
    private db: Database.Database;
    private state: FeedbackState;

    constructor(db: Database.Database) {
        this.db = db;
        this.state = this._loadFromDb();
    }

    /** Mevcut feedback state */
    public getState(): FeedbackState {
        return { ...this.state };
    }

    /** Kullanıcı davranış sinyali uygula */
    public applySignal(signal: UserBehaviorSignal): FeedbackState {
        this.state = applyBehaviorSignal(this.state, signal);
        this._saveToDb();

        logger.info(
            `[Feedback] Signal: ${signal.type} → adj:${this.state.thresholdAdjustment.toFixed(3)}, ` +
            `penalty:${this.state.reluctancePenalty.toFixed(3)}`
        );

        return this.getState();
    }

    /** Zaman bazlı decay uygula */
    public applyDecay(): void {
        if (this.state.lastSignalAt === 0) return;

        const hoursSince = (Date.now() - this.state.lastSignalAt) / (1000 * 60 * 60);
        if (hoursSince > 0.5) { // 30 dk'dan fazlaysa decay uygula
            this.state = decayFeedbackState(this.state, hoursSince);
            this._saveToDb();
        }
    }

    /** Sıfırla */
    public reset(): void {
        this.state = { ...INITIAL_FEEDBACK_STATE, signalHistory: [] };
        this._saveToDb();
        logger.info('[Feedback] State reset.');
    }

    // ── DB İşlemleri ──────────────────────────

    private _loadFromDb(): FeedbackState {
        try {
            const row = this.db.prepare(
                `SELECT value FROM settings WHERE key = 'feedback_state'`
            ).get() as { value: string } | undefined;

            if (!row) return { ...INITIAL_FEEDBACK_STATE, signalHistory: [] };
            return JSON.parse(row.value) as FeedbackState;
        } catch {
            return { ...INITIAL_FEEDBACK_STATE, signalHistory: [] };
        }
    }

    private _saveToDb(): void {
        try {
            // Kaydetmeden önce geçmişi sınırla (disk tasarrufu)
            const toSave = {
                ...this.state,
                signalHistory: this.state.signalHistory.slice(-SIGNAL_HISTORY_SIZE),
            };

            this.db.prepare(`
                INSERT INTO settings (key, value, updated_at)
                VALUES ('feedback_state', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            `).run(JSON.stringify(toSave));
        } catch (err) {
            logger.error({ err }, '[Feedback] Failed to save state to DB.');
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  Yardımcı
// ═══════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
