## WebSocket Protokolü

### Mesaj Tipleri

| Tip | Yön | Açıklama |
|-----|-----|----------|
| `chat` | Client → Server | Kullanıcı mesajı |
| `set_thinking` | Client → Server | Düşünme modu ayarla |
| `confirm_response` | Client → Server | Onay yanıtı |
| `prompt_human_response` | Client → Server | Kullanıcıdan gelen prompt yanıtı |
| `token_batch` | Server → Client | Batch'lenmiş stream token'ları |
| `response` | Server → Client | Tam yanıt |
| `agent_event` | Server → Client | Agent olayları (thinking, tool_start, tool_end, iteration, metrics) |
| `clear_stream` | Server → Client | Stream temizleme sinyali |
| `replace_stream` | Server → Client | Stream değiştirme |
| `confirm_request` | Server → Client | Onay isteği |
| `prompt_human_request` | Server → Client | Kullanıcıya soru sor (agent → human) |
| `error` | Server → Client | Hata mesajı |
| `stats` | Server → Client | Sistem istatistikleri |
| `sys_log` | Server → Client | Canlı log kaydı |
| `system_thought` | Server → Client | Otonom sistem düşüncesi |

### WebSocket Yapılandırması

```typescript
const WS_CONFIG = {
  confirmationTimeoutMs: 300000,  // Onay isteği zaman aşımı (5 dakika)
  maxMessageLength: 50000,       // Maksimum mesaj uzunluğu (karakter)
};
const MESSAGE_PROCESSING_TIMEOUT_MS = 300000; // 5 dakika
```

---

---
[← İçindekilere Dön](./README.md)
