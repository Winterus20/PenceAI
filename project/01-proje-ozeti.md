## Proje Özeti

**PenceAI**, self-hosted ve local-first bir AI agent platformudur. End-to-end TypeScript mimarisi ile çoklu LLM provider desteği, bilişsel bellek katmanı ve otonom düşünme mekanizması sunar.

### Temel Özellikler

- 🧠 **Bilişsel Bellek Sistemi**: Ebbinghaus unutma eğrisi tabanlı uzun vadeli bellek yönetimi
- 🔄 **ReAct Döngüsü**: Reason → Act → Observe paradigması ile otonom ajan davranışı
- 🔗 **Çoklu LLM Desteği**: OpenAI, Anthropic, Ollama, Groq, Mistral, NVIDIA NIM, MiniMax, GitHub Models
- 💾 **Local-First**: Tüm veriler yerel SQLite veritabanında saklanır
- 🎯 **Semantik Router**: Intent eşleştirme için ONNX tabanlı embedding modeli
- 🤖 **Otonom Düşünme**: Inner Monologue ve Merak motoru ile bağımsız düşünme
- 🧩 **Reconsolidation Pilot**: Bellek birleştirme ve güncelleme güvenlik mekanizması
- 📊 **Retrieval Orchestration**: Dual-process (System1/System2) bellek getirme mimarisi
- 🕸️ **GraphRAG**: Graph-aware retrieval (PageRank, topluluk tespiti), deterministic RAG pattern'leri (Evaluation Gate, Phrase Bonus Scoring) ve gölge mod test altyapısı
- 🔍 **Smart Search**: Çoklu kaynak web arama motoru — DuckDuckGo, Wikipedia, Hacker News, Reddit; intent bazlı routing, sonuç birleştirme ve sıralama
- 🌿 **Konuşma Dallanma**: Fork, branch yönetimi ve ağaç görünümü ile konuşma dallanma desteği
- 🔌 **MCP Marketplace**: Model Context Protocol entegrasyonu, genişletilebilir araç ekosistemi
- 🛡️ **Agentic RAG**: Passage Critique, Response Verification ve Multi-Hop Retrieval ile kendi kendini doğrulayan RAG
- 🪝 **Hook Execution Engine**: Tool call lifecycle event'lerini yakalama, engelleme ve modification sistemi
- 🗜️ **Context Compaction**: Uzun konuşmalarda token bütçesini aşarsa otomatik sıkıştırma
- 💾 **LLM Prompt Cache**: SQLite üzerinde MD5(prompt+model) önbellekleme — API maliyetini $0'a indirir
- 📈 **Yerel Metrics Sistemi**: Provider bazlı token tüketimi, maliyet hesaplama ve performans metrikleri
- 📊 **Observability UI**: Yerel metrikler, real-time dashboard ve hata analizi arayüzü
- 📡 **Multi-Channel Support**: Discord ve WebSocket kanal entegrasyonları
- 🎨 **Modern UI/UX**: Markdown render sistemi, syntax highlighting, avatar sistemi ve akıcı animasyonlar
- ⚡ **Frontend Optimizasyonu**: Component decomposition, React.memo ile render performansı ve sanallaştırılmış mesaj akışı
- 🔌 **Stabil WebSocket**: Stale closure korumalı, buffer optimizasyonlu gerçek zamanlı iletişim katmanı

---

---
[← İçindekilere Dön](./README.md)