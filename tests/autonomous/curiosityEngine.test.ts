import Database from 'better-sqlite3';
import {
    SubAgentManager,
    DEFAULT_SUBAGENT_CONFIG,
    type Fixation,
    type ResearchReport,
    type ResearchTask,
} from '../../src/autonomous/curiosityEngine.js';

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function createFreshDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE autonomous_tasks (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            added_at TEXT NOT NULL,
            updated_at TEXT
        )
    `);
    return db;
}

function createFreshManager(db?: Database.Database): SubAgentManager {
    const database = db || createFreshDb();
    return new SubAgentManager(database);
}

function makeFixation(overrides: Partial<Fixation> = {}): Fixation {
    const base: Fixation = {
        topic: 'TypeScript 5.0 decorators',
        source: 'thought_chain',
        urgency: 'medium',
        relatedMemoryIds: [1, 2],
    };
    return { ...base, ...overrides };
}

// ═══════════════════════════════════════════════════════════
//  createTask with valid fixation
// ═══════════════════════════════════════════════════════════

describe('SubAgentManager', () => {
    describe('createTask', () => {
        it('should create a task from a valid fixation', () => {
            const manager = createFreshManager();
            const task = manager.createTask(makeFixation());

            expect(task).not.toBeNull();
            expect(task!.fixation).toBe('TypeScript 5.0 decorators');
            expect(task!.status).toBe('pending');
            expect(task!.category).toBeDefined();
            expect(task!.priority).toBe(3); // medium urgency => P3
            expect(task!.query).toContain('TypeScript 5.0 decorators');
        });

        it('should assign priority 1 for high urgency', () => {
            const manager = createFreshManager();
            const task = manager.createTask(makeFixation({ urgency: 'high' }));
            expect(task).not.toBeNull();
            expect(task!.priority).toBe(1);
        });

        it('should assign priority 5 for low urgency', () => {
            const manager = createFreshManager();
            const task = manager.createTask(makeFixation({ urgency: 'low' }));
            expect(task).not.toBeNull();
            expect(task!.priority).toBe(5);
        });

        it('should increment active task count', () => {
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxConcurrentTasks: 5, maxDailyTasks: 10 });
            manager.createTask(makeFixation({ topic: 'task1' }));
            expect(manager.getActiveCount()).toBe(1);

            manager.createTask(makeFixation({ topic: 'task2' }));
            expect(manager.getActiveCount()).toBe(2);
        });

        it('should persist task to DB', () => {
            const db = createFreshDb();
            const manager = createFreshManager(db);
            manager.createTask(makeFixation({ topic: 'db_task' }));

            const rows = db.prepare("SELECT COUNT(*) as cnt FROM autonomous_tasks WHERE status = 'pending'").get() as { cnt: number };
            expect(rows.cnt).toBe(1);
        });

        it('should set correct context string', () => {
            const manager = createFreshManager();
            const task = manager.createTask(makeFixation({
                source: 'news_trigger',
                relatedMemoryIds: [10, 20, 30],
            }));

            expect(task).not.toBeNull();
            expect(task!.context).toContain('news_trigger');
            expect(task!.context).toContain('3');
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  createTask respects daily limit
    // ═══════════════════════════════════════════════════════════

    describe('createTask daily limit', () => {
        it('should prevent task creation when daily limit is reached', () => {
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxDailyTasks: DEFAULT_SUBAGENT_CONFIG.maxDailyTasks, maxConcurrentTasks: DEFAULT_SUBAGENT_CONFIG.maxDailyTasks });
            const limit = DEFAULT_SUBAGENT_CONFIG.maxDailyTasks;

            // Create tasks up to the limit
            for (let i = 0; i < limit; i++) {
                const task = manager.createTask(makeFixation({ topic: `topic_${i}` }));
                expect(task).not.toBeNull();
            }

            // Next one should be null
            const overLimitTask = manager.createTask(makeFixation({ topic: 'over_limit' }));
            expect(overLimitTask).toBeNull();
        });

        it('should report correct remaining quota', () => {
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxDailyTasks: DEFAULT_SUBAGENT_CONFIG.maxDailyTasks, maxConcurrentTasks: DEFAULT_SUBAGENT_CONFIG.maxDailyTasks });
            const limit = DEFAULT_SUBAGENT_CONFIG.maxDailyTasks;

            expect(manager.getRemainingDailyQuota()).toBe(limit);

            manager.createTask(makeFixation({ topic: 't1' }));
            expect(manager.getRemainingDailyQuota()).toBe(limit - 1);

            manager.createTask(makeFixation({ topic: 't2' }));
            expect(manager.getRemainingDailyQuota()).toBe(limit - 2);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  createTask respects cooldown
    // ═══════════════════════════════════════════════════════════

    describe('createTask cooldown', () => {
        it('should block task creation within cooldown period', () => {
            const db = createFreshDb();
            // Default cooldown is 15 minutes
            const manager = new SubAgentManager(db, { cooldownMinutes: 15, maxDailyTasks: 10, maxConcurrentTasks: 5 });

            const first = manager.createTask(makeFixation({ topic: 'first' }));
            expect(first).not.toBeNull();

            // Immediate second creation should be blocked by cooldown (15 min default)
            const second = manager.createTask(makeFixation({ topic: 'second' }));
            expect(second).toBeNull();
        });

        it('should allow task creation after cooldown', () => {
            // Use a 0-minute cooldown for testing
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxDailyTasks: 10, maxConcurrentTasks: 5 });

            const first = manager.createTask(makeFixation({ topic: 'first' }));
            expect(first).not.toBeNull();

            const second = manager.createTask(makeFixation({ topic: 'second' }));
            expect(second).not.toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  createTask prevents duplicates
    // ═══════════════════════════════════════════════════════════

    describe('createTask duplicate prevention', () => {
        it('should prevent duplicate fixation topics (case-insensitive)', () => {
            // Use 0 cooldown for this test
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxDailyTasks: 10 });

            const first = manager.createTask(makeFixation({ topic: 'TypeScript generics' }));
            expect(first).not.toBeNull();

            const duplicate = manager.createTask(makeFixation({ topic: 'typescript generics' }));
            expect(duplicate).toBeNull();
        });

        it('should allow different topics', () => {
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { cooldownMinutes: 0, maxDailyTasks: 10, maxConcurrentTasks: 5 });

            const t1 = manager.createTask(makeFixation({ topic: 'React hooks' }));
            const t2 = manager.createTask(makeFixation({ topic: 'Vue composables' }));

            expect(t1).not.toBeNull();
            expect(t2).not.toBeNull();
            expect(manager.getActiveCount()).toBe(2);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  parseReport
    // ═══════════════════════════════════════════════════════════

    describe('parseReport', () => {
        it('should extract summary, findings, and sources from well-formed markdown', () => {
            const manager = createFreshManager();
            const rawResponse = [
                '## Özet',
                'TypeScript 5.0 yeni decorator sistemi getiriyor.',
                '',
                '## Anahtar Bulgular',
                '- Decorator standardizasyonu ECMAScript ile uyumlu',
                '- Performans iyileştirmeleri mevcut',
                '',
                '## Kaynaklar',
                '- https://www.typescriptlang.org',
                '- https://devblogs.microsoft.com/typescript',
                '',
                '## Zaman Hassasiyeti',
                'Evet, yeni release ile değişebilir.',
            ].join('\n');

            const report = manager.parseReport(rawResponse, 0.8);

            expect(report.summary).toContain('TypeScript 5.0');
            expect(report.keyFindings.length).toBe(2);
            expect(report.keyFindings[0]).toContain('Decorator standardizasyonu');
            expect(report.sources.length).toBe(2);
            expect(report.sources[0]).toContain('typescriptlang');
            expect(report.isTimeSensitive).toBe(true);
            expect(report.relevanceScore).toBe(0.8);
        });

        it('should handle missing sections gracefully', () => {
            const manager = createFreshManager();
            const rawResponse = 'Just some random text without proper sections.';

            const report = manager.parseReport(rawResponse, 0.5);

            expect(report.summary).toBe(rawResponse.substring(0, 500));
            expect(report.keyFindings).toEqual([]);
            expect(report.sources).toEqual([]);
            expect(report.isTimeSensitive).toBe(false);
        });

        it('should handle partial markdown', () => {
            const manager = createFreshManager();
            const rawResponse = [
                '## Özet',
                'Partial content.',
                '',
                'Some extra text without headers.',
            ].join('\n');

            const report = manager.parseReport(rawResponse);

            expect(report.summary).toContain('Partial content.');
            expect(report.keyFindings).toEqual([]);
        });

        it('should trim summary to maxReportLength', () => {
            const db = createFreshDb();
            const manager = new SubAgentManager(db, { maxReportLength: 50 });

            const longSummary = 'A'.repeat(200);
            const rawResponse = `## Özet\n${longSummary}`;

            const report = manager.parseReport(rawResponse);
            expect(report.summary.length).toBeLessThanOrEqual(50);
        });

        it('should detect time sensitivity as false when no Evet found', () => {
            const manager = createFreshManager();
            const rawResponse = [
                '## Zaman Hassasiyeti',
                'Hayır, bu bilgi zamanla değer kaybetmez.',
            ].join('\n');

            const report = manager.parseReport(rawResponse);
            expect(report.isTimeSensitive).toBe(false);
        });

        it('should handle empty response', () => {
            const manager = createFreshManager();
            const report = manager.parseReport('', 0.0);

            expect(report.summary).toBe('');
            expect(report.keyFindings).toEqual([]);
            expect(report.sources).toEqual([]);
            expect(report.relevanceScore).toBe(0.0);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  buildResearchMessages
    // ═══════════════════════════════════════════════════════════

    describe('buildResearchMessages', () => {
        it('should create correct message structure', () => {
            const manager = createFreshManager();
            const task: ResearchTask = {
                id: 'test_task_1',
                fixation: 'Test topic',
                query: 'What is X?',
                category: 'web_search',
                priority: 3,
                context: 'Test context from thought chain',
                status: 'pending',
                createdAt: new Date().toISOString(),
            };

            const messages = manager.buildResearchMessages(task);

            expect(messages.length).toBe(2);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toContain('kısa ve öz araştırma raporları');
            expect(messages[1].role).toBe('user');
            expect(messages[1].content).toContain('What is X?');
            expect(messages[1].content).toContain('Test context from thought chain');
            expect(messages[1].content).toContain('web_search');
            expect(messages[1].content).toContain('P3');
        });

        it('should include all task metadata in user message', () => {
            const manager = createFreshManager();
            const task: ResearchTask = {
                id: 'test_meta',
                fixation: 'Meta topic',
                query: 'Explain meta',
                category: 'deep_dive',
                priority: 1,
                context: 'Deep research context',
                status: 'pending',
                createdAt: new Date().toISOString(),
            };

            const messages = manager.buildResearchMessages(task);
            const userContent = messages[1].content;

            expect(userContent).toContain('Explain meta');
            expect(userContent).toContain('Deep research context');
            expect(userContent).toContain('deep_dive');
            expect(userContent).toContain('P1');
        });
    });
});
