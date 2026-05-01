/**
 * Konuşma özetleme prompt'u — bir konuşmayı JSON formatında özetler.
 */
export function buildSummarizationPrompt(): string {
    return `Aşağıdaki konuşmayı analiz et ve kısa bir özet ile başlık oluştur.

## Görev
Konuşmayı ileriki konuşmalarda bağlam olarak kullanılabilecek şekilde özetle VE konuşmayı temsil eden kısa bir başlık belirle.

ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON objesi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan { ile başla.
Aşağıdaki formata uy
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "title": "Konuşmayı özetleyen 3-6 kelimelik başlık",
  "topics": ["ana konu 1", "ana konu 2"],
  "mood": "kullanıcının genel tonu (meraklı, stresli, mutlu vb.)",
  "decisions": ["alınan karar 1", "alınan karar 2"],
  "open_questions": ["henüz çözülmemiş soru veya konu"],
  "summary": "Konuşmanın 2-3 cümlelik özeti. Ne hakkında konuşuldu, ne karar verildi, ne açıkta kaldı."
}

## Kurallar
- title: Maksimum 6 kelime, konuşmanın ana konusunu yansıtsın
- summary alanı maksimum 3 cümle, net ve bilgi dolu olsun
- topics için ana konuları kısaca yaz (maks. 5)
- decisions yalnızca net kararlar için (emin değilsen boş bırak)
- JSON dışında hiçbir şey yazma
- DİKKAT: Özetin ve başlığın dilini, konuşmanın ağırlıklı yapıldığı dilde tut.`;
}
