import { api } from '@/lib/api-client';

export interface ConversationItem {
  id: string;
  title?: string;
  user_name?: string;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  messages: Message[];
}

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export const conversationService = {
  getAll: () => api.get<ConversationItem[]>('/conversations'),
  getById: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  getMessages: (id: string) => api.get<Message[]>(`/conversations/${id}/messages`),
  delete: (id: string) => api.delete<void>(`/conversations/${id}`),
};
