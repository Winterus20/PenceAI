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
