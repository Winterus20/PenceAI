import { api } from '@/lib/api-client';

export interface ConversationItem {
  id: string;
  title?: string;
  user_name?: string;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
  parent_conversation_id?: string | null;
  branch_point_message_id?: number | null;
  display_order?: string | null;
  has_children?: number;
  is_branch?: number;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ConversationBranchInfo {
  id: string;
  title: string;
  branch_point_message_id: number | null;
  display_order: string | null;
  message_count: number;
  updated_at: string;
}

export interface BranchInfoResponse {
  hasChildren: boolean;
  isBranch: boolean;
  parentConversationId: string | null;
  branchPointMessageId: number | null;
}

export interface ForkResponse {
  conversationId: string;
  messages: Message[];
}

export const conversationService = {
  getAll: () => api.get<ConversationItem[]>('/conversations'),
  getMessages: (id: string) => api.get<Message[]>(`/conversations/${id}/messages`),
  delete: (id: string, deleteBranches?: boolean) => api.delete<{ deleteBranches?: boolean }, void>(`/conversations/${id}`, { deleteBranches }),
  fork: (conversationId: string, forkFromMessageId: number) => api.post<{ forkFromMessageId: number }, ForkResponse>(`/conversations/${conversationId}/fork`, { forkFromMessageId }),
  getBranches: (conversationId: string) => api.get<ConversationBranchInfo[]>(`/conversations/${conversationId}/branches`),
  getBranchInfo: (conversationId: string) => api.get<BranchInfoResponse>(`/conversations/${conversationId}/branch-info`),
};
