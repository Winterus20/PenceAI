import { STORAGE_KEYS } from './constants.js';

export class PenceAIDashboard {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isProcessing = false;

        // Conversation tracking
        this.activeConversationId = null;
        this.showConversations = false;

        // Inline toggle state (global show/hide for all inline blocks)
        this.showThinking = false;
        this.showTools = false;

        // Pending data accumulated during live WebSocket stream
        this.pendingToolCalls = [];   // { name, arguments, status, result, isError }
        this.pendingThinking = [];    // string[]

        // Streaming (token-by-token) state
        this.streamingWrapper = null;
        this.streamingContent = null;
        this.streamingText = '';
        this.streamRenderScheduled = false;

        // Conversation panel state
        this.allConversations = [];
        this.convSortOrder = 'newest';
        this.convSearchQuery = '';
        this.selectedConvIds = new Set();
        this.pinnedConversations = JSON.parse(localStorage.getItem(STORAGE_KEYS.PINNED_CONVERSATIONS) || '[]');

        // Last user message for regenerate
        this.lastUserMessage = '';

        // Pending file attachments: { fileName, mimeType, size, data: base64, previewUrl? }
        this.pendingAttachments = [];

        this.init();
    }


    init() {
        this.configureMarked();
        this.bindNavigation();
        this.bindChatForm();
        this.bindQuickActions();
        this.bindToggleButtons();
        this.bindSensitivePaths();
        this.bindMemoryViewToggle();
        this.bindMemorySearch();
        this.bindMessageActions();
        this.bindSettings();
        this.bindConvControls();
        this.bindBulkDelete();
        this.bindExportConv();
        this.bindKeyboardShortcuts();
        this.initLightbox();
        this.connectWebSocket();
        this.fetchStats();
        this.fetchChannels();
        this.fetchSettings().then(() => this.checkOnboarding());

        // Graph state
        this.graphSimulation = null;
        this.currentGraphView = 'list'; // 'list' or 'graph'
    }
}
