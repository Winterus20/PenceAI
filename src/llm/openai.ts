import OpenAI from 'openai';
import { LLMProvider, type ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall, LLMToolDefinition, ImageBlock } from '../router/types.js';
import { getConfig } from '../gateway/config.js';
import { extractThinkingFromTags } from '../utils/thinkTags.js';
import { logger } from '../utils/logger.js';
import { LLMError } from '../errors/LLMError.js';

interface NormalizedMessage {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCall[];
    imageBlocks?: ImageBlock[];
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
        let currentImageBlocks: ImageBlock[] | undefined;

        for (const msg of messages) {
            let roleToUse = msg.role;
            let contentToAdd = msg.content || '';
            let toolCallsToAdd: ToolCall[] | undefined;
            let imageBlocksToAdd: ImageBlock[] | undefined;

            if (msg.role === 'tool' && msg.toolResults) {
                roleToUse = 'user';
                contentToAdd = msg.toolResults.map(r => `[Araç Sonucu - ${r.toolCallId}]:\n${r.result}`).join('\n\n');
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                if (!contentToAdd) {
                    contentToAdd = `[Araç Kullanıldı: ${msg.toolCalls.map(tc => tc.name).join(', ')}]`;
                }
                toolCallsToAdd = msg.toolCalls;
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                imageBlocksToAdd = msg.imageBlocks;
            }

            if (!contentToAdd.trim() && msg.role !== 'assistant' && !imageBlocksToAdd) continue;

            if (roleToUse === currentRole && roleToUse !== 'system') {
                currentContent += '\n\n' + contentToAdd;
                if (imageBlocksToAdd) {
                    currentImageBlocks = [...(currentImageBlocks ?? []), ...imageBlocksToAdd];
                }
            } else {
                if (currentRole && currentRole !== 'system') {
                    normalized.push({ role: currentRole as 'user' | 'assistant', content: currentContent, toolCalls: currentToolCalls, imageBlocks: currentImageBlocks });
                }
                currentRole = roleToUse;
                currentContent = contentToAdd;
                currentToolCalls = toolCallsToAdd;
                currentImageBlocks = imageBlocksToAdd;
            }
        }
        if (currentRole && currentRole !== 'system') {
            normalized.push({ role: currentRole as 'user' | 'assistant', content: currentContent, toolCalls: currentToolCalls, imageBlocks: currentImageBlocks });
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

        // Strict mode'da system rolü kullanılmadığı için sistem talimatını
        // ilk user mesajına enjekte et; aksi halde model kendi varsayılan
        // kimliğine dönebilir ve araç talimatlarını görmez.
        const trimmedSystemPrompt = systemPrompt?.trim();
        if (trimmedSystemPrompt) {
            const systemEnvelope = `[Sistem Talimatlari - MUTLAK UY]\n${trimmedSystemPrompt}\n[/Sistem Talimatlari]`;
            if (normalized.length === 0) {
                normalized.push({ role: 'user', content: systemEnvelope });
            } else if (normalized[0].role === 'user') {
                normalized[0].content = `${systemEnvelope}\n\n${normalized[0].content}`;
            } else {
                normalized.unshift({ role: 'user', content: systemEnvelope });
            }
        }

        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = normalized.map(msg => {
            if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
                    ...msg.imageBlocks.map(img => ({
                        type: 'image_url' as const,
                        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                    })),
                    ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ];
                const userMsg: OpenAI.Chat.ChatCompletionUserMessageParam = { role: 'user', content: contentParts };
                return userMsg;
            }

            if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    })),
                };
                return assistantMsg;
            }

            const textMsg: OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                role: msg.role,
                content: msg.content,
            };
            return textMsg;
        });

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

    get supportsNativeToolCalling(): boolean {
        const config = getConfig();
        const model = config.defaultLLMModel || this.defaultModel;
        const currentModel = model.toLowerCase();
        // Strict modeller için fallback gerekiyor
        return !(currentModel.includes('gemma') || currentModel.includes('llama') || currentModel.includes('mistral'));
    }

    protected client: OpenAI;

    // Circuit breaker: geçici tool disable — transient error sonrası otomatik kurtarma
    private toolsCircuitOpen = false;
    private toolsCircuitOpenSince = 0;
    private static readonly CIRCUIT_HALF_OPEN_MS = 30_000; // 30s sonra retry denemesi
    private static readonly CIRCUIT_MAX_FAILURES = 3;       // arka arkaya bu kadar hata → circuit open
    private toolsConsecutiveFailures = 0;

    private isToolRelatedError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        // Geniş hata yakalama: tool_choice, auto-tool, tool not supported, invalid tool, vb.
        return /tool.?choice|auto.?tool|tool.?call.?parser|enable.?auto.?tool|tool.*not.*support|invalid.*tool|function.*call.*not|does not support.*function/i.test(error.message);
    }

    /** Circuit breaker durumunu kontrol et — half-open ise retry'a izin ver */
    private isToolsCircuitOpen(): boolean {
        if (!this.toolsCircuitOpen) return false;
        // Half-open: belirli süre sonra tek bir retry'a izin ver
        const elapsed = Date.now() - this.toolsCircuitOpenSince;
        if (elapsed >= OpenAIProvider.CIRCUIT_HALF_OPEN_MS) {
            logger.info('[OpenAI] Circuit half-open — retrying tool calls');
            return false; // retry'a izin ver
        }
        return true; // hala open — tools yok
    }

    /** Tool-related hatası sonrası circuit breaker'ı güncelle */
    private onToolError(): void {
        this.toolsConsecutiveFailures++;
        if (this.toolsConsecutiveFailures >= OpenAIProvider.CIRCUIT_MAX_FAILURES) {
            this.toolsCircuitOpen = true;
            this.toolsCircuitOpenSince = Date.now();
            logger.warn(`[OpenAI] Circuit OPEN — tool calls disabled for ${OpenAIProvider.CIRCUIT_HALF_OPEN_MS / 1000}s (${this.toolsConsecutiveFailures} consecutive failures)`);
        } else {
            logger.debug(`[OpenAI] Tool failure ${this.toolsConsecutiveFailures}/${OpenAIProvider.CIRCUIT_MAX_FAILURES}`);
        }
    }

    /** Başarılı tool call sonrası circuit breaker'ı sıfırla */
    private onToolSuccess(): void {
        if (this.toolsConsecutiveFailures > 0 || this.toolsCircuitOpen) {
            logger.info('[OpenAI] Circuit CLOSED — tool calls re-enabled after successful call');
        }
        this.toolsConsecutiveFailures = 0;
        this.toolsCircuitOpen = false;
    }

    private async createChatCompletionWithToolFallback(reqOpts: OpenAI.Chat.ChatCompletionCreateParams): Promise<OpenAI.Chat.ChatCompletion> {
        if (this.isToolsCircuitOpen()) {
            const { tools: _, tool_choice: __, ...noToolsReqOpts } = reqOpts;
            return await this.client.chat.completions.create(noToolsReqOpts) as OpenAI.Chat.ChatCompletion;
        }
        try {
            const result = await this.client.chat.completions.create(reqOpts) as OpenAI.Chat.ChatCompletion;
            // Başarılı call — eğer tool kullanıldıysa circuit'i sıfırla
            if (reqOpts.tools && reqOpts.tools.length > 0) {
                this.onToolSuccess();
            }
            return result;
        } catch (error) {
            if (reqOpts.tools && reqOpts.tools.length > 0 && this.isToolRelatedError(error)) {
                this.onToolError();
                const { tools: _, tool_choice: __, ...fallbackReqOpts } = reqOpts;
                return await this.client.chat.completions.create(fallbackReqOpts) as OpenAI.Chat.ChatCompletion;
            }
            throw error;
        }
    }

    private async createChatCompletionWithToolFallbackStream(reqOpts: OpenAI.Chat.ChatCompletionCreateParamsStreaming): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
        if (this.isToolsCircuitOpen()) {
            const { tools: _, tool_choice: __, ...noToolsReqOpts } = reqOpts;
            reqOpts = noToolsReqOpts;
        }
        try {
            const result = await this.client.chat.completions.create(reqOpts) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
            // Note: onToolSuccess() çağrısı stream başlangıcında yapılır.
            // Tool-support hataları create() anında surface olur, stream consumption
            // sırasında tool hatası oluşmaz — bu nedenle erken çağrı güvenlidir.
            if (reqOpts?.tools && reqOpts.tools.length > 0) {
                this.onToolSuccess();
            }
            return result;
        } catch (error) {
            if (!this.isToolsCircuitOpen() && reqOpts?.tools && reqOpts.tools.length > 0 && this.isToolRelatedError(error)) {
                this.onToolError();
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
            throw new LLMError(customApiKey ? 'API Key sağlanmadı (GitHub v.b)' : 'OPENAI_API_KEY ortam değişkeni ayarlanmamış');
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
            temperature: model.startsWith('o1') || model.startsWith('o3') ? 1 : (options?.temperature ?? 0.7),
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1') || model.startsWith('o3')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }
        if (options?.thinking && (model.startsWith('o1') || model.startsWith('o3'))) {
            (reqOpts as unknown as Record<string, unknown>).reasoning_effort = 'high';
        }

        const response = await this.createChatCompletionWithToolFallback(reqOpts);

        const choice = response.choices[0];
        const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc: OpenAI.Chat.ChatCompletionMessageToolCall) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
        }));

        let content = choice.message.content || '';
        let thinkingContent: string | undefined;

        if (options?.thinking) {
            const extracted = extractThinkingFromTags(content);
            if (extracted.thinking) {
                thinkingContent = extracted.thinking;
                content = extracted.cleanContent;
            }
        }

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
        const { messages: openaiMessages, effectiveTools } = normalizeOpenAIMessages(
            messages, options?.systemPrompt, model, options?.tools,
        );

        const reqOpts: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
            model, messages: openaiMessages,
            tools: effectiveTools?.length ? effectiveTools : undefined,
            temperature: model.startsWith('o1') || model.startsWith('o3') ? 1 : (options?.temperature ?? 0.7),
            stream: true,
        };
        if (options?.maxTokens) {
            if (model.startsWith('o1') || model.startsWith('o3')) reqOpts.max_completion_tokens = options.maxTokens;
            else reqOpts.max_tokens = options.maxTokens;
        }
        if (options?.thinking && (model.startsWith('o1') || model.startsWith('o3'))) {
            (reqOpts as unknown as Record<string, unknown>).reasoning_effort = 'high';
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
            .map(([, tc]: [number, { id: string; name: string; argsStr: string }]) => ({ id: tc.id, name: tc.name, arguments: (() => { try { return JSON.parse(tc.argsStr || '{}'); } catch { return {}; } })() })) : undefined;

        let thinkingContent: string | undefined;
        if (options?.thinking) {
            const extracted = extractThinkingFromTags(content);
            if (extracted.thinking) {
                thinkingContent = extracted.thinking;
                content = extracted.cleanContent;
            }
        }

        return { content, thinkingContent, toolCalls: toolCalls?.length ? toolCalls : undefined, finishReason: toolCalls?.length ? 'tool_calls' : 'stop' };
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
