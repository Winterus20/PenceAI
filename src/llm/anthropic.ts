import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

export class AnthropicProvider extends LLMProvider {
    readonly name = 'anthropic';
    readonly supportedModels = ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];

    private client: Anthropic;

    constructor() {
        super();
        const config = getConfig();
        if (!config.anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY ortam değişkeni ayarlanmamış');
        }
        this.client = new Anthropic({ apiKey: config.anthropicApiKey });
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

        return this.withTrace('chat', model, async () => {
            const response = await this.client.messages.create({
                model,
                max_tokens: options?.maxTokens || 4096,
                system: options?.systemPrompt,
                messages: anthropicMessages,
                tools: tools && tools.length > 0 ? tools : undefined,
                temperature: options?.temperature ?? 0.7,
            });

            // Yanıtı çözümle
            let content = '';
            const toolCalls: ToolCall[] = [];

            for (const block of response.content) {
                if (block.type === 'text') {
                    content += block.text;
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        name: block.name,
                        arguments: block.input as Record<string, unknown>,
                    });
                }
            }

            let finishReason: LLMResponse['finishReason'] = 'stop';
            if (response.stop_reason === 'tool_use') finishReason = 'tool_calls';
            else if (response.stop_reason === 'max_tokens') finishReason = 'length';

            return {
                content,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                finishReason,
                usage: {
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
                    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                },
            };
        });
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

        const stream = this.client.messages.stream({
            model, max_tokens: options?.maxTokens || 4096,
            system: options?.systemPrompt,
            messages: anthropicMessages,
            tools: tools?.length ? tools : undefined,
            temperature: options?.temperature ?? 0.7,
        });

        let content = '';
        let hasToolCalls = false;
        let tokensEmitted = false; // Token gönderilip gönderilmediğini takip et
        const toolCalls: ToolCall[] = [];
        let currentToolUse: { id: string; name: string; inputStr: string } | null = null;

        for await (const event of stream) {
            if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    if (!hasToolCalls && tokensEmitted) {
                        // İlk tool call tespit edildi — önceden stream edilmiş metni temizle
                        onToken(TOOL_CALL_CLEAR_SIGNAL);
                    }
                    hasToolCalls = true;
                    currentToolUse = { id: event.content_block.id, name: event.content_block.name, inputStr: '' };
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
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

        return { content, toolCalls: toolCalls.length ? toolCalls : undefined, finishReason: toolCalls.length ? 'tool_calls' : 'stop' };
    }

    async healthCheck(): Promise<boolean> {
        try {
            // API key geçerliliğini kontrol et — gerçek mesaj göndermeden
            // Boş mesaj göndererek 400 (geçerli key) vs 401 (geçersiz key) ayrımı yap
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': this.client.apiKey ?? '',
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 1,
                    messages: [],  // Boş mesaj → 400 Bad Request (token harcamaz)
                }),
            });
            // 400 = API key geçerli ama istek geçersiz (beklenen)
            // 401 = API key geçersiz
            return res.status !== 401 && res.status !== 403;
        } catch {
            return false;
        }
    }
}
