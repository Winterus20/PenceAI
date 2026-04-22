/**
 * Zod-based request validation middleware for Express routes.
 * Provides type-safe input validation for body, query, and params.
 *
 * Usage:
 *   import { validateBody, validateQuery } from './middleware/validate.js';
 *   app.post('/api/memories', validateBody(CreateMemorySchema), handler);
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ============ Generic Validation Middleware ============

interface ValidationErrorDetail {
  path: string;
  message: string;
}

function formatZodErrors(error: z.ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (transformed) data.
 * On failure, returns 400 with structured error details.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: formatZodErrors(result.error),
      });
      return;
    }
    // Replace body with parsed/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Validates req.query against a Zod schema.
 * On success, replaces req.query with the parsed data.
 * On failure, returns 400 with structured error details.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: formatZodErrors(result.error),
      });
      return;
    }
    req.query = result.data as Record<string, string | string[] | undefined>;
    next();
  };
}

/**
 * Validates req.params against a Zod schema.
 * On success, replaces req.params with the parsed data.
 * On failure, returns 400 with structured error details.
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: formatZodErrors(result.error),
      });
      return;
    }
    req.params = result.data as Record<string, string>;
    next();
  };
}

// ============ Pre-built Schemas ============

export const CreateMemorySchema = z.object({
  content: z.string().min(1, 'İçerik boş olamaz').max(10000, 'İçerik maksimum 10000 karakter olabilir'),
  category: z.enum(['preference', 'fact', 'habit', 'project', 'event', 'other', 'general']).optional().default('general'),
  importance: z.number().int().min(1, 'Importance en az 1 olmalı').max(10, 'Importance en fazla 10 olabilir').optional().default(5),
});

export const UpdateMemorySchema = z.object({
  content: z.string().min(1, 'İçerik boş olamaz').max(10000, 'İçerik maksimum 10000 karakter olabilir'),
  category: z.enum(['preference', 'fact', 'habit', 'project', 'event', 'other', 'general']).optional(),
  importance: z.number().int().min(1).max(10).optional(),
});

export const MemoryIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Geçersiz bellek ID'),
});

export const ConversationIdParamSchema = z.object({
  id: z.string().min(1, 'Konuşma ID zorunludur'),
});

export const ForkConversationSchema = z.object({
  forkFromMessageId: z.number().int().positive('forkFromMessageId pozitif bir tam sayı olmalı'),
});

export const UpdateConversationSchema = z.object({
  title: z.string().min(1, 'Başlık boş olamaz').max(200, 'Başlık maksimum 200 karakter olabilir'),
});

export const DeleteConversationsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'En az bir ID girilmelidir').max(100, 'Bir seferde en fazla 100 konuşma silinebilir'),
});

export const DeleteConversationSchema = z.object({
  deleteBranches: z.boolean().optional(),
});

export const SearchMemoriesQuerySchema = z.object({
  q: z.string().min(2, 'Arama sorgusu en az 2 karakter olmalı').max(500, 'Arama sorgusu maksimum 500 karakter olabilir'),
});

export const SensitivePathSchema = z.object({
  path: z.string().min(1, 'Dizin yolu boş olamaz').max(500, 'Dizin yolu maksimum 500 karakter olabilir'),
});

export const FeedbackSchema = z.object({
  messageId: z.string().min(1, 'Mesaj ID zorunludur'),
  conversationId: z.string().min(1, 'Konuşma ID zorunludur'),
  type: z.enum(['positive', 'negative'], { errorMap: () => ({ message: 'Feedback tipi "positive" veya "negative" olmalıdır' }) }),
  comment: z.string().max(2000, 'Yorum maksimum 2000 karakter olabilir').optional().nullable(),
});

export const OnboardingSchema = z.object({
  bio: z.string().min(10, 'Biyografi en az 10 karakter olmalı').max(50000, 'Biyografi maksimum 50000 karakter olabilir'),
  userName: z.string().min(1).max(100).optional().default('Kullanıcı'),
});

export const GraphRAGSetPhaseSchema = z.object({
  phase: z.number().int().min(1).max(4, 'Geçersiz phase (1-4 arası olmalı)'),
});

export const BehaviorDiscoveryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  sampleRate: z.number().min(0).max(1).optional(),
  maxComparisons: z.number().int().positive().optional(),
  logToFile: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'Geçerli bir konfigürasyon sağlanmalıdır',
});

export const MetricsLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

export const MetricsDaysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(1),
});

export const UsageStatsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'year']).optional().default('week'),
});

export const MemoryGraphQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  includePageRank: z.enum(['true', 'false']).optional().default('true'),
  includeCommunities: z.enum(['true', 'false']).optional().default('true'),
});
