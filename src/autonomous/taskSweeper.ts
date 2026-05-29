import { logger } from '../utils/logger.js';
import type { TaskQueue } from './queue.js';

const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * Periyodik olarak süresi dolmuş task lease'lerini geri alır.
 */
export class TaskSweeper {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly queue: TaskQueue,
        private readonly getActiveTaskId: () => string | null,
        private readonly intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
    ) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
        logger.info(`[TaskSweeper] Started (interval: ${this.intervalMs}ms)`);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('[TaskSweeper] Stopped');
        }
    }

    tick(): void {
        const { requeued, failed } = this.queue.sweepExpiredLeases(this.getActiveTaskId());
        if (requeued > 0 || failed > 0) {
            logger.info(`[TaskSweeper] Lease sweep: ${requeued} requeued, ${failed} failed`);
        }
    }
}
