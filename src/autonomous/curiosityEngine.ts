/**
 * Merak Motoru — Alt-Ajan (Sub-Agent) Altyapısı
 * ===============================================
 *
 * PençeAI'nin merak ettiği konuları araştırmak için kullandığı
 * hafif, görev-odaklı alt-ajan sistemi.
 *
 * Tasarım Kararları:
 *   - Ana LLM modeli doğrudan web'de gezmez — bağlam kirliliğini önler
 *   - Alt-ajan hızlı/ucuz bir model kullanır (token tasarrufu)
 *   - Araştırma raporu özetlenmiş şekilde ana modele sunulur
 *   - Her araştırma bir "fixation" (takıntı) noktasından doğar
 *
 * Akış:
 *   think() → fixation keşfedilir → ResearchTask oluşturulur
 *   → SubAgent.execute() → LLM ile özetleme → ResearchReport döner
 *   → Rapor belleğe kaydedilir (opsiyonel)
 *
 * Bu modül LLM çağrısı YAPMAZ — sadece veri yapısını ve mantığı tanımlar.
 * Gerçek LLM çağrısı, SubAgentRunner tarafından yapılır.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════
//  Tipler
// ═══════════════════════════════════════════════════════════

/** Araştırma görevi durumu */
export type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Araştırma görevi kategorileri */
export type ResearchCategory =
    | 'web_search'       // Genel web araması
    | 'news_check'       // Güncel haber kontrolü
    | 'deep_dive'        // Derinlemesine konu araştırması
    | 'fact_check'       // Bilgi doğrulama
    | 'trend_analysis';  // Trend/gündem analizi

/** Araştırma görevi tanımı */
export interface ResearchTask {
    id: string;
    fixation: string;         // Merak noktası (Örn: "Rust'ın yeni 2025 edition'ı")
    query: string;            // Araştırma sorusu (Örn: "Rust 2025 edition ne getiriyor?")
    category: ResearchCategory;
    priority: number;         // 1-5 (1 = en yüksek)
    context: string;          // Neden bu konu merak edildi (think engine'den gelen bağlam)
    status: ResearchStatus;
    createdAt: string;        // ISO 8601
    completedAt?: string;     // ISO 8601
    report?: ResearchReport;  // Tamamlandığında doldurulur
}

/** Alt-ajan araştırma raporu */
export interface ResearchReport {
    summary: string;          // Ana özet (1-3 paragraf)
    keyFindings: string[];    // Anahtar bulgular listesi
    sources: string[];        // Kaynak URL'leri veya referanslar
    relevanceScore: number;   // Kullanıcı ilgi alanıyla örtüşme [0, 1]
    isTimeSensitive: boolean; // Zamanla değer kaybeder mi?
    generatedAt: string;      // ISO 8601
}

/** Alt-ajan yapılandırması */
export interface SubAgentConfig {
    maxConcurrentTasks: number;     // Aynı anda çalışacak maksimum görev
    maxDailyTasks: number;          // Günlük toplam görev limiti
    cooldownMinutes: number;        // Görevler arası bekleme süresi
    maxReportLength: number;        // Rapor maksimum karakter uzunluğu
}

/** Fixation — düşünce zincirinden çıkarılan merak noktası */
export interface Fixation {
    topic: string;            // Merak konusu
    source: 'thought_chain' | 'user_mention' | 'news_trigger' | 'scheduled';
    urgency: 'low' | 'medium' | 'high';
    relatedMemoryIds: number[]; // İlgili bellek ID'leri
}

// ═══════════════════════════════════════════════════════════
//  Sabitler
// ═══════════════════════════════════════════════════════════

/** Varsayılan alt-ajan yapılandırması */
export const DEFAULT_SUBAGENT_CONFIG: Readonly<SubAgentConfig> = {
    maxConcurrentTasks: 1,        // Tek görev — kaynak tasarrufu
    maxDailyTasks: 10,            // Günde en fazla 10 araştırma
    cooldownMinutes: 15,          // Görevler arası 15 dk bekleme
    maxReportLength: 2000,        // Rapor max 2000 karakter
};

/** Araştırma prompt şablonu — LLM'e gönderilecek */
export const RESEARCH_SYSTEM_PROMPT = `Sen kısa ve öz araştırma raporları yazan bir asistansın.

GÖREV: Kullanıcının verdiği araştırma sorusunu yanıtla.

KURALLAR:
1. Sadece doğrulanabilir bilgi ver — spekülasyon yapma
2. Cevabını Türkçe yaz
3. Kısa ve öz ol — uzun paragraflar yazma
4. Kaynakları belirt
5. Zamanla değer kaybedecek bilgileri işaretle

ÇIKTI FORMATI:
## Özet
[1-3 cümlelik ana özet]

## Anahtar Bulgular
- [Bulgu 1]
- [Bulgu 2]
- [Bulgu 3]

## Kaynaklar
- [Kaynak 1]
- [Kaynak 2]

## Zaman Hassasiyeti
[Bu bilgi zamanla değer kaybeder mi? Evet/Hayır ve neden]`;

// ═══════════════════════════════════════════════════════════
//  Görev Yöneticisi (Task Manager)
// ═══════════════════════════════════════════════════════════

/**
 * Alt-ajan görev yöneticisi.
 * Görev oluşturma, kuyruk yönetimi, günlük limit takibi ve
 * tamamlanan raporları belleğe kaydetme işlemlerini yönetir.
 */
export class SubAgentManager {
    private config: SubAgentConfig;
    private db: Database.Database;
    private activeTasks: Map<string, ResearchTask> = new Map();
    private dailyTaskCount: number = 0;
    private lastTaskDate: string = '';
    private lastTaskTime: number = 0;

    constructor(db: Database.Database, config?: Partial<SubAgentConfig>) {
        this.db = db;
        this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
    }

    // ═══════════════════════════════════════════════════════════
    //  Görev Oluşturma
    // ═══════════════════════════════════════════════════════════

    /**
     * Fixation'dan araştırma görevi oluşturur.
     * Günlük limit ve cooldown kontrolü yapar.
     *
     * @param fixation — düşünce zincirinden gelen merak noktası
     * @returns oluşturulan görev veya null (limitlere takılırsa)
     */
    public createTask(fixation: Fixation): ResearchTask | null {
        this._cleanupStaleTasks();
        // Günlük limit kontrolü
        this._resetDailyCountIfNeeded();
        if (this.dailyTaskCount >= this.config.maxDailyTasks) {
            logger.info(
                `[SubAgent] Daily task limit reached (${this.config.maxDailyTasks}). ` +
                `Skipping fixation: "${fixation.topic}"`
            );
            return null;
        }

        // Cooldown kontrolü
        const elapsed = Date.now() - this.lastTaskTime;
        if (elapsed < this.config.cooldownMinutes * 60 * 1000 && this.lastTaskTime > 0) {
            const remaining = Math.ceil((this.config.cooldownMinutes * 60 * 1000 - elapsed) / 60000);
            logger.info(
                `[SubAgent] Cooldown active (${remaining} min remaining). ` +
                `Skipping fixation: "${fixation.topic}"`
            );
            return null;
        }

        // Concurrent task limit
        if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
            logger.info(
                `[SubAgent] Max concurrent tasks reached (${this.config.maxConcurrentTasks}). ` +
                `Skipping fixation: "${fixation.topic}"`
            );
            return null;
        }

        // Duplicate kontrolü — aynı konuda aktif görev var mı?
        for (const [, task] of this.activeTasks) {
            if (task.fixation.toLowerCase() === fixation.topic.toLowerCase()) {
                logger.debug(`[SubAgent] Duplicate fixation detected: "${fixation.topic}"`);
                return null;
            }
        }

        const task: ResearchTask = {
            id: `subagent_research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            fixation: fixation.topic,
            query: this._buildQuery(fixation),
            category: this._inferCategory(fixation),
            priority: fixation.urgency === 'high' ? 1 : fixation.urgency === 'medium' ? 3 : 5,
            context: `Kaynak: ${fixation.source} | İlgili anı sayısı: ${fixation.relatedMemoryIds.length}`,
            status: 'pending',
            createdAt: new Date().toISOString(),
        };

        this.activeTasks.set(task.id, task);
        this.dailyTaskCount++;
        this.lastTaskTime = Date.now();

        // DB'ye kaydet
        this._persistTask(task);

        logger.info(
            `[SubAgent] Task created: "${task.fixation}" (${task.category}, P${task.priority}) ` +
            `[${this.dailyTaskCount}/${this.config.maxDailyTasks} daily]`
        );

        return task;
    }

    // ═══════════════════════════════════════════════════════════
    //  Görev Durumu
    // ═══════════════════════════════════════════════════════════

    /**
     * Görevi tamamlanmış olarak işaretler ve raporu kaydeder.
     */
    public completeTask(taskId: string, report: ResearchReport): void {
        const task = this.activeTasks.get(taskId);
        if (!task) {
            logger.warn(`[SubAgent] Task not found for completion: ${taskId}`);
            return;
        }

        // Rapor uzunluğunu sınırla
        if (report.summary.length > this.config.maxReportLength) {
            report.summary = report.summary.substring(0, this.config.maxReportLength) + '...';
        }

        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.report = report;
        this.activeTasks.delete(taskId);

        this._persistTask(task);
        logger.info(`[SubAgent] Task completed: "${task.fixation}" (relevance: ${report.relevanceScore.toFixed(2)})`);
    }

    /**
     * Görevi başarısız olarak işaretler.
     */
    public failTask(taskId: string, reason: string): void {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        this.activeTasks.delete(taskId);

        this._persistTask(task);
        logger.error(`[SubAgent] Task failed: "${task.fixation}" — ${reason}`);
    }

    /**
     * Görevi iptal eder.
     */
    public cancelTask(taskId: string): void {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        task.status = 'cancelled';
        this.activeTasks.delete(taskId);
        this._persistTask(task);
        logger.info(`[SubAgent] Task cancelled: "${task.fixation}"`);
    }

    // ═══════════════════════════════════════════════════════════
    //  Sorgulama
    // ═══════════════════════════════════════════════════════════

    /** Aktif görev sayısı */
    public getActiveCount(): number {
        return this.activeTasks.size;
    }

    /** Günlük kalan görev sayısı */
    public getRemainingDailyQuota(): number {
        this._resetDailyCountIfNeeded();
        return Math.max(0, this.config.maxDailyTasks - this.dailyTaskCount);
    }

    /** Belirli bir görevi getirir */
    public getTask(taskId: string): ResearchTask | undefined {
        return this.activeTasks.get(taskId);
    }

    /** Tüm aktif görevleri listeler */
    public getActiveTasks(): ResearchTask[] {
        return Array.from(this.activeTasks.values());
    }

    /** Tamamlanan son N araştırma raporunu veritabanından getirir */
    public getRecentReports(limit: number = 5): ResearchTask[] {
        try {
            const rows = this.db.prepare(`
                SELECT payload FROM autonomous_tasks
                WHERE type = 'subagent_research' AND status = 'completed'
                ORDER BY updated_at DESC
                LIMIT ?
            `).all(limit) as Array<{ payload: string }>;

            return rows.map(r => {
                try { return JSON.parse(r.payload) as ResearchTask; }
                catch { return null; }
            }).filter((t): t is ResearchTask => t !== null);
        } catch {
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  LLM Prompt Oluşturma (Sub-agent için)
    // ═══════════════════════════════════════════════════════════

    /**
     * Araştırma görevi için LLM mesajlarını oluşturur.
     * Bu mesajlar doğrudan hızlı/ucuz bir LLM modeline gönderilir.
     *
     * @param task — araştırma görevi
     * @returns LLM'e gönderilecek mesaj dizisi (system + user)
     */
    public buildResearchMessages(task: ResearchTask): Array<{ role: 'system' | 'user'; content: string }> {
        return [
            { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    `## Araştırma Sorusu`,
                    task.query,
                    ``,
                    `## Bağlam`,
                    task.context,
                    ``,
                    `## Kategori: ${task.category}`,
                    `## Öncelik: P${task.priority}`,
                ].join('\n'),
            },
        ];
    }

    /**
     * LLM'den gelen ham yanıtı yapısal ResearchReport'a çevirir.
     * Basit markdown parser — mükemmel çıktı beklemez, fallback'lerle çalışır.
     */
    public parseReport(rawResponse: string, relevanceScore: number = 0.5): ResearchReport {
        // Özet çıkar
        const summaryMatch = rawResponse.match(/##\s*Özet\s*\n([\s\S]*?)(?=\n##|$)/i);
        const summary = summaryMatch ? summaryMatch[1].trim() : rawResponse.substring(0, 500);

        // Anahtar bulgular çıkar
        const findingsMatch = rawResponse.match(/##\s*Anahtar Bulgular?\s*\n([\s\S]*?)(?=\n##|$)/i);
        const keyFindings = findingsMatch
            ? findingsMatch[1].split(/\n-\s*/).map(s => s.trim()).filter(s => s.length > 0)
            : [];

        // Kaynaklar çıkar
        const sourcesMatch = rawResponse.match(/##\s*Kaynaklar?\s*\n([\s\S]*?)(?=\n##|$)/i);
        const sources = sourcesMatch
            ? sourcesMatch[1].split(/\n-\s*/).map(s => s.trim()).filter(s => s.length > 0)
            : [];

        // Zaman hassasiyeti çıkar
        const timeMatch = rawResponse.match(/##\s*Zaman Hassasiyeti\s*\n([\s\S]*?)(?=\n##|$)/i);
        const isTimeSensitive = timeMatch
            ? /evet/i.test(timeMatch[1])
            : false;

        return {
            summary: summary.substring(0, this.config.maxReportLength),
            keyFindings,
            sources,
            relevanceScore,
            isTimeSensitive,
            generatedAt: new Date().toISOString(),
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  Dahili Yardımcılar
    // ═══════════════════════════════════════════════════════════

    private _buildQuery(fixation: Fixation): string {
        // Basit soru formatı — sonradan LLM ile zenginleştirilebilir
        return `"${fixation.topic}" hakkında güncel bilgi ver. ` +
            `Bu konu neden önemli, son gelişmeler neler?`;
    }

    private _inferCategory(fixation: Fixation): ResearchCategory {
        const topic = fixation.topic.toLowerCase();

        if (fixation.source === 'news_trigger' || /haber|gündem|son dakika/i.test(topic)) {
            return 'news_check';
        }
        if (fixation.urgency === 'high' && /doğru mu|gerçek mi|yanlış mı/i.test(topic)) {
            return 'fact_check';
        }
        if (/trend|popüler|gündem|viral/i.test(topic)) {
            return 'trend_analysis';
        }
        if (fixation.source === 'thought_chain') {
            return 'deep_dive';
        }
        return 'web_search';
    }

    private _cleanupStaleTasks(): void {
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const now = Date.now();
        const staleIds: string[] = [];
        
        for (const [id, task] of this.activeTasks) {
            const age = now - new Date(task.createdAt).getTime();
            if (age > maxAge) {
                staleIds.push(id);
            }
        }
        
        for (const id of staleIds) {
            this.failTask(id, 'Task expired (stale > 24h)');
        }
    }

    private _resetDailyCountIfNeeded(): void {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        if (this.lastTaskDate !== today) {
            this.dailyTaskCount = 0;
            this.lastTaskDate = today;
        }
    }

    private _persistTask(task: ResearchTask): void {
        try {
            this.db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at, updated_at)
                VALUES (?, 'subagent_research', ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    payload = excluded.payload,
                    updated_at = CURRENT_TIMESTAMP
            `).run(
                task.id,
                task.priority,
                JSON.stringify(task),
                task.status,
                task.createdAt
            );
        } catch (err) {
            logger.error({ err }, `[SubAgent] Failed to persist task: ${task.id}`);
        }
    }
}
