/**
 * Gateway REST route tests — auth middleware + critical endpoints
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import http from 'http';
import type { Server } from 'http';
import express from 'express';
import { registerRoutes } from '../../src/gateway/routes.js';
import { createDashboardAuthMiddleware } from '../../src/gateway/bootstrap.js';
import { reloadConfig } from '../../src/gateway/config.js';
import type { MemoryManager } from '../../src/memory/manager.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { MessageRouter } from '../../src/router/index.js';
import type { AgentRuntime } from '../../src/agent/runtime.js';

jest.mock('../../src/agent/mcp/config.js', () => ({
  isMCPEnabled: jest.fn().mockReturnValue(false),
}));

const originalEnv = { ...process.env };

function basicAuthHeader(password: string): string {
  return `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
}

function createMockDeps() {
  const mockMemory = {
    getStats: () => ({ conversations: 0, messages: 0, memories: 0 }),
    getSensitivePaths: () => [],
    setSensitivePaths: jest.fn(),
    getOpenContradictions: () => [],
    resolveContradiction: () => false,
    markFalsePositive: () => false,
    getRecentConversations: () => [],
    getConversationHistory: () => [],
    getDb: () => ({ prepare: () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }) }),
    saveFeedback: jest.fn(),
    getFeedbacks: () => [],
  } as unknown as MemoryManager;

  const mockLlm = {
    name: 'mock-llm',
    healthCheck: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  } as unknown as LLMProvider;

  const mockRouter = {
    getChannelStatus: () => ({ web: { connected: true } }),
  } as unknown as MessageRouter;

  const mockAgent = {
    setLLM: jest.fn(),
    processRawTextForMemories: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  } as unknown as AgentRuntime;

  return {
    memory: mockMemory,
    llm: mockLlm,
    router: mockRouter,
    agent: mockAgent,
    broadcastStats: jest.fn(),
  };
}

describe('Gateway routes', () => {
  let server: Server;
  let baseUrl: string;
  let dashboardPassword: string | undefined;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.DASHBOARD_PASSWORD;
    reloadConfig();
    dashboardPassword = undefined;
  });

  afterEach(() => {
    if (server?.listening) {
      server.close();
    }
    process.env = { ...originalEnv };
    reloadConfig();
  });

  function startApp(password?: string) {
    dashboardPassword = password;
    if (password) {
      process.env.DASHBOARD_PASSWORD = password;
    } else {
      delete process.env.DASHBOARD_PASSWORD;
    }
    reloadConfig();

    const app = express();
    app.use(express.json());
    app.use(createDashboardAuthMiddleware(password));
    registerRoutes(app, createMockDeps());

    server = app.listen(0);
    const address = server.address() as import('net').AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function request(
    method: string,
    path: string,
    options?: { auth?: string; body?: unknown },
  ): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
    const payload = options?.body ? JSON.stringify(options.body) : undefined;
    const url = new URL(path, baseUrl);

    return new Promise((resolve, reject) => {
      const req = http.request(
        url.toString(),
        {
          method,
          headers: {
            ...(options?.auth ? { Authorization: options.auth } : {}),
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: data ? JSON.parse(data) : null,
                headers: res.headers,
              });
            } catch {
              resolve({
                status: res.statusCode ?? 0,
                body: data,
                headers: res.headers,
              });
            }
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  describe('health endpoint auth exemption', () => {
    it('GET /api/health is accessible without auth when password is set', async () => {
      startApp('test-dashboard-password');

      const res = await request('GET', '/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        llm: { provider: 'mock-llm', healthy: true },
      });
    });

    it('GET /api/health is accessible without auth when password is unset', async () => {
      startApp();

      const res = await request('GET', '/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    });
  });

  describe('dashboard auth middleware', () => {
    it('returns 401 without credentials when DASHBOARD_PASSWORD is set', async () => {
      startApp('test-dashboard-password');

      const res = await request('GET', '/api/settings');

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
      expect(res.body).toBe('PençeAI: Kimlik doğrulama gerekli');
    });

    it('returns 401 for invalid password', async () => {
      startApp('correct-password');

      const res = await request('GET', '/api/settings', {
        auth: basicAuthHeader('wrong-password'),
      });

      expect(res.status).toBe(401);
      expect(res.body).toBe('PençeAI: Geçersiz parola');
    });

    it('allows access with valid Basic auth', async () => {
      startApp('correct-password');

      const res = await request('GET', '/api/settings', {
        auth: basicAuthHeader('correct-password'),
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        defaultLLMProvider: expect.any(String),
      });
    });

    it('allows unauthenticated access when no password is configured', async () => {
      startApp();

      const res = await request('GET', '/api/settings');

      expect(res.status).toBe(200);
    });
  });

  describe('settings GET auth', () => {
    it('requires auth when DASHBOARD_PASSWORD is set', async () => {
      startApp('secure-dashboard-pwd');

      const unauth = await request('GET', '/api/settings');
      expect(unauth.status).toBe(401);

      const authed = await request('GET', '/api/settings', {
        auth: basicAuthHeader('secure-dashboard-pwd'),
      });
      expect(authed.status).toBe(200);
      expect(authed.body).toHaveProperty('defaultUserName');
    });
  });

  describe('settings POST write policy', () => {
    it('does not block POST when DASHBOARD_PASSWORD is unset (development/test)', async () => {
      startApp();

      const res = await request('POST', '/api/settings', {
        body: { defaultLLMModel: 'gpt-4o-mini' },
      });

      expect(res.status).not.toBe(403);
    });
  });
});
