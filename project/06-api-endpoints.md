## API Endpoints

### REST API

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/api/health` | GET | Sağlık kontrolü |
| `/api/stats` | GET | Sistem istatistikleri |
| `/api/channels` | GET | Kanal durumu |
| `/api/conversations` | GET | Konuşma listesi |
| `/api/conversations/:id/messages` | GET | Mesaj geçmişi |
| `/api/conversations/:id` | PATCH | Konuşma başlığı güncelle |
| `/api/conversations/:id` | DELETE | Konuşma silme |
| `/api/conversations` | DELETE | Toplu konuşma silme |
| `/api/memories` | GET | Bellek listesi |
| `/api/memories` | POST | Yeni bellek ekle |
| `/api/memories/search` | GET | Bellek arama |
| `/api/memories/:id` | PUT | Bellek güncelle |
| `/api/memories/:id` | DELETE | Bellek silme |
| `/api/memory-graph` | GET | Bellek grafiği verisi |
| `/api/settings` | GET | Ayarları getir |
| `/api/settings` | POST | Ayarları güncelle |
| `/api/settings/sensitive-paths` | GET | Hassas dizinleri getir |
| `/api/settings/sensitive-paths` | POST | Hassas dizin ekle |
| `/api/settings/sensitive-paths` | DELETE | Hassas dizin sil |
| `/api/llm/providers` | GET | Kullanılabilir LLM provider'ları |
| `/api/feedback` | POST | Kullanıcı geri bildirimi kaydet |
| `/api/feedback/:conversationId` | GET | Konuşma geri bildirimlerini getir |
| `/api/onboarding/process` | POST | Onboarding biyografi işleme |
| `/api/mcp/servers` | GET | MCP sunucu listesi |
| `/api/mcp/servers` | POST | Yeni MCP sunucu ekle |
| `/api/mcp/servers/:name` | GET | MCP sunucu detayı |
| `/api/mcp/servers/:name` | PUT | MCP sunucu güncelle |
| `/api/mcp/servers/:name` | DELETE | MCP sunucu sil |
| `/api/mcp/servers/:name/activate` | POST | MCP sunucu aktifleştir |
| `/api/mcp/servers/:name/deactivate` | POST | MCP sunucu devre dışı bırak |
| `/api/mcp/tools` | GET | Tüm MCP araçları listele |
| `/api/mcp/marketplace` | GET | Marketplace kataloğu |
| `/api/mcp/marketplace/:name/install` | POST | Marketplace'den sunucu yükle |
| `/api/graphrag/status` | GET | GraphRAG durum kontrolü |
| `/api/graphrag/advance-phase` | POST | GraphRAG faz ilerletme |
| `/api/graphrag/set-phase` | POST | GraphRAG faz ayarlama |
| `/api/behavior-discovery/metrics` | GET | BehaviorDiscovery metrikleri |
| `/api/behavior-discovery/report` | GET | BehaviorDiscovery raporu |
| `/api/behavior-discovery/config` | POST | BehaviorDiscovery konfigürasyonu güncelle |
| `/api/behavior-discovery/clear` | POST | BehaviorDiscovery comparisons temizle |
| `/api/metrics/all` | GET | Tüm metrikler (limit param) |
| `/api/metrics/:conversationId` | GET | Konuşma bazlı metrikler |
| `/api/metrics/summary` | GET | Özet metrikler (days param) |
| `/api/metrics/provider-stats` | GET | Provider bazlı istatistikler |
| `/api/metrics/error-stats` | GET | Hata istatistikleri |
| `/api/usage/stats` | GET | Token usage istatistikleri |
| `/api/usage/daily` | GET | Günlük kullanım raporu |

---

---
[← İçindekilere Dön](./README.md)