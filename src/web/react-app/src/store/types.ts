export interface AttachmentItem {
  fileName: string;
  mimeType: string;
  size?: number;
  data?: string;
  previewUrl?: string | null;
}

export interface ToolCallItem {
  name: string;
  arguments?: unknown;
  status: 'running' | 'success' | 'error';
  result?: string | null;
  isError?: boolean;
}

export interface MemorySource {
  id: number;
  content: string;
  category?: string;
  importance?: number;
  score?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  avatar?: string;
  attachments?: AttachmentItem[];
  toolCalls?: ToolCallItem[];
  thinking?: string[];
  pending?: boolean;
  sources?: MemorySource[];
  dbId?: number;
}

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

export interface StatsState {
  conversations: number;
  messages: number;
  memories: number;
}

export interface ConfirmRequest {
  id: string;
  toolName: string;
  path?: string;
  operation?: string;
  description?: string;
}

export type ActiveView = 'chat' | 'channels' | 'memory' | 'settings' | 'mcp-marketplace' | 'metrics';
export type Theme = 'light' | 'dark';

export interface CanvasArtifact {
  id: string;
  title: string;
  content: string;
  language?: string;
  type: 'code' | 'markdown' | 'text' | 'mermaid';
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  messageCount?: number;
  lastActivity?: string;
}

export interface BulkDeleteConfirmState {
  isOpen: boolean;
  count: number;
  onConfirm: () => void;
}

export interface EditingMessageState {
  messageId: string | null;
  content: string;
}

export interface LightboxState {
  imageUrl: string | null;
  imageAlt: string;
}

export interface FeedbackState {
  messageId: string;
  type: 'positive' | 'negative';
  comment?: string;
}

export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  isVisible: boolean;
}

export interface MessageMetrics {
  /** Backend'den gelen conversation ID */
  conversationId?: string;
  /** Backend'den gelen message ID (benzersiz metrik anahtarı) */
  messageId?: string;
  performance: {
    total: number;
    retrieval: number;
    graphRAG: number;
    llmCalls: Array<{ key: string; ms: number }>;
    agentic: Record<string, number>;
    tools: number;
    toolCalls: number;
  };
  cost: {
    total: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    breakdown: string[];
  };
  context: {
    historyTokens: number;
    userMessageTokens: number;
    systemPromptTokens: number;
  };
}

export interface ChatSlice {
  isConnected: boolean;
  isReceiving: boolean;
  currentThinking: string;
  messages: Message[];
  activeMemories: unknown[];
  graphData: unknown;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  stats: StatsState;
  messageMetrics: Record<string, MessageMetrics | null>;
  selectedConversationIds: string[];
  bulkDeleteConfirm: BulkDeleteConfirmState | null;
  editingMessage: EditingMessageState;
  
  setConnected: (status: boolean) => void;
  setReceiving: (status: boolean) => void;
  setThinking: (text: string) => void;
  addMessage: (msg: Message) => void;
  setMessages: (messages: Message[]) => void;
  patchMessage: (id: string, patch: Partial<Message>) => void;
  appendToMessage: (id: string, content: string) => void;
  updateLastMessage: (content: string) => void;
  setMemories: (memories: unknown[]) => void;
  setGraph: (graph: unknown) => void;
  setConversations: (conversations: ConversationItem[]) => void;
  removeConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;
  setActiveConversationId: (id: string | null) => void;
  setStats: (stats: Partial<StatsState>) => void;
  setMessageMetrics: (payload: { messageId: string; metrics: MessageMetrics }) => void;
  clearMessages: () => void;
  appendThinking: (text: string) => void;
  toggleConversationSelection: (id: string) => void;
  clearConversationSelection: () => void;
  setBulkDeleteConfirm: (state: BulkDeleteConfirmState | null) => void;
  removeSelectedConversations: (ids: string[]) => void;
  setEditingMessage: (state: EditingMessageState) => void;
  clearEditingMessage: () => void;
  updateMessageContent: (messageId: string, content: string) => void;
  removeMessagesAfter: (messageId: string) => void;
  activeBranchInfo: BranchInfoResponse | null;
  setActiveBranchInfo: (info: BranchInfoResponse | null) => void;
  addBranchConversation: (parentId: string, childConversation: ConversationItem) => void;
}

export interface UISlice {
  activeView: ActiveView;
  confirmRequest: ConfirmRequest | null;
  theme: Theme;
  lightbox: LightboxState;
  toast: ToastState;
  canvasArtifact: CanvasArtifact | null;
  isCommandPaletteOpen: boolean;
  
  setActiveView: (view: ActiveView) => void;
  setConfirmRequest: (request: ConfirmRequest | null) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  openLightbox: (url: string, alt?: string) => void;
  closeLightbox: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  setCanvasArtifact: (artifact: CanvasArtifact | null) => void;
  toggleCommandPalette: () => void;
}

export interface SettingsSlice {
  userName: string;
  sensitivePaths: string[];
  channels: Channel[];
  selectedChannel: string | null;
  feedbacks: Record<string, FeedbackState>;
  defaultLLMProvider: string;
  defaultLLMModel: string;
  
  setUserName: (name: string) => void;
  setSensitivePaths: (paths: string[]) => void;
  addSensitivePath: (path: string) => void;
  removeSensitivePath: (path: string) => void;
  setChannels: (channels: Channel[]) => void;
  setSelectedChannel: (id: string | null) => void;
  fetchChannels: () => Promise<void>;
  sendFeedback: (messageId: string, conversationId: string, type: 'positive' | 'negative', comment?: string) => Promise<void>;
  setFeedback: (messageId: string, feedback: FeedbackState | null) => void;
  setDefaultLLMProvider: (provider: string) => void;
  setDefaultLLMModel: (model: string) => void;
}

// Global Agent State birleşimi
export type AgentState = ChatSlice & UISlice & SettingsSlice;
