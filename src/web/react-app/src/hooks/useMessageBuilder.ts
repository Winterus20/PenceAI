import { useCallback } from 'react';
import { normalizeTimestamp } from '@/lib/utils';
import type { Message, AttachmentItem, ToolCallItem } from '../store/agentStore';

/**
 * Think tag'lerini temizle
 */
const stripThinkTags = (text?: string): string => {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
};

/**
 * Mesaj oluşturma ve dönüştürme için custom hook
 * Ham mesajları render edilebilir formata dönüştürür
 * 
 * Not: Bu hook, agentStore'daki Message tipiyle uyumlu mesajlar döndürür.
 * Tool mesajları assistant mesajlarına dönüştürülür.
 */
export function useMessageBuilder() {
  /**
   * Ham mesajları render edilebilir formata dönüştür
   * Tool calls ve thinking içeriklerini işler
   * 
   * @param rawMessages - API'den gelen ham mesajlar
   * @returns Message[] - agentStore ile uyumlu mesajlar
   */
  const buildRenderableMessages = useCallback((rawMessages: unknown[]): Message[] => {
    const renderable: Message[] = [];
    let pendingTools: ToolCallItem[] = [];
    let pendingThinkingEntries: string[] = [];

    rawMessages.forEach((message) => {
      const msg = message as Record<string, unknown>;

      if (msg.role === 'user') {
        const attachments = Array.isArray(msg.attachments)
          ? (msg.attachments as Array<Record<string, unknown>>).map((attachment): AttachmentItem => ({
              fileName: attachment.fileName as string,
              mimeType: attachment.mimeType as string,
              size: attachment.size as number,
              data: attachment.data as string,
              previewUrl:
                (attachment.mimeType as string)?.startsWith('image/') && attachment.data
                  ? `data:${attachment.mimeType};base64,${attachment.data}`
                  : null,
            }))
          : undefined;

        renderable.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: (msg.content as string) || '',
          timestamp: normalizeTimestamp(msg.timestamp as string),
          attachments,
        });
        return;
      }

      if (msg.role === 'assistant') {
        const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          const cleanedThinking = stripThinkTags(msg.content as string);
          if (cleanedThinking) {
            pendingThinkingEntries = [...pendingThinkingEntries, cleanedThinking];
          }

          pendingTools = [
            ...pendingTools,
            ...toolCalls.map((toolCall): ToolCallItem => ({
              name: toolCall.name as string,
              arguments: toolCall.arguments,
              status: 'success' as const,
              result: null,
              isError: false,
            })),
          ];
          return;
        }

        renderable.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: (msg.content as string) || '',
          timestamp: normalizeTimestamp(msg.timestamp as string),
          toolCalls: pendingTools.length > 0 ? pendingTools : undefined,
          thinking: pendingThinkingEntries.length > 0 ? pendingThinkingEntries : undefined,
        });
        pendingTools = [];
        pendingThinkingEntries = [];
        return;
      }

      if (msg.role === 'tool' && Array.isArray(msg.toolResults)) {
        pendingTools = pendingTools.map((tool) => {
          const match = (msg.toolResults as Array<Record<string, unknown>>).find(
            (toolResult) => toolResult.name === tool.name && tool.result == null
          );
          if (!match) return tool;

          return {
            ...tool,
            result:
              typeof match.result === 'string'
                ? match.result
                : JSON.stringify(match.result ?? ''),
            isError: !!match.isError,
            status: match.isError ? 'error' : 'success',
          };
        });
      }
    });

    // Bekleyen tool calls veya thinking varsa ekle
    if (pendingTools.length > 0 || pendingThinkingEntries.length > 0) {
      renderable.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '⏳ İşlem devam ediyor...',
        timestamp: new Date().toISOString(),
        toolCalls: pendingTools.length > 0 ? pendingTools : undefined,
        thinking: pendingThinkingEntries.length > 0 ? pendingThinkingEntries : undefined,
        pending: true,
      });
    }

    return renderable;
  }, []);

  return {
    buildRenderableMessages,
  };
}
