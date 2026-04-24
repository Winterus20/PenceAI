import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Timestamp'i ISO 8601 formatına normalize eder
 * @param value - Timestamp string (opsiyonel)
 * @returns ISO 8601 formatında timestamp string
 */
export function normalizeTimestamp(value?: string): string {
  if (!value) return new Date().toISOString();
  if (value.endsWith('Z')) return value;
  return value.includes('T') ? `${value}Z` : value.replace(' ', 'T') + 'Z';
}

/**
 * Byte cinsinden dosya boyutunu okunabilir formata dönüştürür
 * @param bytes - Dosya boyutu (byte cinsinden, opsiyonel)
 * @returns Formatlanmış dosya boyutu string'i (örn: "1.5 MB")
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * <think> etiketlerini ve içeriklerini temizler
 */
export function stripThinkTags(text?: string): string {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

/**
 * Eğer tüm yanıt gereksiz bir markdown kod bloğu içine alınmışsa veya LLM backtick'ten sonra newline koymayı unutmuşsa dıştaki bloğu temizler.
 */
export function stripOuterBackticks(text: string): string {
  if (!text) return '';
  let current = text.trim();
  
  // Matches: ```[info]\n[content]\n```
  const regex = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1$/;
  let match = current.match(regex);
  
  while (match) {
    const infoString = match[2];
    const content = match[3];
    
    const lowerInfo = infoString.trim().toLowerCase();
    const isMarkdown = lowerInfo === 'markdown' || lowerInfo === 'md' || lowerInfo === 'text';
    const hasSpaces = infoString.includes(' ');
    
    // Eğer dil belirtilmemişse ve içerik belirgin bir şekilde markdown (liste, başlık vb.) içeriyorsa
    const isNamelessMarkdown = lowerInfo === '' && /^(\s*[-*#]\s|\s*\d+\.\s|\[.*?\]\(.*?\))/m.test(content);
    
    if (isMarkdown || hasSpaces || isNamelessMarkdown) {
      if (hasSpaces && !isMarkdown) {
          // LLM newline koymayı unutmuş, ilk cümle info string yerine yazılmış
          current = infoString.trim() + '\n\n' + content.trim();
      } else {
          current = content.trim();
      }
      match = current.match(regex);
    } else {
      break;
    }
  }
  
  return current;
}

/**
 * Timestamp'i saat:dakika formatında döndürür
 */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Timestamp'i göreli zaman olarak döndürür ("az önce", "2 dk", "dün 14:30")
 */
export function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) return '';
  const date = new Date(normalizeTimestamp(timestamp));
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'az önce';
  if (diffMin < 60) return `${diffMin} dk`;
  if (diffHour < 24 && date.toDateString() === now.toDateString()) {
    return `${diffHour} sa`;
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `dün ${date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (diffDay < 7) return `${diffDay} gün`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}
