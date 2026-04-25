import { Cron } from 'croner';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { ToolExecutor } from '../../../agent/tools.js';
import { logger } from '../../../utils/logger.js';

// In-memory cron references for cancel/rehydrate
const activeCronJobs = new Map<string, Cron>();
const activeTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Cron ve zamanlayıcı araçlarını oluşturur.
 * DB referansı verilirse zamanlayıcılar kalıcı olarak kaydedilir ve restart'ta rehydrate edilir.
 */
export function createCronTools(db?: Database.Database): ToolExecutor[] {
    return [
        // ── Tek Seferlik Zamanlayıcı ──
        {
            name: 'wake_me_in',
            execute: async (args: Record<string, unknown>, context?: { conversationId?: string }) => {
                const minutes = Number(args.minutes);
                const reason = String(args.reason ?? '');
                const conversationId = context?.conversationId || String(args.conversationId ?? '');
                const timerId = uuidv4();

                if (!minutes || minutes <= 0) {
                    return 'Hata: "minutes" pozitif bir sayı olmalıdır.';
                }
                if (!reason) {
                    return 'Hata: "reason" alanı zorunludur.';
                }

                // DB'ye kaydet
                if (db) {
                    const fireAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
                    try {
                        db.prepare(`
                            INSERT INTO scheduled_tasks (id, name, cron_expression, action, enabled, next_run, timer_type, conversation_id)
                            VALUES (?, ?, ?, ?, 1, ?, 'one_time', ?)
                        `).run(timerId, `wake_in_${minutes}min`, `after:${minutes}m`, JSON.stringify({ reason, conversationId }), fireAt, conversationId || null);
                    } catch (err) {
                        logger.warn({ err }, '[CronTools] DB kayıt hatası (wake_me_in)');
                    }
                }

                logger.info(`[CronTools] ⏰ Uyandırma planlandı: ${minutes} dk sonra. Sebep: ${reason} (ID: ${timerId})`);

                const timeout = setTimeout(() => {
                    import('../../../utils/index.js').then(({ globalEventBus }) => {
                        globalEventBus.emit('agent_wakeup', {
                            conversationId: conversationId || 'system',
                            reason,
                            timerId,
                            timerType: 'one_time',
                        });
                    });
                    // DB'den temizle
                    if (db) {
                        try { db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(timerId); } catch {}
                    }
                    activeTimeouts.delete(timerId);
                }, minutes * 60 * 1000);

                // Uzun süreli timeout'ları unref et — Node.js process'in kapanmasını engellemesin
                if (timeout.unref) timeout.unref();

                activeTimeouts.set(timerId, timeout);

                return `Başarıyla ${minutes} dakika sonrasına zamanlayıcı kuruldu. Timer ID: \`${timerId}\` — İptal için: cancel_timer("${timerId}")`;
            },
        },

        // ── Düzenli Cron Zamanlayıcı ──
        {
            name: 'wake_me_every',
            execute: async (args: Record<string, unknown>, context?: { conversationId?: string }) => {
                const cronExpression = String(args.cronExpression ?? '');
                const reason = String(args.reason ?? '');
                const conversationId = context?.conversationId || String(args.conversationId ?? '');
                const timerId = uuidv4();

                if (!cronExpression) {
                    return 'Hata: "cronExpression" alanı zorunludur.';
                }
                if (!reason) {
                    return 'Hata: "reason" alanı zorunludur.';
                }

                try {
                    // Önce ifadeyi doğrula
                    const testCron = new Cron(cronExpression);
                    const nextRun = testCron.nextRun();
                    testCron.stop();

                    if (!nextRun) {
                        return 'Hata: Cron ifadesi geçerli değil veya bir sonraki çalışma zamanı hesaplanamıyor.';
                    }

                    // DB'ye kaydet
                    if (db) {
                        try {
                            db.prepare(`
                                INSERT INTO scheduled_tasks (id, name, cron_expression, action, enabled, next_run, timer_type, conversation_id)
                                VALUES (?, ?, ?, ?, 1, ?, 'cron', ?)
                            `).run(timerId, `cron_${cronExpression}`, cronExpression, JSON.stringify({ reason, conversationId }), nextRun.toISOString(), conversationId || null);
                        } catch (err) {
                            logger.warn({ err }, '[CronTools] DB kayıt hatası (wake_me_every)');
                        }
                    }

                    // Gerçek cron job'u başlat
                    const cronJob = new Cron(cronExpression, () => {
                        logger.info(`[CronTools] ⏰ Düzenli Cron Tetiklendi! Sebep: ${reason}`);
                        import('../../../utils/index.js').then(({ globalEventBus }) => {
                            globalEventBus.emit('agent_wakeup', {
                                conversationId: conversationId || 'system',
                                reason,
                                timerId,
                                timerType: 'cron',
                                cronExpression,
                            });
                        });
                        // DB'de last_run güncelle
                        if (db) {
                            try {
                                const nxt = cronJob.nextRun();
                                db.prepare('UPDATE scheduled_tasks SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE id = ?')
                                    .run(nxt?.toISOString() ?? null, timerId);
                            } catch {}
                        }
                    });

                    activeCronJobs.set(timerId, cronJob);

                    const nextRunStr = nextRun.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
                    logger.info(`[CronTools] 🔄 Düzenli görev eklendi: ${cronExpression} - ${reason} (ID: ${timerId})`);
                    return `Başarıyla '${cronExpression}' zamanlamasıyla düzenli görev oluşturuldu. Timer ID: \`${timerId}\` — İptal için: cancel_timer("${timerId}")\nBir sonraki çalışma: ${nextRunStr}`;
                } catch (e) {
                    return `Hata: Geçersiz cron ifadesi. Lütfen formatı kontrol edin. Detay: ${e instanceof Error ? e.message : e}`;
                }
            },
        },

        // ── Zamanlayıcı İptal ──
        {
            name: 'cancel_timer',
            execute: async (args: Record<string, unknown>) => {
                const timerId = String(args.timerId ?? '');

                if (!timerId) {
                    return 'Hata: "timerId" alanı zorunludur.';
                }

                let found = false;

                // In-memory cron durdur
                const cronJob = activeCronJobs.get(timerId);
                if (cronJob) {
                    cronJob.stop();
                    activeCronJobs.delete(timerId);
                    found = true;
                }

                // In-memory timeout durdur
                const timeout = activeTimeouts.get(timerId);
                if (timeout) {
                    clearTimeout(timeout);
                    activeTimeouts.delete(timerId);
                    found = true;
                }

                // DB'den sil
                if (db) {
                    try {
                        const result = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(timerId);
                        if (result.changes > 0) found = true;
                    } catch {}
                }

                if (!found) {
                    return `⚠️ Timer bulunamadı: ${timerId}`;
                }

                logger.info(`[CronTools] 🛑 Timer iptal edildi: ${timerId}`);
                return `✅ Timer başarıyla iptal edildi: ${timerId}`;
            },
        },

        // ── Aktif Zamanlayıcıları Listele ──
        {
            name: 'list_timers',
            execute: async () => {
                const lines: string[] = [];
                const seenIds = new Set<string>();

                // In-memory cron'lar
                for (const [id, cronJob] of activeCronJobs) {
                    const next = cronJob.nextRun();
                    const nextStr = next ? next.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '?';
                    lines.push(`🔄 [Cron] ID: \`${id}\` | Sonraki: ${nextStr}`);
                    seenIds.add(id);
                }

                // In-memory timeout'lar
                for (const [id] of activeTimeouts) {
                    lines.push(`⏰ [One-time] ID: \`${id}\``);
                    seenIds.add(id);
                }

                // DB'de olup memory'de olmayanlar (rehydrate edilmemiş)
                if (db) {
                    try {
                        const rows = db.prepare(
                            'SELECT id, name, cron_expression, timer_type, conversation_id, next_run FROM scheduled_tasks WHERE enabled = 1'
                        ).all() as Array<{
                            id: string; name: string; cron_expression: string;
                            timer_type: string; conversation_id: string | null; next_run: string | null;
                        }>;
                        for (const row of rows) {
                            if (!seenIds.has(row.id)) {
                                const icon = row.timer_type === 'cron' ? '🔄' : '⏰';
                                const nextStr = row.next_run
                                    ? new Date(row.next_run).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
                                    : '?';
                                lines.push(`${icon} [DB-only] ID: \`${row.id}\` | Expr: ${row.cron_expression} | Sonraki: ${nextStr}`);
                            }
                        }
                    } catch {}
                }

                if (lines.length === 0) {
                    return 'Aktif zamanlayıcı yok.';
                }
                return `Aktif Zamanlayıcılar (${lines.length}):\n${lines.join('\n')}`;
            },
        },
    ];
}

/**
 * Restart'ta DB'deki zamanlayıcıları rehydrate eder.
 * Gateway başlatıldıktan sonra çağrılmalıdır.
 */
export function rehydrateTimers(db: Database.Database): void {
    if (!db) return;

    try {
        const rows = db.prepare(
            'SELECT id, cron_expression, action, timer_type, conversation_id, next_run FROM scheduled_tasks WHERE enabled = 1'
        ).all() as Array<{
            id: string; cron_expression: string; action: string;
            timer_type: string; conversation_id: string | null; next_run: string | null;
        }>;

        let rehydratedCount = 0;

        for (const row of rows) {
            let actionData: { reason?: string; conversationId?: string } = {};
            try { actionData = JSON.parse(row.action); } catch { /* ignore */ }

            const conversationId = row.conversation_id || actionData.conversationId || 'system';
            const reason = actionData.reason || row.cron_expression;

            if (row.timer_type === 'one_time') {
                const fireAt = row.next_run ? new Date(row.next_run).getTime() : 0;
                const delay = fireAt - Date.now();

                if (delay <= 0) {
                    // Zamanı geçmiş — hemen tetikle
                    import('../../../utils/index.js').then(({ globalEventBus }) => {
                        globalEventBus.emit('agent_wakeup', {
                            conversationId,
                            reason,
                            timerId: row.id,
                            timerType: 'one_time',
                        });
                    });
                    try { db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(row.id); } catch {}
                } else {
                    const timeout = setTimeout(() => {
                        import('../../../utils/index.js').then(({ globalEventBus }) => {
                            globalEventBus.emit('agent_wakeup', {
                                conversationId,
                                reason,
                                timerId: row.id,
                                timerType: 'one_time',
                            });
                        });
                        try { db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(row.id); } catch {}
                        activeTimeouts.delete(row.id);
                    }, delay);
                    if (timeout.unref) timeout.unref();
                    activeTimeouts.set(row.id, timeout);
                }
                rehydratedCount++;
            } else if (row.timer_type === 'cron') {
                try {
                    const cronJob = new Cron(row.cron_expression, () => {
                        logger.info(`[CronTools] ⏰ Rehydrated cron tetiklendi: ${row.cron_expression}`);
                        import('../../../utils/index.js').then(({ globalEventBus }) => {
                            globalEventBus.emit('agent_wakeup', {
                                conversationId,
                                reason,
                                timerId: row.id,
                                timerType: 'cron',
                                cronExpression: row.cron_expression,
                            });
                        });
                        try {
                            const nxt = cronJob.nextRun();
                            db.prepare('UPDATE scheduled_tasks SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE id = ?')
                                .run(nxt?.toISOString() ?? null, row.id);
                        } catch {}
                    });
                    activeCronJobs.set(row.id, cronJob);
                    rehydratedCount++;
                } catch (e) {
                    logger.warn(`[CronTools] Rehydrate hatası (cron ${row.id}): ${e}`);
                }
            }
        }

        if (rehydratedCount > 0) {
            logger.info(`[CronTools] ✅ ${rehydratedCount} zamanlayıcı DB'den rehydrate edildi`);
        }
    } catch (err) {
        logger.warn({ err }, '[CronTools] Timer rehydration başarısız');
    }
}
