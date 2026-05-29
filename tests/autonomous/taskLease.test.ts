import { TaskQueue, TaskPriority } from '../../src/autonomous/queue.js';
import { TaskSweeper } from '../../src/autonomous/taskSweeper.js';

function createTestDb() {
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
            updated_at TEXT,
            lease_expires_at TEXT,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 2,
            lease_token TEXT
        );
        CREATE INDEX idx_autonomous_tasks_status_lease ON autonomous_tasks(status, lease_expires_at);
    `);
    return db;
}

describe('TaskQueue lease recovery', () => {
    it('recoverStaleTasksOnStartup resets running tasks to pending', () => {
        const db = createTestDb();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at, lease_token, lease_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('stale-1', 'test_type', 1, '{}', 'running', now, 'token-1', now);

        const queue = new TaskQueue(db);
        const recovered = queue.recoverStaleTasksOnStartup();

        expect(recovered).toBe(1);
        const row = db.prepare(`SELECT status, lease_token FROM autonomous_tasks WHERE id = ?`).get('stale-1') as {
            status: string;
            lease_token: string | null;
        };
        expect(row.status).toBe('pending');
        expect(row.lease_token).toBeNull();
    });

    it('sweepExpiredLeases requeues expired running task and skips active task', () => {
        const db = createTestDb();
        const past = new Date(Date.now() - 60_000).toISOString();
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at, lease_expires_at, retry_count, max_retries)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('expired-1', 'test_type', 2, '{}', 'running', now, past, 0, 2);

        db.prepare(`
            INSERT INTO autonomous_tasks (id, type, priority, payload, status, added_at, lease_expires_at, retry_count, max_retries)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('active-1', 'test_type', 1, '{}', 'running', now, past, 0, 2);

        const queue = new TaskQueue(db);
        queue.registerHandler('test_type', async () => {});

        const { requeued, failed } = queue.sweepExpiredLeases('active-1');

        expect(requeued).toBe(1);
        expect(failed).toBe(0);
        expect(queue.length).toBe(1);

        const activeRow = db.prepare(`SELECT status FROM autonomous_tasks WHERE id = ?`).get('active-1') as { status: string };
        expect(activeRow.status).toBe('running');

        const expiredRow = db.prepare(`SELECT status, retry_count FROM autonomous_tasks WHERE id = ?`).get('expired-1') as {
            status: string;
            retry_count: number;
        };
        expect(expiredRow.status).toBe('pending');
        expect(expiredRow.retry_count).toBe(1);
    });
});

describe('TaskSweeper', () => {
    it('tick delegates to queue.sweepExpiredLeases with active task id', () => {
        const db = createTestDb();
        const queue = new TaskQueue(db);
        const sweepSpy = jest.spyOn(queue, 'sweepExpiredLeases').mockReturnValue({ requeued: 0, failed: 0 });

        const sweeper = new TaskSweeper(queue, () => 'active-task-id', 60_000);
        sweeper.tick();

        expect(sweepSpy).toHaveBeenCalledWith('active-task-id');
        sweepSpy.mockRestore();
    });
});

describe('TaskQueue dequeue lease', () => {
    it('sets running status with lease in DB on dequeue', () => {
        const db = createTestDb();
        const queue = new TaskQueue(db);
        queue.registerHandler('test_type', async () => {});
        queue.enqueue({
            id: 'task-lease-1',
            type: 'test_type',
            priority: TaskPriority.P3_NORMAL,
            payload: {},
            addedAt: Date.now() - 1000,
        });

        const task = queue.dequeue();
        expect(task?.id).toBe('task-lease-1');
        expect(task?.leaseToken).toBeDefined();

        const row = db.prepare(`
            SELECT status, lease_token, lease_expires_at FROM autonomous_tasks WHERE id = ?
        `).get('task-lease-1') as { status: string; lease_token: string; lease_expires_at: string };

        expect(row.status).toBe('running');
        expect(row.lease_token).toBeTruthy();
        expect(row.lease_expires_at).toBeTruthy();
    });
});
