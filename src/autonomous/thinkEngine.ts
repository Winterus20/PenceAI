/**
 * İç Ses Motoru (Inner Monologue / Daydreaming Engine)
 * ====================================================
 *
 * PençeAI'nin otonom düşünme mekanizması.
 * Bir "tohum" (seed) kavramdan başlayarak bellek graph'ında gezinir,
 * Ebbinghaus tazelik filtresiyle sadece güncel anıları toplar,
 * ve bunları bir düşünce zinciri (thought chain) olarak sentezler.
 *
 *   1. Tohum Seçimi (Seed Selection)
 *      → Zaman bağlamı, son etkileşimler
 *
 *   2. Graph-Walk (Çağrışım Gezintisi)
 *      → Tohum bellek → 1-hop komşular → 2-hop komşular
 *      → Her adımda Ebbinghaus retention filtresi uygulanır
 *
 *   3. Düşünce Sentezi (Thought Synthesis)
 *      → Toplanan çağrışımlar → LLM'e gönderilecek düşünce
 *
 * Hiçbir LLM çağrısı yapmaz — sadece veri toplar ve yapıyı hazırlar.
 * LLM entegrasyonu üst katmanda (agent/runtime) yapılacaktır.
 */

import type { MemoryManager } from '../memory/manager.js';
import type { MemoryRow } from '../memory/types.js';
import { computeRetention, daysSinceAccess } from '../memory/ebbinghaus.js';
import { logger } from '../utils/logger.js';

/** Basit duygusal bağlam etiketi (VAD bağımlılığı olmadan) */
export interface EmotionalContext {
    primary: string;       // Ana duygu etiketi (ör: 'Nötr', 'Meraklı')
    intensity: 'low' | 'medium' | 'high';
    description: string;   // Kısa açıklama
}

/** Düşünce günlüğü girdisi — tekrar önleme ve pattern çıkarma için */
export interface ThoughtLogRecord {
    id: number;
    seedMemoryId: number;
    seedType: SeedType;
    associationCount: number;
    totalRetentionScore: number;
    emotionalPrimary: string;
    generatedAt: string;        // ISO 8601
    relevanceScore: number | null; // LLM'den gelen relevance skoru
    timeSensitivity: number | null;
}

/** Zaman bağlamı — günün saatine göre düşünce stratejisi */
export interface TimeContext {
    period: 'morning' | 'afternoon' | 'evening' | 'night';
    dayOfWeek: number;         // 0=Pazar, 6=Cumartesi
    isWeekend: boolean;
    suggestedStrategy: string;  // Önerilen düşünce stratejisi
}

// ═══════════════════════════════════════════════════════════
//  Tipler
// ═══════════════════════════════════════════════════════════

/** Tohum (Seed) türleri — düşüncenin başlangıç noktası */
export type SeedType =
    | 'time_context'     // Saat/gün bilgisinden türetilmiş bağlam
    | 'recent_memory'    // Son erişilen anılardan biri
    | 'high_importance'  // Yüksek önem puanlı bir anı
    | 'random_walk';     // Rastgele seçim (keşif modu)

/** Tohum bilgisi */
export interface ThoughtSeed {
    type: SeedType;
    memoryId: number;       // Başlangıç bellek ID'si
    content: string;        // Tohum belleğin içeriği
    reason: string;         // Neden bu tohum seçildi (debug/log amaçlı)
}

/** Graph-Walk sırasında toplanan bir çağrışım */
export interface Association {
    memoryId: number;
    content: string;
    category: string;
    importance: number;
    retention: number;       // Ebbinghaus retention skoru [0, 1]
    hopDistance: number;      // Tohum'dan kaç adım uzakta (1 veya 2)
    relationDescription: string; // Bağlantı açıklaması
    confidence: number;      // İlişki güven skoru
}

/** Sonuç: birleştirilmiş düşünce zinciri */
export interface ThoughtChain {
    seed: ThoughtSeed;
    associations: Association[];
    emotionalContext: EmotionalContext;
    generatedAt: string;     // ISO 8601 timestamp
    totalRetentionScore: number; // Toplanan anıların ortalama tazeliği
}

/** İç ses günlüğü — veritabanına ve/veya loglara kaydedilir */
export interface ThoughtLogEntry {
    thought: ThoughtChain;
    prompt: string;          // LLM'e gönderilecek sentezlenmiş düşünce prompt'u
}

// ═══════════════════════════════════════════════════════════
//  Sabitler
// ═══════════════════════════════════════════════════════════

/** Ebbinghaus tazelik eşiği — bunun altındaki anılar "bayat" kabul edilir */
export const FRESHNESS_THRESHOLD = 0.3;

/** Graph-Walk'ta maksimum hop sayısı */
export const MAX_HOP_DEPTH = 2;

/** Her hop'ta alınacak maksimum komşu sayısı */
export const MAX_NEIGHBORS_PER_HOP = 5;

/** Toplanan maksimum çağrışım sayısı */
export const MAX_ASSOCIATIONS = 8;

/** Minimum ilişki güven eşiği — bunun altındaki ilişkiler takip edilmez */
export const MIN_RELATION_CONFIDENCE = 0.25; // 0.35'ten 0.25'e düşürüldü

/** Think engine yapılandırma seçenekleri */
export interface ThinkEngineConfig {
    freshnessThreshold?: number;       // Default: 0.3
    maxHopDepth?: number;              // Default: 2
    maxAssociations?: number;          // Default: 8
    maxNeighborsPerHop?: number;       // Default: 5
    minRelationConfidence?: number;    // Default: 0.25
    seedCooldownMinutes?: number;      // Default: 30
    thoughtLogMaxEntries?: number;     // Default: 100
    adaptiveHopEnabled?: boolean;     // Default: true
}

/** Varsayılan yapılandırma */
export const DEFAULT_THINK_CONFIG: Readonly<ThinkEngineConfig> = {
    freshnessThreshold: FRESHNESS_THRESHOLD,
    maxHopDepth: MAX_HOP_DEPTH,
    maxAssociations: MAX_ASSOCIATIONS,
    maxNeighborsPerHop: MAX_NEIGHBORS_PER_HOP,
    minRelationConfidence: MIN_RELATION_CONFIDENCE,
    seedCooldownMinutes: 30,
    thoughtLogMaxEntries: 100,
    adaptiveHopEnabled: true,
};

/** Yönlendirme soru şablonları — her düşüncede farklı bir soru seçilir */
export const REFLECTION_QUESTION_TEMPLATES = [
    [
        "Bu çağrışımlar seni neye götürüyor? Yeni bir merak noktası var mı?",
        "Bu düşünce kullanıcıyla paylaşılacak kadar değerli mi?",
        "Bir araştırma konusu (sub-agent görevi) çıkıyor mu?"
    ],
    [
        "Bu anılar arasında gizli bir bağlantı var mı? Kullanıcı farkında olmadan bir pattern oluşturuyor mu?",
        "Bu bilgiler zamanla değişmiş mi? Kullanıcının alışkanlıkları hakkında ne söylüyor?",
        "Kullanıcının bu konudaki duygusal tonu ne? Olumlu mu, olumsuz mu, nötr mü?"
    ],
    [
        "Bu çağrışımlar kullanıcının ilgi alanlarıyla ne kadar örtüşüyor?",
        "Bu konuda kullanıcıya proaktif bir öneri sunulmalı mı?",
        "Bu bilgi gelecekte hangi durumlarda faydalı olabilir?"
    ],
    [
        "Kullanıcının bu konudaki bilgi seviyesi ne? Yeni bir şey mi öğreniyor, yoksa bildiğini mi tekrar ediyor?",
        "Bu anılar kullanıcının hedefleriyle ilgili mi? Destekleyici bir rol oynuyor mu?",
        "Bu konuda derinlemesine araştırma yapılmalı mı?"
    ],
    [
        "Bu düşünce kullanıcının günlük rutinine uygun mu?",
        "Kullanıcı şu anda meşgul görünüyor mu, yoksa bu mesajı almak için uygun mu?",
        "Bu bilgi acil mi yoksa bekleyebilir mi?"
    ]
];

// ═══════════════════════════════════════════════════════════
//  Zaman Bağlamı (Time Context)
// ═══════════════════════════════════════════════════════════

/**
 * Mevcut zaman bağlamını hesaplar.
 * Günün saatine ve haftanın gününe göre düşünce stratejisi önerir.
 */
export function getTimeContext(now?: Date): TimeContext {
    const time = now ?? new Date();
    const hour = time.getHours();
    const dayOfWeek = time.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let period: TimeContext['period'];
    let suggestedStrategy: string;

    if (hour >= 6 && hour < 12) {
        period = 'morning';
        suggestedStrategy = isWeekend
            ? 'Hafta sonu sabahı — rahat konular, hobiler, uzun vadeli planlar'
            : 'Sabah rutini — günün planı, devam eden görevler, dünkü takip noktaları';
    } else if (hour >= 12 && hour < 18) {
        period = 'afternoon';
        suggestedStrategy = isWeekend
            ? 'Öğleden sonra — keşif, yeni konular, merak noktaları'
            : 'Öğleden sonra — aktif görevler, teknik derinleşme, problem çözme';
    } else if (hour >= 18 && hour < 23) {
        period = 'evening';
        suggestedStrategy = isWeekend
            ? 'Akşam — sosyal bağlam, eğlence, günlük değerlendirme'
            : 'Akşam — gün sonu değerlendirmesi, yarınki planlar, öğrenilen dersler';
    } else {
        period = 'night';
        suggestedStrategy = 'Gece — derin düşünce, felsefi sorular, yaratıcı bağlantılar';
    }

    return { period, dayOfWeek, isWeekend, suggestedStrategy };
}

// ═══════════════════════════════════════════════════════════
//  Duygusal Bağlam Çıkarma (Emotion Extraction)
// ═══════════════════════════════════════════════════════════

/** Duygu kalıpları — anahtar kelimeler → duygu etiketleri */
const EMOTION_PATTERNS: Array<{ keywords: string[]; primary: string; intensity: EmotionalContext['intensity'] }> = [
    { keywords: ['teşekkür', 'sağol', 'süper', 'mükemmel', 'awesome', 'great', 'thanks', 'happy'], primary: 'Memnun', intensity: 'medium' },
    { keywords: ['merak', 'nasıl', 'neden', 'niçin', 'acaba', 'ilginç', 'curious', 'wonder', 'interesting'], primary: 'Meraklı', intensity: 'medium' },
    { keywords: ['endişe', 'kaygı', 'dert', 'sorun', 'problem', 'korku', 'worry', 'anxious', 'concerned', 'afraid'], primary: 'Endişeli', intensity: 'high' },
    { keywords: ['kızgın', 'öfkeli', 'sinirli', 'öfke', 'lanet', 'angry', 'furious', 'mad', 'upset'], primary: 'Öfkeli', intensity: 'high' },
    { keywords: ['üzgün', 'mutsuz', 'kederli', 'ağla', 'sad', 'unhappy', 'disappointed', 'cry'], primary: 'Üzgün', intensity: 'medium' },
    { keywords: ['heyecan', 'coşku', 'müjde', 'tutku', 'harika', 'excited', 'thrilled', 'passionate'], primary: 'Heyecanlı', intensity: 'high' },
    { keywords: ['yorgun', 'bıktı', 'usandı', 'bunalım', 'tükenmiş', 'tired', 'exhausted', 'burnout', 'overwhelmed'], primary: 'Yorgun', intensity: 'low' },
];

/**
 * Son mesajlardan duygusal bağlam çıkarır.
 * Basit anahtar kelime eşleşmesi ile çalışır — VAD modeli gerektirmez.
 */
export function extractEmotionalContext(recentMessages: Array<{ role: string; content: string }>): EmotionalContext {
    if (recentMessages.length === 0) {
        return { primary: 'Nötr', intensity: 'low', description: 'Yeni konuşma — duygusal bağlam yok.' };
    }

    // Son 5 kullanıcı mesajını analiz et
    const userMessages = recentMessages
        .filter(m => m.role === 'user')
        .slice(-5)
        .map(m => m.content.toLowerCase());

    if (userMessages.length === 0) {
        return { primary: 'Nötr', intensity: 'low', description: 'Kullanıcı mesajı yok.' };
    }

    const allText = userMessages.join(' ');

    // En çok eşleşen duygu kalıbını bul
    let bestMatch: { primary: string; intensity: EmotionalContext['intensity']; matchCount: number } | null = null;

    for (const pattern of EMOTION_PATTERNS) {
        let matchCount = 0;
        for (const keyword of pattern.keywords) {
            // Tek kelimeler için word boundary, çok kelimeler için basit includes
            if (keyword.includes(' ')) {
                if (allText.includes(keyword)) matchCount++;
            } else {
                const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                const matches = allText.match(regex);
                if (matches) matchCount += matches.length;
            }
        }
        if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.matchCount)) {
            bestMatch = { primary: pattern.primary, intensity: pattern.intensity, matchCount };
        }
    }

    if (bestMatch) {
        const descriptions: Record<string, string> = {
          'Memnun': 'Kullanıcı memnun veya teşekkür ediyor.',
          'Meraklı': 'Kullanıcı merak içinde, sorular soruyor.',
          'Endişeli': 'Kullanıcı endişeli veya kaygılı görünüyor.',
          'Öfkeli': 'Kullanıcı öfkeli veya hayal kırıklığı yaşıyor.',
          'Üzgün': 'Kullanıcı üzgün veya kederli.',
          'Heyecanlı': 'Kullanıcı heyecanlı veya coşkulu.',
          'Yorgun': 'Kullanıcı yorgun veya bunalmış görünüyor.',
        };
        return {
          primary: bestMatch.primary,
          intensity: bestMatch.intensity,
          description: descriptions[bestMatch.primary] ?? 'Duygusal bağlam algılandı.',
        };
    }

    return { primary: 'Nötr', intensity: 'low', description: 'Belirgin duygu algılanmadı — nötr konuşma tonu.' };
}

// ═══════════════════════════════════════════════════════════
//  Düşünce Günlüğü (Thought Log)
// ═══════════════════════════════════════════════════════════

/** Bellek içi düşünce günlüğü — tekrar önleme ve pattern çıkarma (oturum bazlı) */
class ThoughtLog {
    private entries: ThoughtLogRecord[] = [];
    private maxEntries: number;
    private sessionId: string;

    constructor(maxEntries: number = 100, sessionId: string = 'default') {
        this.maxEntries = maxEntries;
        this.sessionId = sessionId;
    }

    /** Oturum kimliğini getir */
    getSessionId(): string {
        return this.sessionId;
    }

    /** Yeni düşünce günlük girdisi ekle */
    record(entry: Omit<ThoughtLogRecord, 'id'>): void {
        const id = this.entries.length > 0
            ? Math.max(...this.entries.map(e => e.id)) + 1
            : 1;
        this.entries.push({ ...entry, id });

        // Kapasite aşılırsa en eski girdileri sil
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
    }

    /** Bir bellek ID'si son N düşüncede kullanıldı mı? (tekrar önleme) */
    isRecentlyUsed(memoryId: number, lookbackCount: number = 5): boolean {
        const recent = this.entries.slice(-lookbackCount);
        return recent.some(e => e.seedMemoryId === memoryId);
    }

    /** Son N düşüncenin ortalama relevance skoru */
    getAverageRelevance(count: number = 10): number {
        const recent = this.entries.slice(-count);
        const scored = recent.filter(e => e.relevanceScore !== null);
        if (scored.length === 0) return 0.5; // Bilgi yoksa varsayılan
        return scored.reduce((sum, e) => sum + (e.relevanceScore ?? 0), 0) / scored.length;
    }

    /** En çok tekrar eden duygu pattern'ini getir */
    getDominantEmotionPattern(count: number = 20): string | null {
        const recent = this.entries.slice(-count);
        if (recent.length < 3) return null;

        const emotionCounts = new Map<string, number>();
        for (const entry of recent) {
            emotionCounts.set(entry.emotionalPrimary, (emotionCounts.get(entry.emotionalPrimary) ?? 0) + 1);
        }

        let dominant: string | null = null;
        let maxCount = 0;
        for (const [emotion, cnt] of emotionCounts) {
            if (cnt > maxCount && cnt >= 3) {
                dominant = emotion;
                maxCount = cnt;
            }
        }
        return dominant;
    }

    /** Son N düşünce günlüğünü getir */
    getRecent(count: number = 10): ThoughtLogRecord[] {
        return this.entries.slice(-count);
    }

    /** Son düşünce günlüğü girdisine LLM geri bildirimini kaydet */
    updateLastFeedback(relevanceScore: number, timeSensitivity: number): void {
        if (this.entries.length === 0) return;
        const last = this.entries[this.entries.length - 1];
        last.relevanceScore = relevanceScore;
        last.timeSensitivity = timeSensitivity;
    }
}

// Oturum bazlı düşünce günlüğü havuzu — eşzamanlı oturumları güvenli şekilde yönetir
const thoughtLogPool = new Map<string, ThoughtLog>();

/** Son erişim zamanı takibi — LRU temizleme için */
const thoughtLogLastAccess = new Map<string, number>();

/** Oturum kimliğine göre düşünce günlüğü getir veya oluştur */
function getThoughtLog(sessionId: string = 'default', maxEntries?: number): ThoughtLog {
    const key = sessionId;
    if (!thoughtLogPool.has(key)) {
        thoughtLogPool.set(key, new ThoughtLog(maxEntries ?? DEFAULT_THINK_CONFIG.thoughtLogMaxEntries ?? 100, sessionId));
    }
    thoughtLogLastAccess.set(key, Date.now());
    return thoughtLogPool.get(key)!;
}

/** Eski/terk edilmiş oturum günlüklerini temizle — LRU yaklaşımı (bellek sızıntısı önleme) */
export function cleanupStaleThoughtLogs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    // Son erişim zamanı maxAgeMs'den eski olan günlükleri sil
    for (const [key, lastAccess] of thoughtLogLastAccess) {
        if (now - lastAccess > maxAgeMs) {
            thoughtLogPool.delete(key);
            thoughtLogLastAccess.delete(key);
            cleaned++;
        }
    }

    // Güvenlik limiti: 100'den fazla günlük varsa, en eski erişimlileri temizle
    if (thoughtLogPool.size > 100) {
        const sorted = Array.from(thoughtLogLastAccess.entries())
            .sort((a, b) => a[1] - b[1]); // En eski erişimliler önce
        const toRemove = thoughtLogPool.size - 50; // 50'ye kadar düşür
        for (let i = 0; i < toRemove && i < sorted.length; i++) {
            const key = sorted[i][0];
            thoughtLogPool.delete(key);
            thoughtLogLastAccess.delete(key);
            cleaned++;
        }
    }

    return cleaned;
}

// ═══════════════════════════════════════════════════════════
//  Tohum Seçimi (Seed Selection)
// ═══════════════════════════════════════════════════════════

/**
 * Düşüncenin başlangıç noktasını seçer.
 * Zaman bağlamı ve düşünce günlüğü ile zenginleştirilmiş strateji.
 *
 * Strateji Sırası:
 *   0. Zaman bağlamı stratejisi (sabah rutin, akşam değerlendirme)
 *   1. Son erişilen taze bir anı (son 24 saat, retention > threshold)
 *   2. Yüksek önemli bir anı (importance >= 7)
 *   3. Rastgele aktif bir anı (keşif modu — fallback)
 */
export function selectSeed(
    manager: MemoryManager,
    recentlySelectedSeedId?: number,
    cooldownMinutes?: number,
    config?: ThinkEngineConfig,
    sessionId?: string,
): ThoughtSeed | null {
    const db = manager.getDatabase();
    const effectiveCooldown = cooldownMinutes ?? config?.seedCooldownMinutes ?? 30;
    const timeContext = getTimeContext();
    const log = getThoughtLog(sessionId);

    // Eğer recentlySelectedSeedId verilmişse, bu belleğin son erişim zamanını kontrol et
    if (recentlySelectedSeedId) {
        const seedInfo = db.prepare(`
            SELECT last_accessed FROM memories WHERE id = ?
        `).get(recentlySelectedSeedId) as { last_accessed: string } | undefined;

        if (seedInfo && seedInfo.last_accessed) {
            const lastAccessed = new Date(seedInfo.last_accessed).getTime();
            const elapsed = Date.now() - lastAccessed;
            const cooldownMs = effectiveCooldown * 60 * 1000;

            if (elapsed < cooldownMs) {
                logger.debug(`[ThinkEngine] Seed #${recentlySelectedSeedId} cooldown'da (${Math.ceil((cooldownMs - elapsed) / 60000)} dk kaldı)`);
            }
        }
    }

    // Strateji 0: Zaman bağlamı stratejisi — günün saatine göre önceliklendirme
    if (timeContext.period === 'morning' && !timeContext.isWeekend) {
        // Sabah rutini — devam eden görevler ve planları öne çıkar
        const morningSQL = `
            SELECT id, content, importance, stability, last_accessed, category
            FROM memories
            WHERE is_archived = 0
                AND category IN ('project', 'task', 'event')
                AND last_accessed > datetime('now', '-7 days')
                ${recentlySelectedSeedId ? 'AND id != ?' : ''}
            ORDER BY importance DESC, last_accessed DESC
            LIMIT 3
        `;
        const morningMemories = (recentlySelectedSeedId
            ? db.prepare(morningSQL).all(recentlySelectedSeedId)
            : db.prepare(morningSQL).all()
        ) as Array<MemoryRow>;

        for (const mem of morningMemories) {
            if (log.isRecentlyUsed(mem.id)) continue;
            const retention = computeRetention(
                mem.stability ?? mem.importance * 2.0,
                daysSinceAccess(mem.last_accessed)
            );
            if (retention >= FRESHNESS_THRESHOLD * 0.7) {
                return {
                    type: 'time_context',
                    memoryId: mem.id,
                    content: mem.content,
                    reason: `Sabah rutini — ${timeContext.suggestedStrategy} (retention: ${retention.toFixed(2)})`,
                };
            }
        }
    } else if (timeContext.period === 'evening') {
        // Akşam değerlendirmesi — gün boyunca konuşulanları özetle
        const eveningSQL = `
            SELECT id, content, importance, stability, last_accessed
            FROM memories
            WHERE is_archived = 0
                AND last_accessed > datetime('now', '-1 day')
                AND category NOT IN ('knowledge', 'concept')
                ${recentlySelectedSeedId ? 'AND id != ?' : ''}
            ORDER BY last_accessed DESC
            LIMIT 5
        `;
        const eveningMemories = (recentlySelectedSeedId
            ? db.prepare(eveningSQL).all(recentlySelectedSeedId)
            : db.prepare(eveningSQL).all()
        ) as Array<MemoryRow>;

        for (const mem of eveningMemories) {
            if (log.isRecentlyUsed(mem.id)) continue;
            const retention = computeRetention(
                mem.stability ?? mem.importance * 2.0,
                daysSinceAccess(mem.last_accessed)
            );
            if (retention >= FRESHNESS_THRESHOLD * 0.5) {
                return {
                    type: 'time_context',
                    memoryId: mem.id,
                    content: mem.content,
                    reason: `Akşam değerlendirmesi — ${timeContext.suggestedStrategy} (retention: ${retention.toFixed(2)})`,
                };
            }
        }
    }

    // Strateji 1: Son erişilen taze anı (son 24 saat)
    const recentMemorySQL = `
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0
            AND last_accessed IS NOT NULL
            AND last_accessed > datetime('now', '-1 day')
            ${recentlySelectedSeedId ? 'AND id != ?' : ''}
        ORDER BY last_accessed DESC
        LIMIT 5
    `;
    const recentMemory = (recentlySelectedSeedId
        ? db.prepare(recentMemorySQL).all(recentlySelectedSeedId)
        : db.prepare(recentMemorySQL).all()
    ) as Array<MemoryRow>;

    for (const mem of recentMemory) {
        // Düşünce günlüğünde tekrar kontrolü
        if (log.isRecentlyUsed(mem.id)) continue;
        const retention = computeRetention(
            mem.stability ?? mem.importance * 2.0,
            daysSinceAccess(mem.last_accessed)
        );
        if (retention >= FRESHNESS_THRESHOLD) {
            return {
                type: 'recent_memory',
                memoryId: mem.id,
                content: mem.content,
                reason: `Son erişilen taze anı (retention: ${retention.toFixed(2)})`,
            };
        }
    }

    // Strateji 2: Yüksek önemli anı
    const importantMemorySQL = `
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0 AND importance >= 7
            ${recentlySelectedSeedId ? 'AND id != ?' : ''}
        ORDER BY importance DESC, RANDOM()
        LIMIT 1
    `;
    const importantMemory = (recentlySelectedSeedId
        ? db.prepare(importantMemorySQL).get(recentlySelectedSeedId)
        : db.prepare(importantMemorySQL).get()
    ) as MemoryRow | undefined;

    if (importantMemory) {
        const retention = computeRetention(
            importantMemory.stability ?? importantMemory.importance * 2.0,
            daysSinceAccess(importantMemory.last_accessed)
        );
        if (retention >= FRESHNESS_THRESHOLD * 0.5) { // Önemli anılar için eşik yarıya iner
            return {
                type: 'high_importance',
                memoryId: importantMemory.id,
                content: importantMemory.content,
                reason: `Yüksek öneme sahip anı (importance: ${importantMemory.importance}, retention: ${retention.toFixed(2)})`,
            };
        }
    }

    // Strateji 3: Rastgele aktif anı (keşif — fallback)
    const randomMemorySQL = `
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0
            ${recentlySelectedSeedId ? 'AND id != ?' : ''}
        ORDER BY RANDOM()
        LIMIT 1
    `;
    const randomMemory = (recentlySelectedSeedId
        ? db.prepare(randomMemorySQL).get(recentlySelectedSeedId)
        : db.prepare(randomMemorySQL).get()
    ) as MemoryRow | undefined;

    if (randomMemory) {
        return {
            type: 'random_walk',
            memoryId: randomMemory.id,
            content: randomMemory.content,
            reason: 'Rastgele keşif modunda seçildi (diğer stratejiler tohum bulamadı)',
        };
    }

    // Hiç anı yoksa null dön
    return null;
}

// ═══════════════════════════════════════════════════════════
//  Graph-Walk (Çağrışım Gezintisi)
// ═══════════════════════════════════════════════════════════

/**
 * Tohum bellek noktasından başlayarak graph üzerinde Breadth-First-Search (BFS) yapar.
 * Her adımda Ebbinghaus tazelik filtresi uygulanır.
 *
 * @param manager         — MemoryManager örneği
 * @param seedId     — Başlangıç bellek ID'si
 * @param maxDepth   — Maksimum hop derinliği (varsayılan: 2)
 * @returns Tazelik filtresinden geçen çağrışım listesi
 */
/**
 * Adaptif hop derinliği hesaplar.
 * Son düşüncelerin ortalama relevance skoruna göre:
 *   - Yüksek relevance (>= 0.6) → 1 hop (odaklanmış, az çağrışım)
 *   - Orta relevance (0.3-0.6) → 2 hop (dengeli)
 *   - Düşük relevance (< 0.3) → 3 hop (geniş keşif — yeni bağlantılar ara)
 */
export function computeAdaptiveHopDepth(config?: ThinkEngineConfig, sessionId?: string): number {
    if (!config?.adaptiveHopEnabled) return MAX_HOP_DEPTH;

    const log = getThoughtLog(sessionId);
    const avgRelevance = log.getAverageRelevance(10);

    if (avgRelevance >= 0.6) return 1;       // Yüksek relevance — odaklanmış
    if (avgRelevance >= 0.3) return 2;       // Orta relevance — dengeli
    const maxAllowed = config?.maxHopDepth ?? MAX_HOP_DEPTH;
    return Math.min(3, maxAllowed);          // Düşük relevance — geniş keşif (config sınırıyla)
}

export function graphWalk(
    manager: MemoryManager,
    seedId: number,
    maxDepth?: number,
    config?: ThinkEngineConfig,
    sessionId?: string,
): Association[] {
    // Adaptif hop derinliği — config'de açıksa dinamik hesapla
    const adaptiveDepth = config?.adaptiveHopEnabled ? computeAdaptiveHopDepth(config, sessionId) : MAX_HOP_DEPTH;
    const effectiveMaxDepth = maxDepth ?? adaptiveDepth;
    const effectiveMaxAssociations = config?.maxAssociations ?? MAX_ASSOCIATIONS;
    const effectiveMaxNeighbors = config?.maxNeighborsPerHop ?? MAX_NEIGHBORS_PER_HOP;
    const visited = new Set<number>([seedId]);
    const associations: Association[] = [];

    // BFS: her derinlik katmanı ayrı işlenir
    let currentLayer = [seedId];

    for (let hop = 1; hop <= effectiveMaxDepth; hop++) {
        const nextLayer: number[] = [];

        for (const nodeId of currentLayer) {
            // Hop bazlı güven eşiği: 1-hop için daha düşük, 2-hop için daha yüksek
            const hopConfidenceThreshold = hop === 1 ? 0.25 : 0.35;

            // 1-hop komşuları al (confidence sıralı)
            const neighbors = manager.getAutonomousGraphWalkNeighbors(
                nodeId,
                hopConfidenceThreshold,
                effectiveMaxNeighbors
            );

            for (const neighbor of neighbors) {
                if (visited.has(neighbor.id)) continue;
                visited.add(neighbor.id);

                // Ebbinghaus tazelik kontrolü — hop bazlı eşik ile
                const retention = computeRetention(
                    neighbor.stability ?? neighbor.importance * 2.0,
                    daysSinceAccess(neighbor.last_accessed)
                );

                // 1-hop komşular için daha düşük retention eşiği (daha fazla keşif)
                const hopFreshnessThreshold = hop === 1 ? FRESHNESS_THRESHOLD * 0.7 : FRESHNESS_THRESHOLD;

                if (retention < hopFreshnessThreshold) {
                    logger.debug(
                        `[ThinkEngine] Skipped memory #${neighbor.id} — stale (retention: ${retention.toFixed(2)} < ${hopFreshnessThreshold.toFixed(2)})`
                    );
                    continue; // Bayat anı — atla
                }

                associations.push({
                    memoryId: neighbor.id,
                    content: neighbor.content,
                    category: neighbor.category,
                    importance: neighbor.importance,
                    retention,
                    hopDistance: hop,
                    relationDescription: neighbor.relation_description || '',
                    confidence: neighbor.relation_confidence ?? 0,
                });

                nextLayer.push(neighbor.id);

                // Toplam çağrışım limitine ulaştıysak dur
                if (associations.length >= effectiveMaxAssociations) break;
            }

            if (associations.length >= effectiveMaxAssociations) break;
        }

        currentLayer = nextLayer;

        if (associations.length >= effectiveMaxAssociations || currentLayer.length === 0) break;
    }

    // Tazelik × önem × güven sırasına göre sırala
    associations.sort((a, b) => {
        const scoreA = a.retention * a.importance * a.confidence;
        const scoreB = b.retention * b.importance * b.confidence;
        return scoreB - scoreA;
    });

    return associations;
}

// ═══════════════════════════════════════════════════════════
//  Düşünce Zinciri Oluşturma (Thought Chain Builder)
// ═══════════════════════════════════════════════════════════

/**
 * Tohum + Graph-Walk sonuçlarını birleştirerek düşünce zinciri oluşturur.
 *
 * @param seed           — Başlangıç tohumu
 * @param associations   — Graph-Walk'tan gelen çağrışımlar
 * @param emotion        — Mevcut duygusal bağlam
 * @returns ThoughtChain
 */
export function buildThoughtChain(
    seed: ThoughtSeed,
    associations: Association[],
    emotion: EmotionalContext
): ThoughtChain {
    const totalRetention = associations.length > 0
        ? associations.reduce((sum, a) => sum + a.retention, 0) / associations.length
        : 0;

    return {
        seed,
        associations,
        emotionalContext: emotion,
        generatedAt: new Date().toISOString(),
        totalRetentionScore: totalRetention,
    };
}

// ═══════════════════════════════════════════════════════════
//  Düşünce Prompt Sentezi (Thought-to-Prompt)
// ═══════════════════════════════════════════════════════════

/**
 * Düşünce zincirini LLM'e gönderilecek bir prompt'a çevirir.
 * Bu prompt, AI'nın "iç sesini" temsil eder — dışarıya yansıtılmaz,
 * sadece karar verme ve merak üretme sürecinde kullanılır.
 *
 * @param chain — Düşünce zinciri
 * @returns LLM-ready iç ses prompt'u
 */
export function synthesizeThoughtPrompt(
    chain: ThoughtChain,
    questionTemplateIndex?: number
): string {
    const { seed, associations, emotionalContext } = chain;

    // İç ses başlığı
    let prompt = `## İç Ses Notu (Dahili Düşünce)\n\n`;
    prompt += `Şu anki ruh halin: **${emotionalContext.primary}** (${emotionalContext.intensity} yoğunlukta)\n`;
    prompt += `${emotionalContext.description}\n\n`;

    // Tohum bağlamı
    prompt += `### Düşüncenin Başlangıç Noktası\n`;
    prompt += `"${seed.content}"\n`;
    prompt += `_(${seed.reason})_\n\n`;

    // Çağrışımlar
    if (associations.length > 0) {
        prompt += `### Çağrışım Zinciri\n`;
        prompt += `Bu düşünce seni şu anılara götürdü:\n\n`;

        for (const assoc of associations) {
            const freshLabel = assoc.retention > 0.7 ? '🟢 çok taze'
                : assoc.retention > 0.5 ? '🟡 taze'
                    : '🟠 solmaya başlıyor';

            prompt += `- **"${assoc.content.length > 80 ? assoc.content.substring(0, 77) + '...' : assoc.content}"**\n`;
            prompt += `  _(${assoc.hopDistance}. derece bağlantı · ${freshLabel} · önem: ${assoc.importance}/10)_\n`;

            if (assoc.relationDescription) {
                prompt += `  Bağlantı: ${assoc.relationDescription}\n`;
            }
            prompt += `\n`;
        }
    } else {
        prompt += `### Çağrışım Zinciri\n`;
        prompt += `Bu düşünceye bağlı taze bir çağrışım bulunamadı. Yalnız bir düşünce.\n\n`;
    }

    // Yönlendirme — farklı soru şablonları kullan
    const templateIdx = questionTemplateIndex !== undefined
        ? questionTemplateIndex % REFLECTION_QUESTION_TEMPLATES.length
        : Math.floor(Math.random() * REFLECTION_QUESTION_TEMPLATES.length);
    const questions = REFLECTION_QUESTION_TEMPLATES[templateIdx];

    prompt += `---\n`;
    prompt += `Bu iç ses notunu kullanarak:\n`;
    prompt += `1. ${questions[0]}\n`;
    prompt += `2. ${questions[1]}\n`;
    prompt += `3. ${questions[2]}\n`;

    // JSON format zorunluluğu
    prompt += `\n\n---\n\nÖNEMLİ: Yanıtını SADECE aşağıdaki JSON formatında ver. Başka hiçbir metin yazma.\n\n\`\`\`json\n{\n  "relevance": 0.0-1.0,\n  "timeSensitivity": 0.0-1.0,\n  "reasoning": "Kısa açıklama"\n}\n\`\`\``;

    return prompt;
}

// ═══════════════════════════════════════════════════════════
//  Ana Düşünme Fonksiyonu (think)
// ═══════════════════════════════════════════════════════════

/**
 * Tek bir düşünme döngüsü çalıştırır.
 * Bu fonksiyon saf ve senkrondur — LLM çağrısı yapmaz.
 *
 * Akış:
 *   1. Tohum seç (selectSeed)
 *   2. Graph-Walk ile çağrışım topla (graphWalk)
 *   3. Düşünce zinciri oluştur (buildThoughtChain)
 *   4. LLM prompt'u sentezle (synthesizeThoughtPrompt)
 *
 * @param db                     — Veritabanı bağlantısı
 * @param emotion                — Duygusal bağlam etiketi
 * @param recentlySelectedSeedId — Son seçilen seed ID'si (tekrar seçimini önlemek için)
 * @param seedCooldownMinutes    — Seed cooldown süresi (dakika)
 * @returns ThoughtLogEntry | null (düşünecek anı yoksa null)
 */
export function think(
    manager: MemoryManager,
    emotion?: EmotionalContext,
    recentlySelectedSeedId?: number,
    seedCooldownMinutes?: number,
    questionTemplateIndex?: number,
    config?: ThinkEngineConfig,
    sessionId?: string,
    recentMessages?: Array<{ role: string; content: string }>,
): ThoughtLogEntry | null {
    // Duygusal bağlam: dışarıdan verilmediyse son mesajlardan çıkar
    const effectiveEmotion = emotion ?? 
        (recentMessages ? extractEmotionalContext(recentMessages) : { primary: 'Nötr', intensity: 'low' as const, description: 'Duygusal bağlam belirtilmedi.' });

    // 1. Tohum seç (bir önceki seçileni dışla)
    const seed = selectSeed(manager, recentlySelectedSeedId, seedCooldownMinutes, config, sessionId);
    if (!seed) {
        return null;
    }

    // 2. Ağı Gez (Graph Walk)
    const associations = graphWalk(manager, seed.memoryId, undefined, config, sessionId);
    if (associations.length === 0) {
        logger.info('[ThinkEngine] No associations found — generating lonely thought.');
    }

    logger.info(`[ThinkEngine] Seed selected: "${seed.content.substring(0, 50)}..." (${seed.type})`);

    logger.info(
        `[ThinkEngine] Graph-Walk completed: ${associations.length} associations found ` +
        `(max depth: ${MAX_HOP_DEPTH})`
    );

    // 3. Düşünce zinciri
    const chain = buildThoughtChain(seed, associations, effectiveEmotion);

    // 4. Prompt sentezi
    const prompt = synthesizeThoughtPrompt(chain, questionTemplateIndex);

    // 5. Düşünce günlüğüne kaydet (tekrar önleme ve pattern çıkarma için)
    const log = getThoughtLog(sessionId);
    log.record({
        seedMemoryId: seed.memoryId,
        seedType: seed.type,
        associationCount: associations.length,
        totalRetentionScore: chain.totalRetentionScore,
        emotionalPrimary: effectiveEmotion.primary,
        generatedAt: chain.generatedAt,
        relevanceScore: null,
        timeSensitivity: null,
    });

    return { thought: chain, prompt };
}

/**
 * LLM yanıtından relevance ve timeSensitivity skorlarını düşünce günlüğüne kaydeder.
 * Bu, adaptif hop derinliği hesaplamasında kullanılır.
 */
export function recordThoughtFeedback(relevanceScore: number, timeSensitivity: number, sessionId?: string): void {
    getThoughtLog(sessionId).updateLastFeedback(relevanceScore, timeSensitivity);
}

/**
 * Düşünce günlüğünün son kayıtlarını getir (debug/dashboard için).
 */
export function getRecentThoughtLog(count: number = 10, sessionId?: string): ThoughtLogRecord[] {
    return getThoughtLog(sessionId).getRecent(count);
}

/**
 * Düşünce günlüğündeki dominant duygu pattern'ini getir.
 */
export function getThoughtDominantEmotion(sessionId?: string): string | null {
    return getThoughtLog(sessionId).getDominantEmotionPattern();
}
