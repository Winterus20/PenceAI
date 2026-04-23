import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingMessage, Server as HttpServer } from 'http';
import fs from 'fs';
import path from 'path';
import type { Duplex } from 'stream';
import type { WebSocketServer } from 'ws';

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
            logger.warn({ path: req.path, ip: req.ip }, '[Gateway] ❌ Dashboard auth failed — invalid password');
            res.setHeader('WWW-Authenticate', 'Basic realm="PençeAI Dashboard"');
            return res.status(401).send('PençeAI: Geçersiz parola');
        }

        next();
    };
}

export function resolveGatewayPublicDir(projectRoot?: string): string {
  const root = projectRoot || process.cwd();

  // React build çıktısı (dist/web/public)
  const reactBuildDir = path.join(root, 'dist/web/public');
  if (fs.existsSync(reactBuildDir)) {
    return reactBuildDir;
  }

  // Fallback: Kaynak dizindeki React public klasörü (development mode)
  const reactPublicDir = path.join(root, 'src/web/react-app/public');
  if (fs.existsSync(reactPublicDir)) {
    return reactPublicDir;
  }

  // Son çare: Boş string (static file serving devre dışı)
  logger.warn('No public directory found, static file serving disabled');
  return '';
}

export function registerRequestTracing(app: Application, onRequest: () => void): void {
    let activityTimer: ReturnType<typeof setTimeout> | null = null;

    app.use((req, _res, next) => {
        // Sadece API ve WS istekleri kullanıcı aktivitesi olarak sayılır
        // Static dosya istekleri (CSS, JS, resimler) worker'ı bölmaz
        const isApiOrWs = req.path.startsWith('/api/') || req.path === '/ws';
        if (isApiOrWs) {
            // Debounce: Aynı 100ms penceresindeki istekler tek sinyal olarak sayılır
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(onRequest, 100);
        }

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
  
      // Dev modunda localhost bağlantıları için auth bypass (Vite proxy gibi)
      const remoteAddress = req.socket.remoteAddress;
      const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  
      if (!isLocalhost && !isDashboardRequestAuthorized(
        dashboardPassword,
        req.headers.authorization,
        req.headers['sec-websocket-protocol'],
      )) {
        logger.warn({ remoteAddress, userAgent: req.headers['user-agent'] }, '[Gateway] ❌ WS auth failed');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });
}
