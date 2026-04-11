/**
 * Observability API Routes
 *
 * Langfuse public API'ye proxy endpoint'leri.
 * Secret key'leri frontend'e expose etmemek için server-side proxy.
 */

import type { Express, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { getConfig } from './config.js';

interface LangfuseTrace {
  id: string;
  name: string;
  timestamp: Date;
  latency: number;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  releases: string[];
  version: string;
  userId: string;
  sessionId: string;
  tags: string[];
  public: boolean;
  usage: {
    input: number;
    output: number;
    total: number;
    unit: string;
  };
  cost: number;
  observations: LangfuseObservation[];
}

interface LangfuseObservation {
  id: string;
  traceId: string;
  type: 'span' | 'generation' | 'event';
  name: string;
  startTime: Date;
  endTime: Date;
  latency: number;
  input: unknown;
  output: unknown;
  model: string;
  modelParameters: Record<string, unknown>;
  usage: {
    input: number;
    output: number;
    total: number;
    unit: string;
  };
  cost: number;
  level: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';
  statusMessage: string;
  version: string;
}

interface LangfuseMetrics {
  tracesToday: number;
  tracesLast7Days: number;
  totalCostToday: number;
  totalCostLast7Days: number;
  avgLatency: number;
  totalTokensToday: number;
  totalTokensLast7Days: number;
}

/**
 * Langfuse API'ye istek atan helper fonksiyon
 */
async function fetchFromLangfuse(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const config = getConfig();
  
  if (!config.langfuseEnabled || !config.langfuseSecretKey || !config.langfusePublicKey) {
    throw new Error('Langfuse is not configured');
  }

  const baseUrl = config.langfuseBaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/api/public${path}`;
  
  // Langfuse public API authentication
  // Basic auth: publicKey:secretKey
  const auth = Buffer.from(`${config.langfusePublicKey}:${config.langfuseSecretKey}`).toString('base64');

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Langfuse API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Observability route'larını register eder
 */
export function registerObservabilityRoutes(app: Express): void {
  
  // ============ Summary / Metrics ============
  
  /**
   * GET /api/observability/summary
   * Özet metrikler: trace sayısı, cost, latency, token kullanımı
   */
  app.get('/api/observability/summary', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      
      if (!config.langfuseEnabled) {
        return res.status(503).json({ 
          error: 'Langfuse is not enabled',
          hint: 'LANGFUSE_ENABLED=true olarak ayarlayın' 
        });
      }

      // Langfuse'dan trace'leri çek
      const tracesResponse = await fetchFromLangfuse('/traces?limit=100&orderBy=timestamp.desc') as { 
        data: LangfuseTrace[];
        meta: { totalItems: number };
      };

      const traces = tracesResponse.data || [];
      
      // Bugünkü ve son 7 günlük metrikleri hesapla
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      let tracesToday = 0;
      let tracesLast7Days = 0;
      let costToday = 0;
      let costLast7Days = 0;
      let tokensToday = 0;
      let tokensLast7Days = 0;
      let totalLatency = 0;

      traces.forEach(trace => {
        const timestamp = new Date(trace.timestamp);
        const traceCost = trace.cost || 0;
        const traceTokens = trace.usage?.total || 0;
        const traceLatency = trace.latency || 0;

        if (timestamp >= todayStart) {
          tracesToday++;
          costToday += traceCost;
          tokensToday += traceTokens;
        }

        if (timestamp >= weekStart) {
          tracesLast7Days++;
          costLast7Days += traceCost;
          tokensLast7Days += traceTokens;
        }

        totalLatency += traceLatency;
      });

      const avgLatency = traces.length > 0 ? totalLatency / traces.length : 0;

      const metrics: LangfuseMetrics = {
        tracesToday,
        tracesLast7Days,
        totalCostToday: costToday,
        totalCostLast7Days: costLast7Days,
        avgLatency: Math.round(avgLatency),
        totalTokensToday: tokensToday,
        totalTokensLast7Days: tokensLast7Days,
      };

      res.json({
        success: true,
        metrics,
        totalTraces: tracesResponse.meta?.totalItems || traces.length,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[Observability] Summary fetch failed');
      res.status(500).json({ 
        error: 'Failed to fetch observability metrics',
        details: error.message 
      });
    }
  });

  // ============ Recent Traces ============
  
  /**
   * GET /api/observability/traces
   * Son N trace listesi
   * Query params: limit (default: 20), offset (default: 0)
   */
  app.get('/api/observability/traces', async (req: Request, res: Response) => {
    try {
      const config = getConfig();
      
      if (!config.langfuseEnabled) {
        return res.status(503).json({ 
          error: 'Langfuse is not enabled',
          hint: 'LANGFUSE_ENABLED=true olarak ayarlayın' 
        });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const tracesResponse = await fetchFromLangfuse(
        `/traces?limit=${limit}&offset=${offset}&orderBy=timestamp.desc`
      ) as { 
        data: Array<{
          id: string;
          name: string;
          timestamp: Date;
          latency: number;
          cost: number;
          usage: { total: number };
          observations: Array<{
            name: string;
            model: string;
            latency: number;
            cost: number;
            usage: { input: number; output: number; total: number };
            level: string;
          }>;
        }>;
        meta: { totalItems: number };
      };

      const traces = (tracesResponse.data || []).map(trace => ({
        id: trace.id,
        name: trace.name,
        timestamp: trace.timestamp,
        latency: trace.latency || 0,
        cost: trace.cost || 0,
        totalTokens: trace.usage?.total || 0,
        observations: (trace.observations || []).map(obs => ({
          name: obs.name || '',
          model: obs.model || '',
          latency: obs.latency || 0,
          cost: obs.cost || 0,
          tokens: obs.usage?.total || 0,
          level: obs.level || 'DEFAULT',
          usage: {
            input: obs.usage?.input || 0,
            output: obs.usage?.output || 0,
            total: obs.usage?.total || 0,
          },
        })),
      }));

      res.json({
        success: true,
        traces,
        total: tracesResponse.meta?.totalItems || traces.length,
        limit,
        offset,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[Observability] Traces fetch failed');
      res.status(500).json({ 
        error: 'Failed to fetch traces',
        details: error.message 
      });
    }
  });

  // ============ Single Trace Detail ============
  
  /**
   * GET /api/observability/traces/:id
   * Tekil trace detayı (observations tree ile)
   */
  app.get('/api/observability/traces/:id', async (req: Request, res: Response) => {
    try {
      const config = getConfig();
      
      if (!config.langfuseEnabled) {
        return res.status(503).json({ 
          error: 'Langfuse is not enabled',
          hint: 'LANGFUSE_ENABLED=true olarak ayarlayın' 
        });
      }

      const traceId = req.params.id;

      const trace = await fetchFromLangfuse(`/traces/${traceId}`) as LangfuseTrace;

      // Observations'ı da çek
      const observationsResponse = await fetchFromLangfuse(
        `/observations?traceId=${traceId}&orderBy=startTime.asc`
      ) as { data: LangfuseObservation[] };

      const observations = observationsResponse.data || [];

      res.json({
        success: true,
        trace: {
          id: trace.id,
          name: trace.name,
          timestamp: trace.timestamp,
          latency: trace.latency,
          cost: trace.cost,
          usage: trace.usage,
          input: trace.input,
          output: trace.output,
          metadata: trace.metadata,
          userId: trace.userId,
          sessionId: trace.sessionId,
          tags: trace.tags,
          observations: observations.map(obs => ({
            id: obs.id,
            type: obs.type,
            name: obs.name,
            startTime: obs.startTime,
            endTime: obs.endTime,
            latency: obs.latency,
            model: obs.model,
            usage: obs.usage,
            cost: obs.cost,
            level: obs.level,
            statusMessage: obs.statusMessage,
            input: obs.input,
            output: obs.output,
          })),
        },
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[Observability] Trace detail fetch failed');
      res.status(500).json({ 
        error: 'Failed to fetch trace detail',
        details: error.message 
      });
    }
  });

  // ============ Provider Stats ============
  
  /**
   * GET /api/observability/provider-stats
   * Provider bazlı kullanım istatistikleri
   */
  app.get('/api/observability/provider-stats', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      
      if (!config.langfuseEnabled) {
        return res.status(503).json({ 
          error: 'Langfuse is not enabled',
          hint: 'LANGFUSE_ENABLED=true olarak ayarlayın' 
        });
      }

      // Son 100 trace'i çek
      const tracesResponse = await fetchFromLangfuse('/traces?limit=100&orderBy=timestamp.desc') as { 
        data: LangfuseTrace[];
      };

      const traces = tracesResponse.data || [];
      
      // Provider bazlı grupla
      const providerStats: Record<string, { count: number; totalCost: number; totalTokens: number; avgLatency: number }> = {};
      
      traces.forEach(trace => {
        trace.observations?.forEach(obs => {
          if (obs.type === 'generation' && obs.model) {
            // Model'den provider'ı çıkar (örn: "gpt-4o" -> "openai", "claude-3" -> "anthropic")
            let provider = 'unknown';
            const model = obs.model.toLowerCase();
            
            if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) provider = 'openai';
            else if (model.includes('claude')) provider = 'anthropic';
            else if (model.includes('llama') || model.includes('codellama')) provider = 'ollama';
            else if (model.includes('mistral')) provider = 'mistral';
            else if (model.includes('mixtral')) provider = 'mistral';
            else if (model.includes('qwen')) provider = 'ollama';
            else if (model.includes('minimax')) provider = 'minimax';
            else if (model.includes('gemini')) provider = 'google';
            else if (model.includes('groq')) provider = 'groq';

            if (!providerStats[provider]) {
              providerStats[provider] = { count: 0, totalCost: 0, totalTokens: 0, avgLatency: 0 };
            }

            const stats = providerStats[provider];
            stats.count++;
            stats.totalCost += obs.cost || 0;
            stats.totalTokens += obs.usage?.total || 0;
            stats.avgLatency += obs.latency || 0;
          }
        });
      });

      // Ortalamaları hesapla
      Object.values(providerStats).forEach(stats => {
        if (stats.count > 0) {
          stats.avgLatency = Math.round(stats.avgLatency / stats.count);
        }
      });

      res.json({
        success: true,
        providerStats,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[Observability] Provider stats fetch failed');
      res.status(500).json({ 
        error: 'Failed to fetch provider stats',
        details: error.message 
      });
    }
  });

  // ============ Error Stats ============
  
  /**
   * GET /api/observability/error-stats
   * Hata oranları ve dağılımı
   */
  app.get('/api/observability/error-stats', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      
      if (!config.langfuseEnabled) {
        return res.status(503).json({ 
          error: 'Langfuse is not enabled',
          hint: 'LANGFUSE_ENABLED=true olarak ayarlayın' 
        });
      }

      // Son 100 trace'i çek
      const tracesResponse = await fetchFromLangfuse('/traces?limit=100&orderBy=timestamp.desc') as { 
        data: LangfuseTrace[];
      };

      const traces = tracesResponse.data || [];
      
      let totalTraces = 0;
      let errorTraces = 0;
      let warningTraces = 0;
      const errorsByType: Record<string, number> = {};

      traces.forEach(trace => {
        totalTraces++;
        
        trace.observations?.forEach(obs => {
          if (obs.level === 'ERROR') {
            errorTraces++;
            const errorType = obs.statusMessage || obs.name || 'unknown';
            errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
          } else if (obs.level === 'WARNING') {
            warningTraces++;
          }
        });
      });

      res.json({
        success: true,
        errorStats: {
          totalTraces,
          errorTraces,
          warningTraces,
          errorRate: totalTraces > 0 ? (errorTraces / totalTraces) * 100 : 0,
          errorsByType,
        },
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[Observability] Error stats fetch failed');
      res.status(500).json({ 
        error: 'Failed to fetch error statistics',
        details: error.message 
      });
    }
  });
}
