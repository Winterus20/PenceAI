import { encode } from 'gpt-tokenizer';
import type { LLMProvider } from '../llm/provider.js';
import type { LLMMessage, ConversationMessage } from '../router/types.js';
import type { HookContext } from './mcp/hookTypes.js';
import { getHookRegistry } from './mcp/hooks.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/index.js';
interface LLMChunk {
  messages: LLMMessage[];
  tokens: number;
}

export interface CompactOptions {
  maxTokens: number;
  preserveRecentMessages: number;
  preserveFileAttachments: boolean;
  maxFileAttachmentBytes: number;
}

export interface CompactResult {
  messages: LLMMessage[];
  wasCompacted: boolean;
  originalTokens: number;
  compactedTokens: number;
  messagesCompacted: number;
  summaryLength: number;
  durationMs: number;
  preservedFiles: string[];
  boundaryId: string;
}

interface FileAttachment {
  path: string;
  content: string;
  size: number;
}

const COMPACT_SUMMARY_PROMPT = `Aşağıdaki konuşma geçmişini analiz et ve bağlamı kaybetmeden özetle.

## Görev
Bu bir CONTEXT COMPACTION özetidir — konuşma devam edecek, bu yüzden agent'ın çalışmaya devam edebilmesi için TÜM bağlamsal bilgiyi korumalısın.

## Özette MUTLAKA olması gerekenler:
1. Yapılan işlemler ve sonuçları (araç çağrıları, dosya değişiklikleri, aramalar)
2. Alınan kararlar ve bunların gerekçeleri
3. Kullanıcının açık tercihleri ve istekleri
4. Henüz çözülmemiş sorunlar veya devam eden görevler
5. Önemli teknik detaylar (dosya yolları, konfigürasyonlar, hata mesajları)

## Özette OLMAMASI gerekenler:
- Genel selamlamalar veya tekrarlar
- Detaylı hata yığınları (sadece ana hata mesajını tut)
- Orta düzey debug çıktıları

## Format
SADECE özet metnini yaz. JSON formatı KULLANMA. Kod bloğu KULLANMA. Açıklama ekleme.
3-6 paragraf, her biri belirli bir konuya odaklı.
Özetin dili konuşmanın ağırlıklı yapıldığı dilde olsun.`;

export class CompactEngine {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async compactIfNeeded(
    llmMessages: LLMMessage[],
    conversationHistory: ConversationMessage[],
    sessionId: string,
    sessionToolCallCount: number,
  ): Promise<CompactResult> {
    const config = getConfig();
    if (!config.compactEnabled) {
      return this.noCompactResult(llmMessages);
    }

    const totalTokens = this.countMessagesTokens(llmMessages);
    const threshold = config.compactTokenThreshold;

    if (totalTokens < threshold) {
      return this.noCompactResult(llmMessages);
    }

    logger.info({
      totalTokens,
      threshold,
      messageCount: llmMessages.length,
    }, '[CompactEngine] Context compaction needed');

    const hookRegistry = getHookRegistry();
    const startTime = Date.now();

    const preCompactContext: HookContext = {
      toolName: '*',
      args: { originalTokens: totalTokens, threshold },
      sessionId,
      callCount: sessionToolCallCount,
      totalTokens,
      tokenThreshold: threshold,
      compactReason: 'token_budget_exceeded',
    };

    await hookRegistry.executePhase('PreCompact', preCompactContext);

    try {
      const result = await this.compact(llmMessages, conversationHistory, config);

      const postCompactContext: HookContext = {
        toolName: '*',
        args: {
          originalTokens: totalTokens,
          compactedTokens: result.compactedTokens,
          messagesCompacted: result.messagesCompacted,
        },
        sessionId,
        callCount: sessionToolCallCount,
        totalTokens: result.compactedTokens,
        tokenThreshold: threshold,
      };

      await hookRegistry.executePhase('PostCompact', postCompactContext);

      result.durationMs = Date.now() - startTime;
      result.originalTokens = totalTokens;

      logger.info({
        originalTokens: totalTokens,
        compactedTokens: result.compactedTokens,
        messagesCompacted: result.messagesCompacted,
        durationMs: result.durationMs,
      }, '[CompactEngine] ✅ Context compacted');

      return result;
    } catch (err) {
      logger.error({ err }, '[CompactEngine] ❌ Compaction failed, falling back to pruning');
      return this.noCompactResult(llmMessages);
    }
  }

  private async compact(
    llmMessages: LLMMessage[],
    conversationHistory: ConversationMessage[],
    config: ReturnType<typeof getConfig>,
  ): Promise<CompactResult> {
    const preserveCount = config.compactPreserveRecentMessages;
    const preserveFiles = config.compactPreserveFileAttachments;
    const maxFileBytes = config.compactMaxFileAttachmentBytes;

    const chunks = this.chunkMessages(llmMessages);
    const totalChunks = chunks.length;

    const preserveChunkCount = Math.min(
      preserveCount,
      totalChunks,
    );

    if (totalChunks <= preserveChunkCount) {
      return this.noCompactResult(llmMessages);
    }

    const chunksToCompact = chunks.slice(0, totalChunks - preserveChunkCount);
    const chunksToPreserve = chunks.slice(totalChunks - preserveChunkCount);

    const messagesToCompact = chunksToCompact.flatMap(c => c.messages);
    const preservedMessages = chunksToPreserve.flatMap(c => c.messages);

    const summary = await this.generateSummary(messagesToCompact);

    const fileAttachments: FileAttachment[] = preserveFiles
      ? this.preserveFileAttachments(conversationHistory, maxFileBytes)
      : [];

    const boundaryId = crypto.randomUUID();
    const boundaryMessage = this.buildBoundaryMessage(summary, fileAttachments, boundaryId, messagesToCompact.length);

    const compactedMessages: LLMMessage[] = [
      boundaryMessage,
      ...preservedMessages,
    ];

    const compactedTokens = this.countMessagesTokens(compactedMessages);

    return {
      messages: compactedMessages,
      wasCompacted: true,
      originalTokens: 0,
      compactedTokens,
      messagesCompacted: messagesToCompact.length,
      summaryLength: summary.length,
      durationMs: 0,
      preservedFiles: fileAttachments.map(f => f.path),
      boundaryId,
    };
  }

  private async generateSummary(messages: LLMMessage[]): Promise<string> {
    const transcript = this.formatMessagesForSummary(messages);

    try {
      const result = await this.llm.chat(
        [{ role: 'user', content: transcript }],
        {
          systemPrompt: COMPACT_SUMMARY_PROMPT,
          temperature: 0.2,
          maxTokens: 2048,
        },
      );

      const summary = result.content.trim();
      if (summary.length > 0) {
        return summary;
      }
    } catch (err) {
      logger.error({ err }, '[CompactEngine] LLM summarization failed, using heuristic summary');
    }

    return this.heuristicSummary(messages);
  }

  private heuristicSummary(messages: LLMMessage[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const toolCalls = messages.filter(m => m.toolCalls && m.toolCalls.length > 0);

    const userTopics = userMessages
      .map(m => (typeof m.content === 'string' ? m.content : '').substring(0, 100))
      .filter(c => c.length > 0)
      .slice(-5);

    const toolsUsed = toolCalls.flatMap(m => m.toolCalls?.map(tc => tc.name) ?? []);

    let summary = `[Otomatik özet — ${messages.length} mesaj sıkıştırıldı]\n`;
    if (userTopics.length > 0) {
      summary += `Konuşulan konular: ${userTopics.join('; ')}\n`;
    }
    if (assistantMessages.length > 0) {
      summary += `Asistan yanıtları: ${assistantMessages.length}\n`;
    }
    if (toolsUsed.length > 0) {
      summary += `Kullanılan araçlar: ${[...new Set(toolsUsed)].join(', ')}\n`;
    }

    return summary;
  }

  private formatMessagesForSummary(messages: LLMMessage[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content.length > 500) {
          parts.push(`[Kullanıcı]: ${content.substring(0, 500)}...`);
        } else {
          parts.push(`[Kullanıcı]: ${content}`);
        }
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const toolNames = msg.toolCalls.map(tc => tc.name).join(', ');
          const argsPreview = msg.toolCalls.map(tc =>
            `${tc.name}(${JSON.stringify(tc.arguments).substring(0, 200)})`
          ).join('; ');
          const contentPreview = typeof msg.content === 'string' && msg.content.length > 0
            ? ` — ${msg.content.substring(0, 100)}`
            : '';
          parts.push(`[Asistan/Tool]: ${argsPreview}${contentPreview}`);
        } else {
          const content = typeof msg.content === 'string' ? msg.content : '';
          if (content.length > 400) {
            parts.push(`[Asistan]: ${content.substring(0, 400)}...`);
          } else {
            parts.push(`[Asistan]: ${content}`);
          }
        }
      } else if (msg.role === 'tool') {
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
            if (resultStr.length > 300) {
              parts.push(`[Sonuç/${tr.name}]: ${resultStr.substring(0, 300)}...`);
            } else {
              parts.push(`[Sonuç/${tr.name}]: ${resultStr}`);
            }
          }
        }
      }
    }

    return parts.join('\n');
  }

  private chunkMessages(messages: LLMMessage[]): LLMChunk[] {
    const chunks: LLMChunk[] = [];
    let i = 0;

    while (i < messages.length) {
      if (
        messages[i].role === 'assistant' &&
        messages[i].toolCalls &&
        (messages[i].toolCalls?.length ?? 0) > 0 &&
        i + 1 < messages.length &&
        messages[i + 1].role === 'tool'
      ) {
        const combinedTokens =
          this.countMessageTokens(messages[i]) +
          this.countMessageTokens(messages[i + 1]);
        chunks.push({
          messages: [messages[i], messages[i + 1]],
          tokens: combinedTokens,
        });
        i += 2;
        continue;
      }

      chunks.push({
        messages: [messages[i]],
        tokens: this.countMessageTokens(messages[i]),
      });
      i++;
    }

    return chunks;
  }

  private preserveFileAttachments(
    conversationHistory: ConversationMessage[],
    maxBytes: number,
  ): FileAttachment[] {
    if (!conversationHistory || conversationHistory.length === 0) return [];

    const attachments: FileAttachment[] = [];
    let totalSize = 0;

    for (let i = conversationHistory.length - 1; i >= 0 && attachments.length < 5; i--) {
      const msg = conversationHistory[i];
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.fileName && att.size && att.size < 10240 && totalSize + att.size <= maxBytes) {
            attachments.push({
              path: att.fileName,
              content: att.data || '',
              size: att.size,
            });
            totalSize += att.size;
          }
        }
      }
    }

    return attachments;
  }

  private buildBoundaryMessage(
    summary: string,
    fileAttachments: FileAttachment[],
    boundaryId: string,
    messagesCompacted: number,
  ): LLMMessage {
    let content = `[CONTEXT_COMPACT] Önceki ${messagesCompacted} mesaj sıkıştırıldı (ID: ${boundaryId})\n\n`;
    content += `## Özet\n${summary}`;

    if (fileAttachments.length > 0) {
      content += `\n\n## Korunan Dosyalar\n`;
      for (const f of fileAttachments) {
        content += `- ${f.path} (${(f.size / 1024).toFixed(1)}KB)`;
        if (f.content) {
          content += `\n\`\`\`\n${f.content.substring(0, 2000)}\n\`\`\``;
        }
        content += '\n';
      }
    }

    content += `\n\n[CONTEXT_COMPACT_END]`;

    return {
      role: 'system',
      content,
    };
  }

  private countMessageTokens(msg: LLMMessage): number {
    let tokens = 0;

    if (msg.content) {
      tokens += encode(msg.content).length;
    }

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tokens += encode(tc.name).length;
        tokens += encode(JSON.stringify(tc.arguments)).length;
      }
    }

    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        tokens += encode(tr.name).length;
        const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
        tokens += encode(resultStr).length;
      }
    }

    tokens += 4;

    return tokens;
  }

  private countMessagesTokens(messages: LLMMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessageTokens(msg), 0);
  }

  private noCompactResult(messages: LLMMessage[]): CompactResult {
    return {
      messages,
      wasCompacted: false,
      originalTokens: this.countMessagesTokens(messages),
      compactedTokens: this.countMessagesTokens(messages),
      messagesCompacted: 0,
      summaryLength: 0,
      durationMs: 0,
      preservedFiles: [],
      boundaryId: '',
    };
  }
}