import OpenAI from 'openai';
import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';
import { LLMError } from '../errors/LLMError.js';

interface MiniMaxDelta {
    content?: string;
    reasoning_details?: Array<{ text: string }>;
    tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    role?: string;
}

/**
 * MiniMax LLM Provider — OpenAI-uyumlu API kullanır.
 * Base URL: https://api.minimax.io/v1
 * Modeller: MiniMax-M2.5, MiniMax-M2.1, MiniMax-M2, vb.
 * Docs: https://platform.minimax.io/docs/api-reference/text-openai-api
 */
/** Default request timeout (ms) for MiniMax API calls */
const MINIMAX_TIMEOUT_MS = 30_000;

export class MiniMaxProvider extends LLMProvider {
    readonly name = 'minimax';
    readonly supportedModels = [
        'MiniMax-M2.5',
        'MiniMax-M2.5-highspeed',
        'MiniMax-M2.1',
        'MiniMax-M2.1-highspeed',
        'MiniMax-M2',
    ];

    private client: OpenAI;

    private isAutoToolChoiceUnsupported(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        return /auto tool choice requires .*enable-auto-tool-choice.*tool-call-parser|tool_choice.+auto|tool choice.+auto/i.test(error.message);
    }

    private async createChatCompletionWithToolFallback(reqOpts: Record<string, unknown>): Promise<unknown> {
        try {
            return await (this.client.chat.completions as any).create(reqOpts);
        } catch (error) {
            if (!reqOpts?.tools || !Array.isArray(reqOpts.tools) || reqOpts.tools.length === 0 || !this.isAutoToolChoiceUnsupported(error)) {
                throw error;
            }

            const { tools: _, tool_choice: __, ...fallbackReqOpts } = reqOpts;
            return await (this.client.chat.completions as any).create(fallbackReqOpts);
        }
    }

    constructor() {
        super();
        const config = getConfig();
        if (!config.minimaxApiKey) {
            throw new LLMError('MINIMAX_API_KEY ortam değişkeni ayarlanmamış');
        }
        this.client = new OpenAI({
            apiKey: config.minimaxApiKey,
            baseURL: 'https://api.minimax.io/v1',
            timeout: MINIMAX_TIMEOUT_MS,
            maxRetries: 1,
        });
    }

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);

        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        // Sistem prompt'u ekle
        if (options?.systemPrompt) {
            openaiMessages.push({ role: 'system', content: options.systemPrompt });
        }

        // Mesajları OpenAI formatına dönüştür
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: result.toolCallId,
                        content: result.result,
                    });
                }
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                openaiMessages.push({
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    })),
                });
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
                    ...msg.imageBlocks.map(img => ({
                        type: 'image_url' as const,
                        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                    })),
                    ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ];
                openaiMessages.push({ role: 'user', content: contentParts });
            } else if (msg.role !== 'system') {
                openaiMessages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content,
                });
            }
        }

        // Araçları dönüştür
        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = options?.tools?.map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters as Record<string, unknown>,
            },
        }));

        const response = await this.createChatCompletionWithToolFallback({
            model,
            messages: openaiMessages,
            tools: tools && tools.length > 0 ? tools : undefined,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            ...(options?.thinking ? { reasoning_split: true } : {}),
        }) as OpenAI.Chat.ChatCompletion;

        const choice = response.choices[0];
        if (!choice) {
            throw new LLMError('Minimax API boş yanıt döndürdü (choice yok)');
        }

        // Thinking içeriğini çıkar (reasoning_split: true ise reasoning_details alanında olur)
        let thinkingContent: string | undefined;
        if (options?.thinking) {
            const rawMsg = choice.message as { reasoning_details?: Array<{ text?: string }> };
            if (Array.isArray(rawMsg.reasoning_details) && rawMsg.reasoning_details.length > 0) {
                const joined = rawMsg.reasoning_details
                    .map((d) => d.text || '')
                    .join('');
                thinkingContent = joined || undefined;
            }
        }

        // <think> etiketlerini içerikten temizle (MiniMax reasoning content)
        let content = choice.message.content || '';
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // Kapatılmamış <think> etiketi kaldıysa (malformed response), onu da temizle
        content = content.replace(/<think>[\s\S]*/g, '').trim();

        const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
        }));

        let finishReason: LLMResponse['finishReason'] = 'stop';
        if (choice.finish_reason === 'tool_calls') finishReason = 'tool_calls';
        else if (choice.finish_reason === 'length') finishReason = 'length';

        return {
            content,
            toolCalls,
            thinkingContent,
            finishReason,
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined,
        };
    }

    async chatStream(messages: LLMMessage[], options: ChatOptions | undefined, onToken: (token: string) => void): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);
        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (options?.systemPrompt) openaiMessages.push({ role: 'system', content: options.systemPrompt });
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) openaiMessages.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.result });
            } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
                openaiMessages.push({
                    role: 'assistant', content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
                });
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
                    ...msg.imageBlocks.map(img => ({
                        type: 'image_url' as const,
                        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                    })),
                    ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ];
                openaiMessages.push({ role: 'user', content: contentParts });
            } else if (msg.role !== 'system') {
                openaiMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
            }
        }
        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = options?.tools?.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
        }));

        const stream = await this.createChatCompletionWithToolFallback({
            model, messages: openaiMessages,
            tools: tools?.length ? tools : undefined,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            stream: true,
            ...(options?.thinking ? { reasoning_split: true } : {}),
        }) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

        let content = '';
        let hasToolCalls = false;
        let tokensEmitted = false; // Token gönderilip gönderilmediğini takip et
        let streamThinkingContent = '';
        const toolCallsAccum = new Map<number, { id: string; name: string; argsStr: string }>();

        // Stateful <think> filtresi: etiketler farklı chunk'lara bölündüğünde de çalışır
        let thinkBuffer = '';
        let insideThink = false;

        const processChunkText = (text: string): string => {
            thinkBuffer += text;
            let output = '';
            while (true) {
                if (insideThink) {
                    const closeIdx = thinkBuffer.indexOf('</think>');
                    if (closeIdx !== -1) {
                        thinkBuffer = thinkBuffer.slice(closeIdx + '</think>'.length);
                        insideThink = false;
                    } else {
                        break; // </think> henüz gelmedi, bekle
                    }
                } else {
                    const openIdx = thinkBuffer.indexOf('<think>');
                    if (openIdx !== -1) {
                        output += thinkBuffer.slice(0, openIdx);
                        thinkBuffer = thinkBuffer.slice(openIdx + '<think>'.length);
                        insideThink = true;
                    } else {
                        // Sondaki kısmi '<think' tag'ini buffer'da tut
                        const partialIdx = thinkBuffer.lastIndexOf('<');
                        if (partialIdx !== -1 && partialIdx >= thinkBuffer.length - 7) {
                            const tail = thinkBuffer.slice(partialIdx);
                            if ('<think>'.startsWith(tail)) {
                                output += thinkBuffer.slice(0, partialIdx);
                                thinkBuffer = thinkBuffer.slice(partialIdx);
                            } else {
                                output += thinkBuffer;
                                thinkBuffer = '';
                            }
                        } else {
                            output += thinkBuffer;
                            thinkBuffer = '';
                        }
                        break;
                    }
                }
            }
            return output;
        };

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as MiniMaxDelta;
            if (!delta) continue;
            if (delta.content) {
                const filtered = processChunkText(delta.content);
                if (filtered) {
                    content += filtered;
                    if (!hasToolCalls) {
                        onToken(filtered);
                        tokensEmitted = true;
                    }
                }
            }
            // Düşünme içeriğini topla (reasoning_split: true ise reasoning_details alanında gelir)
            if (delta.reasoning_details) {
                for (const rd of delta.reasoning_details) {
                    if (rd.text) streamThinkingContent += rd.text;
                }
            }
            if (delta.tool_calls) {
                if (!hasToolCalls && tokensEmitted) {
                    // İlk tool call tespit edildi — önceden stream edilmiş metni temizle
                    onToken(TOOL_CALL_CLEAR_SIGNAL);
                }
                hasToolCalls = true;
                for (const tc of delta.tool_calls) {
                    if (!toolCallsAccum.has(tc.index)) toolCallsAccum.set(tc.index, { id: '', name: '', argsStr: '' });
                    const entry = toolCallsAccum.get(tc.index)!;
                    if (tc.id) entry.id = tc.id;
                    if (tc.function?.name) entry.name += tc.function.name;
                    if (tc.function?.arguments) entry.argsStr += tc.function.arguments;
                }
            }
        }

        // Stream bitti — buffer'da kalan içeriği flush et
        if (thinkBuffer) {
            if (!insideThink) {
                // Normal metin kaldı (kısmi tag kontrolünden dolayı bekletilmiş olabilir)
                content += thinkBuffer;
                if (!hasToolCalls) onToken(thinkBuffer);
            }
            // insideThink === true ise kapatılmamış <think> bloğu var, sessizce at
            thinkBuffer = '';
        }

        const toolCalls = hasToolCalls ? Array.from(toolCallsAccum.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: (() => { try { return JSON.parse(tc.argsStr || '{}'); } catch { return {}; } })() })) : undefined;

        return { content, thinkingContent: streamThinkingContent || undefined, toolCalls: toolCalls?.length ? toolCalls : undefined, finishReason: toolCalls?.length ? 'tool_calls' : 'stop' };
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.client.models.list();
            return true;
        } catch {
            return false;
        }
    }
}
