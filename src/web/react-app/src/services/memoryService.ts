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

export const memoryService = {
  getAll: () => api.get<MemoryItem[]>('/memories'),
  search: (query: string) => api.get<MemoryItem[]>(`/memories/search?q=${encodeURIComponent(query)}`),
  create: (data: Omit<MemoryItem, 'id' | 'created_at'>) => api.post<Omit<MemoryItem, 'id' | 'created_at'>, MemoryCreateResponse>('/memories', data),
  update: (id: number, data: Partial<MemoryItem>) => api.put<Partial<MemoryItem>, MemoryItem>(`/memories/${id}`, data),
  delete: (id: number) => api.delete<void>(`/memories/${id}`),
};
