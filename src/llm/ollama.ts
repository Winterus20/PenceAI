import { LLMProvider, type ChatOptions, TOOL_CALL_CLEAR_SIGNAL } from './provider.js';
import type { LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { getConfig } from '../gateway/config.js';
import { randomUUID } from 'crypto';

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    images?: string[];  // base64-encoded images for vision models
    tool_calls?: Array<{
        function: { name: string; arguments: Record<string, unknown> };
    }>;
}

interface OllamaResponse {
    message: {
        role: string;
        content: string;
        tool_calls?: Array<{
            function: { name: string; arguments: Record<string, unknown> };
        }>;
    };
    done: boolean;
    total_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}

export class OllamaProvider extends LLMProvider {
    readonly name = 'ollama';
    readonly supportedModels = ['llama3.3', 'llama3.1', 'mistral', 'codellama', 'deepseek-r1', 'qwen2.5'];

    private baseUrl: string;

    constructor() {
        super();
        this.baseUrl = getConfig().ollamaBaseUrl;
    }

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);

        const ollamaMessages: OllamaMessage[] = [];

        if (options?.systemPrompt) {
            ollamaMessages.push({ role: 'system', content: options.systemPrompt });
        }

        for (const msg of messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    ollamaMessages.push({
                        role: 'tool',
                        content: result.result,
                    });
                }
            } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                ollamaMessages.push({
                    role: 'assistant',
                    content: msg.content,
                    tool_calls: msg.toolCalls.map(tc => ({
                        function: { name: tc.name, arguments: tc.arguments },
                    })),
                });
            } else if (msg.role !== 'system') {
                const omsg: OllamaMessage = { role: msg.role, content: msg.content };
                if (msg.imageBlocks && msg.imageBlocks.length > 0) {
                    omsg.images = msg.imageBlocks.map(img => img.data);
                }
                ollamaMessages.push(omsg);
            }
        }

        const body: Record<string, unknown> = {
            model,
            messages: ollamaMessages,
            stream: false,
            options: {
                temperature: options?.temperature ?? 0.7,
                num_predict: options?.maxTokens,
            },
        };

        // Ollama tool support (server'da --enable-auto-tool-choice flag'i gerektirir)
        // Eğer server tools desteklemiyorsa bu kod tools göndermez
        const config = getConfig();
        const enableOllamaTools = config.enableOllamaTools ?? false; // .env'de ENABLE_OLLAMA_TOOLS=true ekle
        
        if (enableOllamaTools && options?.tools && options.tools.length > 0) {
            body.tools = options.tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));
        }

        const res = await this.withTrace('chat', model, async () => {
            return await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        });

        if (!res.ok) {
            throw new Error(`Ollama hatası: ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as OllamaResponse;

        const toolCalls: ToolCall[] | undefined = data.message.tool_calls?.map((tc, i) => ({
            id: randomUUID(),
            name: tc.function.name,
            arguments: tc.function.arguments,
        }));

        return {
            content: data.message.content || '',
            toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
            finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
            usage: {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            },
        };
    }

    async chatStream(messages: LLMMessage[], options: ChatOptions | undefined, onToken: (token: string) => void): Promise<LLMResponse> {
        const model = this.resolveModel(options?.model);
        const ollamaMessages: OllamaMessage[] = [];
        if (options?.systemPrompt) ollamaMessages.push({ role: 'system', content: options.systemPrompt });
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) ollamaMessages.push({ role: 'tool', content: result.result });
            } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
                ollamaMessages.push({ role: 'assistant', content: msg.content, tool_calls: msg.toolCalls.map(tc => ({ function: { name: tc.name, arguments: tc.arguments } })) });
            } else if (msg.role !== 'system') {
                const omsg: OllamaMessage = { role: msg.role, content: msg.content };
                if (msg.imageBlocks && msg.imageBlocks.length > 0) {
                    omsg.images = msg.imageBlocks.map(img => img.data);
                }
                ollamaMessages.push(omsg);
            }
        }
        const body: Record<string, unknown> = {
            model, messages: ollamaMessages, stream: true,
            options: { temperature: options?.temperature ?? 0.7, num_predict: options?.maxTokens },
        };
        
        const config = getConfig();
        const enableOllamaTools = config.enableOllamaTools ?? false;
        if (enableOllamaTools && options?.tools?.length) {
            body.tools = options.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
        }

        const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Ollama hatası: ${res.status} ${res.statusText}`);

        let content = '';
        let hasToolCalls = false;
        let tokensEmitted = false; // Token gönderilip gönderilmediğini takip et
        const toolCallsCollected: ToolCall[] = [];
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line) as OllamaResponse;
                    if (data.message?.content) {
                        content += data.message.content;
                        if (!hasToolCalls) {
                            onToken(data.message.content);
                            tokensEmitted = true;
                        }
                    }
                    if (data.message?.tool_calls) {
                        if (!hasToolCalls && tokensEmitted) {
                            // İlk tool call tespit edildi — önceden stream edilmiş metni temizle
                            onToken(TOOL_CALL_CLEAR_SIGNAL);
                        }
                        hasToolCalls = true;
                        data.message.tool_calls.forEach((tc, i) => toolCallsCollected.push({ id: randomUUID(), name: tc.function.name, arguments: tc.function.arguments }));
                    }
                } catch { /* eksik JSON satırı, atla */ }
            }
        }

        return { content, toolCalls: toolCallsCollected.length ? toolCallsCollected : undefined, finishReason: toolCallsCollected.length ? 'tool_calls' : 'stop' };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`);
            return res.ok;
        } catch {
            return false;
        }
    }
}
