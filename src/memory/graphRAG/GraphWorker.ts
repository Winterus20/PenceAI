/**
 * GraphWorker — Periyodik Graph İşleme Background Worker.
 * 
 * Community detection, PageRank hesaplama, cache temizliği
 * ve summary generation gibi ağır işlemleri arka planda yapar.
 * 
 * Çalışma Mantığı:
 * 1. Başlatma: Tüm interval'ları ayarla
 * 2. Her interval'da ilgili görevi çalıştır
 * 3. Kullanıcı aktivitesi varsa → interrupt ve ertele
 * 4. Hardware monitoring: CPU/Memory yüksekse ertele
 * 5. Görev tamamlandığında bir sonraki interval'ı planla
 */

import type Database from 'better-sqlite3';
import os from 'os';
import { logger } from '../../utils/logger.js';
import type { PageRankScorer } from './PageRankScorer.js';
import type { CommunityDetector } from './CommunityDetector.js';
import type { CommunitySummarizer } from './CommunitySummarizer.js';
import type { GraphCache } from './GraphCache.js';

/** GraphWorker konfigürasyonu */
export interface GraphWorkerConfig {
  pageRankIntervalMs: number;           // Default: 1 saat (FULL: 30 dakika)
  communityDetectionIntervalMs: number; // Default: 6 saat (FULL: 3 saat)
  cacheCleanupIntervalMs: number;       // Default: 30 dakika (FULL: 15 dakika)
  summaryGenerationIntervalMs: number;  // Default: 12 saat (FULL: 6 saat)
  maxConcurrentTasks: number;           // Default: 2
  cpuLoadThreshold: number;             // Default: os.cpus().length * 0.8
  memoryThreshold: number;              // Default: 0.1 (10% free)
}

/** Default konfigürasyon (PARTIAL phase) */
const DEFAULT_CONFIG: GraphWorkerConfig = {
  pageRankIntervalMs: 60 * 60 * 1000,           // 1 saat
  communityDetectionIntervalMs: 6 * 60 * 60 * 1000, // 6 saat
  cacheCleanupIntervalMs: 30 * 60 * 1000,       // 30 dakika
  summaryGenerationIntervalMs: 12 * 60 * 60 * 1000, // 12 saat
  maxConcurrentTasks: 2,
  cpuLoadThreshold: os.cpus().length * 0.8,
  memoryThreshold: 0.1,
};

/** FULL phase konfigürasyonu (daha sık interval'ler) */
export const FULL_PHASE_CONFIG: GraphWorkerConfig = {
  pageRankIntervalMs: 30 * 60 * 1000,           // 30 dakika
  communityDetectionIntervalMs: 3 * 60 * 60 * 1000, // 3 saat
  cacheCleanupIntervalMs: 15 * 60 * 1000,       // 15 dakika
  summaryGenerationIntervalMs: 6 * 60 * 60 * 1000, // 6 saat
  maxConcurrentTasks: 2,
  cpuLoadThreshold: os.cpus().length * 0.8,
  memoryThreshold: 0.1,
};

/** Görev durumu */
type TaskStatus = 'idle' | 'running' | 'paused' | 'error';

/** Görev tanımı */
interface TaskDefinition {
  name: string;
  intervalMs: number;
  execute: () => Promise<void>;
  lastRunAt: number;
  nextRunAt: number;
  status: TaskStatus;
  errorCount: number;
}

export class GraphWorker {
  private config: GraphWorkerConfig;
  private tasks: Map<string, TaskDefinition> = new Map();
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastActivityAt: number = Date.now();
  private idleThresholdMs: number = 5 * 60 * 1000; // 5 dakika idle sonra başla

  constructor(
    private db: Database.Database,
    private pageRankScorer: PageRankScorer,
    private communityDetector: CommunityDetector,
    private communitySummarizer: CommunitySummarizer,
    private graphCache: GraphCache,
    config?: Partial<GraphWorkerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerTasks();
  }

  /**
   * Worker'ı başlat.
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[GraphWorker] Already running, ignoring start request');
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.lastActivityAt = Date.now();

    logger.info('[GraphWorker] 🚀 Graph background worker started');

    // İlk kontrolü planla
    this.scheduleNextCheck();
  }

  /**
   * Worker'ı durdur.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    logger.info('[GraphWorker] 🛑 Graph background worker stopped');
  }

  /**
   * Kullanıcı aktivitesini kaydet (interrupt için).
   */
  registerUserActivity(): void {
    this.lastActivityAt = Date.now();
    this.interrupt('User activity detected');
  }

  /**
   * Manuel PageRank güncellemesi tetikle.
   */
  async runPageRankUpdate(): Promise<void> {
    const task = this.tasks.get('pageRank');
    if (!task) return;

    logger.info('[GraphWorker] 📊 Manual PageRank update triggered');
    await this.executeTask('pageRank', task.execute);
  }

  /**
   * Manuel Community Detection tetikle.
   */
  async runCommunityDetection(): Promise<void> {
    const task = this.tasks.get('communityDetection');
    if (!task) return;

    logger.info('[GraphWorker] 🔍 Manual Community Detection triggered');
    await this.executeTask('communityDetection', task.execute);
  }

  /**
   * Manuel Cache Cleanup tetikle.
   */
  async runCacheCleanup(): Promise<void> {
    const task = this.tasks.get('cacheCleanup');
    if (!task) return;

    logger.info('[GraphWorker] 🧹 Manual Cache Cleanup triggered');
    await this.executeTask('cacheCleanup', task.execute);
  }

  /**
   * Manuel Summary Generation tetikle.
   */
  async runSummaryGeneration(): Promise<void> {
    const task = this.tasks.get('summaryGeneration');
    if (!task) return;

    logger.info('[GraphWorker] 📝 Manual Summary Generation triggered');
    await this.executeTask('summaryGeneration', task.execute);
  }

  /**
   * Görevleri kaydet.
   */
  private registerTasks(): void {
    this.tasks.set('pageRank', {
      name: 'PageRank Update',
      intervalMs: this.config.pageRankIntervalMs,
      execute: async () => {
        const scores = this.pageRankScorer.computePageRank();
        logger.info(`[GraphWorker] PageRank computed for ${scores.size} nodes`);
      },
      lastRunAt: 0,
      nextRunAt: Date.now() + this.config.pageRankIntervalMs,
      status: 'idle',
      errorCount: 0,
    });

    this.tasks.set('communityDetection', {
      name: 'Community Detection',
      intervalMs: this.config.communityDetectionIntervalMs,
      execute: async () => {
        const result = this.communityDetector.detectCommunities();
        logger.info(`[GraphWorker] Hierarchical Community Detection: ${result.communities.length} communities found (maxLevel: ${result.maxLevel})`);
      },
      lastRunAt: 0,
      nextRunAt: Date.now() + this.config.communityDetectionIntervalMs,
      status: 'idle',
      errorCount: 0,
    });

    this.tasks.set('cacheCleanup', {
      name: 'Cache Cleanup',
      intervalMs: this.config.cacheCleanupIntervalMs,
      execute: async () => {
        const cleaned = this.graphCache.cleanup();
        logger.info(`[GraphWorker] Cache Cleanup: ${cleaned} entries removed`);
      },
      lastRunAt: 0,
      nextRunAt: Date.now() + this.config.cacheCleanupIntervalMs,
      status: 'idle',
      errorCount: 0,
    });

    this.tasks.set('summaryGeneration', {
      name: 'Summary Generation',
      intervalMs: this.config.summaryGenerationIntervalMs,
      execute: async () => {
        // Hiyerarşik özetleme: Level 0 + Level 1 roll-up summaries
        const summaries = await this.communitySummarizer.summarizeHierarchical(1);
        logger.info(`[GraphWorker] Hierarchical Summary Generation: ${summaries.length} summaries created (multi-level)`);
      },
      lastRunAt: 0,
      nextRunAt: Date.now() + this.config.summaryGenerationIntervalMs,
      status: 'idle',
      errorCount: 0,
    });
  }

  /**
   * Bir sonraki kontrolü planla.
   */
  private scheduleNextCheck(): void {
    if (!this.isRunning) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    // En yakın görevin zamanını bul
    const now = Date.now();
    let minDelay = Infinity;

    for (const task of this.tasks.values()) {
      if (task.status === 'running') continue;

      const delay = task.nextRunAt - now;
      if (delay < minDelay) {
        minDelay = delay;
      }
    }

    // Minimum 1 saniye, maksimum 1 dakika bekle
    const checkDelay = Math.max(1000, Math.min(minDelay, 60 * 1000));

    this.timer = setTimeout(() => {
      this.checkAndRun().catch(err => {
        logger.error({ err }, '[GraphWorker] Unexpected error in checkAndRun loop');
      });
    }, checkDelay);
  }

  /**
   * Kontrol et ve çalıştır.
   */
  private async checkAndRun(): Promise<void> {
    if (!this.isRunning) return;

    // Abort signal kontrolü
    if (this.abortController?.signal.aborted) {
      logger.debug('[GraphWorker] Aborted, stopping check loop');
      return;
    }

    // Idle kontrolü
    const timeSinceActivity = Date.now() - this.lastActivityAt;
    if (timeSinceActivity < this.idleThresholdMs) {
      logger.debug(`[GraphWorker] Not idle yet (${Math.round(timeSinceActivity / 1000)}s since activity)`);
      this.scheduleNextCheck();
      return;
    }

    // Hardware kontrolü
    if (this.isHardwareOverloaded()) {
      logger.warn('[GraphWorker] Hardware overloaded, deferring tasks');
      this.scheduleNextCheck();
      return;
    }

    // Çalıştırılması gereken görevleri bul
    const now = Date.now();
    const dueTasks: TaskDefinition[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'running') continue;
      if (task.nextRunAt <= now) {
        dueTasks.push(task);
      }
    }

    if (dueTasks.length === 0) {
      this.scheduleNextCheck();
      return;
    }

    // Max concurrent tasks kontrolü
    const runningTasks = Array.from(this.tasks.values()).filter(t => t.status === 'running').length;
    const availableSlots = this.config.maxConcurrentTasks - runningTasks;

    if (availableSlots <= 0) {
      logger.debug('[GraphWorker] Max concurrent tasks reached, deferring');
      this.scheduleNextCheck();
      return;
    }

    // Görevleri çalıştır
    const tasksToRun = dueTasks.slice(0, availableSlots);
    for (const task of tasksToRun) {
      this.executeTask(task.name, task.execute).catch(err => {
        logger.error({ err }, `[GraphWorker] Task ${task.name} failed:`);
      });
    }

    this.scheduleNextCheck();
  }

  /**
   * Görevi çalıştır.
   */
  private async executeTask(name: string, execute: () => Promise<void>): Promise<void> {
    const task = this.tasks.get(name);
    if (!task) return;

    if (task.status === 'running') {
      logger.debug(`[GraphWorker] Task ${name} already running, skipping`);
      return;
    }

    // Abort signal kontrolü
    if (this.abortController?.signal.aborted) {
      logger.debug(`[GraphWorker] Aborted, skipping task: ${name}`);
      return;
    }

    task.status = 'running';
    const startTime = Date.now();

    try {
      logger.info(`[GraphWorker] ▶️ Starting task: ${name}`);
      await execute();

      task.lastRunAt = Date.now();
      task.nextRunAt = Date.now() + task.intervalMs;
      task.status = 'idle';
      task.errorCount = 0;

      const elapsed = Date.now() - startTime;
      logger.info(`[GraphWorker] ✅ Task completed: ${name} (${elapsed}ms)`);
    } catch (err) {
      task.status = 'idle'; // Hemen idle'a çevir (race condition yok)
      task.errorCount++;
      // Exponential backoff: 10s, 20s, 40s, max 5min
      const backoff = Math.min(10000 * Math.pow(2, task.errorCount - 1), 5 * 60 * 1000);
      task.nextRunAt = Date.now() + backoff;

      logger.error({ err, errorCount: task.errorCount, nextRetryInMs: backoff }, `[GraphWorker] ❌ Task failed: ${name}`);
    }
  }

  /**
   * Hardware overload kontrolü.
   */
  private isHardwareOverloaded(): boolean {
    const isWindows = os.platform() === 'win32';
    const load = isWindows ? 0 : (os.loadavg()[0] ?? 0);
    const freeMemRatio = os.freemem() / os.totalmem();

    if (!isWindows && load > this.config.cpuLoadThreshold) {
      logger.warn(`[GraphWorker] CPU overloaded (load: ${load.toFixed(2)})`);
      return true;
    }

    if (freeMemRatio < this.config.memoryThreshold) {
      logger.warn(`[GraphWorker] Memory overloaded (free: ${(freeMemRatio * 100).toFixed(1)}%)`);
      return true;
    }

    return false;
  }

  /**
   * Graceful interrupt.
   */
  private interrupt(reason: string): void {
    logger.debug(`[GraphWorker] Interrupt: ${reason}`);
    // Abort signal'i gönder - task'lar signal.aborted kontrolü yapacak
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort(reason);
      // Yeni bir abort controller oluştur (gelecekteki start için)
      this.abortController = new AbortController();
    }
  }

  /**
   * Worker durumunu getir.
   */
  getStatus(): {
    isRunning: boolean;
    tasks: Array<{
      name: string;
      status: TaskStatus;
      lastRunAt: number;
      nextRunAt: number;
      errorCount: number;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      tasks: Array.from(this.tasks.values()).map(t => ({
        name: t.name,
        status: t.status,
        lastRunAt: t.lastRunAt,
        nextRunAt: t.nextRunAt,
        errorCount: t.errorCount,
      })),
    };
  }
}
