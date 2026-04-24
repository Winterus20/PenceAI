import { api } from '@/lib/api-client';

export interface StatsState {
  conversations: number;
  messages: number;
  memories: number;
}

export const statsService = {
  get: () => api.get<StatsState>('/stats'),
};
