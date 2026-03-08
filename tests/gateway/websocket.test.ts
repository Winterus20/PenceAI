import { resolveIncomingUserName } from '../../src/gateway/userName.js';

describe('resolveIncomingUserName', () => {
    test('prefers explicit websocket userName when provided', () => {
        expect(resolveIncomingUserName('Yiğit', 'Ayar Adı')).toBe('Yiğit');
    });

    test('falls back to configured default user name when websocket payload omits it', () => {
        expect(resolveIncomingUserName(undefined, 'Ayşe')).toBe('Ayşe');
        expect(resolveIncomingUserName('   ', 'Ayşe')).toBe('Ayşe');
    });

    test('falls back to generic user name when both payload and config are empty', () => {
        expect(resolveIncomingUserName(undefined, '   ')).toBe('Kullanıcı');
    });
});
