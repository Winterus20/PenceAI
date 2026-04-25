import { api } from '@/lib/api-client';

export interface MemoryItem {
  id: number;
  content: string;
  category?: string;
  importance?: number;
  created_at?: string;
}

export interface MemoryCreateResponse {
  success: boolean;
  memory: MemoryItem;
  isUpdate: boolean;
}

export interface InsightItem {
  id: number;
  type: string;
  description: string;
  confidence: number;
  hitCount: number;
  status: 'active' | 'suppressed' | 'pruned';
  firstSeen: string;
  lastSeen: string;
}

export interface InsightUpdatePayload {
  description?: string;
  status?: 'active' | 'suppressed' | 'pruned';
}

export const memoryService = {
  getAll: () => api.get<MemoryItem[]>('/memories'),
  search: (query: string) => api.get<MemoryItem[]>(`/memories/search?q=${encodeURIComponent(query)}`),
  create: (data: Omit<MemoryItem, 'id' | 'created_at'>) => api.post<Omit<MemoryItem, 'id' | 'created_at'>, MemoryCreateResponse>('/memories', data),
  update: (id: number, data: Partial<MemoryItem>) => api.put<Partial<MemoryItem>, MemoryItem>(`/memories/${id}`, data),
  delete: (id: number) => api.delete<void>(`/memories/${id}`),
};

export const insightService = {
  getAll: () => api.get<{ success: boolean; insights: InsightItem[] }>('/insights').then(r => r.insights),
  search: (q: string, minConfidence?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (minConfidence !== undefined) params.set('minConfidence', String(minConfidence));
    if (limit !== undefined) params.set('limit', String(limit));
    return api.get<{ success: boolean; insights: InsightItem[] }>(`/insights/search?${params.toString()}`).then(r => r.insights);
  },
  update: (id: number, data: InsightUpdatePayload) => api.patch<InsightUpdatePayload, { success: boolean }>(`/insights/${id}`, data),
  feedback: (id: number, isPositive: boolean) => api.post<{ isPositive: boolean }, { success: boolean }>(`/insights/${id}/feedback`, { isPositive }),
  prune: () => api.post<void, { success: boolean; result: { pruned: number; suppressed: number } }>('/insights/prune', undefined),
};
