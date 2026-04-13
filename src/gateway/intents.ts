/**
 * Lokal semantik intent'leri — Semantic Router'a kaydedilen yerel komutlar.
 * Harici NLP modeli gerektirmez, doğrudan eşleşme ile çalışır.
 */

import type { SemanticRouter } from '../router/semantic.js';
import type { TaskQueue, TaskPriority } from '../autonomous/index.js';

export function registerLocalIntents(
    semanticRouter: SemanticRouter,
    taskQueue: TaskQueue,
    TaskPriorityEnum: typeof TaskPriority,
): void {
    semanticRouter.registerIntent({
        name: 'clear_queue',
        description: 'Bekleyen otonom görevleri temizler',
        examples: ['kuyruğu temizle', 'görevleri durdur', 'bütün işleri iptal et', 'arkaplan işlerini sil'],
        action: async () => {
            taskQueue.clear();
            return '✅ Arka plan görev kuyruğu başarıyla temizlendi ve sıfırlandı.';
        }
    });

    semanticRouter.registerIntent({
        name: 'worker_status',
        description: 'Arka plan işçisinin durumunu raporlar',
        examples: ['durum nedir', 'worker durumu', 'kuyrukta kaç iş var', 'ajan ne yapıyor'],
        action: async () => {
            return `⚙️ Otonom Worker Durumu:\n- Bekleyen Görev Sayısı: ${taskQueue.length}`;
        }
    });
}
