import { withWakeupLock, _clearWakeupLocksForTests } from '../../src/gateway/wakeupLock.js';

describe('withWakeupLock', () => {
    afterEach(() => {
        _clearWakeupLocksForTests();
    });

    it('serializes concurrent handlers for the same conversation', async () => {
        const order: number[] = [];

        await Promise.all([
            withWakeupLock('conv-1', async () => {
                order.push(1);
                await new Promise((r) => setTimeout(r, 30));
                order.push(2);
            }),
            withWakeupLock('conv-1', async () => {
                order.push(3);
            }),
        ]);

        expect(order).toEqual([1, 2, 3]);
    });

    it('allows parallel handlers for different conversations', async () => {
        let aDone = false;
        let bStartedBeforeADone = false;

        await Promise.all([
            withWakeupLock('conv-a', async () => {
                await new Promise((r) => setTimeout(r, 40));
                aDone = true;
            }),
            withWakeupLock('conv-b', async () => {
                bStartedBeforeADone = !aDone;
            }),
        ]);

        expect(bStartedBeforeADone).toBe(true);
    });

    it('uses system key for empty conversation id', async () => {
        const order: string[] = [];

        await Promise.all([
            withWakeupLock('', async () => {
                order.push('first');
                await new Promise((r) => setTimeout(r, 20));
                order.push('second');
            }),
            withWakeupLock('system', async () => {
                order.push('third');
            }),
        ]);

        expect(order).toEqual(['first', 'second', 'third']);
    });
});
