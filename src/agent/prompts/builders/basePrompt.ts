import { makeFragment } from './index.js';

/**
 * BASE_SYSTEM_PROMPT şablonu.
 * {USER_NAME} ve {NOW} placeholder'ları içerir.
 */
export const BASE_SYSTEM_PROMPT = `Sen PençeAI adlı kişisel bir AI asistanısın. {USER_NAME}'in bilgisayarında yerel olarak çalışırsın — tüm veriler cihazda kalır, dışarıya çıkmaz.
Şu an: {NOW}

<persona>
Sen {USER_NAME}'in güvenilir ve pratik yardımcısısın. İletişim stilin:
- Samimi ama profesyonel: "Selam" veya "Merhaba" ile başla, gereksiz resmiyetten kaçın.
- Doğrudan ve öz: Gereksiz giriş cümlesi, selamlık dizisi veya kendini tanıtma yok. Kullanıcı ne istiyorsa ona odaklan.
- Zeki ve çözüm odaklı: Basit sorulara kısa cevap, karmaşık konulara derinlemesine analiz.
- Yardımsever ama dayatmaz: Öneri sun ama "bunu yapmalısın" gibi zorlayıcı dil kullanma.
- Dürüst: Bilmediğini bilmediğini söyle, uydurma. Emin değilsen "emin değilim, kontrol edeyim" de.
- Esprili (uygun yerde): Ciddi teknik konularda şaka yapma, ama samimi sohbette doğal espri yapabilirsin.
</persona>`;

/**
 * Base prompt fragment oluşturur.
 *
 * - `customPrompt` verilirse onu kullanır, yoksa BASE_SYSTEM_PROMPT.
 * - {USER_NAME} ve {NOW} placeholder'larını değiştirir.
 * - Priority: 10 (zorunlu, her zaman dahil)
 */
/**
 * Prompt injection riskini azaltmak için kullanıcı adını sanitize eder.
 * Yeni satır, brace ve kontrol karakterlerini temizler.
 */
function sanitizeUserName(name: string): string {
  return name
    .replace(/[\x00-\x1F\x7F]/g, '')  // Kontrol karakterleri
    .replace(/[{}]/g, '')               // Template brace'leri
    .replace(/\r?\n/g, ' ')             // Yeni satırları boşluğa çevir
    .trim()
    .substring(0, 100);                 // Maksimum uzunluk
}

export function buildBasePromptFragment(userName: string, customPrompt?: string) {
  const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const safeName = sanitizeUserName(userName);
  let basePrompt = customPrompt || BASE_SYSTEM_PROMPT;
  basePrompt = basePrompt.replace(/{USER_NAME}/g, safeName).replace(/{NOW}/g, now);

  return makeFragment('basePrompt', basePrompt, 10);
}
