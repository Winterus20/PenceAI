import path from 'path';
import { PenceDatabase } from '../src/memory/database.js';
import { MemoryManager } from '../src/memory/manager.js';

async function main() {
    const dbPath = path.resolve('data/memory_short_term_debug.sqlite');
    const db = new PenceDatabase(dbPath, 1536);
    const manager = new MemoryManager(db);

    await manager.addMemory('  Kullanıcı TypeScript ile agent altyapısı geliştiriyor.  ', 'note', 6);
    await manager.addMemory('Kullanıcı TypeScript ile agent altyapısı geliştiriyor', 'general', 6);
    await manager.addMemory('Sprint planlama toplantısı 12/03 tarihinde', 'event', 5);
    await manager.addMemory('Sprint planlama toplantısı 14/03 tarihinde', 'event', 5);

    const hybrid = await manager.hybridSearch('TypeScript agent altyapısı', 5);
    const graphAware = await manager.graphAwareSearch('Sprint planlama', 5, 1);

    console.log(JSON.stringify({
        hybridResultIds: hybrid.map(item => item.id),
        hybridDebug: manager.getRetrievalDebugSnapshot('hybridSearch'),
        graphAwareDebug: manager.getRetrievalDebugSnapshot('graphAwareSearch'),
        graphAwareActiveIds: graphAware.active.map(item => item.id),
        graphAwareArchivalIds: graphAware.archival.map(item => item.id),
        memoryCount: manager.getUserMemories(20).length,
    }, null, 2));

    db.close();
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
