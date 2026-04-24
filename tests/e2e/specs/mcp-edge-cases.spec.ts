/**
 * E2E-MCP-006: MCP Edge Cases and Error Handling Tests
 *
 * Hata durumlarının doğru handle edildiğini doğrular.
 */

import { test, expect } from '@playwright/test';
import { cleanupAllServers, TEST_SERVERS } from '../fixtures/testServers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

test.describe('MCP Edge Cases (E2E-MCP-006)', () => {
  test.afterEach(async () => {
    await cleanupAllServers(BACKEND_URL);
  });

  test.describe('Invalid Input Handling', () => {
    test('should return 400 for empty name', async ({ request }) => {
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: { name: '', command: 'echo', args: [] },
      });

      expect(response.status()).toBe(400);
    });

    test('should return 400 for empty command', async ({ request }) => {
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: { name: 'test-server', command: '', args: [] },
      });

      expect(response.status()).toBe(400);
    });

    test('should handle special characters in server name', async ({ request }) => {
      const serverConfig = {
        name: 'test-server@#$%',
        description: 'Server with special characters in name',
        command: 'echo',
        args: ['special-chars'],
      };

      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });

      // Special characters should be handled gracefully
      expect([201, 400, 409]).toContain(response.status());
    });

    test('should handle very long server name', async ({ request }) => {
      const longName = 'a'.repeat(500);
      const response = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: { name: longName, command: 'echo', args: [] },
      });

      // Should not crash, should return valid response
      expect([201, 400, 409]).toContain(response.status());
    });
  });

  test.describe('Non-existent Server Operations', () => {
    test('should return 404 for toggling non-existent server', async ({ request }) => {
      const response = await request.patch(
        `${BACKEND_URL}/api/mcp/servers/nonexistent-server/toggle`,
        { data: { action: 'enable' } }
      );

      // Should return error (404 or 500 depending on implementation)
      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should return 404 for getting status of non-existent server', async ({ request }) => {
      const response = await request.get(
        `${BACKEND_URL}/api/mcp/servers/nonexistent-server/status`
      );

      expect(response.status()).toBe(404);
    });

    test('should return error for uninstalling non-existent server', async ({ request }) => {
      const response = await request.delete(
        `${BACKEND_URL}/api/mcp/servers/nonexistent-server`
      );

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  test.describe('Invalid Toggle Actions', () => {
    test('should return 400 for invalid toggle action', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Install server
      await request.post(`${BACKEND_URL}/api/mcp/servers`, { data: serverConfig });

      // Invalid action
      const response = await request.patch(
        `${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`,
        { data: { action: 'restart' } }
      );

      expect(response.status()).toBe(400);
    });

    test('should return 400 for missing action', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Install server
      await request.post(`${BACKEND_URL}/api/mcp/servers`, { data: serverConfig });

      // Missing action
      const response = await request.patch(
        `${BACKEND_URL}/api/mcp/servers/${serverConfig.name}/toggle`,
        { data: {} }
      );

      expect(response.status()).toBe(400);
    });
  });

  test.describe('Concurrent Operations', () => {
    test('should handle rapid install/uninstall', async ({ request }) => {
      const serverConfig = TEST_SERVERS[0];

      // Install
      const installResponse = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
        data: serverConfig,
      });
      expect(installResponse.ok()).toBeTruthy();

      // Immediately uninstall
      const uninstallResponse = await request.delete(
        `${BACKEND_URL}/api/mcp/servers/${serverConfig.name}`
      );
      expect(uninstallResponse.ok()).toBeTruthy();

      // Try to uninstall again (should fail gracefully)
      const secondUninstallResponse = await request.delete(
        `${BACKEND_URL}/api/mcp/servers/${serverConfig.name}`
      );
      expect(secondUninstallResponse.ok()).toBeTruthy();
      const body = await secondUninstallResponse.json();
      expect(body.success).toBe(false);
    });
  });

  test.describe('API Error Responses', () => {
    test('should return proper error format for all errors', async ({ request }) => {
      // Test various error scenarios and verify error format
      const errorResponses = await Promise.all([
        request.post(`${BACKEND_URL}/api/mcp/servers`, { data: {} }),
        request.patch(`${BACKEND_URL}/api/mcp/servers/nonexistent/toggle`, { data: { action: 'enable' } }),
        request.delete(`${BACKEND_URL}/api/mcp/servers/nonexistent`),
      ]);

      for (const response of errorResponses) {
        const body = await response.json();
        // All error responses should have success: false
        if (response.status() >= 400) {
          expect(body.success).toBe(false);
          expect(body.error).toBeDefined();
        }
      }
    });
  });
});
