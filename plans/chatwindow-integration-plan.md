# ChatWindow.tsx Entegrasyon Planı

> **Oluşturulma Tarihi:** 24 Mart 2026
> **Hedef:** ChatWindow.tsx dosyasını mevcut hook'ları kullanarak modüler hale getirmek

---

## 1. Mevcut Durum Analizi

### 1.1 Dosya Özeti

| Metrik | Değer |
|--------|-------|
| Toplam Satır | 597 |
| State Sayısı | 13 |
| Fonksiyon Sayısı | 10 |
| useEffect Sayısı | 6 |
| useCallback Sayısı | 3 |

### 1.2 State Listesi

| # | State | Tip | Satır | Açıklama |
|---|-------|-----|-------|----------|
| 1 | `input` | `string` | 54 | Mesaj input değeri |
| 2 | `isSettingsOpen` | `boolean` | 55 | Ayarlar dialog durumu |
| 3 | `isMemoryOpen` | `boolean` | 56 | Bellek dialog durumu |
| 4 | `showConversations` | `boolean` | 57 | Konuşma paneli görünürlüğü |
| 5 | `showThinking` | `boolean` | 58 | Thinking görünürlüğü |
| 6 | `showTools` | `boolean` | 59 | Tools görünürlüğü |
| 7 | `searchQuery` | `string` | 60 | Arama sorgusu |
| 8 | `sortOrder` | `'newest' \| 'oldest' \| 'messages'` | 61 | Sıralama düzeni |
| 9 | `pendingAttachments` | `AttachmentItem[]` | 62 | Bekleyen dosya ekleri |
| 10 | `isDragOver` | `boolean` | 63 | Drag & drop durumu |
| 11 | `onboardingOpen` | `boolean` | 64 | Onboarding dialog durumu |
| 12 | `isMobileSidebarOpen` | `boolean` | 65 | Mobil sidebar durumu |
| 13 | `pinnedConversations` | `string[]` | 66-73 | Pinlenmiş konuşmalar |

### 1.3 Fonksiyon Listesi

| # | Fonksiyon | Satır | Açıklama |
|---|-----------|-------|----------|
| 1 | `stripThinkTags` | 22-28 | Think tag'lerini temizler (utility) |
| 2 | `loadConversations` | 83-92 | Konuşmaları API'den yükler |
| 3 | `buildRenderableMessages` | 121-208 | Mesajları render formatına dönüştürür |
| 4 | `loadConversation` | 210-220 | Belirli bir konuşmayı yükler |
| 5 | `handleNewChat` | 232-235 | Yeni sohbet başlatır |
| 6 | `handleSend` | 237-272 | Mesaj gönderir |
| 7 | `handleQuickAction` | 274-291 | Hızlı aksiyon gönderir |
| 8 | `handleRegenerate` | 293-297 | Son yanıtı yeniden üretir |
| 9 | `handleEditMessage` | 299-301 | Mesaj düzenler |
| 10 | `handleFileSelection` | 303-332 | Dosya seçimi işler |
| 11 | `togglePinned` | 334-338 | Pin toggle |
| 12 | `deleteConversation` | 340-354 | Konuşma siler |
| 13 | `exportConversation` | 358-376 | Konuşmayı dışa aktarır |

### 1.4 useEffect Listesi

| # | Satır | Bağımlılıklar | Açıklama |
|---|-------|---------------|----------|
| 1 | 75-77 | `showThinking`, `setThinkingEnabled` | Thinking enabled sync |
| 2 | 79-81 | `pinnedConversations` | Pin'leri localStorage'a kaydet |
| 3 | 94-96 | `loadConversations` | İlk yükleme |
| 4 | 98-102 | `isReceiving`, `loadConversations` | Mesaj sonrası yenileme |
| 5 | 104-119 | `[]` | Onboarding kontrolü |
| 6 | 223-230 | `activeConversationId`, `conversations`, `messages.length`, `loadConversation` | Aktif konuşma yükleme |

---

## 2. Fonksiyon Dağılımı

### 2.1 Eşleştirme Tablosu

| Fonksiyon | Satır | Hedef | Risk | Notlar |
|-----------|-------|-------|------|--------|
| `stripThinkTags` | 22-28 | ✅ `useMessageBuilder` | Düşük | Zaten hook'ta mevcut (satır 33-39) |
| `loadConversations` | 83-92 | ✅ `useConversations` | Düşük | Zaten hook'ta mevcut (satır 39-48) |
| `buildRenderableMessages` | 121-208 | ✅ `useMessageBuilder` | Düşük | Zaten hook'ta mevcut (satır 50-150) |
| `loadConversation` | 210-220 | ⚠️ `useConversations` | Orta | Hook'ta var ama mesaj set etmek gerekiyor |
| `handleNewChat` | 232-235 | ✅ `useConversations` | Düşük | Zaten hook'ta mevcut (satır 102-105) |
| `handleSend` | 237-272 | 🔴 ChatWindow'da kalır | Yüksek | UI mantığı ve store entegrasyonu |
| `handleQuickAction` | 274-291 | 🔴 ChatWindow'da kalır | Yüksek | `handleSend` bağımlılığı |
| `handleRegenerate` | 293-297 | 🔴 ChatWindow'da kalır | Orta | Store entegrasyonu |
| `handleEditMessage` | 299-301 | 🔴 ChatWindow'da kalır | Düşük | Basit state setter |
| `handleFileSelection` | 303-332 | ✅ `useFileUpload` | Düşük | Zaten hook'ta mevcut (satır 44-79) |
| `togglePinned` | 334-338 | ✅ `useConversations` | Düşük | Zaten hook'ta mevcut (satır 93-99) |
| `deleteConversation` | 340-354 | ✅ `useConversations` | Düşük | Zaten hook'ta mevcut (satır 70-90) |
| `exportConversation` | 358-376 | 🔴 ChatWindow'da kalır | Düşük | UI-only fonksiyon |

### 2.2 Özet İstatistik

| Kategori | Sayı | Yüzde |
|----------|------|-------|
| Hook'a Taşınabilir | 7 | 54% |
| ChatWindow'da Kalır | 6 | 46% |
| Düşük Risk | 7 | 54% |
| Orta Risk | 2 | 15% |
| Yüksek Risk | 4 | 31% |

---

## 3. State Dağılımı

### 3.1 State Eşleştirme Tablosu

| State | Tip | Hedef | Açıklama |
|-------|-----|-------|----------|
| `input` | `string` | 🔴 ChatWindow | Mesaj input - UI state |
| `isSettingsOpen` | `boolean` | 🔴 ChatWindow | Dialog state - UI only |
| `isMemoryOpen` | `boolean` | 🔴 ChatWindow | Dialog state - UI only |
| `showConversations` | `boolean` | 🔴 ChatWindow | Panel görünürlüğü - UI only |
| `showThinking` | `boolean` | 🔴 ChatWindow | Thinking toggle - UI only |
| `showTools` | `boolean` | 🔴 ChatWindow | Tools toggle - UI only |
| `searchQuery` | `string` | ⚠️ Yeni hook gerekli | Konuşma arama |
| `sortOrder` | `string` | ⚠️ Yeni hook gerekli | Konuşma sıralama |
| `pendingAttachments` | `AttachmentItem[]` | ✅ `useFileUpload` | Dosya ekleri |
| `isDragOver` | `boolean` | ✅ `useFileUpload` | Drag state |
| `onboardingOpen` | `boolean` | 🔴 ChatWindow | Dialog state - UI only |
| `isMobileSidebarOpen` | `boolean` | 🔴 ChatWindow | Mobil UI state |
| `pinnedConversations` | `string[]` | ✅ `useConversations` | Pin state |

### 3.2 State Kategorileri

```
┌─────────────────────────────────────────────────────────────┐
│                    STATE KATEGORİLERİ                        │
├─────────────────────────────────────────────────────────────┤
│  ✅ Hook'a Taşınabilir (3)                                  │
│  ├── pendingAttachments → useFileUpload                     │
│  ├── isDragOver → useFileUpload                             │
│  └── pinnedConversations → useConversations                 │
├─────────────────────────────────────────────────────────────┤
│  🔴 UI State - Kalır (8)                                    │
│  ├── input                                                  │
│  ├── isSettingsOpen                                         │
│  ├── isMemoryOpen                                           │
│  ├── showConversations                                      │
│  ├── showThinking                                           │
│  ├── showTools                                              │
│  ├── onboardingOpen                                         │
│  └── isMobileSidebarOpen                                    │
├─────────────────────────────────────────────────────────────┤
│  ⚠️ Yeni Hook Gerekli (2)                                   │
│  ├── searchQuery → useConversationFilters                   │
│  └── sortOrder → useConversationFilters                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Adım Adım Entegrasyon

### Adım 1: useConversations Hook Entegrasyonu

**Öncelik:** Yüksek
**Risk:** Düşük
**Tahmini Değişiklik:** ~50 satır azalma

#### Yapılacaklar:
- [ ] `useConversations` import et
- [ ] Aşağıdaki state'leri kaldır:
  - `pinnedConversations` (satır 66-73)
- [ ] Aşağıdaki fonksiyonları hook'tan al:
  - `loadConversations`
  - `loadConversation`
  - `deleteConversation`
  - `togglePinned`
  - `handleNewChat`
- [ ] İlgili useEffect'leri kaldır:
  - Pin localStorage sync (satır 79-81)
  - İlk yükleme (satır 94-96) - hook içine taşınmalı

#### Kod Değişikliği Örneği:

```typescript
// ÖNCE:
const [pinnedConversations, setPinnedConversations] = useState<string[]>(() => {...});
const loadConversations = useCallback(async () => {...}, [setConversations]);
const togglePinned = (conversationId: string) => {...};

// SONRA:
const {
  conversations: hookConversations,
  activeConversationId: hookActiveId,
  pinnedConversations,
  loadConversations,
  loadConversation,
  deleteConversation,
  togglePinned,
  handleNewChat,
} = useConversations();
```

---

### Adım 2: useMessageBuilder Hook Entegrasyonu

**Öncelik:** Yüksek
**Risk:** Düşük
**Tahmini Değişiklik:** ~90 satır azalma

#### Yapılacaklar:
- [ ] `useMessageBuilder` import et
- [ ] `stripThinkTags` fonksiyonunu kaldır (satır 22-28)
- [ ] `buildRenderableMessages` fonksiyonunu kaldır (satır 121-208)
- [ ] `loadConversation` içinde `buildRenderableMessages` kullanımını güncelle

#### Kod Değişikliği Örneği:

```typescript
// ÖNCE:
const buildRenderableMessages = useCallback((rawMessages: any[]) => {
  // 87 satır kod...
}, []);

const loadConversation = useCallback(async (conversationId: string) => {
  const data = await response.json();
  setMessages(buildRenderableMessages(Array.isArray(data) ? data : []));
}, [buildRenderableMessages, ...]);

// SONRA:
import { useMessageBuilder } from '../../hooks/useMessageBuilder';

const { buildRenderableMessages } = useMessageBuilder();

// loadConversation artık useConversations'tan geliyor
// Mesaj set etmek için:
const messages = await loadConversation(conversationId);
setMessages(buildRenderableMessages(messages));
```

---

### Adım 3: useFileUpload Hook Entegrasyonu

**Öncek:** Orta
**Risk:** Düşük
**Tahmini Değişiklik:** ~35 satır azalma

#### Yapılacaklar:
- [ ] `useFileUpload` import et
- [ ] Aşağıdaki state'leri kaldır:
  - `pendingAttachments` (satır 62)
  - `isDragOver` (satır 63)
- [ ] `handleFileSelection` fonksiyonunu kaldır (satır 303-332)
- [ ] Drag & drop event handler'larını güncelle

#### Kod Değişikliği Örneği:

```typescript
// ÖNCE:
const [pendingAttachments, setPendingAttachments] = useState<AttachmentItem[]>([]);
const [isDragOver, setIsDragOver] = useState(false);
const handleFileSelection = async (files: File[]) => {
  // 30 satır kod...
};

// SONRA:
import { useFileUpload } from '../../hooks/useFileUpload';

const {
  pendingAttachments,
  isDragOver,
  handleFileSelection,
  handleDrop,
  handleDragOver,
  handleDragLeave,
  removeAttachment,
  clearAttachments,
} = useFileUpload({ maxFiles: 10, maxSize: 25 * 1024 * 1024 });

// JSX'de:
<div
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={(e) => {
    e.preventDefault();
    handleDrop(Array.from(e.dataTransfer.files || []));
  }}
>
```

---

### Adım 4: Yeni Hook Oluşturma - useConversationFilters

**Öncelik:** Düşük
**Risk:** Düşük
**Tahmini Değişiklik:** Yeni dosya

#### Gerekçelendirme:
`searchQuery` ve `sortOrder` state'leri konuşma filtreleme mantığını içerir. Bu mantığı ayrı bir hook'a taşımak modülerliği artırır.

#### Hook İçeriği:

```typescript
// src/web/react-app/src/hooks/useConversationFilters.ts
export interface UseConversationFiltersReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortOrder: 'newest' | 'oldest' | 'messages';
  setSortOrder: (order: 'newest' | 'oldest' | 'messages') => void;
  filterConversations: (conversations: Conversation[]) => Conversation[];
}

export function useConversationFilters(): UseConversationFiltersReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'messages'>('newest');

  const filterConversations = useCallback(
    (conversations: Conversation[]) => {
      let filtered = conversations;
      
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.title?.toLowerCase().includes(query) ||
            c.user_name?.toLowerCase().includes(query)
        );
      }
      
      // Sıralama mantığı...
      return filtered;
    },
    [searchQuery, sortOrder]
  );

  return {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    filterConversations,
  };
}
```

---

### Adım 5: Kalan UI State'lerini Düzenleme

**Öncelik:** Düşük
**Risk:** Düşük

#### ChatWindow'da Kalacak State'ler:

| State | Neden Kalıyor? |
|-------|----------------|
| `input` | Mesaj input, doğrudan UI etkileşimi |
| `isSettingsOpen` | Dialog state, sadece UI |
| `isMemoryOpen` | Dialog state, sadece UI |
| `showConversations` | Panel toggle, sadece UI |
| `showThinking` | Thinking toggle, sadece UI |
| `showTools` | Tools toggle, sadece UI |
| `onboardingOpen` | Dialog state, sadece UI |
| `isMobileSidebarOpen` | Mobil UI state |

---

## 5. Risk Değerlendirmesi

### 5.1 Risk Matrisi

| Risk | Olasılık | Etki | Azaltma Stratejisi |
|------|----------|------|-------------------|
| State senkronizasyon kaybı | Orta | Yüksek | Store bağımlılıklarını koru |
| Fonksiyon imza değişikliği | Düşük | Orta | Backward-compatible wrapper |
| useEffect bağımlılık kırılması | Orta | Orta | Bağımlılık analizi yap |
| Performans regresyonu | Düşük | Düşük | React DevTools ile izle |
| Type mismatch | Düşük | Orta | TypeScript strict mode |

### 5.2 Yüksek Riskli Alanlar

#### 5.2.1 `loadConversation` Fonksiyonu

**Risk:** Orta
**Neden:** Hook'ta mesaj set edilmiyor, sadece ID set ediliyor.

**Çözüm:**
```typescript
// useConversations.ts'de değişiklik gerekli:
const loadConversation = useCallback(async (conversationId: string) => {
  const response = await fetch(`/api/conversations/${conversationId}/messages`);
  const data = await response.json();
  setActiveConversationId(conversationId);
  return Array.isArray(data) ? data : []; // Mesajları döndür
}, [setActiveConversationId]);

// ChatWindow.tsx'de:
const handleLoadConversation = async (id: string) => {
  const messages = await loadConversation(id);
  setMessages(buildRenderableMessages(messages));
};
```

#### 5.2.2 `handleSend` Fonksiyonu

**Risk:** Yüksek
**Neden:** Store entegrasyonu ve WebSocket bağımlılığı var.

**Çözüm:** ChatWindow'da kalacak, refactor gerektirmez.

---

## 6. Test Planı

### 6.1 Test Senaryoları

| # | Senaryo | Beklenen Sonuç | Öncelik |
|---|---------|----------------|---------|
| 1 | Konuşma listesi yükleme | Konuşmalar doğru yüklenmeli | Yüksek |
| 2 | Yeni konuşma başlatma | Mesajlar temizlenmeli, ID null olmalı | Yüksek |
| 3 | Konuşma silme | Konuşma listeden kalkmalı | Yüksek |
| 4 | Pin toggle | Pin state güncellenmeli | Orta |
| 5 | Dosya yükleme | Dosya ekleri doğru işlenmeli | Yüksek |
| 6 | Drag & drop | Dosyalar drop edilebilmeli | Orta |
| 7 | Mesaj gönderme | Mesaj başarıyla gönderilmeli | Yüksek |
| 8 | Thinking toggle | Thinking gösterilmeli/gizlenmeli | Düşük |
| 9 | Mobil sidebar | Sidebar açılıp kapanmalı | Orta |
| 10 | Export | Dosya doğru indirilmeli | Düşük |

### 6.2 Test Sırası

```
1. Unit Tests (Hook'lar için)
   ├── useConversations.test.ts
   ├── useMessageBuilder.test.ts
   └── useFileUpload.test.ts

2. Integration Tests
   └── ChatWindow.integration.test.tsx

3. E2E Tests
   └── chat-flow.e2e.test.ts
```

---

## 7. Geri Alma Planı

### 7.1 Versiyon Kontrolü

```bash
# Entegrasyon öncesi branch oluştur
git checkout -b feature/chatwindow-refactor

# Her adım için commit
git commit -m "feat: integrate useConversations hook"
git commit -m "feat: integrate useMessageBuilder hook"
git commit -m "feat: integrate useFileUpload hook"
```

### 7.2 Geri Alma Prosedürü

| Adım | Geri Alma Komutu |
|------|------------------|
| Tek adım geri | `git revert HEAD` |
| Tüm değişiklikleri geri | `git checkout main` |
| Belirli dosyayı geri | `git checkout HEAD~1 -- src/web/react-app/src/components/chat/ChatWindow.tsx` |

### 7.3 Hotfix Stratejisi

Kritik bir bug bulunursa:
1. Hemen `main` branch'ine hotfix branch aç
2. Sorunu düzelt
3. `feature/chatwindow-refactor` branch'ine de uygula
4. Merge et

---

## 8. Sonuç

### 8.1 Beklenen İyileştirmeler

| Metrik | Önce | Sonra | Değişim |
|--------|------|-------|---------|
| Toplam satır | 597 | ~350 | -41% |
| State sayısı | 13 | 8 | -38% |
| Fonksiyon sayısı | 13 | 6 | -54% |
| useEffect sayısı | 6 | 3 | -50% |

### 8.2 Kazanımlar

- ✅ **Modülerlik:** Her sorumluluk ayrı hook'ta
- ✅ **Test Edilebilirlik:** Hook'lar izole test edilebilir
- ✅ **Yeniden Kullanılabilirlik:** Hook'lar diğer component'lerde kullanılabilir
- ✅ **Bakım Kolaylığı:** Değişiklikler tek yerden yapılır
- ✅ **Okunabilirlik:** ChatWindow sadece UI mantığına odaklanır

### 8.3 Sonraki Adımlar

1. Planı onayla
2. Code mode'a geç
3. Adım adım entegrasyonu gerçekleştir
4. Test et
5. Merge et
