/**
 * Tarih/saat yardımcı fonksiyonları.
 * SQLite CURRENT_TIMESTAMP çıktısını ISO 8601'e dönüştürme,
 * gün hesaplama ve insan-okunabilir göreceli zaman formatlama gibi
 * sıkça kullanılan işlemleri merkezileştirir.
 */

/**
 * SQLite timestamp çıktısını veya çeşitli formatları güvenli bir şekilde
 * ISO 8601 formatına dönüştürür.
 *
 * Desteklenen formatlar:
 * - `YYYY-MM-DD HH:MM:SS` (SQLite CURRENT_TIMESTAMP)
 * - `YYYY-MM-DDTHH:MM:SS` (ISO 8601 without timezone)
 * - `YYYY/MM/DD HH:MM:SS` (slash-separated)
 * - ISO 8601 strings (Z veya timezone offset ile)
 *
 * Tanınmayan formatlar için `new Date(raw)` fallback olarak denenir.
 * Geçersiz girişlerde Error fırlatılır.
 *
 * @param raw — SQLite timestamp string'i, ISO 8601 string veya geçerli herhangi bir tarih formatı
 * @returns ISO 8601 formatında string (UTC, 'Z' ile biten)
 * @throws {Error} Giriş geçerli bir tarihe dönüştürülemezse
 *
 * @example
 * ```ts
 * normalizeSqliteDate('2024-04-11 14:30:00');
 * // => '2024-04-11T14:30:00Z'
 *
 * normalizeSqliteDate('2024-04-11T14:30:00Z');
 * // => '2024-04-11T14:30:00Z' (değişmez)
 *
 * normalizeSqliteDate('2024/04/11 14:30:00');
 * // => '2024-04-11T14:30:00Z'
 * ```
 */
export function normalizeSqliteDate(raw: string): string {
  // Zaten UTC ISO 8601 ise doğrudan döndür
  if (raw.endsWith('Z')) return raw;

  // SQLite format: YYYY-MM-DD HH:MM[:SS[.mmm]]
  const sqlitePattern = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
  const sqliteMatch = raw.match(sqlitePattern);
  if (sqliteMatch) {
    return raw.replace(' ', 'T') + 'Z';
  }

  // Slash-separated: YYYY/MM/DD HH:MM:SS
  const slashPattern = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const slashMatch = raw.match(slashPattern);
  if (slashMatch) {
    const normalized = raw.replace(/\//g, '-').replace(' ', 'T') + 'Z';
    return normalized;
  }

  // ISO 8601 with T separator but no Z (e.g., '2024-04-11T14:30:00')
  const isoWithoutZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
  if (isoWithoutZ.test(raw)) {
    return raw + 'Z';
  }

  // Fallback: new Date() ile parse et
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Geçersiz tarih formatı: "${raw}". Desteklenen formatlar: YYYY-MM-DD HH:MM:SS, ISO 8601`);
  }

  // Geçerli bir Date objesi elde ettik, ISO string'e çevir
  return date.toISOString();
}

/**
 * SQLite timestamp string'inden bu yana geçen gün sayısını hesaplar.
 *
 * Negatif değerler veya NaN sonuçlar 0'a kırpılır.
 * Geçersiz tarih girişleri 0 döndürür.
 *
 * @param raw — SQLite timestamp, ISO 8601 string, null veya undefined
 * @param nowMs — referans zaman damgası (ms, varsayılan: Date.now())
 * @returns Gün cinsinden geçen süre (her zaman >= 0)
 *
 * @example
 * ```ts
 * daysSince('2024-04-01 12:00:00');
 * // => (şu anki tarihe göre gün sayısı)
 *
 * daysSince(null);
 * // => 0
 *
 * daysSince('geçersiz-tarih');
 * // => 0 (NaN protection)
 * ```
 */
export function daysSince(raw: string | null | undefined, nowMs: number = Date.now()): number {
  if (!raw) return 0;

  let isoStr: string;
  try {
    isoStr = normalizeSqliteDate(raw);
  } catch {
    return 0; // Geçersiz tarih -> 0
  }

  const date = new Date(isoStr);
  const timestamp = date.getTime();

  if (!Number.isFinite(timestamp)) {
    return 0; // Invalid Date -> 0
  }

  const result = (nowMs - timestamp) / (1000 * 60 * 60 * 24);
  const clamped = Math.max(0, result);

  // NaN protection: bellek sisteminde NaN yayılmasını önle
  if (!Number.isFinite(clamped)) {
    return 0;
  }

  return clamped;
}

/**
 * Bir tarihi insan-okunabilir göreceli zaman formatına dönüştürür.
 *
 * Desteklenen aralıklar:
 * - < 60 saniye → "az önce"
 * - < 60 dakika → "X dakika önce"
 * - < 24 saat → "X saat önce"
 * - < 30 gün → "X gün önce"
 * - < 1 yıl → "X ay önce"
 * - >= 1 yıl → "X yıl önce"
 *
 * @param date — Date objesi veya tarih string'i
 * @param nowMs — referans zaman damgası (ms, varsayılan: Date.now())
 * @returns İnsan-okunabilir göreceli zaman string'i
 * @throws {Error} Giriş geçerli bir tarihe dönüştürülemezse
 *
 * @example
 * ```ts
 * formatRelativeTime(new Date(Date.now() - 30 * 1000));
 * // => "az önce"
 *
 * formatRelativeTime(new Date(Date.now() - 5 * 60 * 60 * 1000));
 * // => "5 saat önce"
 *
 * formatRelativeTime('2024-01-15T10:30:00Z');
 * // => "X ay önce" (tarihe göre)
 * ```
 */
export function formatRelativeTime(date: Date | string, nowMs: number = Date.now()): string {
  const targetDate = typeof date === 'string' ? new Date(normalizeSqliteDate(date)) : date;
  const timestamp = targetDate.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Geçersiz tarih: "${date}"`);
  }

  const diffMs = nowMs - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'az önce';
  if (diffMinutes < 60) return `${diffMinutes} dakika önce`;
  if (diffHours < 24) return `${diffHours} saat önce`;
  if (diffDays < 30) return `${diffDays} gün önce`;
  if (diffMonths < 12) return `${diffMonths} ay önce`;
  return `${diffYears} yıl önce`;
}
