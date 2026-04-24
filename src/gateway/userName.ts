export function resolveIncomingUserName(candidate: unknown, fallbackUserName?: string): string {
    if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
    }

    if (typeof fallbackUserName === 'string' && fallbackUserName.trim()) {
        return fallbackUserName.trim();
    }

    return 'Kullanıcı';
}
