const locks = new Map<string, Promise<void>>();

/**
 * Konuşma bazlı mutex — aynı conversationId için eşzamanlı agent_wakeup handler'larını serileştirir.
 */
export async function withWakeupLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const key = conversationId?.trim() || 'system';
    const previous = locks.get(key) ?? Promise.resolve();

    let releaseNext!: () => void;
    const current = new Promise<void>((resolve) => {
        releaseNext = resolve;
    });

    locks.set(key, previous.then(() => current));

    await previous;
    try {
        return await fn();
    } finally {
        releaseNext();
        if (locks.get(key) === current) {
            locks.delete(key);
        }
    }
}

/** Test helper */
export function _clearWakeupLocksForTests(): void {
    locks.clear();
}
