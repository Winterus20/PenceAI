/**
 * MCP E2E Test Fixtures
 *
 * Test sunucuları ve mock verileri tanımlar.
 */

export interface TestServerConfig {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Test için kullanılacak MCP server tanımları.
 * Bu server'lar gerçek process başlatmaz, sadece API üzerinden test edilir.
 */
export const TEST_SERVERS: TestServerConfig[] = [
  {
    name: 'test-filesystem',
    description: 'Test filesystem MCP server',
    command: 'echo',
    args: ['filesystem-test'],
    env: {},
  },
  {
    name: 'test-database',
    description: 'Test database MCP server',
    command: 'echo',
    args: ['database-test'],
    env: {},
  },
  {
    name: 'test-webserver',
    description: 'Test webserver MCP server',
    command: 'echo',
    args: ['webserver-test'],
    env: {},
  },
];

/**
 * Test server'larını API üzerinden kur.
 */
export async function installTestServer(
  baseUrl: string,
  config: TestServerConfig
): Promise<any> {
  const response = await fetch(`${baseUrl}/api/mcp/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return response.json();
}

/**
 * Test server'larını API üzerinden kaldır.
 */
export async function uninstallTestServer(
  baseUrl: string,
  name: string
): Promise<any> {
  const response = await fetch(`${baseUrl}/api/mcp/servers/${name}`, {
    method: 'DELETE',
  });
  return response.json();
}

/**
 * Kurulu tüm server'ları temizle.
 */
export async function cleanupAllServers(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/mcp/servers`);
  const data = await response.json();

  if (data.success && data.servers) {
    for (const server of data.servers) {
      try {
        await uninstallTestServer(baseUrl, server.name);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
