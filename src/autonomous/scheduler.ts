import { Cron } from 'croner';
import { logger } from '../utils/logger.js';
import type { TaskQueue, AutonomousTask } from './queue.js';
import { TaskPriority } from './queue.js';
import { getConfig } from '../gateway/config.js';

export class AutonomousScheduler {
    private cronJob: Cron | null = null;
    
    constructor(private readonly taskQueue: TaskQueue) {}

    public start(): void {
        const config = getConfig();
        if (this.cronJob) {
            this.cronJob.stop();
        }

        // Example: Cron format from config or default to every 10 minutes
        const cronExpression = config.autonomousScheduleCron ?? '*/10 * * * *';

        logger.info(`[Scheduler] 🕒 Starting autonomous cron scheduler with pattern: ${cronExpression}`);
        
        this.cronJob = new Cron(cronExpression, () => {
            this.handleCronWakeup();
        });
    }

    public stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info(`[Scheduler] 🛑 Stopped autonomous cron scheduler`);
        }
    }

    private async handleCronWakeup(): Promise<void> {
        logger.info(`[Scheduler] 🤖 Proactive wakeup triggered.`);
        // Here we could enqueue tasks like telescopic_compaction, memory decay, etc.
        // For now, we queue up telescopic compaction if needed
        const task: AutonomousTask = {
            id: `proactive_compaction_${Date.now()}`,
            type: 'telescopic_compaction_scan',
            priority: TaskPriority.P3_NORMAL,
            payload: {},
            addedAt: Date.now()
        };
        this.taskQueue.enqueue(task);
    }
}
