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

import { MemoryManager } from '../memory/manager.js';
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
export const MIN_RELATION_CONFIDENCE = 0.25; // 0.35'ten 0.25'e düşürüldü

/** Think engine yapılandırma seçenekleri */
export interface ThinkEngineConfig {
    freshnessThreshold?: number;       // Default: 0.3
    maxHopDepth?: number;              // Default: 2
    maxAssociations?: number;          // Default: 8
    maxNeighborsPerHop?: number;       // Default: 5
    minRelationConfidence?: number;    // Default: 0.25
    seedCooldownMinutes?: number;      // Default: 30
}

/** Varsayılan yapılandırma */
export const DEFAULT_THINK_CONFIG: Readonly<ThinkEngineConfig> = {
    freshnessThreshold: FRESHNESS_THRESHOLD,
    maxHopDepth: MAX_HOP_DEPTH,
    maxAssociations: MAX_ASSOCIATIONS,
    maxNeighborsPerHop: MAX_NEIGHBORS_PER_HOP,
    minRelationConfidence: MIN_RELATION_CONFIDENCE,
    seedCooldownMinutes: 30,
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
export function selectSeed(
    manager: MemoryManager,
    recentlySelectedSeedId?: number,
    cooldownMinutes?: number,
    config?: ThinkEngineConfig
): ThoughtSeed | null {
    const db = manager.getDatabase();
    const effectiveCooldown = cooldownMinutes ?? config?.seedCooldownMinutes ?? 30;

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
                // Cooldown süresi dolmamış, bu seed'i atla
                logger.debug(`[ThinkEngine] Seed #${recentlySelectedSeedId} cooldown'da (${Math.ceil((cooldownMs - elapsed) / 60000)} dk kaldı)`);
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
export function graphWalk(
    manager: MemoryManager,
    seedId: number,
    maxDepth?: number,
    config?: ThinkEngineConfig
): Association[] {
    const effectiveMaxDepth = maxDepth ?? config?.maxHopDepth ?? MAX_HOP_DEPTH;
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
    emotion: EmotionalContext,
    recentlySelectedSeedId?: number,
    seedCooldownMinutes?: number,
    questionTemplateIndex?: number,
    config?: ThinkEngineConfig
): ThoughtLogEntry | null {
    // 1. Tohum seç (bir önceki seçileni dışla)
    const seed = selectSeed(manager, recentlySelectedSeedId, seedCooldownMinutes, config);
    if (!seed) {
        return null;
    }

    // 2. Ağı Gez (Graph Walk)
    const associations = graphWalk(manager, seed.memoryId, undefined, config);
    if (associations.length === 0) {
        logger.info('[ThinkEngine] No associations found — generating lonely thought.');
    }

    logger.info(`[ThinkEngine] Seed selected: "${seed.content.substring(0, 50)}..." (${seed.type})`);

    logger.info(
        `[ThinkEngine] Graph-Walk completed: ${associations.length} associations found ` +
        `(max depth: ${MAX_HOP_DEPTH})`
    );

    // 3. Düşünce zinciri
    const chain = buildThoughtChain(seed, associations, emotion);

    // 4. Prompt sentezi
    const prompt = synthesizeThoughtPrompt(chain, questionTemplateIndex);

    return { thought: chain, prompt };
}
