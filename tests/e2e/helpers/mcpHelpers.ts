/**
 * MCP E2E Test Helpers
 *
 * Cleanup ve assertion yardımcı fonksiyonları.
 */

import { Page, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Kurulu tüm MCP server'ları temizle.
 */
export async function cleanupMCPServers(): Promise<void> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/mcp/servers`);
    const data = await response.json();

    if (data.success && data.servers) {
      for (const server of data.servers) {
        try {
          await fetch(`${BACKEND_URL}/api/mcp/servers/${server.name}`, {
            method: 'DELETE',
          });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * MCP Marketplace'i aç ve catalog'un yüklenmesini bekle.
 */
export async function navigateToMCPMarketplace(page: Page): Promise<void> {
  // MCP Marketplace sekmesine tıkla
  await page.click('button:has-text("MCP Marketplace")');

  // Marketplace tab'ının yüklenmesini bekle
  await expect(page.getByText('Marketplace')).toBeVisible();
  await expect(page.getByText('Kurulu Server')).toBeVisible();
}

/**
 * Installed tab'a geç.
 */
export async function navigateToInstalledTab(page: Page): Promise<void> {
  await page.click('button:has-text("Kurulu Server")');
  await page.waitForTimeout(500); // Tab switch animation
}

/**
 * Server'ın listede olduğunu doğrula.
 */
export async function expectServerInList(page: Page, serverName: string): Promise<void> {
  await expect(page.getByText(serverName)).toBeVisible();
}

/**
 * Server'ın listede olmadığını doğrula.
 */
export async function expectServerNotInList(page: Page, serverName: string): Promise<void> {
  await expect(page.getByText(serverName)).not.toBeVisible();
}

/**
 * Server durumunu doğrula.
 */
export async function expectServerStatus(page: Page, status: 'active' | 'disabled' | 'error'): Promise<void> {
  const statusText = {
    active: 'Active',
    disabled: 'Disabled',
    error: 'Error',
  };
  await expect(page.getByText(statusText[status])).toBeVisible();
}

/**
 * Toast bildirimini bekle.
 */
export async function expectToastNotification(page: Page, message: string): Promise<void> {
  await expect(page.getByText(message)).toBeVisible({ timeout: 10000 });
}
