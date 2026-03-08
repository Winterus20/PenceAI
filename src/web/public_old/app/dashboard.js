import { STORAGE_KEYS } from './constants.js';
import { PenceAIDashboard } from './core.js';

Object.assign(PenceAIDashboard.prototype, {

    // ============ Image Lightbox ============

    initLightbox() {
        const overlay = document.getElementById('img-lightbox');
        const img = document.getElementById('img-lightbox-img');
        const caption = document.getElementById('img-lightbox-caption');
        const closeBtn = document.getElementById('img-lightbox-close');

        const open = (src, alt) => {
            img.src = src;
            caption.textContent = alt || '';
            overlay.classList.add('open');
            document.addEventListener('keydown', onKeyDown);
        };

        const close = () => {
            overlay.classList.remove('open');
            img.src = '';
            document.removeEventListener('keydown', onKeyDown);
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') close();
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        closeBtn.addEventListener('click', close);

        // Delegate clicks on chat attachment images
        document.addEventListener('click', (e) => {
            const thumb = e.target.closest('.msg-att-img img');
            if (thumb) open(thumb.src, thumb.alt);
        });
    },


    // ============ WebSocket ============

    connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.isConnected = true;
            this.updateConnectionStatus(true);
            console.log('[WS] Bağlandı');
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this.isProcessing = false;
            this.updateConnectionStatus(false);
            console.log('[WS] Bağlantı koptu, yeniden bağlanılıyor...');
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = (err) => {
            console.error('[WS] Hata:', err);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWsMessage(data);
            } catch (err) {
                console.error('[WS] Mesaj ayrıştırma hatası:', err);
            }
        };
    },


    handleWsMessage(data) {
        switch (data.type) {
            case 'token':
                this.handleStreamToken(data.content);
                break;

            case 'response':
                // Streaming wrapper varsa kaldır — final render ile değiştirilecek
                if (this.streamingWrapper) {
                    this.streamingWrapper.remove();
                    this.streamingWrapper = null;
                    this.streamingContent = null;
                    this.streamingText = '';
                }
                this.hideTypingIndicator();
                this.removeLiveToolIndicator();
                // Attach accumulated tool calls & thinking to the assistant message
                this.addMessage('assistant', data.content, {
                    toolCalls: this.pendingToolCalls.length > 0 ? [...this.pendingToolCalls] : null,
                    thinking: this.pendingThinking.length > 0 ? [...this.pendingThinking] : null,
                });
                // Reset pending state
                this.pendingToolCalls = [];
                this.pendingThinking = [];
                this.isProcessing = false;
                if (data.conversationId) {
                    this.activeConversationId = data.conversationId;
                }
                if (this.showConversations) {
                    this.fetchConversations();
                }
                break;

            case 'agent_event':
                this.handleAgentEvent(data.eventType, data.data);
                break;

            case 'clear_stream':
                // Model JSON tool call'ı düz metin olarak döndürdüğünde, streaming wrapper'ı temizle
                if (this.streamingWrapper) {
                    this.streamingWrapper.remove();
                    this.streamingWrapper = null;
                    this.streamingContent = null;
                    this.streamingText = '';
                }
                break;

            case 'tool_use':
                this.showLiveToolIndicator(data.toolName, data.status);
                break;

            case 'error':
                this.hideTypingIndicator();
                this.removeLiveToolIndicator();
                if (this.streamingWrapper) {
                    this.streamingWrapper.remove();
                    this.streamingWrapper = null;
                    this.streamingContent = null;
                    this.streamingText = '';
                }
                this.addMessage('assistant', `⚠️ Hata: ${data.message}`);
                this.pendingToolCalls = [];
                this.pendingThinking = [];
                this.isProcessing = false;
                break;

            case 'stats':
                this.updateStats(data.stats);
                break;

            case 'confirm_request':
                this.showConfirmModal(data);
                break;
        }
    },


    // ============ Agent Events ============

    handleAgentEvent(eventType, data) {
        switch (eventType) {
            case 'thinking': {
                const cleaned = this.stripThinkTags(data.content);
                if (cleaned) this.pendingThinking.push(cleaned);
                break;
            }
            case 'tool_start':
                this.pendingToolCalls.push({
                    name: data.name,
                    arguments: data.arguments,
                    status: 'running',
                    result: null,
                    isError: false,
                });
                this.updateLiveToolSummary();
                break;
            case 'tool_end': {
                // Update the matching pending tool call (last running one with that name)
                for (let i = this.pendingToolCalls.length - 1; i >= 0; i--) {
                    if (this.pendingToolCalls[i].name === data.name && this.pendingToolCalls[i].status === 'running') {
                        this.pendingToolCalls[i].status = data.isError ? 'error' : 'success';
                        this.pendingToolCalls[i].result = data.result;
                        this.pendingToolCalls[i].isError = data.isError;
                        break;
                    }
                }
                this.updateLiveToolSummary();
                break;
            }
            case 'iteration': {
                const typingText = document.querySelector('.typing-text');
                if (typingText) {
                    typingText.textContent = `PençeAI düşünüyor... (adım ${data.iteration})`;
                }
                break;
            }
        }
    },


    // ============ Toggle Buttons ============

    bindToggleButtons() {
        const btnThinking = document.getElementById('btn-toggle-thinking');
        const btnTools = document.getElementById('btn-toggle-tools');
        const btnConv = document.getElementById('btn-toggle-conversations');
        const convSidebar = document.getElementById('conversations-sidebar');

        btnThinking.addEventListener('click', () => {
            this.showThinking = !this.showThinking;
            btnThinking.classList.toggle('active', this.showThinking);
            // Toggle ALL inline thinking blocks across all messages
            document.querySelectorAll('.inline-thinking-block').forEach(el => {
                el.style.display = this.showThinking ? 'block' : 'none';
            });
            // Backend'e düşünme modunu bildir (reasoning_split: true/false)
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'set_thinking', enabled: this.showThinking }));
            }
        });

        btnTools.addEventListener('click', () => {
            this.showTools = !this.showTools;
            btnTools.classList.toggle('active', this.showTools);
            // Toggle ALL inline tool blocks across all messages
            document.querySelectorAll('.inline-tools-block').forEach(el => {
                el.style.display = this.showTools ? 'block' : 'none';
            });
        });

        btnConv.addEventListener('click', () => {
            this.showConversations = !this.showConversations;
            btnConv.classList.toggle('active', this.showConversations);
            convSidebar.style.display = this.showConversations ? 'flex' : 'none';
            if (this.showConversations) {
                this.fetchConversations();
            }
        });
    },


    // ============ Conversations Panel ============

    async fetchConversations() {
        try {
            const res = await fetch('/api/conversations');
            const conversations = await res.json();
            this.renderConversationsList(conversations);
        } catch (err) {
            console.error('Konuşmalar alınamadı:', err);
        }
    },


    renderConversationsList(conversations) {
        const list = document.getElementById('conversations-list');
        this.allConversations = conversations || [];

        if (!conversations || conversations.length === 0) {
            list.innerHTML = `
        <div class="debug-empty">
          Henüz sohbet geçmişi yok.<br>Bir mesaj göndererek başlayın.
        </div>
      `;
            return;
        }

        const filtered = this.filterAndSortConversations(conversations);
        const pinned = filtered.filter(c => this.pinnedConversations.includes(c.id));
        const unpinned = filtered.filter(c => !this.pinnedConversations.includes(c.id));

        if (pinned.length === 0 && unpinned.length === 0) {
            list.innerHTML = `<div class="debug-empty">Aramanızla eşleşen sohbet bulunamadı.</div>`;
            return;
        }

        const groups = this.groupConversationsByDate(unpinned);

        const renderItem = (conv) => {
            const isActive = conv.id === this.activeConversationId;
            const isPinned = this.pinnedConversations.includes(conv.id);
            const isSelected = this.selectedConvIds.has(conv.id);
            const rawDate = conv.updated_at || conv.created_at;
            const parsedDateStr = typeof rawDate === 'string' && !rawDate.endsWith('Z') ? rawDate.replace(' ', 'T') + 'Z' : rawDate;
            const date = new Date(parsedDateStr);
            const formattedDate = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
            const timeStr = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const title = conv.title || conv.user_name || 'Sohbet';
            return `
        <div class="conv-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isSelected ? 'selected' : ''}" data-conv-id="${conv.id}">
          <input type="checkbox" class="conv-select-checkbox" data-sel-id="${conv.id}" ${isSelected ? 'checked' : ''} title="Seç">
          <div class="conv-item-title">${this.escapeHtml(title)}</div>
          <div class="conv-item-meta">
            <span class="conv-item-date">${formattedDate} ${timeStr}</span>
            <span class="conv-item-count">${conv.message_count || 0} mesaj</span>
          </div>
          <button class="conv-pin-btn" data-pin-id="${conv.id}" title="${isPinned ? 'Sabitlemeyi Kaldır' : 'Sabitle'}">${isPinned ? '📌' : '📍'}</button>
          <button class="conv-item-delete" data-conv-delete="${conv.id}" title="Sohbeti Sil">✕</button>
        </div>
      `;
        };

        let html = '';
        if (pinned.length > 0) {
            html += `<div class="conv-group-label">📌 Sabitlenmiş</div>`;
            html += pinned.map(renderItem).join('');
        }
        const groupOrder = [
            { key: 'today', label: 'Bugün' },
            { key: 'yesterday', label: 'Dün' },
            { key: 'thisWeek', label: 'Bu Hafta' },
            { key: 'older', label: 'Daha Eski' },
        ];
        for (const { key, label } of groupOrder) {
            if (groups[key] && groups[key].length > 0) {
                html += `<div class="conv-group-label">${label}</div>`;
                html += groups[key].map(renderItem).join('');
            }
        }
        list.innerHTML = html;

        // Sync header title for active conversation
        const activeConv = this.allConversations.find(c => c.id === this.activeConversationId);
        if (activeConv) this.updateHeaderTitle(activeConv.title || activeConv.user_name || 'Sohbet');

        // Click: load conversation
        list.querySelectorAll('.conv-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.conv-item-delete') || e.target.closest('.conv-pin-btn') || e.target.closest('.conv-select-checkbox')) return;
                this.loadConversation(item.dataset.convId);
            });
            // Double-click: rename inline
            item.addEventListener('dblclick', (e) => {
                if (e.target.closest('.conv-item-delete') || e.target.closest('.conv-pin-btn') || e.target.closest('.conv-select-checkbox')) return;
                const convId = item.dataset.convId;
                const titleEl = item.querySelector('.conv-item-title');
                const currentTitle = titleEl.textContent;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentTitle;
                input.style.cssText = 'width:100%;background:var(--bg-tertiary);border:1px solid var(--accent-primary);border-radius:4px;color:var(--text-primary);padding:2px 4px;font-family:inherit;font-size:13px;outline:none;';
                titleEl.replaceWith(input);
                input.focus();
                input.select();
                const commit = async () => {
                    const newTitle = input.value.trim() || currentTitle;
                    const div = document.createElement('div');
                    div.className = 'conv-item-title';
                    div.textContent = newTitle;
                    input.replaceWith(div);
                    if (newTitle !== currentTitle) await this.renameConversation(convId, newTitle);
                };
                input.addEventListener('blur', commit);
                input.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                    if (ev.key === 'Escape') { input.value = currentTitle; input.blur(); }
                });
            });
        });

        // Delete button
        list.querySelectorAll('.conv-item-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Bu sohbet silinecek. Emin misiniz?')) {
                    await this.deleteConversation(btn.dataset.convDelete);
                }
            });
        });

        // Pin button
        list.querySelectorAll('.conv-pin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.pinId;
                if (this.pinnedConversations.includes(id)) {
                    this.unpinConversation(id);
                } else {
                    this.pinConversation(id);
                }
            });
        });

        // Select checkbox
        list.querySelectorAll('.conv-select-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.dataset.selId;
                if (cb.checked) { this.selectedConvIds.add(id); } else { this.selectedConvIds.delete(id); }
                cb.closest('.conv-item')?.classList.toggle('selected', cb.checked);
                this.updateBulkFooter();
            });
        });
    },


    async loadConversation(conversationId) {
        try {
            const res = await fetch(`/api/conversations/${conversationId}/messages`);
            const messages = await res.json();

            this.activeConversationId = conversationId;

            // Update header title from cached list
            const conv = this.allConversations.find(c => c.id === conversationId);
            if (conv) this.updateHeaderTitle(conv.title || conv.user_name || 'Sohbet');

            const messagesDiv = document.getElementById('chat-messages');
            messagesDiv.innerHTML = '';

            // Group messages: for each final assistant response, collect preceding
            // intermediate assistant (thinking + toolCalls) and tool (toolResults) messages
            let pendingTools = [];
            let pendingThinkingTexts = [];

            for (const msg of messages) {
                if (msg.role === 'user') {
                    // Görsel attachment'ları için previewUrl'yi base64 verisinden yeniden oluştur
                    let attachments = null;
                    if (msg.attachments && msg.attachments.length > 0) {
                        attachments = msg.attachments.map(att => ({
                            ...att,
                            previewUrl: att.mimeType && att.mimeType.startsWith('image/') && att.data
                                ? `data:${att.mimeType};base64,${att.data}`
                                : null,
                        }));
                    }
                    this.addMessage('user', msg.content, { timestamp: msg.timestamp, attachments });
                } else if (msg.role === 'assistant') {
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        // Intermediate assistant message — has thinking content + tool calls
                        if (msg.content && msg.content.trim()) {
                            const cleaned = this.stripThinkTags(msg.content);
                            if (cleaned) pendingThinkingTexts.push(cleaned);
                        }
                        for (const tc of msg.toolCalls) {
                            pendingTools.push({
                                name: tc.name,
                                arguments: tc.arguments,
                                status: 'success',
                                result: null,
                                isError: false,
                            });
                        }
                    } else {
                        // Final assistant response — render with accumulated tools & thinking
                        this.addMessage('assistant', msg.content, {
                            toolCalls: pendingTools.length > 0 ? pendingTools : null,
                            thinking: pendingThinkingTexts.length > 0 ? pendingThinkingTexts : null,
                            timestamp: msg.timestamp,
                        });
                        pendingTools = [];
                        pendingThinkingTexts = [];
                    }
                } else if (msg.role === 'tool') {
                    // Match tool results to pending tool calls
                    if (msg.toolResults) {
                        for (const tr of msg.toolResults) {
                            const match = pendingTools.find(t => t.name === tr.name && t.result === null);
                            if (match) {
                                match.result = tr.result;
                                match.isError = tr.isError;
                                match.status = tr.isError ? 'error' : 'success';
                            }
                        }
                    }
                }
            }

            // Leftover pending (edge case: interrupted response)
            if (pendingTools.length > 0 || pendingThinkingTexts.length > 0) {
                this.addMessage('assistant', '⏳ İşlem devam ediyor...', {
                    toolCalls: pendingTools.length > 0 ? pendingTools : null,
                    thinking: pendingThinkingTexts.length > 0 ? pendingThinkingTexts : null,
                });
            }

            if (messagesDiv.children.length === 0) {
                messagesDiv.innerHTML = `
          <div class="welcome-message">
            <div class="welcome-icon">🐾</div>
            <h3>Bu sohbet boş</h3>
            <p>Bir mesaj göndererek devam edin.</p>
          </div>
        `;
            }

            this.renderActiveConversation();
            this.isProcessing = false;

        } catch (err) {
            console.error('Konuşma yüklenemedi:', err);
        }
    },


    renderActiveConversation() {
        const list = document.getElementById('conversations-list');
        list.querySelectorAll('.conv-item').forEach(item => {
            item.classList.toggle('active', item.dataset.convId === this.activeConversationId);
        });
        // Sync header title
        const conv = this.allConversations.find(c => c.id === this.activeConversationId);
        if (conv) this.updateHeaderTitle(conv.title || conv.user_name || 'Sohbet');
    },


    async deleteConversation(conversationId) {
        try {
            await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });

            if (this.activeConversationId === conversationId) {
                this.activeConversationId = null;
                this.resetChatToWelcome();
            }

            this.fetchConversations();
            this.fetchStats();
        } catch (err) {
            console.error('Konuşma silinemedi:', err);
        }
    },


    resetChatToWelcome() {
        this.updateHeaderTitle('');
        const messagesDiv = document.getElementById('chat-messages');
        messagesDiv.innerHTML = `
      <div class="welcome-message">
        <div class="welcome-icon">🐾</div>
        <h3>Merhaba! Ben PençeAI</h3>
        <p>Kişisel AI asistanınız. Dosya yönetimi, kod yazma, web araştırması ve daha fazlası için buradayım.</p>
        <div class="quick-actions">
          <button class="quick-btn" data-message="Bilgisayarımdaki Masaüstü dosyalarını listele">📁 Dosyaları Listele</button>
          <button class="quick-btn" data-message="Bugün hava durumu nasıl?">🌤️ Hava Durumu</button>
          <button class="quick-btn" data-message="Basit bir Python scripti yaz">🐍 Kod Yaz</button>
          <button class="quick-btn" data-message="Kendini tanıt, neler yapabilirsin?">❓ Neler Yapabilirsin</button>
        </div>
      </div>
    `;
    },


    // ============ Send Message ============

    sendMessage(content, attachments = []) {
        if (!content.trim() && attachments.length === 0) return;
        if (!this.isConnected || this.isProcessing) return;

        this.isProcessing = true;
        this.lastUserMessage = content;

        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        this.addMessage('user', content, { attachments: attachments.length > 0 ? attachments : null });

        // Reset pending state for the upcoming response
        this.pendingToolCalls = [];
        this.pendingThinking = [];

        const wsMsg = { type: 'chat', content };

        if (attachments.length > 0) {
            // Send only metadata + data; strip previewUrl (not needed on server)
            wsMsg.attachments = attachments.map(({ fileName, mimeType, size, data }) => ({
                fileName, mimeType, size, data
            }));
        }

        if (this.activeConversationId) {
            wsMsg.conversationId = this.activeConversationId;
        } else {
            wsMsg.newConversation = true;
        }

        this.ws.send(JSON.stringify(wsMsg));
        this.showTypingIndicator();
    },


    // ============ Chat UI ============

    /**
     * Renders a message bubble with optional inline tool/thinking blocks.
     * @param {string} role - 'user' or 'assistant'
     * @param {string} content - The text content
     * @param {object} [meta] - Optional: { toolCalls: [...], thinking: [...] }
     */
    addMessage(role, content, meta = null) {
        const messagesDiv = document.getElementById('chat-messages');

        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role}`;

        // --- Inline Thinking Block (only for assistant with thinking data) ---
        if (role === 'assistant' && meta && meta.thinking && meta.thinking.length > 0) {
            const thinkingBlock = this.createInlineThinkingBlock(meta.thinking);
            wrapper.appendChild(thinkingBlock);
        }

        // --- Inline Tools Block (only for assistant with tool calls) ---
        if (role === 'assistant' && meta && meta.toolCalls && meta.toolCalls.length > 0) {
            const toolsBlock = this.createInlineToolsBlock(meta.toolCalls);
            wrapper.appendChild(toolsBlock);
        }

        // --- Message Bubble ---
        const messageEl = document.createElement('div');
        messageEl.className = `message ${role}`;

        const avatar = role === 'user' ? '👤' : '🐾';
        const renderedContent = this.renderMarkdown(content);

        const timestamp = meta?.timestamp ? new Date(meta.timestamp) : new Date();
        const timeStr = timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const actionBtns = role === 'assistant'
            ? `<button class="msg-action-btn msg-like-btn" title="Beğen">👍</button>
          <button class="msg-action-btn msg-dislike-btn" title="Beğenme">👎</button>
          <button class="msg-action-btn regen-btn" title="Yeniden Oluştur (son mesaj)">🔄</button>
          <button class="msg-action-btn msg-export-btn" title="Mesajı Kopyala (Markdown)">📤</button>`
            : `<button class="msg-action-btn msg-edit-btn" title="Düzenle ve Yeniden Gönder">✏️</button>`;

        // Render attachments inside user message bubble
        let attachmentsHtml = '';
        if (role === 'user' && meta?.attachments && meta.attachments.length > 0) {
            attachmentsHtml = '<div class="msg-attachments">' + meta.attachments.map(att => {
                if (att.mimeType && att.mimeType.startsWith('image/') && att.previewUrl) {
                    return `<div class="msg-att-img"><img src="${att.previewUrl}" alt="${this.escapeHtml(att.fileName || 'resim')}" title="${this.escapeHtml(att.fileName || '')}"></div>`;
                }
                const ext = att.fileName ? att.fileName.split('.').pop().toUpperCase() : '?';
                return `<div class="msg-att-file"><span class="msg-att-icon">📎</span><span class="msg-att-name">${this.escapeHtml(att.fileName || 'dosya')}</span><span class="msg-att-size">${att.size ? this.formatFileSize(att.size) : ''}</span></div>`;
            }).join('') + '</div>';
        }

        messageEl.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-body">
        ${attachmentsHtml}
        <div class="message-content">${renderedContent}</div>
        <div class="message-meta">
          <span class="message-time">${timeStr}</span>
          <button class="message-copy-btn" title="Mesajı kopyala">📋</button>
          ${actionBtns}
        </div>
      </div>
    `;

        wrapper.appendChild(messageEl);
        messagesDiv.appendChild(wrapper);

        // Syntax highlighting
        wrapper.querySelectorAll('pre code').forEach(el => {
            if (window.hljs) hljs.highlightElement(el);
        });

        if (role === 'user' || this.isAtBottom(messagesDiv)) {
            this.scrollToBottom(messagesDiv);
        }
    },


    // ============ Inline Thinking Block ============

    createInlineThinkingBlock(thinkingEntries) {
        const block = document.createElement('div');
        block.className = 'inline-thinking-block';
        block.style.display = this.showThinking ? 'block' : 'none';

        const header = document.createElement('div');
        header.className = 'inline-block-header thinking-header';
        header.innerHTML = `
      <span class="inline-block-icon">🧠</span>
      <span class="inline-block-title">Düşünce Süreci</span>
      <span class="inline-block-count">${thinkingEntries.length}</span>
      <span class="inline-block-chevron">▼</span>
    `;

        const contentEl = document.createElement('div');
        contentEl.className = 'inline-block-content';

        thinkingEntries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'inline-thinking-item';
            item.innerHTML = `<span class="thinking-label">💭</span>${this.escapeHtml(entry)}`;
            contentEl.appendChild(item);
        });

        // Collapsed by default, click header to expand
        let expanded = false;
        header.addEventListener('click', () => {
            expanded = !expanded;
            contentEl.style.display = expanded ? 'block' : 'none';
            header.querySelector('.inline-block-chevron').textContent = expanded ? '▲' : '▼';
        });
        contentEl.style.display = 'none';

        block.appendChild(header);
        block.appendChild(contentEl);
        return block;
    },


    // ============ Inline Tools Block ============

    createInlineToolsBlock(toolCalls) {
        const TOOL_ICONS = {
            readFile: '📄', writeFile: '✏️', listDirectory: '📁',
            executeShell: '💻', saveMemory: '💾', searchMemory: '🔍', deleteMemory: '🗑️',
            searchConversation: '💬', webSearch: '🌐',
        };

        const block = document.createElement('div');
        block.className = 'inline-tools-block';
        block.style.display = this.showTools ? 'block' : 'none';

        const header = document.createElement('div');
        header.className = 'inline-block-header tools-header';

        // Show a compact summary of tools used
        const toolNames = [...new Set(toolCalls.map(tc => tc.name))];
        const summaryIcons = toolNames.map(n => TOOL_ICONS[n] || '🔧').join(' ');

        header.innerHTML = `
      <span class="inline-block-icon">🔧</span>
      <span class="inline-block-title">Kullanılan Araçlar</span>
      <span class="inline-block-tools-summary">${summaryIcons}</span>
      <span class="inline-block-count">${toolCalls.length}</span>
      <span class="inline-block-chevron">▼</span>
    `;

        const contentEl = document.createElement('div');
        contentEl.className = 'inline-block-content';

        toolCalls.forEach(tc => {
            const item = document.createElement('div');
            item.className = 'inline-tool-item';

            const icon = TOOL_ICONS[tc.name] || '🔧';
            const statusClass = tc.status === 'error' ? 'error' : tc.status === 'running' ? 'running' : 'success';
            const statusText = tc.status === 'error' ? '❌ hata' : tc.status === 'running' ? '⏳ çalışıyor' : '✅';
            const argsStr = tc.arguments ? JSON.stringify(tc.arguments, null, 0) : '';

            let resultHtml = '';
            if (tc.result) {
                const truncated = tc.result.length > 300 ? tc.result.substring(0, 300) + '...' : tc.result;
                resultHtml = `<div class="inline-tool-result">${this.escapeHtml(truncated)}</div>`;
            }

            item.innerHTML = `
        <div class="inline-tool-header">
          <span>${icon}</span>
          <span class="inline-tool-name">${tc.name}</span>
          <span class="inline-tool-status ${statusClass}">${statusText}</span>
        </div>
        <div class="inline-tool-args">${this.escapeHtml(argsStr.substring(0, 200))}</div>
        ${resultHtml}
      `;
            contentEl.appendChild(item);
        });

        // Collapsed by default
        let expanded = false;
        header.addEventListener('click', () => {
            expanded = !expanded;
            contentEl.style.display = expanded ? 'block' : 'none';
            header.querySelector('.inline-block-chevron').textContent = expanded ? '▲' : '▼';
        });
        contentEl.style.display = 'none';

        block.appendChild(header);
        block.appendChild(contentEl);
        return block;
    },


    // ============ Live Tool Indicator (during streaming) ============

    // Shows all accumulated tool calls (completed + running) as a persistent live summary.
    // Called on tool_start and tool_end so the indicator is never blank between iterations.
    updateLiveToolSummary() {
        this.removeLiveToolIndicator();
        if (this.pendingToolCalls.length === 0) return;

        const messagesDiv = document.getElementById('chat-messages');
        const TOOL_ICONS = {
            readFile: '📄', writeFile: '✏️', listDirectory: '📁',
            executeShell: '💻', saveMemory: '💾', searchMemory: '🔍', deleteMemory: '🗑️',
            searchConversation: '💬', webSearch: '🌐',
        };

        const hasRunning = this.pendingToolCalls.some(tc => tc.status === 'running');

        const indicator = document.createElement('div');
        indicator.className = 'tool-indicator live-tool-indicator';

        const parts = this.pendingToolCalls.map(tc => {
            const icon = TOOL_ICONS[tc.name] || '🔧';
            const statusIcon = tc.status === 'running' ? '⏳' : tc.isError ? '❌' : '✅';
            return `<span>${statusIcon} ${icon} ${tc.name}</span>`;
        }).join('<span style="opacity:0.4"> · </span>');

        const statusText = hasRunning ? 'çalışıyor...' : 'yanıt oluşturuluyor...';

        indicator.innerHTML = `
      <span class="tool-icon">⚙️</span>
      ${parts}
      <span style="color: var(--text-muted)">${statusText}</span>
    `;

        const shouldScroll = this.isAtBottom(messagesDiv);
        messagesDiv.appendChild(indicator);
        if (shouldScroll) {
            this.scrollToBottom(messagesDiv);
        }
    },


    showLiveToolIndicator(toolName, status) {
        const messagesDiv = document.getElementById('chat-messages');
        this.removeLiveToolIndicator();

        const TOOL_ICONS = {
            readFile: '📄', writeFile: '✏️', listDirectory: '📁',
            executeShell: '💻', saveMemory: '💾', searchMemory: '🔍', deleteMemory: '🗑️',
            searchConversation: '💬', webSearch: '🌐',
        };

        const indicator = document.createElement('div');
        indicator.className = 'tool-indicator live-tool-indicator';
        indicator.innerHTML = `
      <span class="tool-icon">⚙️</span>
      <span>${TOOL_ICONS[toolName] || '🔧'} ${toolName}</span>
      <span style="color: var(--text-muted)">${status || 'çalışıyor...'}</span>
    `;

        const shouldScroll = this.isAtBottom(messagesDiv);
        messagesDiv.appendChild(indicator);
        if (shouldScroll) {
            this.scrollToBottom(messagesDiv);
        }
    },


    removeLiveToolIndicator() {
        const existing = document.querySelector('.live-tool-indicator');
        if (existing) existing.remove();
    },


    // ============ Confirm Modal ============

    showConfirmModal(data) {
        const TOOL_LABELS = {
            writeFile: '✏️ Dosya Yazma',
            executeShell: '💻 Komut Çalıştırma',
        };
        const OP_LABELS = {
            write: '📝 Yazma',
            delete: '🗑️ Silme',
            execute: '⚡ Çalıştırma',
        };

        document.getElementById('confirm-tool-name').textContent = TOOL_LABELS[data.toolName] || data.toolName;
        document.getElementById('confirm-operation').textContent = OP_LABELS[data.operation] || data.operation;
        document.getElementById('confirm-path').textContent = data.path;
        document.getElementById('confirm-description').textContent = data.description;

        const modal = document.getElementById('confirm-modal');
        modal.style.display = 'flex';

        // Timer
        let remaining = 60;
        const timerEl = document.getElementById('confirm-timer');
        timerEl.textContent = remaining;
        const timerInterval = setInterval(() => {
            remaining--;
            timerEl.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(timerInterval);
                this.sendConfirmResponse(data.id, false);
                this.hideConfirmModal();
            }
        }, 1000);

        // Button handlers — use one-time listeners
        const approveBtn = document.getElementById('confirm-approve-btn');
        const denyBtn = document.getElementById('confirm-deny-btn');

        const cleanup = () => {
            clearInterval(timerInterval);
            this.hideConfirmModal();
            approveBtn.removeEventListener('click', onApprove);
            denyBtn.removeEventListener('click', onDeny);
        };

        const onApprove = () => {
            this.sendConfirmResponse(data.id, true);
            cleanup();
        };
        const onDeny = () => {
            this.sendConfirmResponse(data.id, false);
            cleanup();
        };

        approveBtn.addEventListener('click', onApprove);
        denyBtn.addEventListener('click', onDeny);
    },


    hideConfirmModal() {
        document.getElementById('confirm-modal').style.display = 'none';
    },


    sendConfirmResponse(id, approved) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'confirm_response',
                id,
                approved,
            }));
        }
    },


    showTypingIndicator() {
        document.getElementById('typing-indicator').style.display = 'flex';
    },


    hideTypingIndicator() {
        document.getElementById('typing-indicator').style.display = 'none';
    },


    // ============ Markdown Rendering ============

    configureMarked() {
        if (typeof marked === 'undefined') return;
        const self = this;
        const renderer = {
            code(code, lang) {
                const langLabel = lang || 'text';
                const escaped = code
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${langLabel}</span><button class="code-copy-btn">📋 Kopyala</button></div><pre><code class="language-${lang || ''}">${escaped}</code></pre></div>`;
            },
            link(href, title, text) {
                const titleAttr = title ? ` title="${self.escapeHtml(title)}"` : '';
                return `<a href="${href}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
            }
        };
        marked.use({ renderer, gfm: true, breaks: false });
        if (typeof window.markedKatex !== 'undefined') {
            marked.use(window.markedKatex({ throwOnError: false }));
        }
    },


    renderMarkdown(text) {
        if (!text) return '';
        if (typeof marked === 'undefined') return this.escapeHtml(text);

        let processedText = text;
        // LaTeX block math \[ ... \] to $$ ... $$
        processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
        // LaTeX inline math \( ... \) to $ ... $
        processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

        return marked.parse(processedText);
    },


    stripThinkTags(text) {
        if (!text) return '';
        // Tam etiket çiftlerini temizle
        let result = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
        // Tek başına kalan açılış/kapanış etiketlerini de temizle
        result = result.replace(/<\/?think>/gi, '');
        return result.trim();
    },


    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },


    // ============ Navigation ============

    bindNavigation() {
        const navBtns = document.querySelectorAll('.nav-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById(`view-${view}`).classList.add('active');
                if (view === 'memory') {
                    if (this.currentGraphView === 'graph') {
                        this.fetchMemoryGraph();
                    } else {
                        this.fetchMemories();
                    }
                }
                if (view === 'channels') this.fetchChannels();
                if (view === 'settings') this.fetchSensitivePaths();
            });
        });
    },


    // ============ Chat Form ============

    bindChatForm() {
        const form = document.getElementById('chat-form');
        const input = document.getElementById('chat-input');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const content = input.value.trim();
            if (content || this.pendingAttachments.length > 0) {
                const attachments = [...this.pendingAttachments];
                this.pendingAttachments = [];
                this.renderAttachmentChips();
                this.sendMessage(content, attachments);
                input.value = '';
                input.style.height = 'auto';
            }
        });

        const charCounter = document.getElementById('char-counter');
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            const len = input.value.length;
            if (charCounter) {
                charCounter.textContent = len;
                charCounter.className = 'char-counter' + (len > 3000 ? ' danger' : len > 2000 ? ' warn' : '');
            }
        });

        // File attachment — full implementation
        const fileInput = document.getElementById('file-upload-input');
        if (fileInput) {
            fileInput.addEventListener('change', () => {
                this.handleFileSelection(Array.from(fileInput.files));
                fileInput.value = '';
            });
        }

        // Clipboard paste support (images)
        document.addEventListener('paste', (e) => {
            const chatView = document.getElementById('view-chat');
            if (!chatView || !chatView.classList.contains('active')) return;
            const items = Array.from(e.clipboardData?.items || []);
            const imageItems = items.filter(i => i.kind === 'file');
            if (imageItems.length > 0) {
                e.preventDefault();
                this.handleFileSelection(imageItems.map(i => i.getAsFile()).filter(Boolean));
            }
        });

        // Drag & drop into chat
        const chatBody = document.getElementById('chat-body-wrapper');
        if (chatBody) {
            chatBody.addEventListener('dragover', (e) => { e.preventDefault(); chatBody.classList.add('drag-over'); });
            chatBody.addEventListener('dragleave', () => chatBody.classList.remove('drag-over'));
            chatBody.addEventListener('drop', (e) => {
                e.preventDefault();
                chatBody.classList.remove('drag-over');
                const files = Array.from(e.dataTransfer?.files || []);
                if (files.length > 0) this.handleFileSelection(files);
            });
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                form.dispatchEvent(new Event('submit'));
            }
        });

        document.getElementById('btn-new-chat').addEventListener('click', () => {
            this.activeConversationId = null;
            this.resetChatToWelcome();
            if (this.showConversations) {
                this.fetchConversations();
            }
        });
    },


    // ============ File Attachment Helpers ============

    handleFileSelection(files) {
        const MAX_FILES = 10;
        const MAX_SIZE_MB = 25;
        for (const file of files) {
            if (this.pendingAttachments.length >= MAX_FILES) {
                alert(`En fazla ${MAX_FILES} dosya ekleyebilirsiniz.`);
                break;
            }
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                alert(`"${file.name}" çok büyük (maks. ${MAX_SIZE_MB} MB).`);
                continue;
            }
            const reader = new FileReader();
            reader.onload = (evt) => {
                // DataURL format: "data:mime/type;base64,XXXX"
                const dataUrl = evt.target.result;
                const base64 = dataUrl.split(',')[1];
                const att = {
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    data: base64,
                    previewUrl: file.type.startsWith('image/') ? dataUrl : null,
                };
                this.pendingAttachments.push(att);
                this.renderAttachmentChips();
            };
            reader.readAsDataURL(file);
        }
    },


    renderAttachmentChips() {
        const area = document.getElementById('attachment-preview-area');
        if (!area) return;
        if (this.pendingAttachments.length === 0) {
            area.style.display = 'none';
            area.innerHTML = '';
            return;
        }
        area.style.display = 'flex';
        area.innerHTML = '';
        this.pendingAttachments.forEach((att, idx) => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            if (att.previewUrl) {
                chip.innerHTML = `<img class="att-thumb" src="${att.previewUrl}" alt="${this.escapeHtml(att.fileName)}">`;
            } else {
                chip.innerHTML = `<span class="att-file-icon">📄</span>`;
            }
            chip.innerHTML += `<span class="att-chip-name">${this.escapeHtml(att.fileName)}</span>
                <span class="att-chip-size">${this.formatFileSize(att.size)}</span>
                <button class="att-chip-remove" title="Kaldır" data-idx="${idx}">✕</button>`;
            chip.querySelector('.att-chip-remove').addEventListener('click', () => {
                this.pendingAttachments.splice(idx, 1);
                this.renderAttachmentChips();
            });
            area.appendChild(chip);
        });
    },


    formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },


    // ============ Quick Actions ============

    bindQuickActions() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('quick-btn')) {
                const message = e.target.dataset.message;
                if (message) {
                    this.sendMessage(message);
                }
            }
        });
    },


    // ============ API Calls ============

    async fetchStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            this.updateStats(data);
        } catch (err) {
            console.error('Stats alınamadı:', err);
        }
    },


    updateStats(stats) {
        document.getElementById('stat-conversations').textContent = stats.conversations || 0;
        document.getElementById('stat-messages').textContent = stats.messages || 0;
        document.getElementById('stat-memories').textContent = stats.memories || 0;
    },


    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('span:last-child');
        dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
        text.textContent = connected ? 'Bağlı' : 'Bağlantı Kesik';
    },


    async fetchChannels() {
        try {
            const res = await fetch('/api/channels');
            const channels = await res.json();
            this.renderChannels(channels);
        } catch (err) {
            console.error('Kanallar alınamadı:', err);
        }
    },


    renderChannels(channels) {
        const grid = document.getElementById('channels-grid');
        if (!channels || channels.length === 0) {
            grid.innerHTML = `
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-icon">🌐</span>
            <span class="channel-name">Web Dashboard</span>
          </div>
          <div class="channel-status">
            <span class="status-dot connected"></span>
            <span>Aktif — siz buradasınız</span>
          </div>
        </div>
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-icon">✈️</span>
            <span class="channel-name">Telegram</span>
          </div>
          <div class="channel-status">
            <span class="status-dot disconnected"></span>
            <span>Yapılandırılmamış</span>
          </div>
        </div>
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-icon">🎮</span>
            <span class="channel-name">Discord</span>
          </div>
          <div class="channel-status">
            <span class="status-dot disconnected"></span>
            <span>Yapılandırılmamış</span>
          </div>
        </div>
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-icon">📱</span>
            <span class="channel-name">WhatsApp</span>
          </div>
          <div class="channel-status">
            <span class="status-dot disconnected"></span>
            <span>Yapılandırılmamış</span>
          </div>
        </div>
      `;
            return;
        }
        const channelIcons = { web: '🌐', telegram: '✈️', discord: '🎮', whatsapp: '📱' };
        grid.innerHTML = channels.map(ch => `
      <div class="channel-card">
        <div class="channel-card-header">
          <span class="channel-icon">${channelIcons[ch.type] || '📡'}</span>
          <span class="channel-name">${ch.name}</span>
        </div>
        <div class="channel-status">
          <span class="status-dot ${ch.connected ? 'connected' : 'disconnected'}"></span>
          <span>${ch.connected ? 'Bağlı' : 'Bağlı Değil'}</span>
        </div>
      </div>
    `).join('');
    },


    async fetchMemories() {
        try {
            const res = await fetch('/api/memories');
            const memories = await res.json();
            this.renderMemories(memories);
        } catch (err) {
            console.error('Bellekler alınamadı:', err);
        }
    },


    renderMemories(memories) {
        const list = document.getElementById('memory-list');
        const filterCategory = document.getElementById('memory-filter-category')?.value || 'all';

        // Filter the memories by category if not 'all'
        const filteredMemories = filterCategory === 'all'
            ? memories
            : memories.filter(m => m.category === filterCategory);

        this.currentMemories = filteredMemories; // Store for edit reference

        if (!filteredMemories || filteredMemories.length === 0) {
            list.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <p>Henüz bellek kaydı yok (veya bu kategoride sonuç bulunamadı).</p>
          <p style="font-size: 12px; margin-top: 8px;">AI asistanınız konuşmalarınızdan önemli bilgileri otomatik olarak kaydedecek veya yukarıdan kendiniz ekleyebilirsiniz.</p>
        </div>
      `;
            return;
        }

        list.innerHTML = filteredMemories.map(m => {
            const rawDate = m.created_at;
            const parsedDateStr = typeof rawDate === 'string' && !rawDate.endsWith('Z') ? rawDate.replace(' ', 'T') + 'Z' : rawDate;
            const date = new Date(parsedDateStr);
            const importanceStars = '⭐'.repeat(Math.min(Math.floor((m.importance || 0) / 2), 5));

            // Serialize for modal editing
            const escapedContent = this.escapeHtml(m.content);
            const rawContentBase64 = btoa(unescape(encodeURIComponent(m.content)));

            return `
      <div class="memory-item" data-memory-id="${m.id}">
        <div class="memory-item-top">
          <span class="memory-category">${m.category || 'general'}</span>
          ${importanceStars ? `<span class="memory-importance">${importanceStars}</span>` : ''}
          <div class="memory-actions" style="margin-left: auto; display: flex; gap: 4px;">
              <button class="memory-edit-btn" data-memory-id="${m.id}" data-category="${m.category}" data-importance="${m.importance}" data-content-b64="${rawContentBase64}" title="Düzenle">✏️</button>
              <button class="memory-delete-btn" data-memory-id="${m.id}" title="Sil">🗑️</button>
          </div>
        </div>
        <span class="memory-content">${escapedContent}</span>
        <span class="memory-date">${date.toLocaleDateString('tr-TR')}</span>
      </div>
    `;
        }).join('');

        // Bind delete action
        list.querySelectorAll('.memory-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.memoryId;
                if (confirm('Bu bellek silinecek. Emin misiniz?')) {
                    await this.deleteMemory(id);
                }
            });
        });

        // Bind edit action
        list.querySelectorAll('.memory-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.memoryId;
                const category = btn.dataset.category;
                const importance = btn.dataset.importance;
                const rawContent = decodeURIComponent(escape(atob(btn.dataset.contentB64)));

                this.showMemoryModal({
                    id: id,
                    content: rawContent,
                    category: category,
                    importance: importance
                });
            });
        });
    },


    // ============ Memory View Toggle ============

    // Bellek arama kutusu (#14) ve filtreleme
    bindMemorySearch() {
        const searchInput = document.getElementById('memory-search');
        const filterSelect = document.getElementById('memory-filter-category');
        const addNewBtn = document.getElementById('btn-memory-add-new');

        if (addNewBtn) {
            addNewBtn.addEventListener('click', () => {
                this.showMemoryModal(); // No args means new memory
            });
        }

        if (filterSelect) {
            filterSelect.addEventListener('change', () => {
                // Re-trigger the current search or fetch all to apply filter
                const query = (searchInput?.value || '').trim();
                if (query.length >= 2) {
                    searchInput.dispatchEvent(new Event('input')); // trigger debounce
                } else {
                    this.fetchMemories();
                }
            });
        }

        if (!searchInput) return;
        let debounceTimer = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();
            debounceTimer = setTimeout(async () => {
                if (query.length < 2) {
                    // Sorgu kısaysa tüm bellekleri göster
                    this.fetchMemories();
                    return;
                }
                try {
                    const res = await fetch(`/api/memories/search?q=${encodeURIComponent(query)}`);
                    if (res.ok) {
                        const results = await res.json();
                        // renderMemories will handle the category filtering locally
                        this.renderMemories(results);
                    }
                } catch (err) {
                    console.error('Bellek arama hatası:', err);
                }
            }, 300);
        });

        // Modal Events
        const modal = document.getElementById('memory-modal');
        const btnClose = document.getElementById('memory-modal-close');
        const btnCancel = document.getElementById('memory-modal-cancel');
        const btnSave = document.getElementById('memory-modal-save');

        if (modal && btnClose && btnCancel && btnSave) {
            const hideModal = () => { modal.style.display = 'none'; };
            btnClose.addEventListener('click', hideModal);
            btnCancel.addEventListener('click', hideModal);

            btnSave.addEventListener('click', async () => {
                const id = document.getElementById('memory-modal-id').value;
                const content = document.getElementById('memory-modal-content').value.trim();
                const category = document.getElementById('memory-modal-category').value;
                const importance = parseInt(document.getElementById('memory-modal-importance').value) || 5;

                if (!content) {
                    alert('Lütfen bellek içeriği girin.');
                    return;
                }

                btnSave.disabled = true;
                btnSave.textContent = 'Kaydediliyor...';

                try {
                    const isUpdate = !!id;
                    const endpoint = isUpdate ? `/api/memories/${id}` : `/api/memories`;
                    const method = isUpdate ? 'PUT' : 'POST';

                    const res = await fetch(endpoint, {
                        method: method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content, category, importance })
                    });

                    if (res.ok) {
                        hideModal();
                        // Refresh the current view
                        const query = (document.getElementById('memory-search')?.value || '').trim();
                        if (query.length >= 2) {
                            document.getElementById('memory-search').dispatchEvent(new Event('input'));
                        } else {
                            this.fetchMemories();
                        }
                    } else {
                        const err = await res.json();
                        alert('Hata: ' + (err.error || 'Kaydedilemedi'));
                    }
                } catch (err) {
                    console.error('Bellek kaydetme hatası:', err);
                    alert('Bellek kaydedilirken bir hata oluştu.');
                } finally {
                    btnSave.disabled = false;
                    btnSave.textContent = 'Kaydet';
                }
            });
        }
    },


    showMemoryModal(data = null) {
        const modal = document.getElementById('memory-modal');
        const title = document.getElementById('memory-modal-title');
        const inputId = document.getElementById('memory-modal-id');
        const inputContent = document.getElementById('memory-modal-content');
        const inputCategory = document.getElementById('memory-modal-category');
        const inputImportance = document.getElementById('memory-modal-importance');

        if (!modal) return;

        if (data) {
            title.innerHTML = '<span class="confirm-modal-icon" style="font-size: 1.25rem;">✏️</span> Belleği Düzenle';
            inputId.value = data.id || '';
            inputContent.value = data.content || '';
            inputCategory.value = data.category || 'general';
            inputImportance.value = data.importance || 5;
        } else {
            title.innerHTML = '<span class="confirm-modal-icon" style="font-size: 1.25rem;">🧠</span> Yeni Bellek';
            inputId.value = '';
            inputContent.value = '';
            inputCategory.value = 'general';
            inputImportance.value = 5;
        }

        modal.style.display = 'flex';
        inputContent.focus();
    },


    bindMemoryViewToggle() {
        const listBtn = document.getElementById('btn-memory-list-view');
        const graphBtn = document.getElementById('btn-memory-graph-view');
        const listContainer = document.getElementById('memory-list');
        const graphContainer = document.getElementById('memory-graph-container');
        const resetBtn = document.getElementById('btn-graph-reset');

        listBtn.addEventListener('click', () => {
            this.currentGraphView = 'list';
            listBtn.classList.add('active');
            graphBtn.classList.remove('active');
            listContainer.style.display = '';
            graphContainer.style.display = 'none';
            this.fetchMemories();
        });

        graphBtn.addEventListener('click', () => {
            this.currentGraphView = 'graph';
            graphBtn.classList.add('active');
            listBtn.classList.remove('active');
            listContainer.style.display = 'none';
            graphContainer.style.display = 'flex';
            this.fetchMemoryGraph();
        });

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.fetchMemoryGraph();
            });
        }

        // Pencere boyutu değişince graph'ı yeniden çiz (debounced)
        let graphResizeTimeout;
        window.addEventListener('resize', () => {
            if (this.currentGraphView === 'graph') {
                clearTimeout(graphResizeTimeout);
                graphResizeTimeout = setTimeout(() => this.fetchMemoryGraph(), 300);
            }
        });
    },


    // ============ Memory Graph (D3.js Force-Directed) ============

    async fetchMemoryGraph() {
        try {
            const res = await fetch('/api/memory-graph');
            const graph = await res.json();
            this.renderMemoryGraph(graph);
        } catch (err) {
            console.error('Memory graph alınamadı:', err);
        }
    },


    renderMemoryGraph(data) {
        const container = document.getElementById('memory-graph-container');
        const svg = d3.select('#memory-graph-svg');
        const tooltip = document.getElementById('graph-tooltip');
        const filterCategory = document.getElementById('memory-filter-category')?.value || 'all';

        // Clear previous graph
        svg.selectAll('*').remove();
        if (this.graphSimulation) {
            this.graphSimulation.stop();
            this.graphSimulation = null;
        }

        // Apply Category Filter to nodes and edges
        let nodesToRender = data.nodes || [];
        let edgesToRender = data.edges || [];

        if (filterCategory !== 'all' && nodesToRender.length > 0) {
            const keptMemories = new Set(nodesToRender.filter(n => n.type === 'memory' && n.category === filterCategory).map(n => n.id));

            edgesToRender = edgesToRender.filter(e => {
                const sId = typeof e.source === 'object' ? e.source.id : e.source;
                const tId = typeof e.target === 'object' ? e.target.id : e.target;

                if (sId.startsWith('memory_') && tId.startsWith('memory_')) {
                    return keptMemories.has(sId) && keptMemories.has(tId);
                }
                if (sId.startsWith('memory_')) return keptMemories.has(sId);
                if (tId.startsWith('memory_')) return keptMemories.has(tId);
                return false;
            });

            const keptNodes = new Set([...keptMemories]);
            edgesToRender.forEach(e => {
                keptNodes.add(typeof e.source === 'object' ? e.source.id : e.source);
                keptNodes.add(typeof e.target === 'object' ? e.target.id : e.target);
            });

            nodesToRender = nodesToRender.filter(n => keptNodes.has(n.id));
        }

        if (!nodesToRender || nodesToRender.length === 0) {
            svg.append('text')
                .attr('x', '50%')
                .attr('y', '50%')
                .attr('text-anchor', 'middle')
                .attr('fill', '#64748b')
                .attr('font-size', '14px')
                .text('Arama veya filtreye uygun bellek ilişkisi bulunamadı.');
            return;
        }

        const width = container.clientWidth;
        const height = container.clientHeight - 48; // toolbar height

        svg.attr('width', width).attr('height', height);

        // Color scales
        const CATEGORY_COLORS = {
            preference: '#8b5cf6',
            fact: '#3b82f6',
            habit: '#10b981',
            project: '#f59e0b',
            event: '#ef4444',
            other: '#6366f1',
            general: '#94a3b8',
        };

        const ENTITY_TYPE_COLORS = {
            person: '#ec4899',
            technology: '#06b6d4',
            project: '#f59e0b',
            place: '#84cc16',
            organization: '#a855f7',
            concept: '#64748b',
        };

        const EDGE_COLORS = {
            related_to: '#475569',
            supports: '#10b981',
            contradicts: '#ef4444',
            caused_by: '#f59e0b',
            part_of: '#8b5cf6',
            has_entity: '#334155',
        };

        // Create node/link data copies for D3
        const nodes = nodesToRender.map(d => ({ ...d }));
        const links = edgesToRender.map(d => ({ ...d }));

        // Force simulation
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links)
                .id(d => d.id)
                .distance(d => d.type === 'has_entity' ? 60 : 120)
                .strength(d => d.type === 'has_entity' ? 0.8 : d.confidence * 0.5)
            )
            .force('charge', d3.forceManyBody()
                .strength(d => d.type === 'entity' ? -150 : -250)
            )
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide()
                .radius(d => d.type === 'entity' ? 20 : 30)
            );

        this.graphSimulation = simulation;

        // Container group for zoom/pan
        const g = svg.append('g');

        // Zoom behavior
        this.graphUserInteracted = false;
        const zoom = d3.zoom()
            .scaleExtent([0.2, 4])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
                // If this zoom was NOT triggered by an automated transition, mark as user interacted
                if (event.sourceEvent) {
                    this.graphUserInteracted = true;
                }
            });

        svg.call(zoom);

        // Arrow markers for directed edges
        const defs = svg.append('defs');
        ['supports', 'contradicts', 'caused_by', 'part_of'].forEach(type => {
            defs.append('marker')
                .attr('id', `arrow-${type}`)
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 25)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('fill', EDGE_COLORS[type] || '#475569');
        });

        // Links
        const link = g.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', d => EDGE_COLORS[d.type] || '#475569')
            .attr('stroke-opacity', d => d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8))
            .attr('stroke-width', d => d.type === 'has_entity' ? 1 : Math.max(1, d.confidence * 3))
            .attr('stroke-dasharray', d => d.type === 'contradicts' ? '5,5' : d.type === 'has_entity' ? '2,4' : null)
            .attr('marker-end', d => {
                if (['supports', 'caused_by', 'part_of'].includes(d.type)) return `url(#arrow-${d.type})`;
                return null;
            });

        // Node groups
        const node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                    this.graphUserInteracted = true;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                })
            );

        // Memory nodes — rounded rectangles
        node.filter(d => d.type === 'memory')
            .append('rect')
            .attr('width', 28)
            .attr('height', 28)
            .attr('x', -14)
            .attr('y', -14)
            .attr('rx', 6)
            .attr('ry', 6)
            .attr('fill', d => CATEGORY_COLORS[d.category] || '#6366f1')
            .attr('fill-opacity', 0.8)
            .attr('stroke', d => CATEGORY_COLORS[d.category] || '#6366f1')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.4);

        // Entity nodes — circles
        node.filter(d => d.type === 'entity')
            .append('circle')
            .attr('r', 12)
            .attr('fill', d => ENTITY_TYPE_COLORS[d.entityType] || '#64748b')
            .attr('fill-opacity', 0.9)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.6);

        // Labels
        node.append('text')
            .attr('dy', d => d.type === 'entity' ? 24 : 26)
            .attr('text-anchor', 'middle')
            .attr('font-size', d => d.type === 'entity' ? '10px' : '11px')
            .attr('fill', '#94a3b8')
            .attr('pointer-events', 'none')
            .text(d => {
                const maxLen = d.type === 'entity' ? 20 : 25;
                return d.label.length > maxLen ? d.label.substring(0, maxLen - 2) + '…' : d.label;
            });

        // Importance indicator for memory nodes
        node.filter(d => d.type === 'memory' && d.importance >= 7)
            .append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 4)
            .attr('font-size', '12px')
            .attr('pointer-events', 'none')
            .text('⭐');

        // Entity type icon
        const ENTITY_ICONS = {
            person: '👤', technology: '💻', project: '📋',
            place: '📍', organization: '🏢', concept: '💡',
        };
        node.filter(d => d.type === 'entity')
            .append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 4)
            .attr('font-size', '10px')
            .attr('pointer-events', 'none')
            .text(d => ENTITY_ICONS[d.entityType] || '•');

        // State for focused node
        let focusedNode = null;

        // Reset focus on background click
        svg.on('click', () => {
            if (focusedNode) {
                focusedNode = null;
                node.style('opacity', 1).classed('graph-dimmed', false);
                link.style('opacity', l => l.type === 'has_entity' ? 0.2 : Math.max(0.3, l.confidence * 0.8)).classed('graph-dimmed', false);
            }
        });

        // Hover tooltip and Click interactions
        node.style('cursor', 'pointer')
            .on('mouseover', (event, d) => {
                tooltip.style.display = 'block';

                if (d.type === 'memory') {
                    const textContent = d.fullContent ? this.escapeHtml(d.fullContent) : this.escapeHtml(d.label);
                    const color = CATEGORY_COLORS[d.category] || '#94a3b8';
                    tooltip.innerHTML = `
                        <div style="font-size:11px; font-weight:600; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); color: ${color}; text-transform: uppercase; letter-spacing: 0.5px;">
                            📝 ${d.category || 'Belirsiz'} • Önem: ${d.importance || '?'}
                        </div>
                        <div style="font-size:13px; line-height:1.5;">${textContent}</div>
                        <div style="font-size:10px; color: var(--text-muted); margin-top: 8px; font-style: italic;">Düzenlemek için tıklayın</div>
                    `;
                } else {
                    const color = ENTITY_TYPE_COLORS[d.entityType] || '#94a3b8';
                    tooltip.innerHTML = `
                        <div style="font-size:11px; font-weight:600; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); color: ${color}; text-transform: uppercase; letter-spacing: 0.5px;">
                            🏷️ Varlık: ${d.entityType || 'bilinmiyor'}
                        </div>
                        <div style="font-size:13px; font-weight: 500;">${this.escapeHtml(d.label)}</div>
                        <div style="font-size:10px; color: var(--text-muted); margin-top: 8px; font-style: italic;">İlişkileri odaklamak için tıklayın</div>
                    `;
                }

                tooltip.style.left = (event.pageX + 15) + 'px';
                tooltip.style.top = (event.pageY - 15) + 'px';
            })
            .on('mousemove', (event) => {
                tooltip.style.left = (event.pageX + 15) + 'px';
                tooltip.style.top = (event.pageY - 15) + 'px';
            })
            .on('mouseout', () => {
                tooltip.style.display = 'none';
            })
            .on('click', (event, d) => {
                event.stopPropagation();
                if (d.type === 'memory' && d.rawId) {
                    this.showMemoryModal({
                        id: d.rawId,
                        content: d.fullContent || d.label,
                        category: d.category,
                        importance: d.importance
                    });
                    tooltip.style.display = 'none'; // hide tooltip when modal opens
                } else if (d.type === 'entity') {
                    // Focus / Dim
                    if (focusedNode === d) {
                        focusedNode = null;
                        node.style('opacity', 1).classed('graph-dimmed', false);
                        link.style('opacity', l => l.type === 'has_entity' ? 0.2 : Math.max(0.3, l.confidence * 0.8)).classed('graph-dimmed', false);
                    } else {
                        focusedNode = d;
                        const connectedIds = new Set([d.id]);
                        links.forEach(l => {
                            const sId = typeof l.source === 'object' ? l.source.id : l.source;
                            const tId = typeof l.target === 'object' ? l.target.id : l.target;
                            if (sId === d.id || tId === d.id) {
                                connectedIds.add(sId);
                                connectedIds.add(tId);
                            }
                        });

                        node.style('opacity', n => connectedIds.has(n.id) ? 1 : 0.1)
                            .classed('graph-dimmed', n => !connectedIds.has(n.id));

                        link.style('opacity', l => {
                            const sId = typeof l.source === 'object' ? l.source.id : l.source;
                            const tId = typeof l.target === 'object' ? l.target.id : l.target;
                            return (connectedIds.has(sId) && connectedIds.has(tId))
                                ? (l.type === 'has_entity' ? 0.8 : Math.max(0.6, l.confidence * 0.8))
                                : 0.05;
                        }).classed('graph-dimmed', l => {
                            const sId = typeof l.source === 'object' ? l.source.id : l.source;
                            const tId = typeof l.target === 'object' ? l.target.id : l.target;
                            return !(connectedIds.has(sId) && connectedIds.has(tId));
                        });
                    }
                }
            });

        // Edge hover — show relation type
        link.on('mouseover', (event, d) => {
            const RELATION_LABELS = {
                related_to: '↔ İlişkili',
                supports: '→ Destekler',
                contradicts: '⚡ Çelişir',
                caused_by: '← Neden',
                part_of: '⊂ Parçası',
                has_entity: '🏷️ Varlık',
            };
            tooltip.style.display = 'block';
            const label = RELATION_LABELS[d.type] || d.type;
            const desc = d.description ? `<br><span style="color:#94a3b8">${this.escapeHtml(d.description)}</span>` : '';
            const conf = d.type !== 'has_entity' ? `<br><span style="color:#64748b">Güven: ${(d.confidence * 100).toFixed(0)}%</span>` : '';
            tooltip.innerHTML = `<strong>${label}</strong>${desc}${conf}`;
            tooltip.style.left = (event.pageX + 12) + 'px';
            tooltip.style.top = (event.pageY - 28) + 'px';
        })
            .on('mousemove', (event) => {
                tooltip.style.left = (event.pageX + 12) + 'px';
                tooltip.style.top = (event.pageY - 28) + 'px';
            })
            .on('mouseout', () => {
                tooltip.style.display = 'none';
            });

        // Tick
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        // Initial zoom to fit - ONLY if user hasn't interacted yet
        simulation.on('end', () => {
            if (this.graphUserInteracted) return;

            const bounds = g.node().getBBox();
            if (bounds.width > 0 && bounds.height > 0) {
                const padding = 60;
                const scale = Math.min(
                    (width - padding * 2) / bounds.width,
                    (height - padding * 2) / bounds.height,
                    1.2 // Max initial scale
                );
                const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
                const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;

                svg.transition().duration(800).call(
                    zoom.transform,
                    d3.zoomIdentity.translate(tx, ty).scale(scale)
                );
            }
        });
    },


    // ============ Sensitive Paths Management ============

    async fetchSensitivePaths() {
        try {
            const res = await fetch('/api/settings/sensitive-paths');
            const paths = await res.json();
            this.renderSensitivePaths(paths);
        } catch (err) {
            console.error('Hassas dizinler alınamadı:', err);
        }
    },


    renderSensitivePaths(paths) {
        const list = document.getElementById('sensitive-paths-list');
        if (!paths || paths.length === 0) {
            list.innerHTML = `<div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 13px;">Henüz hassas dizin eklenmemiş.</div>`;
            return;
        }
        list.innerHTML = paths.map(p => `
            <div class="sensitive-path-item">
                <span>${this.escapeHtml(p)}</span>
                <button class="sensitive-path-delete" data-path="${this.escapeHtml(p)}" title="Kaldır">✕</button>
            </div>
        `).join('');

        list.querySelectorAll('.sensitive-path-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pathToRemove = btn.dataset.path;
                await this.removeSensitivePath(pathToRemove);
            });
        });
    },


    async addSensitivePath(newPath) {
        try {
            const res = await fetch('/api/settings/sensitive-paths', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newPath }),
            });
            if (res.ok) {
                const paths = await res.json();
                this.renderSensitivePaths(paths);
            } else {
                const err = await res.json();
                alert(err.error || 'Eklenemedi');
            }
        } catch (err) {
            console.error('Hassas dizin eklenemedi:', err);
        }
    },


    async removeSensitivePath(pathToRemove) {
        try {
            const res = await fetch('/api/settings/sensitive-paths', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: pathToRemove }),
            });
            if (res.ok) {
                const paths = await res.json();
                this.renderSensitivePaths(paths);
            }
        } catch (err) {
            console.error('Hassas dizin kaldırılamadı:', err);
        }
    },


    // ============ Message Action Delegation (copy button + code copy) ============

    bindMessageActions() {
        const messagesDiv = document.getElementById('chat-messages');

        messagesDiv.addEventListener('click', async (e) => {
            // Copy message button
            const msgCopyBtn = e.target.closest('.message-copy-btn');
            if (msgCopyBtn) {
                const content = msgCopyBtn.closest('.message')?.querySelector('.message-content')?.innerText || '';
                try {
                    await navigator.clipboard.writeText(content);
                    msgCopyBtn.textContent = '✅';
                    setTimeout(() => { msgCopyBtn.textContent = '📋'; }, 2000);
                } catch { msgCopyBtn.textContent = '❌'; }
                return;
            }

            // Code block copy button
            const codeCopyBtn = e.target.closest('.code-copy-btn');
            if (codeCopyBtn) {
                const code = codeCopyBtn.closest('.code-block-wrapper')?.querySelector('code')?.innerText || '';
                try {
                    await navigator.clipboard.writeText(code);
                    codeCopyBtn.textContent = '✅ Kopyalandı';
                    setTimeout(() => { codeCopyBtn.textContent = '📋 Kopyala'; }, 2000);
                } catch { codeCopyBtn.textContent = '❌ Hata'; }
                return;
            }

            // Like button
            const likeBtn = e.target.closest('.msg-like-btn');
            if (likeBtn) { this.submitFeedback(likeBtn.closest('.message-wrapper'), 'like'); return; }

            // Dislike button
            const dislikeBtn = e.target.closest('.msg-dislike-btn');
            if (dislikeBtn) { this.submitFeedback(dislikeBtn.closest('.message-wrapper'), 'dislike'); return; }

            // Regenerate button
            const regenBtn = e.target.closest('.regen-btn');
            if (regenBtn) { this.regenerateResponse(); return; }

            // Export single message button
            const exportBtn = e.target.closest('.msg-export-btn');
            if (exportBtn) {
                const content = exportBtn.closest('.message')?.querySelector('.message-content')?.innerText || '';
                this.exportSingleMessage(content);
                exportBtn.textContent = '✅';
                setTimeout(() => { exportBtn.textContent = '📤'; }, 2000);
                return;
            }

            // Edit user message button
            const editBtn = e.target.closest('.msg-edit-btn');
            if (editBtn) {
                const contentEl = editBtn.closest('.message')?.querySelector('.message-content');
                if (!contentEl) return;
                const input = document.getElementById('chat-input');
                if (input) {
                    input.value = contentEl.innerText;
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                    input.focus();
                    input.selectionStart = input.selectionEnd = input.value.length;
                    const counter = document.getElementById('char-counter');
                    if (counter) counter.textContent = input.value.length;
                }
                return;
            }
        });
    },


    // ============ Scroll Helpers ============

    isAtBottom(container, threshold = 15) {
        if (!container) return false;
        return (container.scrollHeight - container.scrollTop - container.clientHeight) <= threshold;
    },


    scrollToBottom(container, smooth = false) {
        if (!container) return;
        if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    },


    // ============ Streaming Token Handler ============

    handleStreamToken(token) {
        let isFirstToken = false;
        if (!this.streamingWrapper) {
            isFirstToken = true;
            this.hideTypingIndicator();
            this.removeLiveToolIndicator();

            const messagesDiv = document.getElementById('chat-messages');
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper assistant';

            const messageEl = document.createElement('div');
            messageEl.className = 'message assistant';
            messageEl.innerHTML = `
        <div class="message-avatar">🐾</div>
        <div class="message-body">
          <div class="message-content streaming-content"></div>
          <div class="message-meta">
            <span class="message-time">${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      `;
            wrapper.appendChild(messageEl);
            messagesDiv.appendChild(wrapper);

            this.streamingWrapper = wrapper;
            this.streamingContent = messageEl.querySelector('.streaming-content');
            this.streamingText = '';
            this.streamRenderScheduled = false;
        }

        this.streamingText += token;

        if (!this.streamRenderScheduled) {
            this.streamRenderScheduled = true;
            requestAnimationFrame(() => {
                this.streamRenderScheduled = false;
                const md = document.getElementById('chat-messages');

                // Capture scroll state BEFORE updating content
                const wasAtBottom = md && (isFirstToken || this.isAtBottom(md));

                if (this.streamingContent) {
                    this.streamingContent.innerHTML = this.renderMarkdown(this.streamingText) + '<span class="stream-cursor"></span>';
                }

                // Apply scroll only if we were already at the bottom
                if (md && wasAtBottom) {
                    this.scrollToBottom(md);
                }
            });
        }
    },


    // ============ Memory Delete ============

    async deleteMemory(memoryId) {
        try {
            const res = await fetch(`/api/memories/${memoryId}`, { method: 'DELETE' });
            if (res.ok) {
                const item = document.querySelector(`.memory-item[data-memory-id="${memoryId}"]`);
                if (item) item.remove();
                this.fetchStats();
            } else {
                const err = await res.json();
                alert(err.error || 'Silinemedi');
            }
        } catch (err) {
            console.error('Bellek silinemedi:', err);
        }
    },


    bindSensitivePaths() {
        const addBtn = document.getElementById('sensitive-path-add-btn');
        const input = document.getElementById('sensitive-path-input');

        if (addBtn && input) {
            addBtn.addEventListener('click', () => {
                const val = input.value.trim();
                if (val) {
                    this.addSensitivePath(val);
                    input.value = '';
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const val = input.value.trim();
                    if (val) {
                        this.addSensitivePath(val);
                        input.value = '';
                    }
                }
            });
        }
    },


    // ============ Settings UI ============

    async fetchSettings() {
        try {
            // Fetch providers & models
            const provRes = await fetch('/api/llm/providers');
            if (provRes.ok) {
                this.providersData = await provRes.json();
            }

            // Fetch Current Config
            const res = await fetch('/api/settings');
            if (!res.ok) throw new Error('Failed to fetch settings');

            this.currentConfig = await res.json();
            this.defaultUserName = this.currentConfig?.defaultUserName || '';
            this.populateSettingsUI();

        } catch (err) {
            console.error('Ayarlar alınamadı:', err);
        }
    },


    populateSettingsUI() {
        const config = this.currentConfig;
        if (!config) return;

        this.updateModelBadge();

        // Populate Provider Dropdown logic
        const providerSelect = document.getElementById('setting-provider');
        const modelSelect = document.getElementById('setting-model');

        // Initial Provider Setup
        if (config.defaultLLMProvider) {
            providerSelect.value = config.defaultLLMProvider;
        }

        const updateModelDropdown = () => {
            if (!this.providersData) return;
            const selectedProvider = providerSelect.value;
            const providerInfo = this.providersData.find(p => p.name === selectedProvider);
            const models = providerInfo ? providerInfo.models : [];

            modelSelect.innerHTML = models.map(m =>
                `<option value="${m}">${m}</option>`
            ).join('');

            // Restore previously selected model if it exists in the new list, or keep config model
            if (config.defaultLLMProvider === selectedProvider && config.defaultLLMModel) {
                const modelExists = models.find(m => m === config.defaultLLMModel);
                if (modelExists) modelSelect.value = config.defaultLLMModel;
            }
        };

        if (providerSelect) {
            providerSelect.addEventListener('change', updateModelDropdown);
            updateModelDropdown(); // Call mapping once on initial fetch
        }

        // Setup the rest of the fields mapping safely
        this._setVal('setting-openai-key', config.openaiApiKey || '');
        this._setVal('setting-anthropic-key', config.anthropicApiKey || '');
        this._setVal('setting-minimax-key', config.minimaxApiKey || '');
        this._setVal('setting-github-key', config.githubApiKey || '');
        this._setVal('setting-groq-key', config.groqApiKey || '');
        this._setVal('setting-mistral-key', config.mistralApiKey || '');
        this._setVal('setting-nvidia-key', config.nvidiaApiKey || '');
        this._setVal('setting-ollama-url', config.ollamaBaseUrl || 'http://localhost:11434');

        this._setVal('setting-system-prompt', config.systemPrompt || config.baseSystemPrompt || '');
        this._setVal('setting-embedding-model', config.embeddingModel || '');

        const shellToggle = document.getElementById('setting-shell');
        if (shellToggle && config.allowShellExecution !== undefined) {
            shellToggle.checked = config.allowShellExecution;
        }

        this._setVal('setting-brave-search', config.braveSearchApiKey || '');

        // Match options
        this._setVal('setting-embedding-provider', config.embeddingProvider || 'openai');
        this._setVal('setting-log-level', config.logLevel || 'info');

        // Advanced Variables
        this._setVal('setting-autonomous-limit', config.autonomousStepLimit || 5);
        this._setVal('setting-memory-decay', config.memoryDecayThreshold !== undefined ? config.memoryDecayThreshold : 30);
        this._setVal('setting-semantic-threshold', config.semanticSearchThreshold !== undefined ? config.semanticSearchThreshold : 0.75);
    },


    _setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    },


    _getVal(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    },


    bindSettings() {
        const saveBtn = document.getElementById('btn-save-settings');
        const themeToggle = document.getElementById('btn-theme-toggle');

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const prevText = saveBtn.textContent;
                saveBtn.textContent = '⏳ Kaydediliyor...';
                saveBtn.disabled = true;

                try {
                    const updates = {
                        defaultLLMProvider: this._getVal('setting-provider'),
                        defaultLLMModel: this._getVal('setting-model'),
                        openaiApiKey: this._getVal('setting-openai-key'),
                        anthropicApiKey: this._getVal('setting-anthropic-key'),
                        minimaxApiKey: this._getVal('setting-minimax-key'),
                        githubApiKey: this._getVal('setting-github-key'),
                        groqApiKey: this._getVal('setting-groq-key'),
                        mistralApiKey: this._getVal('setting-mistral-key'),
                        nvidiaApiKey: this._getVal('setting-nvidia-key'),
                        ollamaBaseUrl: this._getVal('setting-ollama-url'),
                        systemPrompt: this._getVal('setting-system-prompt'),
                        embeddingProvider: this._getVal('setting-embedding-provider'),
                        embeddingModel: this._getVal('setting-embedding-model'),
                        allowShellExecution: document.getElementById('setting-shell').checked,
                        braveSearchApiKey: this._getVal('setting-brave-search'),
                        autonomousStepLimit: Number(this._getVal('setting-autonomous-limit')),
                        memoryDecayThreshold: Number(this._getVal('setting-memory-decay')),
                        semanticSearchThreshold: Number(this._getVal('setting-semantic-threshold')),
                        logLevel: this._getVal('setting-log-level')
                    };

                    const res = await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updates)
                    });

                    if (res.ok) {
                        saveBtn.textContent = '✅ Kaydedildi';
                        // Re-fetch to normalize
                        await this.fetchSettings();
                    } else {
                        throw new Error("Update failed");
                    }
                } catch (err) {
                    console.error('Settings save failed', err);
                    saveBtn.textContent = '❌ Hata Oluştu';
                } finally {
                    setTimeout(() => {
                        saveBtn.textContent = '💾 Ayarları Kaydet ve Uygula';
                        saveBtn.disabled = false;
                    }, 2000);
                }
            });
        }

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                document.body.classList.toggle('light-theme');
                const isLight = document.body.classList.contains('light-theme');
                localStorage.setItem(STORAGE_KEYS.THEME, isLight ? 'light' : 'dark');
            });

            // On initialization
            const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
            if (savedTheme === 'light') {
                document.body.classList.add('light-theme');
            }
        }
    },


    // ============ Conversation Controls ============

    bindConvControls() {
        const searchInput = document.getElementById('conv-search-input');
        const sortSelect = document.getElementById('conv-sort-select');

        if (searchInput) {
            let debounce = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    this.convSearchQuery = searchInput.value.trim().toLowerCase();
                    if (this.allConversations.length > 0) this.renderConversationsList(this.allConversations);
                }, 200);
            });
        }

        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.convSortOrder = sortSelect.value;
                if (this.allConversations.length > 0) this.renderConversationsList(this.allConversations);
            });
        }
    },


    filterAndSortConversations(conversations) {
        let list = [...conversations];
        if (this.convSearchQuery) {
            list = list.filter(c => (c.title || c.user_name || 'Sohbet').toLowerCase().includes(this.convSearchQuery));
        }
        switch (this.convSortOrder) {
            case 'oldest':
                list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                break;
            case 'messages':
                list.sort((a, b) => (b.message_count || 0) - (a.message_count || 0));
                break;
            default: // newest
                list.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        }
        return list;
    },


    groupConversationsByDate(conversations) {
        const now = new Date();
        const todayStr = now.toDateString();
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        const yesterdayStr = yesterday.toDateString();
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
        const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
        for (const conv of conversations) {
            const rawDate = conv.updated_at || conv.created_at;
            const parsedStr = typeof rawDate === 'string' && !rawDate.endsWith('Z') ? rawDate.replace(' ', 'T') + 'Z' : rawDate;
            const d = new Date(parsedStr);
            if (d.toDateString() === todayStr) { groups.today.push(conv); }
            else if (d.toDateString() === yesterdayStr) { groups.yesterday.push(conv); }
            else if (d >= weekAgo) { groups.thisWeek.push(conv); }
            else { groups.older.push(conv); }
        }
        return groups;
    },


    pinConversation(id) {
        if (!this.pinnedConversations.includes(id)) {
            this.pinnedConversations.unshift(id);
            localStorage.setItem(STORAGE_KEYS.PINNED_CONVERSATIONS, JSON.stringify(this.pinnedConversations));
            this.renderConversationsList(this.allConversations);
        }
    },


    unpinConversation(id) {
        this.pinnedConversations = this.pinnedConversations.filter(p => p !== id);
        localStorage.setItem(STORAGE_KEYS.PINNED_CONVERSATIONS, JSON.stringify(this.pinnedConversations));
        this.renderConversationsList(this.allConversations);
    },


    async renameConversation(id, newTitle) {
        try {
            await fetch(`/api/conversations/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            const conv = this.allConversations.find(c => c.id === id);
            if (conv) conv.title = newTitle;
            if (id === this.activeConversationId) this.updateHeaderTitle(newTitle);
        } catch (err) {
            console.error('Sohbet yeniden adlandırılamadı:', err);
        }
    },


    updateBulkFooter() {
        const footer = document.getElementById('conv-bulk-footer');
        const countEl = document.getElementById('conv-selected-count');
        if (!footer) return;
        const count = this.selectedConvIds.size;
        footer.style.display = count > 0 ? 'flex' : 'none';
        if (countEl) countEl.textContent = `${count} seçili`;
    },


    bindBulkDelete() {
        const btn = document.getElementById('btn-bulk-delete');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            if (this.selectedConvIds.size === 0) return;
            if (!confirm(`${this.selectedConvIds.size} sohbet silinecek. Emin misiniz?`)) return;
            const ids = [...this.selectedConvIds];
            for (const id of ids) {
                try {
                    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
                    if (id === this.activeConversationId) {
                        this.activeConversationId = null;
                        this.resetChatToWelcome();
                    }
                } catch (err) { console.error('Toplu silme hatası:', err); }
            }
            this.selectedConvIds.clear();
            this.updateBulkFooter();
            this.fetchConversations();
            this.fetchStats();
        });
    },


    // ============ Header ============

    updateHeaderTitle(title) {
        const el = document.getElementById('active-conv-title');
        const exportBtn = document.getElementById('btn-export-conv');
        if (el) el.textContent = title || 'Sohbet';
        if (exportBtn) exportBtn.style.display = title ? 'inline-flex' : 'none';
    },


    updateModelBadge() {
        const badge = document.getElementById('model-badge');
        if (!badge) return;
        const config = this.currentConfig;
        if (config && config.defaultLLMModel) {
            const provider = config.defaultLLMProvider || '';
            badge.textContent = provider ? `${provider} · ${config.defaultLLMModel}` : config.defaultLLMModel;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    },


    // ============ Export ============

    bindExportConv() {
        const btn = document.getElementById('btn-export-conv');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const choice = confirm('Dışa aktarma formatı:\n\nTamam → Markdown (.md)\nİptal → JSON (.json)');
            this.exportConversation(choice ? 'md' : 'json');
        });
    },


    exportConversation(format) {
        const wrappers = document.querySelectorAll('.message-wrapper');
        if (!wrappers.length) return;
        const convTitle = document.getElementById('active-conv-title')?.textContent || 'Sohbet';
        const now = new Date().toISOString().slice(0, 10);

        if (format === 'md') {
            let md = `# ${convTitle}\n\n_Dışa aktarıldı: ${now}_\n\n---\n\n`;
            wrappers.forEach(wrapper => {
                const isUser = wrapper.classList.contains('user');
                const contentEl = wrapper.querySelector('.message-content');
                if (!contentEl) return;
                const role = isUser ? '**Siz**' : '**PençeAI**';
                md += `${role}:\n${contentEl.innerText}\n\n---\n\n`;
            });
            this._downloadFile(`${convTitle}-${now}.md`, md, 'text/markdown');
        } else {
            const data = [];
            wrappers.forEach(wrapper => {
                const isUser = wrapper.classList.contains('user');
                const contentEl = wrapper.querySelector('.message-content');
                const timeEl = wrapper.querySelector('.message-time');
                if (!contentEl) return;
                data.push({ role: isUser ? 'user' : 'assistant', content: contentEl.innerText, time: timeEl?.textContent || '' });
            });
            this._downloadFile(`${convTitle}-${now}.json`, JSON.stringify({ title: convTitle, exported: now, messages: data }, null, 2), 'application/json');
        }
    },


    _downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace(/[^\w.\- ]/g, '_');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },


    exportSingleMessage(content) {
        navigator.clipboard.writeText(content).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = content;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    },


    // ============ Onboarding (İlk Kurulum) ============

    checkOnboarding() {
        const savedUserName = (this.currentConfig?.defaultUserName || this.defaultUserName || '').trim();
        const shouldShowOnboarding = !savedUserName || savedUserName === 'Kullanıcı';

        if (shouldShowOnboarding) {
            const modal = document.getElementById('onboarding-modal');
            const submitBtn = document.getElementById('onboarding-submit');
            const nameInput = document.getElementById('onboarding-name');
            const bioInput = document.getElementById('onboarding-bio');

            if (modal) {
                modal.style.display = 'flex';
                if (nameInput) nameInput.focus();

                if (submitBtn) {
                    const dashboard = this;

                    submitBtn.onclick = async () => {
                        const name = nameInput.value.trim();
                        const bio = bioInput.value.trim();

                        if (!name) {
                            alert('Lütfen hitap edebilmem için bir isim girin.');
                            return;
                        }
                        if (!bio) {
                            alert('Lütfen kısaca kendinizden bahsedin.');
                            return;
                        }

                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Kaydediliyor...';

                        try {
                            // 1. İsmi .env dosyasına kaydet
                            const settingsRes = await fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ defaultUserName: name })
                            });

                            if (!settingsRes.ok) {
                                throw new Error('Kullanıcı adı ayarı kaydedilemedi.');
                            }

                            dashboard.defaultUserName = name;
                            dashboard.currentConfig = {
                                ...(dashboard.currentConfig || {}),
                                defaultUserName: name
                            };

                            // 2. Biyografiyi parçalayarak işle (Derin analiz arka planda başlar)
                            fetch('/api/onboarding/process', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    bio: bio,
                                    userName: name
                                })
                            }).catch(e => console.error('Biyografi analiz hatası:', e));

                            // Başarılı - Modal'ı hemen kapat ve kullanıcıyı karşıla
                            modal.style.display = 'none';
                            if (typeof dashboard.showNotification === 'function') {
                                dashboard.showNotification(`Hoşgeldin ${name}! Bilgilerin analiz ediliyor.`, 'success');
                            }
                            dashboard.fetchStats();

                        } catch (err) {
                            console.error('Onboarding kaydetme hatası:', err);
                            alert('Bilgiler kaydedilirken bir hata oluştu.');
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Tanışalım 🚀';
                        }
                    };
                }
            }
        }
    },


    // ============ Keyboard Shortcuts ============

    bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement?.tagName;
            // Skip if user is typing in an input/textarea (except Escape)
            if (e.key !== 'Escape' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;

            // Ctrl+K → New Chat
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('btn-new-chat')?.click();
                document.getElementById('chat-input')?.focus();
            }
            // Ctrl+/ → Toggle history sidebar
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                document.getElementById('btn-toggle-conversations')?.click();
            }
            // Escape → Close history sidebar
            if (e.key === 'Escape' && this.showConversations) {
                document.getElementById('btn-toggle-conversations')?.click();
            }
        });
    },


    // ============ Regenerate ============

    regenerateResponse() {
        if (!this.lastUserMessage || !this.isConnected || this.isProcessing) return;
        // Remove the last assistant message wrapper from DOM
        const messagesDiv = document.getElementById('chat-messages');
        const wrappers = [...messagesDiv.querySelectorAll('.message-wrapper')];
        for (let i = wrappers.length - 1; i >= 0; i--) {
            const w = wrappers[i];
            w.remove();
            if (!w.classList.contains('assistant') || w.querySelector('.message.assistant')) break;
        }
        this.isProcessing = true;
        this.pendingToolCalls = [];
        this.pendingThinking = [];
        const wsMsg = { type: 'chat', content: this.lastUserMessage };
        if (this.activeConversationId) wsMsg.conversationId = this.activeConversationId;
        this.ws.send(JSON.stringify(wsMsg));
        this.showTypingIndicator();
    },


    // ============ Message Feedback ============

    submitFeedback(msgWrapper, type) {
        if (!msgWrapper) return;
        const likeBtn = msgWrapper.querySelector('.msg-like-btn');
        const dislikeBtn = msgWrapper.querySelector('.msg-dislike-btn');
        if (!likeBtn || !dislikeBtn) return;
        if (type === 'like') {
            const wasLiked = likeBtn.classList.contains('active-like');
            likeBtn.classList.toggle('active-like', !wasLiked);
            dislikeBtn.classList.remove('active-dislike');
        } else {
            const wasDisliked = dislikeBtn.classList.contains('active-dislike');
            dislikeBtn.classList.toggle('active-dislike', !wasDisliked);
            likeBtn.classList.remove('active-like');
        }
    }
});

export { PenceAIDashboard };
