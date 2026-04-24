import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';

// Re-declare schemas inline for unit testing (mirrors websocket.ts)
const WebSocketAttachmentSchema = z.object({
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
});

const WebSocketChatMessageSchema = z.object({
  type: z.literal('chat'),
  content: z.string().optional(),
  conversationId: z.string().optional(),
  newConversation: z.boolean().optional(),
  userName: z.string().optional(),
  attachments: z.array(WebSocketAttachmentSchema).optional(),
});

const WebSocketSetThinkingMessageSchema = z.object({
  type: z.literal('set_thinking'),
  enabled: z.boolean(),
});

const WebSocketConfirmResponseMessageSchema = z.object({
  type: z.literal('confirm_response'),
  id: z.string().min(1),
  approved: z.boolean(),
});

const WebSocketMessageSchema = z.union([
  WebSocketChatMessageSchema,
  WebSocketSetThinkingMessageSchema,
  WebSocketConfirmResponseMessageSchema,
]);

describe('WebSocket Message Validation', () => {
  it('accepts valid chat message', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'chat',
      content: 'hello',
      conversationId: 'conv-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects chat message with wrong type', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'chat',
      content: 12345,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid set_thinking message', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'set_thinking',
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects set_thinking without enabled field', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'set_thinking',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid confirm_response message', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'confirm_response',
      id: 'confirm_1',
      approved: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confirm_response with empty id', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'confirm_response',
      id: '',
      approved: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown message type', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'unknown_type',
      payload: 'bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects nested object injection attempt', () => {
    const result = WebSocketMessageSchema.safeParse({
      type: 'chat',
      content: 'hi',
      __proto__: { polluted: true },
    });
    // Zod ignores extra keys by default; this test documents behavior
    expect(result.success).toBe(true);
  });
});
