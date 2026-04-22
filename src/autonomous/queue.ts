import { logger } from '../utils/logger.js';
import type Database from 'better-sqlite3';

export type TaskExecutor = (payload: any, signal: AbortSignal) => Promise<void>;

export enum TaskPriority {
    P1_CRITICAL = 1, // Conflict resolution, user direct requests
    P2_HIGH = 2,     // Semantic routing fallback, initial graph extraction
    P3_NORMAL = 3,   // Routine memory consolidation, decay processing
    P4_LOW = 4       // Deep philosophical analysis, slow background tasks
}

export interface AutonomousTask {
    id: string;
    type: string;
    priority: TaskPriority;
    payload: any;
    addedAt: number;
    execute?: (signal: AbortSignal) => Promise<void>;
    retryCount?: number;       // How many times retried
    maxRetries?: number;       // Maximum retries allowed (default: 2)
}

export class TaskQueue {
    private queue: AutonomousTask[] = [];
    private db?: Database.Database;
    private registry: Map<string, TaskExecutor> = new Map();

    constructor(db?: Database.Database) {
        this.db = db;
    }

    public registerHandler(type: string, handler: TaskExecutor): void {
        this.registry.set(type, handler);
    }

    public loadPendingTasks(): void {
        if (!this.db) return;
        try {
            const rows = this.db.prepare(`
                SELECT id, type, priority, payload, added_at 
                FROM autonomous_tasks 
                WHERE status = 'pending' OR status = 'running'
                ORDER BY priority ASC, added_at ASC
            `).all() as any[];

            let loadedCount = 0;
            for (const row of rows) {
                const handler = this.registry.get(row.type);
                if (!handler) {
                    logger.warn(`[TaskQueue] ⚠️ No handler registered for task type: ${row.type}. Skipping task ${row.id}.`);
                    continue;
                }

                let parsedPayload = {};
                try {
                    parsedPayload = JSON.parse(row.payload);
                } catch (e) {
                    logger.debug({ taskId: row.id, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to parse task payload, using empty object');
                }

                this.queue.push({
                    id: row.id,
                    type: row.type,
                    priority: row.priority,
                    payload: parsedPayload,
                    addedAt: new Date(row.added_at).getTime(),
                    execute: async (signal) => {
                        await handler(parsedPayload, signal);
                    }
                });
                loadedCount++;
            }

            logger.info(`[TaskQueue] 💾 Checkpoint: Found ${rows.length} pending/running tasks, rehydrated ${loadedCount} tasks into memory.`);
        } catch (err) {
            logger.warn({ err }, '[TaskQueue] ❌ Failed to load pending tasks from DB.');
        }
    }

    private syncToDb(task: AutonomousTask, status: 'pending' | 'running' | 'completed' | 'failed', payloadStr?: string): void {
        if (!this.db) return;
        try {
            const currentPayload = payloadStr ?? JSON.stringify(task.payload);
            const addedAtDate = new Date(task.addedAt).toISOString();

            this.db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET 
                    status = excluded.status, 
                    payload = excluded.payload,
                    updated_at = CURRENT_TIMESTAMP
            `).run(task.id, task.type, task.priority, currentPayload, status, addedAtDate);
        } catch (err) {
            logger.error({ err }, `[TaskQueue] ❌ Failed to sync task ${task.id} to DB.`);
        }
    }

    public updateTaskPayload(taskId: string, newPayload: any): void {
        const t = this.queue.find(x => x.id === taskId);
        if (t) {
            t.payload = newPayload;
            this.syncToDb(t, 'running'); // Just an update
        } else {
            // Task might not be in memory queue but we can still update DB
            if (this.db) {
                try {
                    this.db.prepare(`UPDATE autonomous_tasks SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(JSON.stringify(newPayload), taskId);
                } catch (e) {
                    logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to update task payload in DB');
                }
            }
        }
    }

    enqueue(task: AutonomousTask): void {
        if (!task.execute && task.type) {
            const handler = this.registry.get(task.type);
            if (handler) {
                task.execute = async (signal) => {
                    await handler(task.payload, signal);
                };
            }
        }

        // Binary insertion — O(log N) arama + O(N) splice, her seferinde O(N log N) sort yerine
        let lo = 0;
        let hi = this.queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const cmp = this.queue[mid].priority !== task.priority
                ? this.queue[mid].priority - task.priority
                : this.queue[mid].addedAt - task.addedAt;
            if (cmp <= 0) lo = mid + 1;
            else hi = mid;
        }
        this.queue.splice(lo, 0, task);

        this.syncToDb(task, 'pending');
        logger.debug(`[TaskQueue] Enqueued task ${task.type} (${task.id}) with priority P${task.priority}`);
    }

    dequeue(): AutonomousTask | undefined {
        // Queue is already sorted by priority and addedAt, check first element only
        const now = Date.now();
        if (this.queue.length === 0) return undefined;
        const task = this.queue[0];
        if (task.addedAt > now) return undefined; // Not yet ready

        this.queue.shift(); // Remove first element
        this.syncToDb(task, 'running');
        return task;
    }

    markCompleted(taskId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(`UPDATE autonomous_tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
        } catch (e) {
            logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to mark task completed in DB');
        }
    }

    markFailed(taskId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(`UPDATE autonomous_tasks SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
        } catch (e) {
            logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to mark task failed in DB');
        }
    }

    peek(): AutonomousTask | undefined {
        return this.queue[0];
    }

    remove(taskId: string): boolean {
        const initialLength = this.queue.length;
        const taskToRemove = this.queue.find(t => t.id === taskId);
        this.queue = this.queue.filter(t => t.id !== taskId);

        if (taskToRemove && this.db) {
            try {
                this.db.prepare(`DELETE FROM autonomous_tasks WHERE id = ?`).run(taskId);
            } catch (e) {
                logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to delete task from DB');
            }
        }

        return this.queue.length < initialLength;
    }

    get length(): number {
        return this.queue.length;
    }

    clear(): void {
        this.queue = [];
        if (this.db) {
            try {
                this.db.prepare(`DELETE FROM autonomous_tasks WHERE status IN ('pending', 'running')`).run();
            } catch (e) {
                logger.warn({ err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to clear pending/running tasks from DB');
            }
        }
    }

    getTasks(): AutonomousTask[] {
        return [...this.queue];
    }
}
