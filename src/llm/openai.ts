import OpenAI from 'openai';
import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

export class OpenAIProvider extends LLMProvider {
    readonly name: string = 'openai';
    readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];

    protected client: OpenAI;

    private isAutoToolChoiceUnsupported(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        return /auto tool choice requires .*enable-auto-tool-choice.*tool-call-parser|tool_choice.+auto|tool choice.+auto/i.test(error.message);
    }

    private async createChatCompletionWithToolFallback(reqOpts: any): Promise<any> {
        try {
            return await this.client.chat.completions.create(reqOpts);
        } catch (error) {
            if (!reqOpts?.tools?.length || !this.isAutoToolChoiceUnsupported(error)) {
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

        // Mesajları dönüştür
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

        const reqOpts: any = {
            model,
            messages: openaiMessages,
            tools: tools && tools.length > 0 ? tools : undefined,
            temperature: model.startsWith('o1') ? 1 : (options?.temperature ?? 0.7),
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }

        const response = await this.createChatCompletionWithToolFallback(reqOpts);

        const choice = response.choices[0];
        const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
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
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    openaiMessages.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.result });
                }
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

        const reqOpts: any = {
            model, messages: openaiMessages,
            tools: tools?.length ? tools : undefined,
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
        let tokensEmitted = false; // Token gönderilip gönderilmediğini takip et
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

        const toolCalls = hasToolCalls ? Array.from(toolCallsAccum.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: (() => { try { return JSON.parse(tc.argsStr || '{}'); } catch { return {}; } })() })) : undefined;

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
