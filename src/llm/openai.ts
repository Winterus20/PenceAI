import OpenAI from 'openai';
import { LLMProvider, type ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall, LLMToolDefinition } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

interface NormalizedMessage {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCall[];
}

/**
 * OpenAI mesajlarini normalize eder — ardisik rolleri birlestirir,
 * tool response'larini user'a cevirir, strict alternating roles saglar.
 */
function normalizeOpenAIMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
    model?: string,
    tools?: LLMToolDefinition[],
): { messages: OpenAI.Chat.ChatCompletionMessageParam[]; effectiveTools: OpenAI.Chat.ChatCompletionTool[] | undefined } {
    const needsStrictMode = model ? (model.includes('gemma') || model.includes('llama') || model.includes('mistral')) : false;

    // --- Strict mode normalization ---
    if (needsStrictMode) {
        const normalized: NormalizedMessage[] = [];
        let currentRole: string | null = null;
        let currentContent = '';
        let currentToolCalls: ToolCall[] | undefined;

        for (const msg of messages) {
            let roleToUse = msg.role;
            let contentToAdd = msg.content || '';
            let toolCallsToAdd: ToolCall[] | undefined;

            if (msg.role === 'tool' && msg.toolResults) {
                roleToUse = 'user';
                contentToAdd = msg.toolResults.map(r => `[Araç Sonucu - ${r.toolCallId}]:\n${r.result}`).join('\n\n');
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                if (!contentToAdd) {
                    contentToAdd = `[Araç Kullanıldı: ${msg.toolCalls.map(tc => tc.name).join(', ')}]`;
                }
                toolCallsToAdd = msg.toolCalls;
            }

            if (!contentToAdd.trim() && msg.role !== 'assistant') continue;

            if (roleToUse === currentRole && roleToUse !== 'system') {
                currentContent += '\n\n' + contentToAdd;
            } else {
                if (currentRole && currentRole !== 'system') {
                    normalized.push({ role: currentRole as 'user' | 'assistant', content: currentContent, toolCalls: currentToolCalls });
                }
                currentRole = roleToUse;
                currentContent = contentToAdd;
                currentToolCalls = toolCallsToAdd;
            }
        }
        if (currentRole && currentRole !== 'system') {
            normalized.push({ role: currentRole as 'user' | 'assistant', content: currentContent, toolCalls: currentToolCalls });
        }

        // Ilk mesaj assistant ise user'a cevir
        if (normalized.length > 0 && normalized[0].role === 'assistant') {
            normalized[0].role = 'user';
            normalized[0].content = `[Önceki Asistan Durumu]:\n${normalized[0].content}`;
            if (normalized.length > 1 && normalized[1].role === 'user') {
                normalized[1].content = normalized[0].content + '\n\n' + normalized[1].content;
                normalized.shift();
            }
        }

        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = normalized.map(msg => ({
            role: msg.role,
            content: msg.content,
            ...(msg.role === 'assistant' && msg.toolCalls ? {
                tool_calls: msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
            } : {}),
        }));

        return { messages: openaiMessages, effectiveTools: undefined };
    }

    // --- Normal mode: OpenAI native tool calling ---
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
        openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
        if (msg.role === 'tool' && msg.toolResults) {
            for (const result of msg.toolResults) {
                openaiMessages.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.result });
            }
        } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
            openaiMessages.push({
                role: 'assistant',
                content: msg.content || null,
                tool_calls: msg.toolCalls.map(tc => ({
                    id: tc.id, type: 'function' as const,
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
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
            openaiMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
        }
    }

    const effectiveTools = tools?.map(t => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
    }));

    return { messages: openaiMessages, effectiveTools };
}

export class OpenAIProvider extends LLMProvider {
    readonly name: string = 'openai';
    readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];

    protected client: OpenAI;
    private toolsDisabled = false;

    private isToolRelatedError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        // Geniş hata yakalama: tool_choice, auto-tool, tool not supported, invalid tool, vb.
        return /tool.?choice|auto.?tool|tool.?call.?parser|enable.?auto.?tool|tool.*not.*support|invalid.*tool|function.*call.*not|does not support.*function/i.test(error.message);
    }

    private async createChatCompletionWithToolFallback(reqOpts: OpenAI.Chat.ChatCompletionCreateParams): Promise<OpenAI.Chat.ChatCompletion> {
        if (this.toolsDisabled) {
            const { tools: _, tool_choice: __, ...noToolsReqOpts } = reqOpts;
            return await this.client.chat.completions.create(noToolsReqOpts) as OpenAI.Chat.ChatCompletion;
        }
        try {
            return await this.client.chat.completions.create(reqOpts) as OpenAI.Chat.ChatCompletion;
        } catch (error) {
            if (reqOpts.tools && reqOpts.tools.length > 0 && this.isToolRelatedError(error)) {
                this.toolsDisabled = true;
                const { tools: _, tool_choice: __, ...fallbackReqOpts } = reqOpts;
                return await this.client.chat.completions.create(fallbackReqOpts) as OpenAI.Chat.ChatCompletion;
            }
            throw error;
        }
    }

    private async createChatCompletionWithToolFallbackStream(reqOpts: OpenAI.Chat.ChatCompletionCreateParamsStreaming): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
        if (this.toolsDisabled) {
            const { tools: _, tool_choice: __, ...noToolsReqOpts } = reqOpts;
            reqOpts = noToolsReqOpts;
        }
        try {
            return await this.client.chat.completions.create(reqOpts) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
        } catch (error) {
            if (!this.toolsDisabled && reqOpts?.tools && reqOpts.tools.length > 0 && this.isToolRelatedError(error)) {
                this.toolsDisabled = true;
                const { tools: _, tool_choice: __, ...fallbackReqOpts } = reqOpts;
                return await this.client.chat.completions.create(fallbackReqOpts) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
            }
            throw error;
        }
    }

    constructor(customBaseUrl?: string, customApiKey?: string) {
        super();
        const config = getConfig();
        const apiKey = customApiKey || config.openaiApiKey;
        if (!apiKey) {
            throw new Error(customApiKey ? 'API Key sağlanmadı (GitHub v.b)' : 'OPENAI_API_KEY ortam değişkeni ayarlanmamış');
        }
        const baseClient = new OpenAI({
            apiKey,
            baseURL: customBaseUrl,
            timeout: 45000, // 45 saniye timeout - NVIDIA/OpenAI API için makul limit (önceden 120s)
            maxRetries: 1,   // Network hatalarında 1 retry (önceden 2 - gereksiz gecikmeyi önler)
        });

        this.client = baseClient;
    }

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);

        const { messages: openaiMessages, effectiveTools } = normalizeOpenAIMessages(
            messages, options?.systemPrompt, model, options?.tools,
        );

        const reqOpts: OpenAI.Chat.ChatCompletionCreateParams = {
            model, messages: openaiMessages,
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
        const { messages: openaiMessages, effectiveTools } = normalizeOpenAIMessages(
            messages, options?.systemPrompt, model, options?.tools,
        );

        const reqOpts: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
            model, messages: openaiMessages,
            tools: effectiveTools?.length ? effectiveTools : undefined,
            temperature: model.startsWith('o1') ? 1 : (options?.temperature ?? 0.7),
            stream: true,
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }

        const stream = await this.createChatCompletionWithToolFallbackStream(reqOpts);

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
