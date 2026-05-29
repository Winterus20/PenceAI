import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type Database from 'better-sqlite3';

export const DEFAULT_TASK_LEASE_MS = 15 * 60 * 1000;

export type TaskPayload = Record<string, unknown>;

export type TaskExecutor = (payload: TaskPayload, signal: AbortSignal) => Promise<void>;

export enum TaskPriority {
    P1_CRITICAL = 1,
    P2_HIGH = 2,
    P3_NORMAL = 3,
    P4_LOW = 4,
}

export interface AutonomousTask {
    id: string;
    type: string;
    priority: TaskPriority;
    payload: TaskPayload;
    addedAt: number;
    execute?: (signal: AbortSignal) => Promise<void>;
    retryCount?: number;
    maxRetries?: number;
    leaseToken?: string;
}

interface DbTaskRow {
    id: string;
    type: string;
    priority: number;
    payload: string;
    added_at: string;
    retry_count?: number | null;
    max_retries?: number | null;
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

    /**
     * Crash sonrası DB'de 'running' kalan görevleri pending'e çevirir.
     */
    public recoverStaleTasksOnStartup(): number {
        if (!this.db) return 0;
        try {
            const result = this.db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'pending',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'running'
            `).run();
            if (result.changes > 0) {
                logger.info(`[TaskQueue] 🔄 Recovered ${result.changes} stale running task(s) → pending`);
            }
            return result.changes;
        } catch (err) {
            logger.warn({ err }, '[TaskQueue] Failed to recover stale tasks on startup');
            return 0;
        }
    }

    public loadPendingTasks(): void {
        if (!this.db) return;
        this.recoverStaleTasksOnStartup();
        try {
            const rows = this.db.prepare(`
                SELECT id, type, priority, payload, added_at, retry_count, max_retries
                FROM autonomous_tasks
                WHERE status = 'pending'
                ORDER BY priority ASC, added_at ASC
            `).all() as DbTaskRow[];

            let loadedCount = 0;
            for (const row of rows) {
                if (this.queue.some((task) => task.id === row.id)) continue;
                if (!this.rehydrateTaskFromRow(row)) continue;
                loadedCount++;
            }

            logger.info(`[TaskQueue] 💾 Checkpoint: Found ${rows.length} pending tasks, rehydrated ${loadedCount} into memory.`);
        } catch (err) {
            logger.warn({ err }, '[TaskQueue] ❌ Failed to load pending tasks from DB.');
        }
    }

    /**
     * Süresi dolmuş lease'leri geri alır. Aktif worker görevini atlar.
     */
    public sweepExpiredLeases(skipTaskId?: string | null): { requeued: number; failed: number } {
        if (!this.db) return { requeued: 0, failed: 0 };

        const now = new Date().toISOString();
        const skipId = skipTaskId ?? null;

        try {
            const failed = this.db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'failed',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'running'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < ?
                  AND COALESCE(retry_count, 0) >= COALESCE(max_retries, 2)
                  AND (? IS NULL OR id != ?)
            `).run(now, skipId, skipId).changes;

            const requeuedRows = this.db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'pending',
                    retry_count = COALESCE(retry_count, 0) + 1,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'running'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < ?
                  AND COALESCE(retry_count, 0) < COALESCE(max_retries, 2)
                  AND (? IS NULL OR id != ?)
                RETURNING id, type, priority, payload, added_at, retry_count, max_retries
            `).all(now, skipId, skipId) as DbTaskRow[];

            let rehydrated = 0;
            for (const row of requeuedRows) {
                if (this.rehydrateTaskFromRow(row)) {
                    rehydrated++;
                }
            }

            return { requeued: rehydrated, failed };
        } catch (err) {
            logger.warn({ err }, '[TaskQueue] Failed to sweep expired leases');
            return { requeued: 0, failed: 0 };
        }
    }

    public renewLease(taskId: string): boolean {
        if (!this.db) return false;
        try {
            const expiresAt = new Date(Date.now() + DEFAULT_TASK_LEASE_MS).toISOString();
            const result = this.db.prepare(`
                UPDATE autonomous_tasks
                SET lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'running'
            `).run(expiresAt, taskId);
            return result.changes > 0;
        } catch (err) {
            logger.warn({ err, taskId }, '[TaskQueue] Failed to renew lease');
            return false;
        }
    }

    private rehydrateTaskFromRow(row: DbTaskRow): boolean {
        const handler = this.registry.get(row.type);
        if (!handler) {
            logger.warn(`[TaskQueue] ⚠️ No handler registered for task type: ${row.type}. Skipping task ${row.id}.`);
            return false;
        }

        let parsedPayload: TaskPayload = {};
        try {
            parsedPayload = JSON.parse(row.payload);
        } catch (e) {
            logger.debug({ taskId: row.id, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to parse task payload, using empty object');
        }

        const task: AutonomousTask = {
            id: row.id,
            type: row.type,
            priority: row.priority as TaskPriority,
            payload: parsedPayload,
            addedAt: new Date(row.added_at).getTime(),
            retryCount: row.retry_count ?? 0,
            maxRetries: row.max_retries ?? 2,
            execute: async (signal) => {
                await handler(parsedPayload, signal);
            },
        };

        this.insertSorted(task);
        return true;
    }

    private syncToDb(
        task: AutonomousTask,
        status: 'pending' | 'running' | 'completed' | 'failed',
        payloadStr?: string,
        lease?: { token: string; expiresAt: string } | null,
    ): void {
        if (!this.db) return;
        try {
            const currentPayload = payloadStr ?? JSON.stringify(task.payload);
            const addedAtDate = new Date(task.addedAt).toISOString();

            this.db.prepare(`
                INSERT INTO autonomous_tasks (
                    id, type, priority, payload, status, added_at, updated_at,
                    lease_token, lease_expires_at, retry_count, max_retries
                )
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    payload = excluded.payload,
                    updated_at = CURRENT_TIMESTAMP,
                    lease_token = excluded.lease_token,
                    lease_expires_at = excluded.lease_expires_at,
                    retry_count = COALESCE(excluded.retry_count, autonomous_tasks.retry_count, 0),
                    max_retries = COALESCE(excluded.max_retries, autonomous_tasks.max_retries, 2)
            `).run(
                task.id,
                task.type,
                task.priority,
                currentPayload,
                status,
                addedAtDate,
                lease?.token ?? null,
                lease?.expiresAt ?? null,
                task.retryCount ?? 0,
                task.maxRetries ?? 2,
            );
        } catch (err) {
            logger.error({ err }, `[TaskQueue] ❌ Failed to sync task ${task.id} to DB.`);
        }
    }

    public updateTaskPayload(taskId: string, newPayload: TaskPayload): void {
        const t = this.queue.find(x => x.id === taskId);
        if (t) {
            t.payload = newPayload;
            this.syncToDb(t, 'running');
        } else if (this.db) {
            try {
                this.db.prepare(`UPDATE autonomous_tasks SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                    .run(JSON.stringify(newPayload), taskId);
            } catch (e) {
                logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to update task payload in DB');
            }
        }
    }

    private insertSorted(task: AutonomousTask): void {
        let lo = 0;
        let hi = this.queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const qElement = this.queue[mid]!;
            const cmp = qElement.priority !== task.priority
                ? qElement.priority - task.priority
                : qElement.addedAt - task.addedAt;
            if (cmp <= 0) lo = mid + 1;
            else hi = mid;
        }
        this.queue.splice(lo, 0, task);
    }

    enqueue(task: AutonomousTask): void {
        if (!task.execute && task.type) {
            const handler = this.registry.get(task.type);
            if (handler) {
                const payload = task.payload;
                task.execute = async (signal) => {
                    await handler(payload, signal);
                };
            }
        }

        this.insertSorted(task);
        this.syncToDb(task, 'pending');
        logger.debug(`[TaskQueue] Enqueued task ${task.type} (${task.id}) with priority P${task.priority}`);
    }

    dequeue(): AutonomousTask | undefined {
        const now = Date.now();
        if (this.queue.length === 0) return undefined;
        const task = this.queue[0]!;
        if (task.addedAt > now) return undefined;

        this.queue.shift();
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(Date.now() + DEFAULT_TASK_LEASE_MS).toISOString();
        task.leaseToken = leaseToken;
        this.syncToDb(task, 'running', undefined, { token: leaseToken, expiresAt: leaseExpiresAt });
        return task;
    }

    markCompleted(taskId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'completed',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(taskId);
        } catch (e) {
            logger.warn({ taskId, err: e instanceof Error ? e.message : e }, '[TaskQueue] Failed to mark task completed in DB');
        }
    }

    markFailed(taskId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'failed',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(taskId);
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
