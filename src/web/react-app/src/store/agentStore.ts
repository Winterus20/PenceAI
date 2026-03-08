import { create } from 'zustand';

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
}

export interface ConversationItem {
    id: string;
    title?: string;
    user_name?: string;
    created_at?: string;
    updated_at?: string;
    message_count?: number;
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

export interface AgentState {
    isConnected: boolean;
    isReceiving: boolean;
    currentThinking: string;
    messages: Message[];
    activeMemories: any[];
    graphData: any;
    conversations: ConversationItem[];
    activeConversationId: string | null;
    stats: StatsState;
    confirmRequest: ConfirmRequest | null;
    setConnected: (status: boolean) => void;
    setReceiving: (status: boolean) => void;
    setThinking: (text: string) => void;
    addMessage: (msg: Message) => void;
    setMessages: (messages: Message[]) => void;
    patchMessage: (id: string, patch: Partial<Message>) => void;
    appendToMessage: (id: string, content: string) => void;
    updateLastMessage: (content: string) => void;
    setMemories: (memories: any[]) => void;
    setGraph: (graph: any) => void;
    setConversations: (conversations: ConversationItem[]) => void;
    removeConversation: (id: string) => void;
    setActiveConversationId: (id: string | null) => void;
    setStats: (stats: Partial<StatsState>) => void;
    setConfirmRequest: (request: ConfirmRequest | null) => void;
    clearMessages: () => void;
    appendThinking: (text: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
    isConnected: false,
    isReceiving: false,
    currentThinking: '',
    messages: [],
    activeMemories: [],
    graphData: { nodes: [], links: [] },
    conversations: [],
    activeConversationId: null,
    stats: { conversations: 0, messages: 0, memories: 0 },
    confirmRequest: null,

    setConnected: (status) => set({ isConnected: status }),
    setReceiving: (status) => set({ isReceiving: status }),
    setThinking: (text) => set({ currentThinking: text }),

    addMessage: (msg) => set((state) => ({
        messages: [...state.messages, msg]
    })),

    setMessages: (messages) => set({ messages }),

    patchMessage: (id, patch) => set((state) => ({
        messages: state.messages.map((message) =>
            message.id === id ? { ...message, ...patch } : message
        )
    })),

    appendToMessage: (id, content) => set((state) => ({
        messages: state.messages.map((message) =>
            message.id === id
                ? { ...message, content: `${message.content}${content}` }
                : message
        )
    })),

    updateLastMessage: (content) => set((state) => {
        if (state.messages.length === 0) return state;
        const newMessages = [...state.messages];
        newMessages[newMessages.length - 1] = {
            ...newMessages[newMessages.length - 1],
            content: newMessages[newMessages.length - 1].content + content
        };
        return { messages: newMessages };
    }),

    setMemories: (memories) => set({ activeMemories: memories }),

    setGraph: (graph) => set({ graphData: graph }),

    setConversations: (conversations) => set({ conversations }),

    removeConversation: (id) => set((state) => ({
        conversations: state.conversations.filter((conversation) => conversation.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })),

    setActiveConversationId: (id) => set({ activeConversationId: id }),

    setStats: (stats) => set((state) => ({
        stats: { ...state.stats, ...stats }
    })),

    setConfirmRequest: (request) => set({ confirmRequest: request }),

    clearMessages: () => set({ messages: [], currentThinking: '' }),

    appendThinking: (text) => set((state) => ({
        currentThinking: state.currentThinking + text
    })),
}));
