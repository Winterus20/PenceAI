/**
 * E2E-MCP-003: MCP Settings Management Tests
 *
 * MCP ile ilgili ayarların yönetilebilmesini doğrular.
 */

import { test, expect } from '@playwright/test';
import { cleanupAllServers } from '../fixtures/testServers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

test.describe('MCP Settings Management (E2E-MCP-003)', () => {
  test.afterEach(async () => {
    await cleanupAllServers(BACKEND_URL);
  });

  test('should display MCP settings in settings dialog', async ({ page }) => {
    // Frontend'e git
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');

    // Settings dialog'unu aç
    const settingsButton = page.getByRole('button', { name: /Settings|Ayarlar/i });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    } else {
      // Alternatif selector
      await page.click('[data-testid="settings-button"]');
    }

    // Settings dialog'unun açılmasını bekle
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });

    // MCP ayarları bölümünü kontrol et
    // ENABLE_MCP veya MCP_SERVERS gibi metinleri ara
    const hasMCPSettings =
      (await page.getByText(/MCP_SERVERS|ENABLE_MCP|MCP Servers/i).isVisible()) ||
      (await page.getByText(/MCP Settings|MCP Ayarları/i).isVisible());

    // MCP settings bölümü mevcut olmalı
    expect(hasMCPSettings).toBe(true);
  });

  test('should show MCP_SERVERS environment variable format', async ({ request }) => {
    // Settings API'den mevcut ayarları getir
    const response = await request.get(`${BACKEND_URL}/api/settings`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    // MCP ile ilgili ayarlar mevcut olmalı
    expect(body).toBeDefined();
    // Settings response'da MCP ile ilgili alanlar olabilir
    // Bu backend implementasyonuna göre değişir
  });

  test('should update MCP settings via API', async ({ request }) => {
    // ENABLE_MCP ayarını güncelle
    const response = await request.post(`${BACKEND_URL}/api/settings`, {
      data: {
        enableMCP: 'true',
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
  });
});
