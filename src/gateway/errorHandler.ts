import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { getConfig } from './config.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    // Zaten response gönderilmişse tekrar gönderme (headers already sent hatasını önler)
    if (res.headersSent) {
        logger.warn({ err }, '[Gateway] Error after headers sent — skipping response');
        return;
    }

    if (err instanceof AppError && err.isOperational) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
    }
    logger.error({ err }, '[Gateway] Unhandled error');
    const isDev = getConfig().nodeEnv === 'development';
    res.status(500).json({
        error: 'Internal server error',
        ...(isDev ? { stack: err.stack } : {}),
    });
}
