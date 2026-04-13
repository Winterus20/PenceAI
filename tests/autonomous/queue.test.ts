import { TaskQueue, TaskPriority } from '../../src/autonomous/queue.js';
import type { AutonomousTask, TaskExecutor } from '../../src/autonomous/queue.js';

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function makeTask(overrides: Partial<AutonomousTask> = {}): AutonomousTask {
    const base: AutonomousTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'test',
        priority: TaskPriority.P3_NORMAL,
        payload: {},
        addedAt: Date.now() - 1000,
    };
    return { ...base, ...overrides } as AutonomousTask;
}

// ═══════════════════════════════════════════════════════════
//  enqueue with priority ordering
// ═══════════════════════════════════════════════════════════

describe('TaskQueue', () => {
    describe('enqueue', () => {
        it('should order tasks by priority (P1 before P4)', () => {
            const queue = new TaskQueue();

            queue.enqueue(makeTask({ id: 'p4', priority: TaskPriority.P4_LOW, addedAt: 100 }));
            queue.enqueue(makeTask({ id: 'p1', priority: TaskPriority.P1_CRITICAL, addedAt: 200 }));
            queue.enqueue(makeTask({ id: 'p2', priority: TaskPriority.P2_HIGH, addedAt: 300 }));

            const tasks = queue.getTasks();
            expect(tasks[0].id).toBe('p1');
            expect(tasks[1].id).toBe('p2');
            expect(tasks[2].id).toBe('p4');
        });

        it('should order same-priority tasks by addedAt (earlier first)', () => {
            const queue = new TaskQueue();

            queue.enqueue(makeTask({ id: 'later', priority: TaskPriority.P3_NORMAL, addedAt: 300 }));
            queue.enqueue(makeTask({ id: 'earlier', priority: TaskPriority.P3_NORMAL, addedAt: 100 }));
            queue.enqueue(makeTask({ id: 'middle', priority: TaskPriority.P3_NORMAL, addedAt: 200 }));

            const tasks = queue.getTasks();
            expect(tasks[0].id).toBe('earlier');
            expect(tasks[1].id).toBe('middle');
            expect(tasks[2].id).toBe('later');
        });

        it('should insert maintaining sort order', () => {
            const queue = new TaskQueue();

            queue.enqueue(makeTask({ id: 'a', priority: TaskPriority.P3_NORMAL, addedAt: 100 }));
            queue.enqueue(makeTask({ id: 'b', priority: TaskPriority.P1_CRITICAL, addedAt: 200 }));
            queue.enqueue(makeTask({ id: 'c', priority: TaskPriority.P2_HIGH, addedAt: 300 }));

            expect(queue.peek()?.id).toBe('b');
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  dequeue
    // ═══════════════════════════════════════════════════════════

    describe('dequeue', () => {
        it('should remove and return the first ready task', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'first', priority: TaskPriority.P1_CRITICAL, addedAt: Date.now() - 1000, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'second', priority: TaskPriority.P2_HIGH, addedAt: Date.now() - 500, execute: async () => {} }));

            const task = queue.dequeue();
            expect(task?.id).toBe('first');
            expect(queue.length).toBe(1);
        });

        it('should skip tasks with future addedAt', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'future', priority: TaskPriority.P1_CRITICAL, addedAt: Date.now() + 60000, execute: async () => {} }));

            const task = queue.dequeue();
            expect(task).toBeUndefined();
            expect(queue.length).toBe(1); // Task stays in queue
        });

        it('should return undefined when queue is empty', () => {
            const queue = new TaskQueue();
            expect(queue.dequeue()).toBeUndefined();
        });

        it('should dequeue highest priority among ready tasks', () => {
            const queue = new TaskQueue();
            const now = Date.now();
            queue.enqueue(makeTask({ id: 'p3', priority: TaskPriority.P3_NORMAL, addedAt: now - 1000, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'p1', priority: TaskPriority.P1_CRITICAL, addedAt: now - 500, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'p4_future', priority: TaskPriority.P4_LOW, addedAt: now + 60000, execute: async () => {} }));

            const task = queue.dequeue();
            expect(task?.id).toBe('p1');
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  markCompleted / markFailed
    // ═══════════════════════════════════════════════════════════

    describe('markCompleted / markFailed', () => {
        it('markCompleted should not throw', () => {
            const queue = new TaskQueue();
            expect(() => queue.markCompleted('nonexistent')).not.toThrow();
        });

        it('markFailed should not throw', () => {
            const queue = new TaskQueue();
            expect(() => queue.markFailed('nonexistent')).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  remove
    // ═══════════════════════════════════════════════════════════

    describe('remove', () => {
        it('should remove task by ID and return true', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'removable', addedAt: Date.now() - 1000, execute: async () => {} }));

            const removed = queue.remove('removable');
            expect(removed).toBe(true);
            expect(queue.length).toBe(0);
        });

        it('should return false for non-existent task ID', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'exists', addedAt: Date.now() - 1000, execute: async () => {} }));

            const removed = queue.remove('nonexistent');
            expect(removed).toBe(false);
            expect(queue.length).toBe(1);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  clear
    // ═══════════════════════════════════════════════════════════

    describe('clear', () => {
        it('should remove all tasks', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'a', addedAt: Date.now() - 1000, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'b', addedAt: Date.now() - 1000, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'c', addedAt: Date.now() - 1000, execute: async () => {} }));

            queue.clear();
            expect(queue.length).toBe(0);
        });

        it('should work on empty queue', () => {
            const queue = new TaskQueue();
            expect(() => queue.clear()).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  loadPendingTasks
    // ═══════════════════════════════════════════════════════════

    describe('loadPendingTasks', () => {
        it('should do nothing without DB', () => {
            const queue = new TaskQueue();
            expect(() => queue.loadPendingTasks()).not.toThrow();
            expect(queue.length).toBe(0);
        });

        it('should load pending tasks from mock DB', () => {
            // Create an in-memory better-sqlite3 database
            const Database = require('better-sqlite3');
            const db = new Database(':memory:');

            db.exec(`
                CREATE TABLE autonomous_tasks (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    added_at TEXT NOT NULL,
                    updated_at TEXT
                )
            `);

            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task1', 'test_type', 1, JSON.stringify({ key: 'value1' }), 'pending', now);
            db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task2', 'test_type', 3, JSON.stringify({ key: 'value2' }), 'pending', now);
            db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task3', 'test_type', 2, JSON.stringify({ key: 'value3' }), 'completed', now);

            const executor: TaskExecutor = async () => {};
            const queue = new TaskQueue(db);
            queue.registerHandler('test_type', executor);
            queue.loadPendingTasks();

            // Only pending/running, not completed
            expect(queue.length).toBe(2);

            // Should be sorted by priority
            const tasks = queue.getTasks();
            expect(tasks[0].id).toBe('task1'); // P1
            expect(tasks[1].id).toBe('task2'); // P3
        });

        it('should skip tasks with no registered handler', () => {
            const Database = require('better-sqlite3');
            const db = new Database(':memory:');

            db.exec(`
                CREATE TABLE autonomous_tasks (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    added_at TEXT NOT NULL,
                    updated_at TEXT
                )
            `);

            db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task_unknown_type', 'unknown_type', 1, '{}', 'pending', new Date().toISOString());

            const queue = new TaskQueue(db);
            // No handler registered for 'unknown_type'
            queue.loadPendingTasks();
            expect(queue.length).toBe(0);
        });

        it('should handle malformed JSON payload gracefully', () => {
            const Database = require('better-sqlite3');
            const db = new Database(':memory:');

            db.exec(`
                CREATE TABLE autonomous_tasks (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    added_at TEXT NOT NULL,
                    updated_at TEXT
                )
            `);

            db.prepare(`
                INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task_bad_json', 'test', 1, '{invalid json}', 'pending', new Date().toISOString());

            const executor: TaskExecutor = async () => {};
            const queue = new TaskQueue(db);
            queue.registerHandler('test', executor);
            queue.loadPendingTasks();
            expect(queue.length).toBe(1);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  registerHandler and handler execution
    // ═══════════════════════════════════════════════════════════

    describe('registerHandler', () => {
        it('should register a handler for a task type', () => {
            const queue = new TaskQueue();
            const handler: TaskExecutor = async () => {};
            expect(() => queue.registerHandler('my_type', handler)).not.toThrow();
        });

        it('should auto-wire execute function when enqueuing a task with a registered handler', async () => {
            const queue = new TaskQueue();
            let handlerCalled = false;
            const handler: TaskExecutor = async (payload) => {
                handlerCalled = true;
                expect(payload.key).toBe('test_value');
            };
            queue.registerHandler('auto_type', handler);

            queue.enqueue(makeTask({
                id: 'auto_exec',
                type: 'auto_type',
                payload: { key: 'test_value' },
                addedAt: Date.now() - 1000,
                // no execute function provided
            }));

            const task = queue.dequeue();
            expect(task).toBeDefined();
            expect(task?.type).toBe('auto_type');

            if (task?.execute) {
                await task.execute(new AbortController().signal);
            }
            expect(handlerCalled).toBe(true);
        });

        it('should allow multiple handler types', () => {
            const queue = new TaskQueue();
            queue.registerHandler('type_a', async () => {});
            queue.registerHandler('type_b', async () => {});
            queue.registerHandler('type_c', async () => {});
            expect(queue.length).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  peek and length
    // ═══════════════════════════════════════════════════════════

    describe('peek and length', () => {
        it('should return first task without removing', () => {
            const queue = new TaskQueue();
            queue.enqueue(makeTask({ id: 'first', addedAt: Date.now() - 1000, execute: async () => {} }));
            queue.enqueue(makeTask({ id: 'second', addedAt: Date.now() - 1000, execute: async () => {} }));

            expect(queue.peek()?.id).toBe('first');
            expect(queue.length).toBe(2);
        });

        it('should return undefined on empty queue', () => {
            const queue = new TaskQueue();
            expect(queue.peek()).toBeUndefined();
        });

        it('should track length correctly after operations', () => {
            const queue = new TaskQueue();
            expect(queue.length).toBe(0);

            queue.enqueue(makeTask({ id: 'a', addedAt: Date.now() - 1000, execute: async () => {} }));
            expect(queue.length).toBe(1);

            queue.dequeue();
            expect(queue.length).toBe(0);
        });
    });
});
