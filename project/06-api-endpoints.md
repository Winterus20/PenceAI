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
| `/api/conversations/:id/fork` | POST | Konuşmayı belirli mesajdan dallandır |
| `/api/conversations/:id/branches` | GET | Alt dalları getir |
| `/api/conversations/:id/branch-info` | GET | Dal bilgisi getir |
| `/api/memories` | GET | Bellek listesi |
| `/api/memories` | POST | Yeni bellek ekle |
| `/api/memories/search` | GET | Bellek arama |
| `/api/memories/:id` | PUT | Bellek güncelle |
| `/api/memories/:id` | DELETE | Bellek silme |
| `/api/memories/contradictions` | GET | Açık çelişkileri getir |
| `/api/memories/contradictions/:id/resolve` | POST | Çelişkiyi çöz |
| `/api/memories/contradictions/:id/false-positive` | POST | Çelişkiyi yanlış pozitif olarak işaretle |
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
| `/api/mcp/marketplace` | GET | Marketplace kataloğu |
| `/api/mcp/servers` | GET | MCP sunucu listesi |
| `/api/mcp/servers` | POST | Yeni MCP sunucu ekle |
| `/api/mcp/servers/:name/toggle` | PATCH | MCP sunucu aktif/pasif et (action: enable/disable) |
| `/api/mcp/servers/:name` | DELETE | MCP sunucu sil |
| `/api/mcp/servers/:name/tools` | GET | Sunucunun araçlarını getir |
| `/api/mcp/servers/:name/status` | GET | Sunucu durumunu getir |
| `/api/graphrag/status` | GET | GraphRAG durum kontrolü |
| `/api/graphrag/advance-phase` | POST | GraphRAG faz ilerletme |
| `/api/graphrag/set-phase` | POST | GraphRAG faz ayarlama |
| `/api/behavior-discovery/metrics` | GET | BehaviorDiscovery metrikleri |
| `/api/behavior-discovery/report` | GET | BehaviorDiscovery raporu |
| `/api/behavior-discovery/config` | POST | BehaviorDiscovery konfigürasyonu güncelle |
| `/api/behavior-discovery/clear` | POST | BehaviorDiscovery comparisons temizle |
| `/api/metrics/all` | GET | Tüm metrikler (limit param) |
| `/api/metrics/summary` | GET | Özet metrikler (days param) |
| `/api/metrics/provider-stats` | GET | Provider bazlı istatistikler |
| `/api/metrics/error-stats` | GET | Hata istatistikleri |
| `/api/metrics/:conversationId` | GET | Konuşma bazlı metrikler |
| `/api/usage/stats` | GET | Token usage istatistikleri |
| `/api/logs` | GET | Son log kayıtlarını getir (ring buffer) |
| `/api/insights` | GET | Aktif insight'ları getir |
| `/api/insights/search` | GET | Insight ara (q, minConfidence, limit) |
| `/api/insights/:id` | PATCH | Insight güncelle (description, status) |
| `/api/insights/:id/feedback` | POST | Insight feedback uygula (isPositive) |
| `/api/insights/prune` | POST | Eski insight'ları temizle |

---

---
[← İçindekilere Dön](./README.md)
