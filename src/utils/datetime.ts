/**
 * Tarih/saat yardımcı fonksiyonları.
 * SQLite CURRENT_TIMESTAMP çıktısını ISO 8601'e dönüştürme gibi
 * sıkça kullanılan işlemleri merkezileştirir.
 */

/**
 * SQLite CURRENT_TIMESTAMP çıktısını ("YYYY-MM-DD HH:MM:SS") güvenli
 * bir şekilde ISO 8601 formatına dönüştürür.
 *
 * Eğer string zaten 'Z' ile bitiyorsa olduğu gibi döner.
 * Aksi halde boşluğu 'T' ile değiştirir ve sonuna 'Z' ekler.
 *
 * @param raw — SQLite timestamp string'i veya ISO 8601 string
 * @returns ISO 8601 formatında string (UTC)
 */
export function normalizeSqliteDate(raw: string): string {
    if (raw.endsWith('Z')) return raw;
    return raw.replace(' ', 'T') + 'Z';
}

/**
 * SQLite timestamp string'inden bu yana geçen gün sayısını hesaplar.
 *
 * @param raw — SQLite timestamp veya ISO 8601 string
 * @param nowMs — referans zaman damgası (ms, varsayılan: Date.now())
 * @returns Gün cinsinden geçen süre (negatif değer dönmez)
 */
export function daysSince(raw: string | null | undefined, nowMs: number = Date.now()): number {
    if (!raw) return 0;
    const isoStr = normalizeSqliteDate(raw);
    return Math.max(0, (nowMs - new Date(isoStr).getTime()) / (1000 * 60 * 60 * 24));
}
