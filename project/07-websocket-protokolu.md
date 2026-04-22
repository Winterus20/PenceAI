## WebSocket Protokolü

### Mesaj Tipleri

| Tip | Yön | Açıklama |
|-----|-----|----------|
| `chat` | Client → Server | Kullanıcı mesajı |
| `set_thinking` | Client → Server | Düşünme modu ayarla |
| `confirm_response` | Client → Server | Onay yanıtı |
| `token` | Server → Client | Stream token |
| `response` | Server → Client | Tam yanıt |
| `agent_event` | Server → Client | Agent olayları (thinking, tool_start, tool_end, iteration, metrics) |
| `clear_stream` | Server → Client | Stream temizleme sinyali |
| `replace_stream` | Server → Client | Stream değiştirme |
| `confirm_request` | Server → Client | Onay isteği |
| `error` | Server → Client | Hata mesajı |
| `stats` | Server → Client | Sistem istatistikleri |

### WebSocket Yapılandırması

```typescript
const WS_CONFIG = {
  confirmationTimeoutMs: 60000,  // Onay isteği zaman aşımı
  maxMessageLength: 50000,       // Maksimum mesaj uzunluğu (karakter)
};
const MESSAGE_PROCESSING_TIMEOUT_MS = 300000; // 5 dakika
```

---

---
[← İçindekilere Dön](./README.md)