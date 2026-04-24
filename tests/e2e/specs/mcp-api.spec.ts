/**
 * E2E-MCP-004: MCP REST API Tests
 *
 * MCP REST API endpoint'lerinin doğru çalışmasını doğrular.
 */

import { test, expect } from '@playwright/test';
import { cleanupAllServers, TEST_SERVERS } from '../fixtures/testServers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

test.describe('MCP REST API Tests', () => {
  test.afterEach(async () => {
    await cleanupAllServers(BACKEND_URL);
  });

  test.describe('GET /api/mcp/marketplace', () => {
    test('should return marketplace catalog', async ({ request }) => {
      const response = await request.get(`${BACKEND_URL}/api/mcp/marketplace`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.catalog)).toBe(true);
    });

    test('should filter catalog by query', async ({ request }) => {
      const response = await request.get(`${BACKEND_URL}/api/mcp/marketplace?query=filesystem`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
      // Query varsa filtrelenmiş sonuçlar dönmeli
      expect(Array.isArray(body.catalog)).toBe(true);
    });
  });

  test.describe('GET /api/mcp/servers', () => {
    test('should return empty servers list initially', async ({ request }) => {
      const response = await request.get(`${BACKEND_URL}/api/mcp/servers`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.servers).toEqual([]);
      expect(body.summary).toBeDefined();
      expect(body.summary.total).toBe(0);
    });
  });

  test.describe('POST /api/mcp/servers', () => {
    test('should install a new server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      expect(response.status()).toBe(201);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.server).toBeDefined();
      expect(body.server.name).toBe(serverConfig.name);
    });

    test('should return 400 for missing name', async ({ request }) => {
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: { command: 'echo', args: [] },
      });

      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    test('should return 400 for missing command', async ({ request }) => {
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: { name: 'test-server' },
      });

      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    test('should return 409 for duplicate server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // İlk kurulum
      const installResponse = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });
      expect(installResponse.ok()).toBeTruthy();

      // İkinci kurulum denemesi
      const duplicateResponse = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      expect(duplicateResponse.status()).toBe(409);

      const body = await duplicateResponse.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  test.describe('GET /api/mcp/servers/:name/tools', () => {
    test('should return tools for installed server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Tools getir
      const response = await request.get(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/tools`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.tools)).toBe(true);
    });
  });

  test.describe('GET /api/mcp/servers/:name/status', () => {
    test('should return server status', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Status getir
      const response = await request.get(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/status`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.server).toBeDefined();
      expect(body.server.name).toBe(serverConfig.name);
    });

    test('should return 404 for non-existent server', async ({ request }) => {
      const response = await request.get(`${BACKEND_URL}/api/mcp/servers/nonexistent-server/status`);
      expect(response.status()).toBe(404);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Server not found');
    });
  });

  test.describe('PATCH /api/mcp/servers/:name/toggle', () => {
    test('should disable a server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Disable
      const response = await request.patch(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`, {
        data: { action: 'disable' },
      });

      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    test('should enable a server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Önce disable
      await request.patch(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`, {
        data: { action: 'disable' },
      });

      // Sonra enable
      const response = await request.patch(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`, {
        data: { action: 'enable' },
      });

      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    test('should return 400 for invalid action', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Invalid action
      const response = await request.patch(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`, {
        data: { action: 'invalid' },
      });

      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  test.describe('DELETE /api/mcp/servers/:name', () => {
    test('should uninstall a server', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Server kur
      await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Uninstall
      const response = await request.delete(`${BACKEND_URL}/api/mcp/servers/${serverConfig.name}`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(true);

      // Server artık olmamalı
      const getResponse = await request.get(`${BACKEND_URL}/api/mcp/servers`);
      const getBody = await getResponse.json();
      expect(getBody.servers.length).toBe(0);
    });

    test('should return error for non-existent server', async ({ request }) => {
      const response = await request.delete(`${BACKEND_URL}/api/mcp/servers/nonexistent-server`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });
});
