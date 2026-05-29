import {
    DiscordTypingKeepalive,
    DEFAULT_TYPING_REFRESH_MS,
    DEFAULT_TYPING_MAX_DURATION_MS,
} from '../../../src/gateway/channels/discordTypingKeepalive.js';

function createMockChannel() {
    return { sendTyping: jest.fn().mockResolvedValue(undefined) };
}

describe('DiscordTypingKeepalive', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('fires sendTyping immediately on start', () => {
        const channel = createMockChannel();
        const keepalive = new DiscordTypingKeepalive(channel);

        keepalive.start();

        expect(channel.sendTyping).toHaveBeenCalledTimes(1);
    });

    it('refreshes typing on interval until stopped', () => {
        const channel = createMockChannel();
        const keepalive = new DiscordTypingKeepalive(channel, { refreshMs: 8_000 });

        keepalive.start();
        jest.advanceTimersByTime(8_000);
        expect(channel.sendTyping).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(8_000);
        expect(channel.sendTyping).toHaveBeenCalledTimes(3);

        keepalive.stop();
        jest.advanceTimersByTime(24_000);
        expect(channel.sendTyping).toHaveBeenCalledTimes(3);
    });

    it('stop is idempotent', () => {
        const channel = createMockChannel();
        const keepalive = new DiscordTypingKeepalive(channel);

        keepalive.start();
        keepalive.stop();
        keepalive.stop();

        jest.advanceTimersByTime(DEFAULT_TYPING_REFRESH_MS * 3);
        expect(channel.sendTyping).toHaveBeenCalledTimes(1);
    });

    it('auto-stops after maxDurationMs', () => {
        const channel = createMockChannel();
        const keepalive = new DiscordTypingKeepalive(channel, {
            refreshMs: 2_000,
            maxDurationMs: 10_000,
        });

        keepalive.start();
        jest.advanceTimersByTime(10_000);

        const callsAtMax = channel.sendTyping.mock.calls.length;
        jest.advanceTimersByTime(20_000);
        expect(channel.sendTyping.mock.calls.length).toBe(callsAtMax);
    });

    it('uses default timing constants', () => {
        expect(DEFAULT_TYPING_REFRESH_MS).toBe(8_000);
        expect(DEFAULT_TYPING_MAX_DURATION_MS).toBe(300_000);
    });

    it('does not throw when sendTyping fails', async () => {
        const channel = {
            sendTyping: jest.fn().mockRejectedValue(new Error('429')),
        };
        const keepalive = new DiscordTypingKeepalive(channel);

        keepalive.start();
        await Promise.resolve();
        jest.advanceTimersByTime(8_000);
        await Promise.resolve();

        expect(channel.sendTyping).toHaveBeenCalled();
        keepalive.stop();
    });
});
