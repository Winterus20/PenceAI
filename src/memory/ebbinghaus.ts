/**
 * Ebbinghaus Forgetting Curve — Saf Matematik Fonksiyonları.
 * Hafıza kararlılığı, hatırlama oranı ve tekrar zamanı hesaplamaları.
 * Hiçbir dış bağımlılığı yoktur — tamamen saf fonksiyonlardan oluşur.
 */

/**
 * R(t) = e^(-t/S)
 * @param stability  — hafızanın kararlılığı (gün cinsinden)
 * @param daysSince  — son erişimden bu yana geçen gün sayısı
 * @returns          — retention oranı [0, 1]
 */
export function computeRetention(stability: number, daysSince: number): number {
    if (stability <= 0) return 0;
    return Math.exp(-daysSince / stability);
}

/**
 * R=0.7 eşiğinde bir sonraki review zamanını hesaplar.
 * t_review = -S * ln(0.7) ≈ S * 0.3567
 * @returns unix timestamp (saniye)
 */
export function computeNextReview(stability: number): number {
    const daysUntilReview = stability * 0.3567; // -ln(0.7)
    return Math.floor(Date.now() / 1000) + Math.round(daysUntilReview * 86400);
}

/**
 * Başarılı bir hatırlamadan sonra stability'yi günceller.
 * S_new = S * (1 + 0.9 * R)
 * @param currentStability — mevcut kararlılık (gün)
 * @param currentRetention — hatırlama anındaki retention [0,1]
 * @returns yeni stability değeri
 */
export function computeNewStability(currentStability: number, currentRetention: number): number {
    return currentStability * (1 + 0.9 * currentRetention);
}

/**
 * Son erişimden bu yana geçen gün sayısını hesaplar.
 * SQLite'ın CURRENT_TIMESTAMP formatını dikkate alır (UTC, 'Z' eki olmadan).
 */
export function daysSinceAccess(lastAccessedStr: string | null): number {
    if (!lastAccessedStr) return 0;
    const dateStr = lastAccessedStr.endsWith('Z') ? lastAccessedStr : lastAccessedStr.replace(' ', 'T') + 'Z';
    const lastMs = new Date(dateStr).getTime();
    return Math.max(0, (Date.now() - lastMs) / (1000 * 60 * 60 * 24));
}
