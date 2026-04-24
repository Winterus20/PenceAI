## Brief overview
Bu dosya, proje için genel iletişim tercihlerini, geliştirme iş akışlarını ve kodlama standartlarını tanımlar. Kullanıcı izole edilmiş ve net kurallar talep etmiştir.

## Communication style
- Yapay zeka (Cline) her zaman Türkçe (tr) konuşmalıdır.
- Yanıtlar her zaman kısa, net ve doğrudan konuya odaklı olmalıdır.
- Konuşkanlıktan (conversational tone) kaçınılmalı, tamamen teknik ve çözüm odaklı bir dil kullanılmalıdır.

## Development workflow
- Görevler küçük, yönetilebilir ve mantıksal adımlara (step-by-step) bölünmelidir.
- Her adımın başarılı olduğu doğrulanmadan bir sonrakine geçilmemelidir.
- Dosya değişikliklerinde projenin mevcut dosya yapısına uygun olarak hareket edilmelidir.

## Coding best practices
- Temiz kod (Clean Code) prensiplerine sıkı sıkıya bağlı kalınmalıdır.
- İsimlendirmeler açıklayıcı olmalı ve projedeki mevcut isimlendirme standartlarıyla tutarlılık göstermelidir.
- Her kod değişikliğinde güvenlik, performans ve okunabilirlik göz önünde bulundurulmalıdır.

## Project context
- PenceAI projesi içerisinde çalışılmakta olup, çeşitli ajansal (agent, llm, memory) yapılar bulunmaktadır.
- Mevcut mimari yapıya saygı gösterilmeli ve yeni dosyalar doğru dizinlere (örneğin src/ altına) yerleştirilmelidir.

## Other guidelines
- Görev tamamlama işlemi her zaman kullanıcı onayı ve test güvencesi ile kapatılmalıdır.
- Sistem komutları çalıştırılırken (execute_command) proje kök dizini yapısı dikkate alınmalıdır.