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

/** Teknik/Programlama konuşmaları için özet prompt'u */
const COMPACT_SUMMARY_PROMPT_TECHNICAL = `Aşağıdaki teknik konuşma geçmişini analiz et ve bağlamı kaybetmeden özetle.

## Görev
Bu bir CONTEXT COMPACTION özetidir — konuşma devam edecek, bu yüzden agent'ın çalışmaya devam edebilmesi için TÜM bağlamsal bilgiyi korumalısın.

## Özette MUTLAKA olması gerekenler:
1. Yapılan işlemler ve sonuçları (dosya değişiklikleri, komutlar, aramalar) — dosya yolları ve değişiklik detayları tam olarak belirtilmeli
2. Alınan kararlar ve bunların gerekçeleri
3. Kullanıcının açık tercihleri ve istekleri
4. Henüz çözülmemiş sorunlar veya devam eden görevler (TODO olarak işaretle)
5. Önemli teknik detaylar: dosya yolları, konfigürasyon değerleri, hata mesajları, API yanıtları
6. Kod değişikliklerinin tam dosya yolları ve yapılan spesifik değişiklikler

## Özette OLMAMASI gerekenler:
- Genel selamlamalar veya tekrarlar
- Detaylı hata yığınları (sadece ana hata mesajını tut)
- Orta düzey debug çıktıları
- Onay mesajları ("tamam", "yapıldı" vb.)

## Format
SADECE özet metnini yaz. JSON formatı KULLANMA. Kod bloğu KULLANMA. Açıklama ekleme.
3-6 paragraf, her biri belirli bir konuya odaklı.
Özetin dili konuşmanın ağırlıklı yapıldığı dilde olsun.`;

/** Sohbet/Genel konuşmalar için özet prompt'u */
const COMPACT_SUMMARY_PROMPT_CONVERSATIONAL = `Aşağıdaki konuşma geçmişini analiz et ve bağlamı kaybetmeden özetle.

## Görev
Bu bir CONTEXT COMPACTION özetidir — konuşma devam edecek, bu yüzden agent'ın çalışmaya devam edebilmesi için TÜM bağlamsal bilgiyi korumalısın.

## Özette MUTLAKA olması gerekenler:
1. Tartışılan konular ve varılan sonuçlar
2. Kullanıcının açık tercihleri ve duygusal durumu
3. Paylaşılan kişisel bilgiler ve anılar
4. Henüz bitmemiş konular veya takip edilmesi gerekenler
5. Önemli isimler, tarihler, yerler ve olaylar

## Özette OLMAMASI gerekenler:
- Genel selamlamalar veya tekrarlar
- Detaylı günlük rutin anlatıları
- Konu dışı geçici konuşmalar

## Format
SADECE özet metnini yaz. JSON formatı KULLANMA. Kod bloğu KULLANMA. Açıklama ekleme.
3-6 paragraf, her biri belirli bir konuya odaklı.
Özetin dili konuşmanın ağırlıklı yapıldığı dilde olsun.`;

/** Artımlı özetleme — mevcut özete yeni mesajları eklemek için */
const COMPACT_INCREMENTAL_PROMPT = `Aşağıda mevcut bir konuşma özeti ve sonrasında yapılan yeni mesajlar var.
Mevcut özeti, yeni mesajlardaki bilgileri dahil ederek güncelle.

## Kurallar:
1. Mevcut özetteki bilgileri kaybetme — sadece gereksiz tekrarları çıkar
2. Yeni mesajlardaki tüm önemli bilgileri ekle
3. Çelişkili bilgi varsa yeni bilgiye öncelik ver
4. Özetin toplam uzunluğu mevcut uzunluğun 1.5 katını geçmemeli
5. Aynı formatı koru — paragraf tabanlı, JSON değil

## Mevcut Özet:
{EXISTING_SUMMARY}

## Yeni Mesajlar:
{NEW_MESSAGES}`;

/** Zaman dilimi tipleri — teleskopik compaction için */
type TimeSpan = 'recent' | 'medium' | 'old';

/** Zaman dilimi yapılandırması */
interface TimeSpanConfig {
  label: string;
  maxContentLength: number;  // Her mesaj için maksimum karakter uzunluğu
  summaryDetail: 'full' | 'condensed' | 'brief';
}

const TIMESPAN_CONFIGS: Record<TimeSpan, TimeSpanConfig> = {
  recent:  { label: 'Son 1 saat',    maxContentLength: 500,  summaryDetail: 'full' },
  medium:  { label: 'Son 24 saat',    maxContentLength: 250,  summaryDetail: 'condensed' },
  old:     { label: '24 saatten eski', maxContentLength: 100,  summaryDetail: 'brief' },
};

export class CompactEngine {
  private llm: LLMProvider;
  private lastBoundarySummary: string | null = null;
  private lastSessionId: string | null = null;

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

    const threshold = config.compactTokenThreshold;

    // Hızlı tahmin ile threshold kontrolü — sadece karar için kullanılır
    const approxTotal = this.countMessagesTokens(llmMessages, threshold);

    if (approxTotal < threshold) {
      // Kesinlikle altında — yaklaşık değeri raporlama için kullan (tam sayıma gerek yok)
      return this.noCompactResult(llmMessages, approxTotal);
    }

    // Threshold aşılmış olabilir — raporlama için tam sayım yap
    const totalTokens = this.countMessagesTokens(llmMessages);

    if (totalTokens < threshold) {
      // Yaklaşık değer threshold'u aştı ama tam sayım altında — compaction gerekmez
      return this.noCompactResult(llmMessages, totalTokens);
    }

    logger.info({
      totalTokens,
      threshold,
      messageCount: llmMessages.length,
    }, '[CompactEngine] Context compaction needed');

    // Oturum değişikliği tespiti — farklı konuşmaya geçince incremental state'i sıfırla
    if (this.lastSessionId !== null && this.lastSessionId !== sessionId) {
      this.lastBoundarySummary = null;
    }
    this.lastSessionId = sessionId;

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

    // Teleskopik compaction: mesajları zaman dilimlerine ayır ve detay seviyesini ayarla
    const timeSpanGroups = this.categorizeByTimeSpan(messagesToCompact, conversationHistory);
    const transcript = this.formatTelescopicTranscript(timeSpanGroups);

    // Artımlı compaction: mevcut boundary özeti varsa genişlet
    let summary: string;
    if (this.lastBoundarySummary) {
      summary = await this.generateIncrementalSummary(this.lastBoundarySummary, transcript);
    } else {
      const isTechnical = this.detectConversationType(messagesToCompact) === 'technical';
      summary = await this.generateSummary(transcript, isTechnical);
    }

    // Özet token sınırı — çok fazla compaction cycle'ında sınırsız büyümeyi engelle
    const MAX_SUMMARY_TOKENS = 1500;
    const summaryTokens = encode(summary).length;
    if (summaryTokens > MAX_SUMMARY_TOKENS) {
      logger.warn({
        summaryTokens,
        maxTokens: MAX_SUMMARY_TOKENS,
      }, '[CompactEngine] Summary exceeds token limit, forcing fresh summary next cycle');
      // Token sınırını aşarsa incremental state'i sıfırla → bir sonraki cycle taze özet üretir
      this.lastBoundarySummary = null;
    } else {
      this.lastBoundarySummary = summary;
    }

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

  /**
   * Konuşma tipini tespit eder — teknik (kod, araç çağrısı ağırlıklı) veya sohbet.
   */
  private detectConversationType(messages: LLMMessage[]): 'technical' | 'conversational' {
    let toolCallCount = 0;
    let codeSnippetCount = 0;
    let totalContent = 0;

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      totalContent += content.length;

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolCallCount += msg.toolCalls.length;
      }

      // Kod bloğu tespiti
      if (/```[\s\S]*?```/.test(content) || /\b(function|class|import|export|const |let |var |return |if \()\b/.test(content)) {
        codeSnippetCount++;
      }
    }

    const toolDensity = toolCallCount / Math.max(1, messages.length);
    const codeDensity = codeSnippetCount / Math.max(1, messages.length);

    // Araç çağrısı yoğunluğu veya kod yoğunluğu yüksekse teknik
    return (toolDensity > 0.3 || codeDensity > 0.2) ? 'technical' : 'conversational';
  }

  /**
   * Mesajları zaman dilimlerine göre kategorize eder (teleskopik compaction).
   * recent: son 1 saat, medium: son 24 saat, old: daha eski
   */
  private categorizeByTimeSpan(
    messages: LLMMessage[],
    conversationHistory: ConversationMessage[],
  ): Map<TimeSpan, LLMMessage[]> {
    const nowMs = Date.now();
    const HOUR_MS = 3600000;
    const DAY_MS = 86400000;

    const result = new Map<TimeSpan, LLMMessage[]>([
      ['recent', []],
      ['medium', []],
      ['old', []],
    ]);

    // conversationHistory'den zaman damgalarını eşleştir
    // id → timestamp haritası (content bazlı lookup yerine — aynı içerikli
    // mesajlar content key'inde birbirinin timestamp'ını overwrite ediyordu)
    const timestampById = new Map<number, number>();
    for (const msg of conversationHistory) {
      if (msg.id !== undefined && msg.timestamp) {
        const ts = msg.timestamp instanceof Date
          ? msg.timestamp.getTime()
          : new Date(msg.timestamp).getTime();
        if (Number.isFinite(ts)) {
          timestampById.set(msg.id, ts);
        }
      }
    }

    // role:content → id[] haritası (aynı content'li mesajları sırayla eşleştirmek için)
    const idsByContentRole = new Map<string, number[]>();
    for (const msg of conversationHistory) {
      if (msg.id !== undefined) {
        const key = `${msg.role}:${msg.content}`;
        const list = idsByContentRole.get(key);
        if (list) {
          list.push(msg.id);
        } else {
          idsByContentRole.set(key, [msg.id]);
        }
      }
    }

    // Her key için tüketim indeksi — aynı content'li mesajlar sırayla eşleşir
    const consumeIndex = new Map<string, number>();

    // Mesajları zaman damgalarına göre kategorize et
    let lastKnownCategory: TimeSpan = 'recent';

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let category: TimeSpan;

      // Tool result → bir önceki kategoriyi miras al
      if (msg.role === 'tool') {
        category = lastKnownCategory;
      } else {
        const content = typeof msg.content === 'string' ? msg.content : '';
        const lookupKey = `${msg.role}:${content}`;
        const idList = idsByContentRole.get(lookupKey);
        const idx = consumeIndex.get(lookupKey) ?? 0;

        let ts: number | undefined;
        if (idList && idx < idList.length) {
          ts = timestampById.get(idList[idx]);
          consumeIndex.set(lookupKey, idx + 1);
        }

        if (ts !== undefined) {
          const ageMs = nowMs - ts;
          if (ageMs < HOUR_MS) {
            category = 'recent';
          } else if (ageMs < DAY_MS) {
            category = 'medium';
          } else {
            category = 'old';
          }
        } else {
          // Zaman damgası yoksa — pozisyon bazlı tahmin
          const positionRatio = i / Math.max(1, messages.length - 1);
          if (positionRatio < 0.3) {
            category = 'old';
          } else if (positionRatio < 0.7) {
            category = 'medium';
          } else {
            category = 'recent';
          }
        }
        lastKnownCategory = category;
      }

      result.get(category)!.push(msg);
    }

    return result;
  }

  /**
   * Teleskopik transkript oluşturur — zaman dilimine göre farklı detay seviyesi uygular.
   */
  private formatTelescopicTranscript(timeSpanGroups: Map<TimeSpan, LLMMessage[]>): string {
    const parts: string[] = [];

    // Eski → Yeni sıralama
    const order: TimeSpan[] = ['old', 'medium', 'recent'];

    for (const span of order) {
      const messages = timeSpanGroups.get(span) ?? [];
      if (messages.length === 0) continue;

      const config = TIMESPAN_CONFIGS[span];
      parts.push(`\n--- ${config.label} (${messages.length} mesaj, detay: ${config.summaryDetail}) ---\n`);

      for (const msg of messages) {
        const formatted = this.formatSingleMessage(msg, config.maxContentLength);
        parts.push(formatted);
      }
    }

    return parts.join('\n');
  }

  /**
   * Tek bir mesajı belirli bir maksimum uzunlukta formatlar.
   */
  private formatSingleMessage(msg: LLMMessage, maxContentLength: number): string {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      return `[Kullanıcı]: ${this.truncateContent(content, maxContentLength)}`;
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolParts = msg.toolCalls.map(tc =>
          `${tc.name}(${this.truncateContent(JSON.stringify(tc.arguments), 150)})`
        ).join('; ');
        const contentPreview = typeof msg.content === 'string' && msg.content.length > 0
          ? ` — ${this.truncateContent(msg.content, 80)}`
          : '';
        return `[Asistan/Tool]: ${toolParts}${contentPreview}`;
      } else {
        const content = typeof msg.content === 'string' ? msg.content : '';
        return `[Asistan]: ${this.truncateContent(content, maxContentLength)}`;
      }
    } else if (msg.role === 'tool') {
      if (msg.toolResults) {
        const resultParts = msg.toolResults.map(tr => {
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
          return `[Sonuç/${tr.name}]: ${this.truncateContent(resultStr, maxContentLength)}`;
        });
        return resultParts.join('\n');
      }
    }
    return '';
  }

  /**
   * İçeriği belirli bir uzunlukta kırpar.
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  private async generateSummary(transcript: string, isTechnical: boolean): Promise<string> {
    const systemPrompt = isTechnical ? COMPACT_SUMMARY_PROMPT_TECHNICAL : COMPACT_SUMMARY_PROMPT_CONVERSATIONAL;

    try {
      const result = await this.llm.chat(
        [{ role: 'user', content: transcript }],
        {
          systemPrompt,
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

    return this.heuristicSummaryFromTranscript(transcript);
  }

  /**
   * Artımlı özetleme — mevcut özete yeni mesajları entegre eder.
   */
  private async generateIncrementalSummary(existingSummary: string, newTranscript: string): Promise<string> {
    const prompt = COMPACT_INCREMENTAL_PROMPT
      .replace('{EXISTING_SUMMARY}', existingSummary)
      .replace('{NEW_MESSAGES}', newTranscript);

    try {
      const result = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        {
          systemPrompt: 'Sen bir özet asistanısın. Mevcut bir özeti yeni bilgilerle güncelle, hiçbir bilgiyi kaybetme.',
          temperature: 0.2,
          maxTokens: 2048,
        },
      );

      const summary = result.content.trim();
      if (summary.length > 0) {
        return summary;
      }
    } catch (err) {
      logger.error({ err }, '[CompactEngine] Incremental summarization failed, using existing summary + new transcript');
    }

    // Fallback: mevcut özet + yeni transkriptin kısa versiyonu
    return `${existingSummary}\n\n--- Sonraki mesajlar ---\n${this.heuristicSummaryFromTranscript(newTranscript)}`;
  }

  private heuristicSummaryFromTranscript(transcript: string): string {
    const lineCount = transcript.split('\n').filter(l => l.trim().length > 0).length;
    const toolMentions = transcript.match(/\[Asistan\/Tool\]:/g);
    const toolsUsed = [...new Set(
      (transcript.match(/\[Sonuç\/([^\]]+)\]/g) ?? [])
        .map(m => m.replace('[Sonuç/', '').replace(']', ''))
    )];

    let summary = `[Otomatik özet — ${lineCount} satır sıkıştırıldı]\n`;
    if (toolsUsed.length > 0) {
      summary += `Kullanılan araçlar: ${toolsUsed.join(', ')}\n`;
    }
    if (toolMentions) {
      summary += `Araç çağrısı sayısı: ${toolMentions.length}\n`;
    }
    // İlk ve son kullanıcı mesajlarını tut
    const userLines = transcript.split('\n').filter(l => l.startsWith('[Kullanıcı]:'));
    if (userLines.length > 0) {
      summary += `İlk konu: ${userLines[0].replace('[Kullanıcı]: ', '').substring(0, 100)}\n`;
      if (userLines.length > 1) {
        summary += `Son konu: ${userLines[userLines.length - 1].replace('[Kullanıcı]: ', '').substring(0, 100)}\n`;
      }
    }

    return summary;
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

  /** Hızlı yaklaşık token tahmini — char/4 oranı. Encode çağrısından ~100x hızlı. */
  private estimateTokensApprox(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Tek bir mesajın yaklaşık token sayısı (hafif hesaplama). */
  private estimateMessageTokensApprox(msg: LLMMessage): number {
    let tokens = 0;

    if (msg.content) {
      tokens += this.estimateTokensApprox(msg.content as string);
    }

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tokens += this.estimateTokensApprox(tc.name);
        tokens += this.estimateTokensApprox(JSON.stringify(tc.arguments));
      }
    }

    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        tokens += this.estimateTokensApprox(tr.name);
        const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
        tokens += this.estimateTokensApprox(resultStr);
      }
    }

    tokens += 4;

    return tokens;
  }

  private countMessageTokens(msg: LLMMessage): number {
    let tokens = 0;

    if (msg.content) {
      tokens += encode(msg.content as string).length;
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

  /**
   * Mesaj listesinin toplam token sayısını hesaplar.
   * Optimizasyon: Önce hızlı tahmin (char/4) ile kontrol eder,
   * sadece threshold'a yakın olduğunda tam sayım yapar.
   */
  private countMessagesTokens(messages: LLMMessage[], threshold?: number): number {
    // Hızlı yol: yaklaşık tahmin
    const approxTotal = messages.reduce((sum, msg) => sum + this.estimateMessageTokensApprox(msg), 0);

    // Eğer threshold verilmişse ve yaklaşık değer threshold'dan belirgin derecede uzaksa,
    // tam sayımı atla (±%15 tolerance)
    if (threshold !== undefined) {
      const margin = threshold * 0.15;
      if (approxTotal < threshold - margin) {
        // Kesinlikle altında — tam sayıma gerek yok
        return approxTotal;
      }
      if (approxTotal > threshold + margin * 3) {
        // Kesinlikle üstünde — tam sayıma gerek yok (compaction yapılacak)
        return approxTotal;
      }
      // Threshold'a yakın — tam sayım yap
    }

    // Tam sayım: her mesaj için encode() çağır
    return messages.reduce((sum, msg) => sum + this.countMessageTokens(msg), 0);
  }

  private noCompactResult(messages: LLMMessage[], cachedTokenCount?: number): CompactResult {
    const tokenCount = cachedTokenCount ?? this.countMessagesTokens(messages);
    return {
      messages,
      wasCompacted: false,
      originalTokens: tokenCount,
      compactedTokens: tokenCount,
      messagesCompacted: 0,
      summaryLength: 0,
      durationMs: 0,
      preservedFiles: [],
      boundaryId: '',
    };
  }
}