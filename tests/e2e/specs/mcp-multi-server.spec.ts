/**
 * E2E-MCP-002: Multi-Server Workflow Tests
 *
 * Birden fazla server'ın aynı anda yönetilebilmesini doğrular.
 */

import { test, expect } from '@playwright/test';
import { cleanupAllServers, TEST_SERVERS } from '../fixtures/testServers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

test.describe('Multi-Server Workflow (E2E-MCP-002)', () => {
  test.afterEach(async () => {
    await cleanupAllServers(BACKEND_URL);
  });

  test('should install and manage multiple servers', async ({ request }) => {
    // 1. Install first server
    const server1 = TEST_SERVERS[0];
    const installResponse1 = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
      data: server1,
    });
    expect(installResponse1.ok()).toBeTruthy();

    // 2. Install second server
    const server2 = TEST_SERVERS[1];
    const installResponse2 = await request.post(`${BACKEND_URL}/api/mcp/servers`, {
      data: server2,
    });
    expect(installResponse2.ok()).toBeTruthy();

    // 3. Verify both servers are installed
    const serversResponse = await request.get(`${BACKEND_URL}/api/mcp/servers`);
    const serversBody = await serversResponse.json();

    expect(serversBody.success).toBe(true);
    expect(serversBody.servers.length).toBe(2);
    expect(serversBody.summary.total).toBe(2);

    // 4. Disable first server
    const disableResponse = await request.patch(
      `${BACKEND_URL}/api/mcp/servers/${server1.name}/toggle`,
      { data: { action: 'disable' } }
    );
    expect(disableResponse.ok()).toBeTruthy();

    // 5. Verify summary reflects one disabled server
    const serversResponse2 = await request.get(`${BACKEND_URL}/api/mcp/servers`);
    const serversBody2 = await serversResponse2.json();

    expect(serversBody2.summary.active).toBeGreaterThanOrEqual(0);
    expect(serversBody2.summary.disabled).toBeGreaterThanOrEqual(1);

    // 6. Uninstall both servers
    await request.delete(`${BACKEND_URL}/api/mcp/servers/${server1.name}`);
    await request.delete(`${BACKEND_URL}/api/mcp/servers/${server2.name}`);

    // 7. Verify all servers are removed
    const finalResponse = await request.get(`${BACKEND_URL}/api/mcp/servers`);
    const finalBody = await finalResponse.json();

    expect(finalBody.servers.length).toBe(0);
    expect(finalBody.summary.total).toBe(0);
  });

  test('should handle concurrent server operations', async ({ request }) => {
    // Install two servers concurrently
    const server1 = TEST_SERVERS[0];
    const server2 = TEST_SERVERS[1];

    const [response1, response2] = await Promise.all([
      request.post(`${BACKEND_URL}/api/mcp/servers`, { data: server1 }),
      request.post(`${BACKEND_URL}/api/mcp/servers`, { data: server2 }),
    ]);

    expect(response1.ok()).toBeTruthy();
    expect(response2.ok()).toBeTruthy();

    // Verify both are installed
    const serversResponse = await request.get(`${BACKEND_URL}/api/mcp/servers`);
    const serversBody = await serversResponse.json();

    expect(serversBody.servers.length).toBe(2);

    // Cleanup
    await request.delete(`${BACKEND_URL}/api/mcp/servers/${server1.name}`);
    await request.delete(`${BACKEND_URL}/api/mcp/servers/${server2.name}`);
  });

  test('should maintain correct state after multiple toggles', async ({ request }) => {
    const server = TEST_SERVERS[0];

    // Install server
    await request.post(`${BACKEND_URL}/api/mcp/servers`, { data: server });

    // Toggle multiple times
    for (let i = 0; i < 3; i++) {
      // Disable
      const disableResponse = await request.patch(
        `${BACKEND_URL}/api/mcp/servers/${server.name}/toggle`,
        { data: { action: 'disable' } }
      );
      expect(disableResponse.ok()).toBeTruthy();

      // Enable
      const enableResponse = await request.patch(
        `${BACKEND_URL}/api/mcp/servers/${server.name}/toggle`,
        { data: { action: 'enable' } }
      );
      expect(enableResponse.ok()).toBeTruthy();
    }

    // Final state should be active
    const statusResponse = await request.get(
      `${BACKEND_URL}/api/mcp/servers/${server.name}/status`
    );
    const statusBody = await statusResponse.json();

    expect(statusBody.success).toBe(true);
    expect(statusBody.server.status).toBe('active');

    // Cleanup
    await request.delete(`${BACKEND_URL}/api/mcp/servers/${server.name}`);
  });
});
