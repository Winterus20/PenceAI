import { TaskQueue, AutonomousTask } from './queue.js';
import { logger } from '../utils/logger.js';
import os from 'os';

export interface WorkerConfig {
    idleThresholdMs: number; // How long to wait before starting background tasks
    boredomThresholdMs: number; // How long to run before getting "bored"
    cpuLoadThreshold: number; // Max CPU load average (1m) before sleeping
    checkIntervalMs: number; // How often to check for idle state
    maxIterationsPerLoop: number; // Maximum number of tasks to execute per loop iteration
}

export class BackgroundWorker {
    private queue: TaskQueue;
    private config: WorkerConfig;
    private lastActivityAt: number = Date.now();
    private isRunning: boolean = false;
    private abortController: AbortController | null = null;
    private checkTimer: NodeJS.Timeout | null = null;
    private activeTaskId: string | null = null;

    constructor(queue: TaskQueue, config?: Partial<WorkerConfig>) {
        this.queue = queue;
        this.config = {
            idleThresholdMs: 60 * 60 * 1000, // Default 1 hour
            boredomThresholdMs: 15 * 60 * 1000, // Default 15 mins max work
            cpuLoadThreshold: os.cpus().length * 0.8, // 80% of available cores
            checkIntervalMs: 60 * 1000, // Check every minute
            maxIterationsPerLoop: 5, // Default: max 5 tasks per loop
            ...config
        };
    }

    public start(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        logger.info('[Worker] Autonomous background worker started.');
        this.checkTimer = setInterval(() => this.checkAndRun(), this.config.checkIntervalMs);
    }

    public stop(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        this.interrupt('Worker stopped intentionally');
        logger.info('[Worker] Autonomous background worker stopped.');
    }

    public registerUserActivity(): void {
        this.lastActivityAt = Date.now();
        // If we are currently running background tasks, GRACEFULLY INTERRUPT immediately.
        if (this.isRunning) {
            this.interrupt('User activity detected');
        }
    }

    private isHardwareOverloaded(): boolean {
        // os.loadavg()[0] gives 1-minute load average on Unix-like systems.
        // On Windows it always returns [0, 0, 0], so we skip CPU check on Windows.
        const isWindows = os.platform() === 'win32';
        const load = isWindows ? 0 : os.loadavg()[0];
        const freeMemRatio = os.freemem() / os.totalmem();

        if (!isWindows && load > this.config.cpuLoadThreshold) {
            logger.warn(`[Worker] Hardware overloaded (CPU load: ${load.toFixed(2)}). Sleeping.`);
            return true;
        }

        if (freeMemRatio < 0.1) { // Less than 10% memory free
            logger.warn(`[Worker] Hardware overloaded (Free memory: ${(freeMemRatio * 100).toFixed(1)}%). Sleeping.`);
            return true;
        }

        return false;
    }

    private async checkAndRun(): Promise<void> {
        if (this.isRunning) return;

        const timeSinceActivity = Date.now() - this.lastActivityAt;
        if (timeSinceActivity < this.config.idleThresholdMs) {
            return; // Not idle enough yet
        }

        if (this.queue.length === 0) {
            return; // Nothing to do
        }

        if (this.isHardwareOverloaded()) {
            return; // Shh, sleep.
        }

        await this.runLoop();
    }

    private async runLoop(): Promise<void> {
        this.isRunning = true;
        this.abortController = new AbortController();
        const startTime = Date.now();
        let iterationCount = 0;

        logger.info('[Worker] Entering active autonomous loop...');

        try {
            while (this.queue.length > 0 && !this.abortController.signal.aborted) {
                // Check iteration limit
                if (iterationCount >= this.config.maxIterationsPerLoop) {
                    logger.info(`[Worker] Reached max iterations per loop (${iterationCount}/${this.config.maxIterationsPerLoop}). Going to sleep.`);
                    break;
                }

                // Check if we're bored (running too long)
                if (Date.now() - startTime > this.config.boredomThresholdMs) {
                    logger.info('[Worker] Reached boredom threshold. Going to sleep.');
                    break;
                }

                // Check constraints between tasks
                if (this.isHardwareOverloaded()) {
                    break;
                }

                const task = this.queue.dequeue();
                if (!task) break;

                this.activeTaskId = task.id;
                try {
                    logger.debug(`[Worker] Executing task: ${task.type} (${task.id})`);
                    if (task.execute) {
                        // IMPORTANT: We pass the abort signal down to the task so it can stop gracefully.
                        await task.execute(this.abortController.signal);
                    } else {
                        logger.error(`[Worker] Task ${task.id} has no execution logic attached.`);
                    }
                    logger.debug(`[Worker] Task completed: ${task.id}`);
                    this.queue.markCompleted(task.id);
                } catch (error: any) {
                    if (error.name === 'AbortError') {
                        logger.info(`[Worker] Task ${task.id} was aborted mid-execution. Checkpointing...`);
                        // Put it back in the queue (or handle specific checkpointing later)
                        this.queue.enqueue(task);
                    } else {
                        logger.error({ err: error }, `[Worker] Task execution failed (${task.id}):`);
                        this.queue.markFailed(task.id);
                    }
                } finally {
                    this.activeTaskId = null;
                }

                // Increment iteration counter
                iterationCount++;

                // Micro-task breathing room: prevent blocking Node.js event loop
                await new Promise(resolve => setImmediate(resolve));
            }
        } finally {
            this.isRunning = false;
            this.abortController = null;
            logger.info(`[Worker] Exited autonomous loop. (Completed ${iterationCount} iterations)`);
        }
    }

    private interrupt(reason: string): void {
        if (this.abortController && !this.abortController.signal.aborted) {
            logger.info(`[Worker] 🛑 Graceful Interruption Triggered (${reason}). Aborting current task...`);
            this.abortController.abort(new Error('AbortError'));
            // OPT F-10: isRunning'i burada false yapmıyoruz — runLoop.finally bloğu
            // bunu halleder. Aksi halde checkAndRun yeniden runLoop başlatabilir.
        }
    }
}
