import express, { Router } from 'express';
import { logger } from '../../utils/logger.js';
import {
  getMarketplace,
  getInstalledServers,
  installServer,
  activateServer,
  deactivateServer,
  uninstallServer,
  getServerTools,
  getServerStatus,
} from '../services/mcpService.js';

export function createMCPController(): Router {
  const router = express.Router();

  // GET /api/mcp/marketplace — Marketplace catalog'unu getir
  router.get('/marketplace', async (req, res) => {
    try {
      const { query } = req.query;
      const catalog = await getMarketplace(query as string);
      res.json({ success: true, catalog });
    } catch (err) {
      logger.error({ err }, '[MCP:routes] Failed to fetch marketplace');
      res.status(500).json({ success: false, error: 'Failed to fetch marketplace' });
    }
  });

  // GET /api/mcp/servers — Kurulu server'ları getir
  router.get('/servers', (req, res) => {
    try {
      const servers = getInstalledServers();
      const summary = {
        total: servers.length,
        active: servers.filter(s => s.status === 'active').length,
        disabled: servers.filter(s => s.status === 'disabled').length,
        error: servers.filter(s => s.status === 'error').length,
      };
      res.json({ success: true, servers, summary });
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to fetch servers');
      res.status(500).json({ success: false, error: 'Failed to fetch servers' });
    }
  });

  // POST /api/mcp/servers — Yeni server kur
  router.post('/servers', async (req, res) => {
    try {
      const { name, description, command, args, env, cwd, timeout } = req.body;
      if (!name || !command) {
        return res.status(400).json({ success: false, error: 'name and command required' });
      }
      const result = await installServer({
        name,
        description: description || '',
        command,
        args: args || [],
        env,
        cwd,
        timeout,
      });
      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(409).json(result);
      }
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to install server');
      res.status(500).json({ success: false, error: 'Failed to install server' });
    }
  });

  // PATCH /api/mcp/servers/:name/toggle — Server'ı aktif/pasif et
  router.patch('/servers/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      const { action } = req.body;
      if (action === 'enable') {
        const result = await activateServer(name);
        res.json(result);
      } else if (action === 'disable') {
        const result = await deactivateServer(name);
        res.json(result);
      } else {
        res.status(400).json({ success: false, error: 'action must be enable or disable' });
      }
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to toggle server');
      res.status(500).json({ success: false, error: 'Failed to toggle server' });
    }
  });

  // DELETE /api/mcp/servers/:name — Server'ı kaldır
  router.delete('/servers/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const result = await uninstallServer(name);
      res.json(result);
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to uninstall server');
      res.status(500).json({ success: false, error: 'Failed to uninstall server' });
    }
  });

  // GET /api/mcp/servers/:name/tools — Server'ın araçlarını getir
  router.get('/servers/:name/tools', (req, res) => {
    try {
      const { name } = req.params;
      const tools = getServerTools(name);
      res.json({ success: true, tools });
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to fetch tools');
      res.status(500).json({ success: false, error: 'Failed to fetch tools' });
    }
  });

  // GET /api/mcp/servers/:name/status — Server durumunu getir
  router.get('/servers/:name/status', (req, res) => {
    try {
      const { name } = req.params;
      const server = getServerStatus(name);
      if (server) {
        res.json({ success: true, server });
      } else {
        res.status(404).json({ success: false, error: 'Server not found' });
      }
    } catch (error) {
      logger.error({ error }, '[MCP:routes] Failed to fetch status');
      res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
  });

  return router;
}
