import type { ConversationMessage } from '../router/types.js';

export interface HistoryPruneResult {
    history: ConversationMessage[];
    prunedChunkCount: number;
    repairedAssistantCount: number;
    skippedToolCount: number;
}

export interface HistoryChunk {
    messages: ConversationMessage[];
    tokens: number;
}

export interface RecentPromptMessage {
    role: string;
    content: string;
    created_at: string;
    conversation_title: string;
}

export function pruneConversationHistory(
    history: ConversationMessage[],
    estimateMessageTokens: (message: ConversationMessage) => number,
    maxHistoryTokens: number,
): HistoryPruneResult {
    const chunks: HistoryChunk[] = [];
    let cursor = 0;

    while (cursor < history.length) {
        if (
            history[cursor].role === 'assistant' && history[cursor].toolCalls?.length &&
            cursor + 1 < history.length && history[cursor + 1].role === 'tool'
        ) {
            chunks.push({
                messages: [history[cursor], history[cursor + 1]],
                tokens: estimateMessageTokens(history[cursor]) + estimateMessageTokens(history[cursor + 1]),
            });
            cursor += 2;
            continue;
        }

        chunks.push({
            messages: [history[cursor]],
            tokens: estimateMessageTokens(history[cursor]),
        });
        cursor++;
    }

    let currentTokens = 0;
    const keptChunks: HistoryChunk[] = [];
    let prunedChunkCount = 0;

    for (let index = chunks.length - 1; index >= 0; index--) {
        if (currentTokens + chunks[index].tokens > maxHistoryTokens) {
            prunedChunkCount = index + 1;
            break;
        }
        currentTokens += chunks[index].tokens;
        keptChunks.unshift(chunks[index]);
    }

    const pruned = keptChunks.flatMap(chunk => chunk.messages);
    const validated: ConversationMessage[] = [];
    let repairedAssistantCount = 0;
    let skippedToolCount = 0;

    for (let index = 0; index < pruned.length; index++) {
        const message = pruned[index];
        if (message.role === 'assistant' && message.toolCalls?.length) {
            if (index + 1 < pruned.length && pruned[index + 1].role === 'tool') {
                validated.push(message);
            } else if (message.content && message.content.trim()) {
                validated.push({ ...message, toolCalls: undefined });
                repairedAssistantCount++;
            } else {
                repairedAssistantCount++;
            }
            continue;
        }

        if (message.role === 'tool') {
            const previous = validated[validated.length - 1];
            if (previous && previous.role === 'assistant' && previous.toolCalls?.length) {
                validated.push(message);
            } else {
                skippedToolCount++;
            }
            continue;
        }

        validated.push(message);
    }

    return {
        history: validated,
        prunedChunkCount,
        repairedAssistantCount,
        skippedToolCount,
    };
}

export function formatRecentContextMessages(messages: RecentPromptMessage[]): string[] {
    return messages.map(message => {
        const dateStr = typeof message.created_at === 'string' && !message.created_at.endsWith('Z')
            ? message.created_at.replace(' ', 'T') + 'Z'
            : message.created_at;
        const time = new Date(dateStr).toLocaleString('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
            day: 'numeric',
        });
        const title = message.conversation_title ? ` [${message.conversation_title}]` : '';
        return `[${time}]${title} ${message.role === 'user' ? 'Kullanıcı' : 'Sen'}: ${message.content}`;
    });
}
