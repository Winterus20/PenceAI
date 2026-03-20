import OpenAI from 'openai';
import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

export class OpenAIProvider extends LLMProvider {
    readonly name: string = 'openai';
    readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];

    protected client: OpenAI;

    private isToolRelatedError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        // Geniş hata yakalama: tool_choice, auto-tool, tool not supported, invalid tool, vb.
        return /tool.?choice|auto.?tool|tool.?call.?parser|enable.?auto.?tool|tool.*not.*support|invalid.*tool|function.*call.*not|does not support.*function/i.test(error.message);
    }

    private async createChatCompletionWithToolFallback(reqOpts: any): Promise<any> {
        try {
            return await this.client.chat.completions.create(reqOpts);
        } catch (error) {
            if (!reqOpts?.tools?.length || !this.isToolRelatedError(error)) {
                throw error;
            }

            const fallbackReqOpts = {
                ...reqOpts,
                tools: undefined,
                tool_choice: undefined,
            };

            return await this.client.chat.completions.create(fallbackReqOpts);
        }
    }

    constructor(customBaseUrl?: string, customApiKey?: string) {
        super();
        const config = getConfig();
        const apiKey = customApiKey || config.openaiApiKey;
        if (!apiKey) {
            throw new Error(customApiKey ? 'API Key sağlanmadı (GitHub v.b)' : 'OPENAI_API_KEY ortam değişkeni ayarlanmamış');
        }
        this.client = new OpenAI({
            apiKey,
            baseURL: customBaseUrl
        });
    }

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);

        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        // Sistem prompt'u ekle
        if (options?.systemPrompt) {
            openaiMessages.push({ role: 'system', content: options.systemPrompt });
        }

        // --- STRICT ALTERNATING ROLES NORMALIZATION ---
        // Bazı modeller (özellikle NVIDIA Gemma/Llama) ardışık aynı rolleri veya 'tool' rollerini sevmez.
        const normalizedHistory: any[] = [];
        let currentRole: string | null = null;
        let currentContent = '';

        for (const msg of messages) {
            let roleToUse = msg.role;
            let contentToAdd = msg.content || '';

            // Tool response'larını user mesajı gibi yedir, model "ben ne sormuştum, sen ne dedin" anlasın
            if (msg.role === 'tool' && msg.toolResults) {
                roleToUse = 'user';
                contentToAdd = msg.toolResults.map(r => `[Araç Sonucu - ${r.toolCallId}]:\n${r.result}`).join('\n\n');
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                // Sadece metin içeren fallback tool call'lar yaptıysak asistan mesajı olarak kalmalı
                if (!contentToAdd) {
                    contentToAdd = `[Araç Kullanıldı: ${msg.toolCalls.map(tc => tc.name).join(', ')}]`;
                }
            }

            if (!contentToAdd.trim() && msg.role !== 'assistant') continue; // Boş içerikleri atla (asistan hariç, tool_call barındırabilir)
            
            if (roleToUse === currentRole && roleToUse !== 'system') {
                // Ardışık rolleri birleştir
                currentContent += '\n\n' + contentToAdd;
            } else {
                // Yeni rol, eskisini kaydet
                if (currentRole && currentRole !== 'system') {
                    // Önceki rol assistant ise ve biz de assistant ekliyorsak birleşirdi.
                    // Eğer şu an user ekliyorsak ve önceki sistemse, direkt ekle
                    normalizedHistory.push({ role: currentRole, content: currentContent, toolCalls: (normalizedHistory.length === 0 ? undefined : null) /* hack for preserving toolCalls later if needed */ });
                }
                currentRole = roleToUse;
                currentContent = contentToAdd;
            }
        }
        if (currentRole && currentRole !== 'system') {
            normalizedHistory.push({ role: currentRole, content: currentContent });
        }

        // Eğer ilk mesaj assistant ise onu user yaparız çünkü bazı modeller ilk mesajın user olmasını zorunlu kılar
        if (normalizedHistory.length > 0 && normalizedHistory[0].role === 'assistant') {
            normalizedHistory[0].role = 'user';
            normalizedHistory[0].content = `[Önceki Asistan Durumu]:\n${normalizedHistory[0].content}`;
            
            // Eğer bu değişiklik ardışık user mesajlarına sebep olduysa, birleştir (strict alternating roles ihlalini önlemek için)
            if (normalizedHistory.length > 1 && normalizedHistory[1].role === 'user') {
                normalizedHistory[1].content = normalizedHistory[0].content + '\n\n' + normalizedHistory[1].content;
                normalizedHistory.shift(); // ilk elemanı sil, zaten ikincisiyle birleşti
            }
        }

        // Strict mode: model adına göre — native tool calling desteklemeyen modeller
        // (gemma, llama, mistral) strict alternating roles formatı gerektirir.
        // Bu modeller için: strict mesaj formatı + tools kaldırılır (fallback parser devreye girer)
        // Diğer modeller (minimax, deepseek, qwen vb.): normal format + native tool calling
        const needsStrictMode = model.includes('gemma') || model.includes('llama') || model.includes('mistral');

        // Strict mode'da tools göndermiyoruz — API alternating roles ihlali verir
        const effectiveTools: OpenAI.Chat.ChatCompletionTool[] | undefined = needsStrictMode
            ? undefined
            : options?.tools?.map(t => ({
                type: 'function' as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as Record<string, unknown>,
                },
            }));

        const finalMessages = needsStrictMode ? normalizedHistory : messages;

        for (const msg of finalMessages) {
            // Strict mode'da msg artık sadece {role, content} içeriyor (asistan tool call string halinde)
            if (needsStrictMode) {
                 openaiMessages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content,
                });
                continue;
            }

            // Normal provider (OpenAI orijinal mantık)
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
                    tool_calls: msg.toolCalls.map((tc: ToolCall) => ({
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
                    ...msg.imageBlocks.map((img: { mimeType: string; data: string; fileName?: string }) => ({
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

        const reqOpts: any = {
            model,
            messages: openaiMessages,
            tools: effectiveTools?.length ? effectiveTools : undefined,
            temperature: model.startsWith('o1') ? 1 : (options?.temperature ?? 0.7),
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }

        const response = await this.createChatCompletionWithToolFallback(reqOpts);

        const choice = response.choices[0];
        const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc: OpenAI.Chat.ChatCompletionMessageToolCall) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
        }));

        let finishReason: LLMResponse['finishReason'] = 'stop';
        if (choice.finish_reason === 'tool_calls') finishReason = 'tool_calls';
        else if (choice.finish_reason === 'length') finishReason = 'length';

        return {
            content: choice.message.content || '',
            toolCalls,
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
        if (options?.systemPrompt) {
            openaiMessages.push({ role: 'system', content: options.systemPrompt });
        }

        // --- STRICT ALTERNATING ROLES NORMALIZATION ---
        const normalizedHistory: any[] = [];
        let currentRole: string | null = null;
        let currentContent = '';

        for (const msg of messages) {
            let roleToUse = msg.role;
            let contentToAdd = msg.content || '';

            if (msg.role === 'tool' && msg.toolResults) {
                roleToUse = 'user';
                contentToAdd = msg.toolResults.map(r => `[Araç Sonucu - ${r.toolCallId}]:\n${r.result}`).join('\n\n');
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                if (!contentToAdd) {
                    contentToAdd = `[Araç Kullanıldı: ${msg.toolCalls.map(tc => tc.name).join(', ')}]`;
                }
            }

            if (!contentToAdd.trim() && msg.role !== 'assistant') continue;
            
            if (roleToUse === currentRole && roleToUse !== 'system') {
                currentContent += '\n\n' + contentToAdd;
            } else {
                if (currentRole && currentRole !== 'system') {
                    normalizedHistory.push({ role: currentRole, content: currentContent });
                }
                currentRole = roleToUse;
                currentContent = contentToAdd;
            }
        }
        if (currentRole && currentRole !== 'system') {
            normalizedHistory.push({ role: currentRole, content: currentContent });
        }

        if (normalizedHistory.length > 0 && normalizedHistory[0].role === 'assistant') {
            normalizedHistory[0].role = 'user';
            normalizedHistory[0].content = `[Önceki Asistan Durumu]:\n${normalizedHistory[0].content}`;

            if (normalizedHistory.length > 1 && normalizedHistory[1].role === 'user') {
                normalizedHistory[1].content = normalizedHistory[0].content + '\n\n' + normalizedHistory[1].content;
                normalizedHistory.shift();
            }
        }

        const needsStrictMode = model.includes('gemma') || model.includes('llama') || model.includes('mistral');

        const effectiveTools: OpenAI.Chat.ChatCompletionTool[] | undefined = needsStrictMode
            ? undefined
            : options?.tools?.map(t => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
            }));

        const finalMessages = needsStrictMode ? normalizedHistory : messages;

        for (const msg of finalMessages) {
            if (needsStrictMode) {
                 openaiMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
                 continue;
            }

            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    openaiMessages.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.result });
                }
            } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
                openaiMessages.push({
                    role: 'assistant', content: msg.content || null,
                    tool_calls: msg.toolCalls.map((tc: ToolCall) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
                });
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
                    ...msg.imageBlocks.map((img: { mimeType: string; data: string; fileName?: string }) => ({
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

        const reqOpts: any = {
            model, messages: openaiMessages,
            tools: effectiveTools?.length ? effectiveTools : undefined,
            temperature: model.startsWith('o1') ? 1 : (options?.temperature ?? 0.7),
            stream: true,
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }

        const stream = await this.createChatCompletionWithToolFallback(reqOpts) as any;

        let content = '';
        let hasToolCalls = false;
        let tokensEmitted = false;
        const toolCallsAccum = new Map<number, { id: string; name: string; argsStr: string }>();

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
                content += delta.content;
                if (!hasToolCalls) {
                    onToken(delta.content);
                    tokensEmitted = true;
                }
            }
            if (delta.tool_calls) {
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

        const toolCalls = hasToolCalls ? Array.from(toolCallsAccum.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]: [number, any]) => ({ id: tc.id, name: tc.name, arguments: (() => { try { return JSON.parse(tc.argsStr || '{}'); } catch { return {}; } })() })) : undefined;

        return { content, toolCalls: toolCalls?.length ? toolCalls : undefined, finishReason: toolCalls?.length ? 'tool_calls' : 'stop' };
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
