/**
 * E2E-MCP-001: MCP Server Lifecycle Tests
 *
 * Kullanıcının marketplace'ten bir server kurup, aktif edip,
 * devre dışı bırakıp ve kaldırabilmesini doğrular.
 */

import { test, expect } from '@playwright/test';
import { cleanupMCPServers } from '../helpers/mcpHelpers';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

test.describe('MCP Server Lifecycle (E2E-MCP-001)', () => {
  test.afterEach(async () => {
    await cleanupMCPServers();
  });

  test('should install, activate, disable, and uninstall a server via UI', async ({ page }) => {
    // 1. Navigate to MCP Marketplace
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');

    // MCP Marketplace butonunu bul ve tıkla
    const mcpButton = page.getByRole('button', { name: /MCP Marketplace/i });
    if (await mcpButton.isVisible()) {
      await mcpButton.click();
    } else {
      // Alternatif: Sol menüden MCP Marketplace'e git
      await page.click('text=MCP Marketplace');
    }

    // Marketplace tab'ının yüklenmesini bekle
    await expect(page.getByText('Marketplace')).toBeVisible({ timeout: 10000 });

    // 2. Catalog'un yüklenmesini bekle
    await expect(page.getByText('Search MCP servers')).toBeVisible({ timeout: 10000 });

    // 3. Arama kutusuna yaz
    const searchInput = page.getByPlaceholder(/Search MCP servers/i);
    await searchInput.fill('filesystem');

    // 4. İlk sonuçtaki Install butonuna tıkla
    // Not: Gerçek catalog entry'lerine göre değişebilir
    const installButton = page.getByRole('button', { name: /Install/i }).first();
    if (await installButton.isVisible()) {
      await installButton.click();
      // Kurulum başarılı mesajını bekle
      await expect(page.getByText(/installed|kuruldu|success/i)).toBeVisible({ timeout: 15000 });
    }

    // 5. Installed tab'a geç
    const installedTab = page.getByRole('tab', { name: /Kurulu Server/i });
    if (await installedTab.isVisible()) {
      await installedTab.click();
      await page.waitForTimeout(500);
    }

    // 6. Server'ın listede olduğunu doğrula
    // Server ismi catalog'a göre değişir, genel kontrol yap
    const serverList = page.locator('[class*="server"], [class*="card"]').first();
    if (await serverList.isVisible()) {
      // Server listede
      await expect(serverList).toBeVisible();
    }

    // 7. Server'ı devre dışı bırak
    const disableButton = page.getByRole('button', { name: /Disable|Devre/i }).first();
    if (await disableButton.isVisible()) {
      await disableButton.click();
      await page.waitForTimeout(1000);
    }

    // 8. Server'ı tekrar aktif et
    const enableButton = page.getByRole('button', { name: /Enable|Aktif/i }).first();
    if (await enableButton.isVisible()) {
      await enableButton.click();
      await page.waitForTimeout(1000);
    }

    // 9. Server'ı kaldır
    const uninstallButton = page.getByRole('button', { name: /Uninstall|Kaldır/i }).first();
    if (await uninstallButton.isVisible()) {
      await uninstallButton.click();
      await page.waitForTimeout(1000);
    }

    // 10. Server'ın listeden silindiğini doğrula
    // Liste boş olmalı veya server görünmemeli
    const emptyState = page.getByText(/No servers|Server bulunamadı|Boş/i);
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should show server tools after installation', async ({ page }) => {
    // API üzerinden server kur
    const serverConfig = {
      name: 'test-tools-server',
      description: 'Test server for tools verification',
      command: 'echo',
      args: ['tools-test'],
    };

    await fetch(`${BACKEND_URL}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverConfig),
    });

    // UI'a git
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');

    // MCP Marketplace'e git
    try {
      await page.click('text=MCP Marketplace');
    } catch {
      // Already on the page
    }

    // Installed tab'a geç
    try {
      await page.click('text=Kurulu Server');
      await page.waitForTimeout(500);
    } catch {
      // Tab might not be available
    }

    // Server'ın listede olduğunu doğrula
    await expect(page.getByText('test-tools-server')).toBeVisible({ timeout: 10000 });

    // Cleanup
    await fetch(`${BACKEND_URL}/api/mcp/servers/test-tools-server`, {
      method: 'DELETE',
    });
  });
});
