import type { LLMProvider } from '../llm/provider.js';
import { TOOL_CALL_CLEAR_SIGNAL } from '../llm/provider.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';
import type { AgentEventCallback } from './runtime.js';
import type { ToolManager } from './toolManager.js';
import type { MetricsTracker } from './metricsTracker.js';
import { extractFallbackToolCalls } from './fallbackParser.js';
import { getConfig } from '../gateway/config.js';
import type { MemoryManager } from '../memory/manager.js';
import { logger } from '../utils/index.js';
import type { CompactEngine } from './compactEngine.js';
import { getHookRegistry } from './mcp/hooks.js';

export interface ReActLoopInput {
    llm: LLMProvider;
    toolManager: ToolManager;
    metricsTracker: MetricsTracker;
    memory: MemoryManager;
    conversationId: string;
    finalSystemPrompt: string;
    llmMessages: LLMMessage[];
    maxIterations: number;
    isToolingDisabled: boolean;
    onEvent?: AgentEventCallback;
    thinking?: boolean;
    isFirstMessage: boolean;
    contextTokenInfo: {
        systemPromptTokens: number;
        userMsgTokens: number;
        pastHistoryTokens: number;
    };
    compactEngine: CompactEngine;
    compactThreshold: number;
    confirmCallback?: (info: { toolName: string; path: string; operation: 'write' | 'delete' | 'execute'; description: string; }) => Promise<boolean>;
}

export interface ReActLoopResult {
    uiContent: string;
    lastDbContent: string;
    iterations: number;
}

/** Artımlı token tahmini — karakter bazlı, reduce() yerine incremental */
function estimateMessageTokensChar(msg: LLMMessage): number {
    let t = 0;
    if (msg.content) t += msg.content.length;
    if (msg.toolCalls) for (const tc of msg.toolCalls) { t += tc.name.length + JSON.stringify(tc.arguments).length; }
    if (msg.toolResults) for (const tr of msg.toolResults) { t += tr.name.length + tr.result.length; }
    return t + 4;
}

export class ReActLoop {
    async execute(input: ReActLoopInput): Promise<ReActLoopResult> {
        const {
            llm,
            toolManager,
            metricsTracker,
            memory,
            conversationId,
            finalSystemPrompt,
            llmMessages,
            maxIterations,
            isToolingDisabled,
            onEvent,
            thinking,
            isFirstMessage,
            contextTokenInfo,
            compactEngine,
            compactThreshold,
            confirmCallback,
        } = input;

        let uiContent = '';
        let lastDbContent = '';
        let iterations = 0;

        // Çalışma kopyası — orijinal diziyi mutasyona uğratma
        let workingMessages = [...llmMessages];

        // Artımlı token takibi — her reduce() yerine sadece delta ekle
        let incrementalCharCount = workingMessages.reduce((sum, msg) => sum + estimateMessageTokensChar(msg), 0);

        while (iterations < maxIterations) {
            iterations++;

            // İlk iterasyonda token bilgisini logla
            if (iterations === 1) {
                logger.info(`[Agent] 📊 Context: geçmiş ${contextTokenInfo.pastHistoryTokens} token, kullanıcı mesajı ${contextTokenInfo.userMsgTokens} token, sistem promptu ${contextTokenInfo.systemPromptTokens} token`);
            }

            logger.debug(`[Agent] 🧠 LLM çağrılıyor (iterasyon ${iterations})...`);
            onEvent?.({ type: 'iteration', data: { iteration: iterations } });

            // Tool definitions'ı her iterasyonda güncelle (MCP araçları dinamik olarak değişebilir)
            const currentToolDefinitions = isToolingDisabled ? [] : toolManager.getEffectiveToolDefinitions();

            // MCP araç durumunu logla
            const mcpTools = currentToolDefinitions.filter(t => t.name.startsWith('mcp:'));
            logger.info(`[Agent] Total tools available: ${currentToolDefinitions.length} (Built-in: ${currentToolDefinitions.length - mcpTools.length}, MCP: ${mcpTools.length})`);
            if (mcpTools.length > 0) {
                logger.info(`[Agent] Active MCP tools: ${mcpTools.map(t => t.name).join(', ')}`);
            } else {
                logger.warn(`[Agent] No MCP tools found in currentToolDefinitions!`);
            }

            const chatOptions = {
                systemPrompt: finalSystemPrompt,
                tools: currentToolDefinitions,
                temperature: 0.7,
                maxTokens: 4096,
                thinking,
            };

            let llmResponse: LLMResponse;
            const llmCallStart = Date.now();
            if (llm.chatStream) {
                llmResponse = await llm.chatStream(workingMessages, chatOptions, (token) => {
                    if (token === TOOL_CALL_CLEAR_SIGNAL) {
                        // clear_stream engellendi; ara yazılar artık silinmeyecek.
                    } else {
                        onEvent?.({ type: 'token', data: { content: token } });
                    }
                });
            } else {
                llmResponse = await llm.chat(workingMessages, chatOptions);
            }
            const llmCallDuration = Date.now() - llmCallStart;
            metricsTracker.recordPerf(`llm_call_${iterations}`, llmCallDuration);

            // Token usage bilgisini kaydet ve maliyet hesapla
            if (llmResponse.usage) {
                const config = getConfig();
                const currentProvider = config.defaultLLMProvider;
                const currentModel = config.defaultLLMModel || 'unknown';

                const promptTokens = llmResponse.usage.promptTokens || 0;
                const completionTokens = llmResponse.usage.completionTokens || 0;
                const totalTokens = llmResponse.usage.totalTokens || 0;
                const callCost = metricsTracker.recordLlmCall(currentProvider, currentModel, promptTokens, completionTokens, llmCallDuration);

                try {
                    memory.saveTokenUsage({
                        provider: currentProvider,
                        model: currentModel,
                        promptTokens,
                        completionTokens,
                        totalTokens,
                    });
                } catch (err) {
                    logger.warn({ err }, '[Agent] Token usage kaydedilemedi:');
                }

                logger.info(`[Agent] ⏱️ LLM call (iterasyon ${iterations}): ${llmCallDuration}ms | ${currentProvider}/${currentModel} | ${promptTokens} input + ${completionTokens} output = ${totalTokens} tokens | $${callCost.toFixed(4)}`);
            }

            // <think> ve <plan> etiketlerini ayıkla
            const thinkingContent = llmResponse.thinkingContent;
            const planMatch = (llmResponse.content || '').match(/<plan>([\s\S]*?)<\/plan>/i);
            const extractedPlan = planMatch ? planMatch[1].trim() : null;

            const cleanContent = (llmResponse.content || '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*/g, '')
                .replace(/<plan>[\s\S]*?<\/plan>/gi, '') // Plan etiketlerini temizle
                .trim();

            // Eğer plan varsa ve düşünme içeriği boşsa planı düşünme alanına gönder
            let effectiveThinking = thinkingContent || extractedPlan;
            if (effectiveThinking) {
                // Etiketleri temizle (bazı modeller düşünme içeriğine de etiket koyabilir)
                effectiveThinking = effectiveThinking
                    .replace(/<plan>/gi, '')
                    .replace(/<\/plan>/gi, '')
                    .replace(/<think>/gi, '')
                    .replace(/<\/think>/gi, '')
                    .trim();
                onEvent?.({ type: 'thinking', data: { content: effectiveThinking } });
            }

            // Fallback: Model tool_calls array yerine content içerisine direkt JSON veya fonksiyon formatı döndürdüyse
            if ((!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) && cleanContent) {
                const fallbackResult = extractFallbackToolCalls(cleanContent, new Set(currentToolDefinitions.map(t => t.name)));
                if (fallbackResult.calls.length > 0) {
                    llmResponse.toolCalls = fallbackResult.calls;
                    // Fallback aracı bulunduğu için tespit edilen tam metinler (rawMatches) içerikten silinir
                    let strippedContent = cleanContent;
                    fallbackResult.rawMatches.forEach(matchStr => {
                        strippedContent = strippedContent.replace(matchStr, '').trim();
                    });

                    llmResponse.content = strippedContent;
                    logger.warn(`[Agent] ⚠️ Fallback parser: ${fallbackResult.calls.length} araç çağrısı yakalandı — ${fallbackResult.calls.map(tc => tc.name).join(', ')}`);
                    
                    // UI içeriğini güncelle (Fallback durumunda)
                    uiContent = this.joinUIContent(uiContent, strippedContent);
                    onEvent?.({ type: 'replace_stream', data: { content: uiContent } });
                }
            }

            // UI içeriğini güncelle ve etiketleri temizle
            uiContent = this.joinUIContent(uiContent, cleanContent);
            
            // Streaming sırasında etiketler gözükmüş olabilir, replace_stream ile temizle
            onEvent?.({ type: 'replace_stream', data: { content: uiContent } });

            // Araç çağrısı varsa
            if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                // İlk mesajda searchConversation çağrısını engelle — henüz aranacak geçmiş yok
                if (isFirstMessage) {
                    llmResponse.toolCalls = llmResponse.toolCalls.filter(tc => {
                        if (tc.name === 'searchConversation') {
                            logger.info(`[Agent] 🚫 searchConversation ilk mesajda engellendi.`);
                            return false;
                        }
                        return true;
                    });
                    // Tüm araç çağrıları filtrelendiyse normal yanıt olarak devam et
                    if (llmResponse.toolCalls.length === 0) {
                        lastDbContent = cleanContent;
                        uiContent = this.joinUIContent(uiContent, lastDbContent);
                        break;
                    }
                }

                logger.debug(`[Agent] 🔧 ${llmResponse.toolCalls.length} araç çağrılıyor...`);

                // Asistan mesajını ekle — düşünme içeriği LLM geçmişi için <think> ile saklanır
                const historyContent = effectiveThinking
                    ? `<think>${effectiveThinking}</think>\n${cleanContent}`
                    : cleanContent;
                const assistantMessage: LLMMessage = {
                    role: 'assistant',
                    content: historyContent,
                    toolCalls: llmResponse.toolCalls,
                };
                workingMessages.push(assistantMessage);

                // Araçları çalıştır — her biri için event gönder
                const toolResults = await toolManager.executeToolsWithEvents(llmResponse.toolCalls, onEvent, metricsTracker, confirmCallback);

                // Araç sonuçlarını ekle
                const toolMessage: LLMMessage = {
                    role: 'tool',
                    content: '',
                    toolResults,
                };
                workingMessages.push(toolMessage);

                // Araç sonuçlarını veritabanına kaydet (temiz içerikle, düşünme olmadan)
                memory.addMessage(conversationId, {
                    role: 'assistant',
                    content: cleanContent,
                    timestamp: new Date(),
                    toolCalls: llmResponse.toolCalls,
                });
                memory.addMessage(conversationId, {
                    role: 'tool',
                    content: '',
                    timestamp: new Date(),
                    toolResults,
                });

                // Artımlı token güncellemesi — sadece yeni eklenen mesajların katkısını hesapla
                incrementalCharCount += estimateMessageTokensChar(assistantMessage);
                incrementalCharCount += estimateMessageTokensChar(toolMessage);

                // Context Compaction — tool call'lar token bütçesini aşıyorsa sıkıştır
                if (compactEngine && compactThreshold > 0) {
                    const approxTokens = Math.ceil(incrementalCharCount / 4);

                    if (approxTokens > compactThreshold) {
                        const config = getConfig();
                        if (config.enableHooks) {
                            const hookRegistry = getHookRegistry();
                            await hookRegistry.executePhase('PreCompact', {
                                toolName: '*',
                                args: { currentTokens: approxTokens, threshold: compactThreshold },
                                sessionId: conversationId,
                                callCount: toolManager.sessionToolCallCount,
                                totalTokens: approxTokens,
                                tokenThreshold: compactThreshold,
                                compactReason: 'react_loop_budget_exceeded',
                            });
                        }

                        const compactResult = await compactEngine.compactIfNeeded(
                            workingMessages,
                            [],
                            conversationId,
                            toolManager.sessionToolCallCount,
                        );

                        if (compactResult.wasCompacted) {
                            workingMessages = [...compactResult.messages];
                            // Compact sonrası artımlı sayacı yeniden hesapla
                            incrementalCharCount = workingMessages.reduce((sum, msg) => sum + estimateMessageTokensChar(msg), 0);
                            metricsTracker.recordCompaction({
                                originalTokens: compactResult.originalTokens,
                                compactedTokens: compactResult.compactedTokens,
                                durationMs: compactResult.durationMs,
                                messagesCompacted: compactResult.messagesCompacted,
                                summaryLength: compactResult.summaryLength,
                            });
                            logger.info(`[ReActLoop] 🗜️ In-loop context compacted: ${compactResult.originalTokens} → ${compactResult.compactedTokens} tokens`);

                            if (config.enableHooks) {
                                const hookRegistry = getHookRegistry();
                                hookRegistry.executePhase('PostCompact', {
                                    toolName: '*',
                                    args: { originalTokens: compactResult.originalTokens, compactedTokens: compactResult.compactedTokens },
                                    sessionId: conversationId,
                                    callCount: toolManager.sessionToolCallCount,
                                    totalTokens: compactResult.compactedTokens,
                                    tokenThreshold: compactThreshold,
                                }).catch(err => logger.debug({ err }, '[ReActLoop] PostCompact hook error (non-blocking)'));
                            }

                            if (onEvent) {
                                onEvent({ type: 'compaction', data: { originalTokens: compactResult.originalTokens, compactedTokens: compactResult.compactedTokens } });
                            }
                        }
                    }
                }

                continue; // LLM'e tekrar dön
            }

            // Araç çağrısı yok — son yanıt
            lastDbContent = cleanContent;
            // joinUIContent çağrılmıyor çünkü uiContent zaten loop içinde joinUIContent(uiContent, cleanContent) ile güncellendi
            break;
        }

        if (!uiContent) {
            uiContent = '⚠️ Yanıt oluşturulamadı.';
        }

        if (iterations >= maxIterations) {
            uiContent += '\n\n⚠️ Maksimum araç iterasyon sayısına ulaşıldı.';
        }

        // Asistan yanıtını kaydet (veritabanında sadece son iterasyon)
        memory.addMessage(conversationId, {
            role: 'assistant',
            content: lastDbContent || (iterations >= maxIterations ? '⚠️ Maksimum araç iterasyon sayısına ulaşıldı.' : '⚠️ Yanıt oluşturulamadı.'),
            timestamp: new Date(),
        });

        return { uiContent, lastDbContent, iterations };
    }

    private joinUIContent(current: string, next: string): string {
        if (!next) return current;
        if (!current) return next;

        const nextTrimmed = next.trimStart();
        // Eğer yeni içerik tablo satırı (|), liste elemanı (-, *, 1.) veya kod bloğu (```) ise
        const isStructural = nextTrimmed.startsWith('|') ||
            nextTrimmed.startsWith('- ') ||
            nextTrimmed.startsWith('* ') ||
            /^\d+\.\s/.test(nextTrimmed) ||
            nextTrimmed.startsWith('```');

        if (isStructural) {
            // Yapısal içerik için: eğer mevcut içerik \n ile bitmiyorsa ekle, ama \n\n ekleme
            if (current.endsWith('\n')) return current + next;
            return current + '\n' + next;
        }

        // Normal metin için: eğer paragraf devam ediyorsa (noktalama yoksa) boşlukla bağla, değilse \n\n
        const lastChar = current.trimEnd().slice(-1);
        const isSentenceEnd = ['.', '!', '?', ':', ';'].includes(lastChar);

        if (!isSentenceEnd && !current.endsWith('\n')) {
            return current + ' ' + next;
        }

        if (current.endsWith('\n\n')) return current + next;
        if (current.endsWith('\n')) return current + '\n' + next;
        return current + '\n\n' + next;
    }
}
