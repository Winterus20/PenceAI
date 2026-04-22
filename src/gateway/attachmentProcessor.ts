/**
 * WebSocket ek dosya işleme — metin, görsel ve binary attachment'ları parse eder.
 */

import { logger } from '../utils/logger.js';
import type { Attachment } from '../router/types.js';

export interface WebSocketAttachment {
    mimeType?: string;
    fileName?: string;
    size?: number;
    data?: string;
}

export interface ProcessedAttachments {
    enrichedContent: string;
    builtAttachments: Attachment[];
}

export const ATTACHMENT_CONFIG = {
    maxAttachmentBase64Size: 10 * 1024 * 1024, // 10 MB
    maxTextFileLength: 20000,
} as const;

const TEXT_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css',
    'text/javascript', 'text/typescript', 'application/json', 'application/xml',
    'application/javascript', 'application/typescript',
]);

/** Yüklenmesi engellenen tehlikeli dosya uzantıları */
const BLOCKED_EXTENSIONS = new Set([
    '.exe', '.bat', '.cmd', '.sh', '.php', '.ps1', '.vbs', '.jar',
    '.com', '.scr', '.msi', '.dll', '.bin',
]);

function isTextFile(mimeType: string, fileName: string): boolean {
    return (
        TEXT_MIMES.has(mimeType) ||
        mimeType.startsWith('text/') ||
        /\.(txt|md|json|csv|xml|html|htm|css|js|ts|jsx|tsx|py|rb|java|c|cpp|h|hpp|cs|go|rs|sh|yaml|yml|toml|ini|cfg|conf|env|log|sql)$/i.test(fileName || '')
    );
}

function hasBlockedExtension(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    for (const ext of BLOCKED_EXTENSIONS) {
        if (lower.endsWith(ext)) return true;
    }
    return false;
}

/**
 * WebSocket ek dosyalarını parse eder ve mesaj içeriğine entegre eder.
 */
export function processAttachments(
    content: string | undefined,
    attachments: WebSocketAttachment[],
): ProcessedAttachments {
    let enrichedContent = content ?? '';
    const builtAttachments: Attachment[] = [];

    for (const att of attachments) {
        const mime = att.mimeType || 'application/octet-stream';
        const name = att.fileName || 'dosya';

        // Tehlikeli dosya uzantısı kontrolü
        if (hasBlockedExtension(name)) {
            logger.warn(`[Attachment] ⛔ Tehlikeli dosya uzantısı engellendi: ${name}`);
            enrichedContent += `\n\n[Dosya engellendi: ${name} — güvenlik nedeniyle işlenemedi]`;
            continue;
        }

        if (att.data && typeof att.data === 'string' && att.data.length > ATTACHMENT_CONFIG.maxAttachmentBase64Size) {
            logger.warn(`[Attachment] ⚠️ Dosya çok büyük, atlandı: ${name} (${(att.data.length / 1024 / 1024).toFixed(1)} MB base64)`);
            enrichedContent += `\n\n[Dosya çok büyük ve işlenemedi: ${name} (${mime})]`;
            continue;
        }

        if (att.data && isTextFile(mime, name)) {
            let text: string;
            try {
                text = Buffer.from(att.data as string, 'base64').toString('utf-8');
            } catch {
                text = '(içerik okunamadı)';
            }
            const truncated = text.length > ATTACHMENT_CONFIG.maxTextFileLength
                ? text.substring(0, ATTACHMENT_CONFIG.maxTextFileLength) + '\n...(dosya uzun, kısaltıldı)'
                : text;
            const lang = name.split('.').pop() || '';
            enrichedContent += `\n\n---\n**[Dosya: ${name}]**\n\`\`\`${lang}\n${truncated}\n\`\`\``;
            logger.info(`[Attachment] 📄 Metin dosyası eklendi: ${name} (${text.length} karakter)`);
        } else if (mime.startsWith('image/') && att.data) {
            let imgBuffer: Buffer;
            try {
                imgBuffer = Buffer.from(att.data as string, 'base64');
            } catch {
                imgBuffer = Buffer.alloc(0);
            }
            builtAttachments.push({
                type: 'image',
                mimeType: mime,
                fileName: name,
                size: att.size,
                data: imgBuffer,
            });
            enrichedContent += enrichedContent.trim() ? '' : '(Aşağıdaki görseli analiz et)';
            logger.info(`[Attachment] 🖼️ Görsel eklendi: ${name} (${mime}, ${imgBuffer.length} byte)`);
        } else {
            builtAttachments.push({
                type: mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document',
                mimeType: mime,
                fileName: name,
                size: att.size,
            });
            enrichedContent += `\n\n[Kullanıcı bir dosya ekledi: ${name} (${mime})]`;
            logger.info(`[Attachment] 📎 Binary dosya eklendi: ${name} (${mime})`);
        }
    }

    return { enrichedContent, builtAttachments };
}
