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

import type Database from 'better-sqlite3';
import type { MemoryRow } from '../memory/types.js';
import { computeRetention, daysSinceAccess } from '../memory/ebbinghaus.js';
import { logger } from '../utils/logger.js';

/** Basit duygusal bağlam etiketi (VAD bağımlılığı olmadan) */
export interface EmotionalContext {
    primary: string;       // Ana duygu etiketi (ör: 'Nötr', 'Meraklı')
    intensity: 'low' | 'medium' | 'high';
    description: string;   // Kısa açıklama
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
export const MIN_RELATION_CONFIDENCE = 0.35;

// ═══════════════════════════════════════════════════════════
//  Tohum Seçimi (Seed Selection)
// ═══════════════════════════════════════════════════════════

/**
 * Düşüncenin başlangıç noktasını seçer.
 * Birden fazla stratejiyi sırayla dener; ilk bulunan tohum döner.
 *
 * Strateji Sırası:
 *   1. Son erişilen taze bir anı (son 24 saat, retention > threshold)
 *   2. Yüksek önemli bir anı (importance >= 7)
 *   3. Rastgele aktif bir anı (keşif modu — fallback)
 */
export function selectSeed(db: Database.Database): ThoughtSeed | null {
    // Strateji 1: Son erişilen taze anı (son 24 saat)
    const recentMemory = db.prepare(`
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0
            AND last_accessed IS NOT NULL
            AND last_accessed > datetime('now', '-1 day')
        ORDER BY last_accessed DESC
        LIMIT 5
    `).all() as Array<MemoryRow>;

    for (const mem of recentMemory) {
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
    const importantMemory = db.prepare(`
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0 AND importance >= 7
        ORDER BY importance DESC, RANDOM()
        LIMIT 1
    `).get() as MemoryRow | undefined;

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
    const randomMemory = db.prepare(`
        SELECT id, content, importance, stability, last_accessed
        FROM memories
        WHERE is_archived = 0
        ORDER BY RANDOM()
        LIMIT 1
    `).get() as MemoryRow | undefined;

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
 * @param db         — Veritabanı bağlantısı
 * @param seedId     — Başlangıç bellek ID'si
 * @param maxDepth   — Maksimum hop derinliği (varsayılan: 2)
 * @returns Tazelik filtresinden geçen çağrışım listesi
 */
export function graphWalk(
    db: Database.Database,
    seedId: number,
    maxDepth: number = MAX_HOP_DEPTH
): Association[] {
    const visited = new Set<number>([seedId]);
    const associations: Association[] = [];

    // BFS: her derinlik katmanı ayrı işlenir
    let currentLayer = [seedId];

    for (let hop = 1; hop <= maxDepth; hop++) {
        const nextLayer: number[] = [];

        for (const nodeId of currentLayer) {
            // 1-hop komşuları al (confidence sıralı)
            const neighbors = db.prepare(`
                SELECT
                    m.id, m.content, m.category, m.importance,
                    m.stability, m.last_accessed,
                    mr.confidence, mr.description as relation_description
                FROM memory_relations mr
                JOIN memories m ON (
                    (mr.source_memory_id = ? AND m.id = mr.target_memory_id)
                    OR
                    (mr.target_memory_id = ? AND m.id = mr.source_memory_id)
                )
                WHERE m.is_archived = 0
                    AND mr.confidence >= ?
                ORDER BY mr.confidence DESC
                LIMIT ?
            `).all(nodeId, nodeId, MIN_RELATION_CONFIDENCE, MAX_NEIGHBORS_PER_HOP) as Array<MemoryRow & {
                confidence: number;
                relation_description: string;
            }>;

            for (const neighbor of neighbors) {
                if (visited.has(neighbor.id)) continue;
                visited.add(neighbor.id);

                // Ebbinghaus tazelik kontrolü
                const retention = computeRetention(
                    neighbor.stability ?? neighbor.importance * 2.0,
                    daysSinceAccess(neighbor.last_accessed)
                );

                if (retention < FRESHNESS_THRESHOLD) {
                    logger.debug(
                        `[ThinkEngine] Skipped memory #${neighbor.id} — stale (retention: ${retention.toFixed(2)} < ${FRESHNESS_THRESHOLD})`
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
                    confidence: neighbor.confidence,
                });

                nextLayer.push(neighbor.id);

                // Toplam çağrışım limitine ulaştıysak dur
                if (associations.length >= MAX_ASSOCIATIONS) break;
            }

            if (associations.length >= MAX_ASSOCIATIONS) break;
        }

        currentLayer = nextLayer;

        if (associations.length >= MAX_ASSOCIATIONS || currentLayer.length === 0) break;
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
export function synthesizeThoughtPrompt(chain: ThoughtChain): string {
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

    // Yönlendirme
    prompt += `---\n`;
    prompt += `Bu iç ses notunu kullanarak:\n`;
    prompt += `1. Bu çağrışımlar seni neye götürüyor? Yeni bir merak noktası var mı?\n`;
    prompt += `2. Bu düşünce kullanıcıyla paylaşılacak kadar değerli mi?\n`;
    prompt += `3. Bir araştırma konusu (sub-agent görevi) çıkıyor mu?\n`;

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
 * @param db      — Veritabanı bağlantısı
 * @param emotion — Duygusal bağlam etiketi
 * @returns ThoughtLogEntry | null (düşünecek anı yoksa null)
 */
export function think(
    db: Database.Database,
    emotion: EmotionalContext
): ThoughtLogEntry | null {
    // 1. Tohum seç
    const seed = selectSeed(db);
    if (!seed) {
        logger.info('[ThinkEngine] No seed found — no memories to think about.');
        return null;
    }

    logger.info(`[ThinkEngine] Seed selected: "${seed.content.substring(0, 50)}..." (${seed.type})`);

    // 2. Graph-Walk
    const associations = graphWalk(db, seed.memoryId);
    logger.info(
        `[ThinkEngine] Graph-Walk completed: ${associations.length} associations found ` +
        `(max depth: ${MAX_HOP_DEPTH})`
    );

    // 3. Düşünce zinciri
    const chain = buildThoughtChain(seed, associations, emotion);

    // 4. Prompt sentezi
    const prompt = synthesizeThoughtPrompt(chain);

    return { thought: chain, prompt };
}
