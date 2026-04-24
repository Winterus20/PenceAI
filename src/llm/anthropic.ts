import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';
import { extractThinkingFromTags } from '../utils/thinkTags.js';
import { LLMError } from '../errors/LLMError.js';

/** Default request timeout (ms) for Anthropic API calls */
const ANTHROPIC_TIMEOUT_MS = 30_000;

export class AnthropicProvider extends LLMProvider {
    readonly name = 'anthropic';
    readonly supportedModels = ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];

    get supportsNativeToolCalling(): boolean { return true; }

    private client: Anthropic;

    constructor() {
        super();
        const config = getConfig();
        if (!config.anthropicApiKey) {
            throw new LLMError('ANTHROPIC_API_KEY ortam değişkeni ayarlanmamış');
        }
        this.client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: ANTHROPIC_TIMEOUT_MS });
    }

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);

        // Anthropic mesaj formatına dönüştür
        const anthropicMessages: Anthropic.MessageParam[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') continue; // System prompt ayrı alanda

            if (msg.role === 'tool' && msg.toolResults) {
                anthropicMessages.push({
                    role: 'user',
                    content: msg.toolResults.map(r => ({
                        type: 'tool_result' as const,
                        tool_use_id: r.toolCallId,
                        content: r.result,
                        is_error: r.isError,
                    })),
                });
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                const content: Anthropic.ContentBlockParam[] = [];
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                for (const tc of msg.toolCalls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.arguments,
                    });
                }
                anthropicMessages.push({ role: 'assistant', content });
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                // Multimodal: görsel + metin blokları
                const contentBlocks: Anthropic.ContentBlockParam[] = [
                    ...msg.imageBlocks.map(img => ({
                        type: 'image' as const,
                        source: {
                            type: 'base64' as const,
                            media_type: (img.mimeType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                            data: img.data,
                        },
                    })),
                    ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ];
                anthropicMessages.push({ role: 'user', content: contentBlocks });
            } else {
                anthropicMessages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content,
                });
            }
        }

        // Araçları dönüştür
        const tools: Anthropic.Tool[] | undefined = options?.tools?.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool['input_schema'],
        }));

        const isThinkingEnabled = !!options?.thinking;

        const baseParams: Record<string, unknown> = {
            model,
            max_tokens: options?.maxTokens || 4096,
            system: options?.systemPrompt,
            messages: anthropicMessages,
            tools: tools && tools.length > 0 ? tools : undefined,
        };

        if (isThinkingEnabled) {
            baseParams.thinking = { type: 'enabled', budget_tokens: options?.maxTokens ? Math.min(options.maxTokens, 10000) : 10000 };
        } else {
            baseParams.temperature = options?.temperature ?? 0.7;
        }

        const response = await this.client.messages.create(baseParams as unknown as Anthropic.MessageCreateParams) as Anthropic.Message;

        // Yanıtı çözümle
        let content = '';
        let thinkingContent: string | undefined;
        const toolCalls: ToolCall[] = [];

        for (const block of response.content) {
            if (block.type === 'thinking') {
                const blockText = (block as { thinking: string }).thinking || '';
                if (blockText) {
                    thinkingContent = thinkingContent ? thinkingContent + '\n\n' + blockText : blockText;
                }
            } else if (block.type === 'text') {
                content += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.input as Record<string, unknown>,
                });
            }
        }

        if (!thinkingContent && isThinkingEnabled) {
            const extracted = extractThinkingFromTags(content);
            if (extracted.thinking) {
                thinkingContent = extracted.thinking;
                content = extracted.cleanContent;
            }
        }

        let finishReason: LLMResponse['finishReason'] = 'stop';
        if (response.stop_reason === 'tool_use') finishReason = 'tool_calls';
        else if (response.stop_reason === 'max_tokens') finishReason = 'length';

        return {
            content,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            thinkingContent,
            finishReason,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    }

    async chatStream(messages: LLMMessage[], options: ChatOptions | undefined, onToken: (token: string) => void): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);
        const anthropicMessages: Anthropic.MessageParam[] = [];
        for (const msg of messages) {
            if (msg.role === 'system') continue;
            if (msg.role === 'tool' && msg.toolResults) {
                anthropicMessages.push({ role: 'user', content: msg.toolResults.map(r => ({ type: 'tool_result' as const, tool_use_id: r.toolCallId, content: r.result, is_error: r.isError })) });
            } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
                const content: Anthropic.ContentBlockParam[] = [];
                if (msg.content) content.push({ type: 'text', text: msg.content });
                for (const tc of msg.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
                anthropicMessages.push({ role: 'assistant', content });
            } else if (msg.role === 'user' && msg.imageBlocks && msg.imageBlocks.length > 0) {
                const contentBlocks: Anthropic.ContentBlockParam[] = [
                    ...msg.imageBlocks.map(img => ({
                        type: 'image' as const,
                        source: {
                            type: 'base64' as const,
                            media_type: (img.mimeType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                            data: img.data,
                        },
                    })),
                    ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ];
                anthropicMessages.push({ role: 'user', content: contentBlocks });
            } else {
                anthropicMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
            }
        }
        const tools: Anthropic.Tool[] | undefined = options?.tools?.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool['input_schema'] }));

        const isThinkingEnabled = !!options?.thinking;

        const streamParams: Record<string, unknown> = {
            model, max_tokens: options?.maxTokens || 4096,
            system: options?.systemPrompt,
            messages: anthropicMessages,
            tools: tools?.length ? tools : undefined,
        };

        if (isThinkingEnabled) {
            streamParams.thinking = { type: 'enabled', budget_tokens: options?.maxTokens ? Math.min(options.maxTokens, 10000) : 10000 };
        } else {
            streamParams.temperature = options?.temperature ?? 0.7;
        }

        const stream = this.client.messages.stream(streamParams as unknown as Anthropic.MessageCreateParams);

        let content = '';
        let thinkingContent = '';
        let hasToolCalls = false;
        let tokensEmitted = false;
        const toolCalls: ToolCall[] = [];
        let currentToolUse: { id: string; name: string; inputStr: string } | null = null;

        for await (const event of stream) {
            if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    if (!hasToolCalls && tokensEmitted) {
                        onToken(TOOL_CALL_CLEAR_SIGNAL);
                    }
                    hasToolCalls = true;
                    currentToolUse = { id: event.content_block.id, name: event.content_block.name, inputStr: '' };
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'thinking_delta') {
                    thinkingContent += (event.delta as { thinking: string }).thinking;
                } else if (event.delta.type === 'text_delta') {
                    content += event.delta.text;
                    if (!hasToolCalls) {
                        onToken(event.delta.text);
                        tokensEmitted = true;
                    }
                } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
                    currentToolUse.inputStr += event.delta.partial_json;
                }
            } else if (event.type === 'content_block_stop' && currentToolUse) {
                toolCalls.push({ id: currentToolUse.id, name: currentToolUse.name, arguments: (() => { try { return JSON.parse(currentToolUse!.inputStr || '{}'); } catch { return {}; } })() });
                currentToolUse = null;
            }
        }

        if (!thinkingContent && isThinkingEnabled) {
            const extracted = extractThinkingFromTags(content);
            if (extracted.thinking) {
                thinkingContent = extracted.thinking;
                content = extracted.cleanContent;
            }
        }

        return { content, thinkingContent: thinkingContent || undefined, toolCalls: toolCalls.length ? toolCalls : undefined, finishReason: toolCalls.length ? 'tool_calls' : 'stop' };
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.client.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 1,
                messages: [{ role: 'user', content: '.' }],
            });
            return true;
        } catch (err: unknown) {
            // 401 = gecersiz API key, 403 = yetkisiz
            // Diger hatalar (rate limit, network) false doner
            if (err instanceof Error && 'status' in err) {
                return (err as any).status !== 401 && (err as any).status !== 403;
            }
            return false;
        }
    }
}
