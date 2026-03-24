import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { platform } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');

// Windows için UTF-8 encoding desteği
if (platform() === 'win32') {
  try {
    process.stdout.setDefaultEncoding?.('utf8');
    process.stderr.setDefaultEncoding?.('utf8');
  } catch {
    // Eski Node.js versiyonları için sessizce geç
  }
}

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Trace context için AsyncLocalStorage oluşturuyoruz
interface TraceContext {
    traceId: string;
}
export const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

// Pino Konfigürasyonu
const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

const targets = [];

// 1. Terminal çıktısı (Geliştirmede pino-pretty, prod'da standart JSON)
if (!isProd) {
    targets.push({
        target: 'pino-pretty',
        level: logLevel,
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            messageFormat: '{msg} {if traceId}[trace: {traceId}]{end}', // Trace ID'yi ekranda daha rahat görmek için
        }
    });
}

// 2. Roll (Rotasyon) Transport - Günlük olarak 100MB sınırında loglar `logs/` altına kaydedilecek
targets.push({
    target: 'pino-roll',
    level: logLevel,
    options: {
        file: path.join(LOG_DIR, 'penceai'),
        size: '100m', // 100MB limit (size is used, limit is deprecated)
        frequency: 'daily', // Günlük rotasyon
        extension: '.log',
        mkdir: true
    }
});

const transport = pino.transport({ targets });

export const logger = pino(
    {
        level: logLevel,
        mixin() {
            const context = asyncLocalStorage.getStore();
            return context ? { traceId: context.traceId } : {};
        },
    },
    transport
);

/**
 * Belirli bir traceID (veya uuid ile rastgele üretilecek) içerecek şekilde context çalıştırır.
 */
export function runWithTraceId<T>(action: () => T, traceId?: string): T {
    const context: TraceContext = {
        traceId: traceId || uuidv4(),
    };
    return asyncLocalStorage.run(context, action);
}
