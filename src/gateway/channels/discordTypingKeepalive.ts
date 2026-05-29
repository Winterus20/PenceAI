import { logger } from '../../utils/logger.js';

/** Discord typing göstergesi ~10 sn sonra sona erer; yenileme bu süreden önce yapılmalı. */
export const DEFAULT_TYPING_REFRESH_MS = 8_000;
/** Takılı işlemlerde interval sızıntısını önleyen üst süre. */
export const DEFAULT_TYPING_MAX_DURATION_MS = 300_000;

export interface TypingChannel {
    sendTyping(): Promise<unknown>;
}

export interface DiscordTypingKeepaliveOptions {
    refreshMs?: number;
    maxDurationMs?: number;
}

/**
 * Discord kanalında "yazıyor…" göstergesini agent işlemi bitene kadar canlı tutar.
 * @see https://discord.com/developers/docs/resources/channel#trigger-typing-indicator
 */
export class DiscordTypingKeepalive {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private maxTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;

    constructor(
        private readonly channel: TypingChannel,
        private readonly options: DiscordTypingKeepaliveOptions = {},
    ) {}

    start(): void {
        if (this.intervalId !== null) return;

        const refreshMs = this.options.refreshMs ?? DEFAULT_TYPING_REFRESH_MS;
        const maxDurationMs = this.options.maxDurationMs ?? DEFAULT_TYPING_MAX_DURATION_MS;

        void this.pulse();

        this.intervalId = setInterval(() => {
            void this.pulse();
        }, refreshMs);

        this.maxTimeoutId = setTimeout(() => {
            logger.debug('[Discord] Typing keepalive max süreye ulaştı, durduruluyor');
            this.stop();
        }, maxDurationMs);
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;

        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.maxTimeoutId !== null) {
            clearTimeout(this.maxTimeoutId);
            this.maxTimeoutId = null;
        }
    }

    private async pulse(): Promise<void> {
        if (this.stopped) return;
        try {
            await this.channel.sendTyping();
        } catch (err) {
            logger.debug({ err }, '[Discord] Typing pulse başarısız');
        }
    }
}
