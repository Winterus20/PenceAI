import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { platform } from 'os';
import { execSync } from 'child_process';
import { logRingBuffer } from './logRingBuffer.js';
import type { LogEntry } from './logRingBuffer.js';

// Jest CommonJS ve ESM uyumluluğu: process.cwd() kullan
const PROJECT_ROOT = process.cwd();
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');

// Windows için UTF-8 encoding desteği - en başta çalıştırılmalı
// chcp 65001, Windows konsolunun kod sayfasını UTF-8'e ayarlar.
// Bu, Türkçe karakterlerin ve diğer Unicode karakterlerin doğru
// şekilde görüntülenmesini sağlar. stdio: 'ignore' ile sessizce
// çalıştırılır; hata durumunda sessizce geçilir.
if (platform() === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // chcp komutu mevcut değilse veya çalışmazsa, varsayılan kod sayfası kullanılır.
    // Bu durumda log çıktısında karakter encoding sorunları görülebilir.
  }
}

// Log dizinini oluştur, hata durumunda temp dizinine düş
let resolvedLogDir = LOG_DIR;
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (err) {
  // Log dizini oluşturulamazsa (örn: izin sorunu), sistem temp dizinini kullan
  resolvedLogDir = path.join(os.tmpdir(), 'penceai-logs');
  try {
    if (!fs.existsSync(resolvedLogDir)) {
      fs.mkdirSync(resolvedLogDir, { recursive: true });
    }
  } catch {
    // Son çare: mevcut dizini kullan
    resolvedLogDir = PROJECT_ROOT;
  }
}

// Trace context için AsyncLocalStorage oluşturuyoruz
export interface TraceContext {
  traceId: string;
}
export const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

// Pino Konfigürasyonu
const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

const targets: Array<{ target: string; level: string; options: Record<string, unknown> }> = [];

// 1. Terminal çıktısı (Geliştirmede pino-pretty, prod'da standart JSON)
if (!isProd) {
  targets.push({
    target: 'pino-pretty',
    level: logLevel,
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      messageFormat: '{msg} {if traceId}[trace: {traceId}]{end}',
      // Windows için encoding desteği
      destination: 1, // stdout - bu pino-pretty'nin doğru stream'e yazmasını sağlar
      sync: true, // Senkron yazım Windows için daha güvenli
    }
  });
} else {
  // Production modunda stdout'a JSON formatında log bas
  // Bu, containerized ortamlarda log aggregation (örn: Fluentd, Logstash)
  // için standart JSON stream sağlar. pino-pretty kullanılmaz.
  targets.push({
    target: 'pino/file',
    level: logLevel,
    options: {
      destination: 1, // stdout (file descriptor 1)
      sync: true, // Production'da log kaybını önlemek için senkron
    }
  });
}

// 2. Roll (Rotasyon) Transport - Günlük olarak 100MB sınırında loglar `logs/` altına kaydedilecek
targets.push({
  target: 'pino-roll',
  level: logLevel,
  options: {
    file: path.join(resolvedLogDir, 'penceai'),
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
    // Hassas verileri otomatik olarak redact et
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.apiKey',
        '*.secret',
        '*.password',
        '*.token',
        'apiKey',
        'password',
        'token',
        'secret',
        'authorization',
      ],
      censor: '**redacted**',
    },
    mixin() {
      const context = asyncLocalStorage.getStore();
      return context ? { traceId: context.traceId } : {};
    },
    hooks: {
      logMethod(inputArgs, method, level) {
        let logObj: Record<string, unknown> = {};
        let msg = '';

        if (typeof inputArgs[0] === 'object' && inputArgs[0] !== null) {
          logObj = inputArgs[0] as Record<string, unknown>;
          msg = typeof inputArgs[1] === 'string' ? inputArgs[1] : String(inputArgs[1] || '');
        } else if (typeof inputArgs[0] === 'string') {
          msg = inputArgs[0];
        }

        logRingBuffer.addLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          level: (pino.levels.labels[level] as LogEntry['level']) || 'info',
          msg,
          traceId: logObj.traceId as string | undefined,
          ...logObj,
        });

        return method.apply(this, inputArgs);
      }
    }
  },
  transport
);

/**
 * Graceful shutdown için logger buffer'ı boşaltır.
 * Tüm bekleyen log entry'lerinin yazılmasını garanti eder.
 */
export function flush(): void {
  logger.flush();
}

/**
 * Runtime log level hot-reload — LOG_LEVEL env değiştiğinde pino level'ını günceller.
 * reloadConfig() tarafından çağrılır.
 */
export function updateLogLevel(newLevel: string): void {
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const level = validLevels.includes(newLevel) ? newLevel : 'info';
  logger.level = level;
  logger.info({ newLevel: level }, '[Logger] Log level hot-reloaded');
}

/**
 * Belirli bir traceID (veya uuid ile rastgele üretilecek) içerecek şekilde context çalıştırır.
 *
 * @param action — Çalıştırılacak fonksiyon
 * @param traceId — Opsiyonel trace ID, sağlanmazsa otomatik oluşturulur
 * @returns action fonksiyonunun dönüş değeri
 *
 * @example
 * ```ts
 * runWithTraceId(() => {
 *   logger.info('Bu log entry traceId içerir');
 * });
 * ```
 */
export function runWithTraceId<T>(action: () => T, traceId?: string): T {
  const context: TraceContext = {
    traceId: traceId || uuidv4(),
  };
  return asyncLocalStorage.run(context, action);
}
