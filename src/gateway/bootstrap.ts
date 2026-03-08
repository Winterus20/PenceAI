import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingMessage, Server as HttpServer } from 'http';
import fs from 'fs';
import path from 'path';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';

import { runWithTraceId, logger } from '../utils/logger.js';

function extractBasicPassword(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return null;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    return decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
}

export function isDashboardRequestAuthorized(
    dashboardPassword: string | undefined,
    authHeader?: string,
    protocolsHeader?: string | string[],
): boolean {
    if (!dashboardPassword) {
        return true;
    }

    if (extractBasicPassword(authHeader) === dashboardPassword) {
        return true;
    }

    if (!protocolsHeader) {
        return false;
    }

    const protocolValues = Array.isArray(protocolsHeader)
        ? protocolsHeader.flatMap(value => value.split(',').map(part => part.trim()))
        : protocolsHeader.split(',').map(part => part.trim());
    const authProto = protocolValues.find(protocol => protocol.startsWith('auth-'));
    return authProto?.slice(5) === dashboardPassword;
}

export function createDashboardAuthMiddleware(dashboardPassword?: string): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!dashboardPassword || req.path === '/api/health') {
            return next();
        }

        const providedPassword = extractBasicPassword(req.headers.authorization);
        if (!providedPassword) {
            res.setHeader('WWW-Authenticate', 'Basic realm="PençeAI Dashboard"');
            return res.status(401).send('PençeAI: Kimlik doğrulama gerekli');
        }

        if (providedPassword !== dashboardPassword) {
            res.setHeader('WWW-Authenticate', 'Basic realm="PençeAI Dashboard"');
            return res.status(401).send('PençeAI: Geçersiz parola');
        }

        next();
    };
}

export function resolveGatewayPublicDir(currentDir: string): string {
    const developmentDir = path.join(currentDir, '../../dist/web/public_old');
    if (fs.existsSync(developmentDir)) {
        return developmentDir;
    }

    return path.join(currentDir, '../web/public_old');
}

export function registerRequestTracing(app: Application, onRequest: () => void): void {
    app.use((req, _res, next) => {
        onRequest();

        runWithTraceId(() => {
            logger.info({ method: req.method, url: req.url }, 'Gelen İstek');
            next();
        });
    });
}

export function attachDashboardWebSocketUpgrade(
    server: HttpServer,
    wss: WebSocketServer,
    dashboardPassword: string | undefined,
): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        if (url.pathname !== '/ws') {
            socket.destroy();
            return;
        }

        if (!isDashboardRequestAuthorized(
            dashboardPassword,
            req.headers.authorization,
            req.headers['sec-websocket-protocol'],
        )) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });
}
