/**
 * Benchmark Test Veri Seti
 * 
 * PenceAI retrieval algoritmalarını diğer sistemlerle karşılaştırmak için
 * gerçekçi senaryolar içeren test veri seti.
 * 
 * İçerik:
 * - 50+ sorgu (farklı zorluk ve kategorilerde)
 * - 200+ bellek kaydı (çeşitli kategorilerde)
 * - Ground truth etiketleri
 */

import type { MemoryRow } from '../../../src/memory/types.js';

// ========== Tip Tanımlamaları ==========

export interface BenchmarkQuery {
  id: string;
  query: string;
  relevantMemoryIds: number[]; // Ground truth - ilgili memory ID'leri
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'preference' | 'follow_up' | 'factual' | 'exploratory';
  description: string; // Test senaryosunun açıklaması
}

export interface BenchmarkMemory {
  id: number;
  content: string;
  category: string;
  memoryType: 'semantic' | 'episodic';
  importance: number;
  createdAt: Date;
  tags?: string[];
}

export interface BenchmarkDataset {
  queries: BenchmarkQuery[];
  memories: BenchmarkMemory[];
  metadata: {
    totalQueries: number;
    totalMemories: number;
    categoryDistribution: Record<string, number>;
    difficultyDistribution: Record<string, number>;
  };
}

// ========== Bellek Veri Seti (200+ kayıt) ==========

export const benchmarkMemories: BenchmarkMemory[] = [
  // ----- Kullanıcı Tercihleri (preference) - ID 1-40 -----
  {
    id: 1,
    content: 'Kullanıcı TypeScript yerine JavaScript kullanmayı tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    tags: ['programlama', 'dil-tercihi', 'javascript']
  },
  {
    id: 2,
    content: 'Kullanıcı sabahları erken çalışmayı tercih ediyor, en verimli saatleri 06:00-09:00 arası',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-16T08:00:00Z'),
    tags: ['çalışma-saati', 'verimlilik', 'sabah']
  },
  {
    id: 3,
    content: 'Kullanıcı koyu renk temayı tercih ediyor, açık tema gözünü yoruyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-17T14:00:00Z'),
    tags: ['tema', 'görsel', 'koyu-tema']
  },
  {
    id: 4,
    content: 'Kullanıcı VS Code editörünü kullanıyor, IntelliJ\'den daha rahat ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-18T09:00:00Z'),
    tags: ['editör', 'vscode', 'ide']
  },
  {
    id: 5,
    content: 'Kullanıcı Türkçe dokümantasyon tercih ediyor, İngilizce ikinci tercih',
    category: 'preference',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-19T11:00:00Z'),
    tags: ['dil', 'dokümantasyon', 'türkçe']
  },
  {
    id: 6,
    content: 'Kullanıcı kısa ve öz yanıtları tercih ediyor, uzun açıklamalardan hoşlanmıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 9,
    createdAt: new Date('2026-01-20T10:00:00Z'),
    tags: ['yanıt-tercihi', 'kısa', 'öz']
  },
  {
    id: 7,
    content: 'Kullanıcı kod örnekleri ile öğrenmeyi tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-21T15:00:00Z'),
    tags: ['öğrenme', 'kod-örneği', 'pratik']
  },
  {
    id: 8,
    content: 'Kullanıcı hafta sonu çalışmıyor, sadece acil durumlar için müsait',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-22T12:00:00Z'),
    tags: ['çalışma-saatleri', 'hafta-sonu', 'izin']
  },
  {
    id: 9,
    content: 'Kullanıcı React framework\'ünü tercih ediyor, Vue ile deneyimi yok',
    category: 'preference',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-23T09:00:00Z'),
    tags: ['framework', 'react', 'frontend']
  },
  {
    id: 10,
    content: 'Kullanıcı PostgreSQL veritabanını tercih ediyor, MySQL deneyimi var ama hoşlanmıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-24T14:00:00Z'),
    tags: ['veritabanı', 'postgresql', 'mysql']
  },
  {
    id: 11,
    content: 'Kullanıcı müzik dinleyerek çalışmayı seviyor, lo-fi playlist tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-25T16:00:00Z'),
    tags: ['müzik', 'çalışma', 'lo-fi']
  },
  {
    id: 12,
    content: 'Kullanıcı kahve içmiyor, çay tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-01-26T08:00:00Z'),
    tags: ['içecek', 'çay', 'kahve']
  },
  {
    id: 13,
    content: 'Kullanıcı toplantılarda kamera açmayı tercih etmiyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-27T10:00:00Z'),
    tags: ['toplantı', 'kamera', 'gizlilik']
  },
  {
    id: 14,
    content: 'Kullanıcı Git için terminal kullanmayı tercih ediyor, GUI araçları kullanmıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-28T11:00:00Z'),
    tags: ['git', 'terminal', 'cli']
  },
  {
    id: 15,
    content: 'Kullanıcı Docker container\'ları kullanıyor, local kurulum yerine',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-29T13:00:00Z'),
    tags: ['docker', 'container', 'geliştirme']
  },
  {
    id: 16,
    content: 'Kullanıcı markdown formatında not almayı tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-30T09:00:00Z'),
    tags: ['not', 'markdown', 'format']
  },
  {
    id: 17,
    content: 'Kullanıcı otomatik kaydetme özelliğini kullanıyor, manuel kaydetmeyi unutuyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-31T14:00:00Z'),
    tags: ['otomatik-kaydet', 'editör', 'ayar']
  },
  {
    id: 18,
    content: 'Kullanıcı mobil uygulama geliştirmede React Native tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-02-01T10:00:00Z'),
    tags: ['mobil', 'react-native', 'geliştirme']
  },
  {
    id: 19,
    content: 'Kullanıcı API tasarımında REST tercih ediyor, GraphQL denemedi',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-02T11:00:00Z'),
    tags: ['api', 'rest', 'graphql']
  },
  {
    id: 20,
    content: 'Kullanıcı test yazarken Jest framework\'ünü kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-02-03T09:00:00Z'),
    tags: ['test', 'jest', 'framework']
  },

  // ----- Fakt Bilgiler (factual) - ID 21-60 -----
  {
    id: 21,
    content: 'TypeScript 2020 yılında Microsoft tarafından geliştirilen açık kaynak bir programlama dilidir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-04T10:00:00Z'),
    tags: ['typescript', 'microsoft', 'programlama-dili']
  },
  {
    id: 22,
    content: 'React 2013 yılında Facebook tarafından açık kaynak olarak yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-05T11:00:00Z'),
    tags: ['react', 'facebook', 'tarih']
  },
  {
    id: 23,
    content: 'Node.js 2009 yılında Ryan Dahl tarafından oluşturulmuştur',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-06T09:00:00Z'),
    tags: ['nodejs', 'tarih', 'ryan-dahl']
  },
  {
    id: 24,
    content: 'PostgreSQL 1986 yılında Berkeley\'de geliştirilmeye başlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-07T14:00:00Z'),
    tags: ['postgresql', 'tarih', 'berkeley']
  },
  {
    id: 25,
    content: 'Docker 2013 yılında dotCloud tarafından yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-08T10:00:00Z'),
    tags: ['docker', 'tarih', 'container']
  },
  {
    id: 26,
    content: 'Git 2005 yılında Linus Torvalds tarafından oluşturulmuştur',
    category: 'factual',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-09T11:00:00Z'),
    tags: ['git', 'linus-torvalds', 'tarih']
  },
  {
    id: 27,
    content: 'JavaScript 1995 yılında Brendan Eich tarafından 10 günde oluşturulmuştur',
    category: 'factual',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-10T09:00:00Z'),
    tags: ['javascript', 'brendan-eich', 'tarih']
  },
  {
    id: 28,
    content: 'Python 1991 yılında Guido van Rossum tarafından yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-11T14:00:00Z'),
    tags: ['python', 'guido-van-rossum', 'tarih']
  },
  {
    id: 29,
    content: 'HTTP/2 2015 yılında standardize edilmiştir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-12T10:00:00Z'),
    tags: ['http', 'protokol', 'standard']
  },
  {
    id: 30,
    content: 'JSON 2001 yılında Douglas Crockford tarafından popülerleştirilmiştir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-13T11:00:00Z'),
    tags: ['json', 'douglas-crockford', 'format']
  },
  {
    id: 31,
    content: 'SQL 1974 yılında IBM\'de geliştirilmiştir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-14T09:00:00Z'),
    tags: ['sql', 'ibm', 'tarih']
  },
  {
    id: 32,
    content: 'Linux kernel 1991 yılında yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-15T14:00:00Z'),
    tags: ['linux', 'kernel', 'tarih']
  },
  {
    id: 33,
    content: 'Kubernetes 2014 yılında Google tarafından açık kaynak olarak yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-16T10:00:00Z'),
    tags: ['kubernetes', 'google', 'container-orchestration']
  },
  {
    id: 34,
    content: 'MongoDB 2009 yılında 10gen (şimdi MongoDB Inc.) tarafından yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-17T11:00:00Z'),
    tags: ['mongodb', 'nosql', 'veritabanı']
  },
  {
    id: 35,
    content: 'Redis 2009 yılında Salvatore Sanfilippo tarafından geliştirilmiştir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-18T09:00:00Z'),
    tags: ['redis', 'cache', 'in-memory']
  },
  {
    id: 36,
    content: 'Elasticsearch 2010 yılında Shay Banon tarafından oluşturulmuştur',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-19T14:00:00Z'),
    tags: ['elasticsearch', 'search', 'lucene']
  },
  {
    id: 37,
    content: 'RabbitMQ 2007 yılında Rabbit Technologies tarafından yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-20T10:00:00Z'),
    tags: ['rabbitmq', 'message-queue', 'amqp']
  },
  {
    id: 38,
    content: 'GraphQL 2015 yılında Facebook tarafından açık source olarak yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-21T11:00:00Z'),
    tags: ['graphql', 'facebook', 'api']
  },
  {
    id: 39,
    content: 'WebSocket 2011 yılında RFC 6455 olarak standardize edilmiştir',
    category: 'factual',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-22T09:00:00Z'),
    tags: ['websocket', 'protokol', 'real-time']
  },
  {
    id: 40,
    content: 'OAuth 2.0 2012 yılında RFC 6749 olarak yayınlanmıştır',
    category: 'factual',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-23T14:00:00Z'),
    tags: ['oauth', 'auth', 'standard']
  },

  // ----- Episodik Bellekler (geçmiş olaylar) - ID 41-100 -----
  {
    id: 41,
    content: 'Kullanıcı 15 Ocak\'ta TypeScript öğrenmeye başladı ve ilk projeyi oluşturdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 7,
    createdAt: new Date('2026-01-15T16:00:00Z'),
    tags: ['öğrenme', 'typescript', 'başlangıç']
  },
  {
    id: 42,
    content: 'Kullanıcı 20 Ocak\'ta React projesinde ilk component\'ini yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-01-20T14:00:00Z'),
    tags: ['react', 'component', 'ilk']
  },
  {
    id: 43,
    content: 'Kullanıcı 25 Ocak\'ta PostgreSQL veritabanı kurulumunu tamamladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-01-25T11:00:00Z'),
    tags: ['postgresql', 'kurulum', 'veritabanı']
  },
  {
    id: 44,
    content: 'Kullanıcı 1 Şubat\'ta Docker ile ilk container\'ını oluşturdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-02-01T15:00:00Z'),
    tags: ['docker', 'container', 'ilk']
  },
  {
    id: 45,
    content: 'Kullanıcı 5 Şubat\'ta API entegrasyonu için REST endpoint\'leri yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 7,
    createdAt: new Date('2026-02-05T10:00:00Z'),
    tags: ['api', 'rest', 'endpoint']
  },
  {
    id: 46,
    content: 'Kullanıcı 10 Şubat\'ta Jest ile ilk unit test\'lerini yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-02-10T13:00:00Z'),
    tags: ['test', 'jest', 'unit-test']
  },
  {
    id: 47,
    content: 'Kullanıcı 15 Şubat\'ta Git branching stratejisini öğrendi',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-02-15T09:00:00Z'),
    tags: ['git', 'branch', 'strateji']
  },
  {
    id: 48,
    content: 'Kullanıcı 20 Şubat\'ta WebSocket ile real-time chat uygulaması yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 7,
    createdAt: new Date('2026-02-20T14:00:00Z'),
    tags: ['websocket', 'chat', 'real-time']
  },
  {
    id: 49,
    content: 'Kullanıcı 25 Şubat\'ta Redis cache entegrasyonunu tamamladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-02-25T11:00:00Z'),
    tags: ['redis', 'cache', 'entegrasyon']
  },
  {
    id: 50,
    content: 'Kullanıcı 1 Mart\'ta Kubernetes deployment için YAML dosyaları yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    tags: ['kubernetes', 'deployment', 'yaml']
  },
  {
    id: 51,
    content: 'Kullanıcı 5 Mart\'ta OAuth 2.0 authentication implementasyonunu tamamladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 7,
    createdAt: new Date('2026-03-05T15:00:00Z'),
    tags: ['oauth', 'auth', 'security']
  },
  {
    id: 52,
    content: 'Kullanıcı 10 Mart\'ta Elasticsearch ile full-text search ekledi',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-10T11:00:00Z'),
    tags: ['elasticsearch', 'search', 'full-text']
  },
  {
    id: 53,
    content: 'Kullanıcı 15 Mart\'ta GraphQL API gateway oluşturdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 7,
    createdAt: new Date('2026-03-15T14:00:00Z'),
    tags: ['graphql', 'api', 'gateway']
  },
  {
    id: 54,
    content: 'Kullanıcı 20 Mart\'ta MongoDB migration\'ını tamamladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-20T10:00:00Z'),
    tags: ['mongodb', 'migration', 'nosql']
  },
  {
    id: 55,
    content: 'Kullanıcı 25 Mart\'ta RabbitMQ message queue entegrasyonunu yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-25T13:00:00Z'),
    tags: ['rabbitmq', 'message-queue', 'async']
  },

  // ----- Teknik Detaylar - ID 56-120 -----
  {
    id: 56,
    content: 'TypeScript\'te type assertion için "as" keyword kullanılır: value as string',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-01T10:00:00Z'),
    tags: ['typescript', 'type-assertion', 'syntax']
  },
  {
    id: 57,
    content: 'React\'te useEffect dependency array\'i boş bırakılırsa component mount\'ta bir kez çalışır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-02-02T11:00:00Z'),
    tags: ['react', 'useeffect', 'hooks']
  },
  {
    id: 58,
    content: 'Node.js\'de process.env ile environment variable\'lara erişilir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-03T09:00:00Z'),
    tags: ['nodejs', 'environment', 'config']
  },
  {
    id: 59,
    content: 'PostgreSQL\'de JSONB veri tipi JSON veriden daha verimli sorgulama sağlar',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-04T14:00:00Z'),
    tags: ['postgresql', 'jsonb', 'data-type']
  },
  {
    id: 60,
    content: 'Docker\'ta multi-stage build ile image boyutu küçültülür',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-05T10:00:00Z'),
    tags: ['docker', 'multi-stage', 'optimization']
  },
  {
    id: 61,
    content: 'Git\'te interactive rebase ile commit\'ler birleştirilebilir: git rebase -i HEAD~3',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-06T11:00:00Z'),
    tags: ['git', 'rebase', 'commit']
  },
  {
    id: 62,
    content: 'JavaScript\'te async/await Promise.then zincirini daha okunabilir hale getirir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-02-07T09:00:00Z'),
    tags: ['javascript', 'async', 'promise']
  },
  {
    id: 63,
    content: 'Python\'da list comprehension ile liste oluşturmak for döngüsünden daha hızlıdır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-08T14:00:00Z'),
    tags: ['python', 'list-comprehension', 'performance']
  },
  {
    id: 64,
    content: 'HTTP/2 server push ile istemci istemeden kaynak gönderilebilir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-09T10:00:00Z'),
    tags: ['http2', 'server-push', 'optimization']
  },
  {
    id: 65,
    content: 'JSON Schema ile JSON veri doğrulaması yapılabilir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-10T11:00:00Z'),
    tags: ['json', 'schema', 'validation']
  },
  {
    id: 66,
    content: 'SQL\'de INDEX oluşturmak sorgu performansını artırır: CREATE INDEX idx_name ON table(column)',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-11T09:00:00Z'),
    tags: ['sql', 'index', 'performance']
  },
  {
    id: 67,
    content: 'Linux\'ta chmod 755 dosya izinlerini ayarlar: sahibi tam, diğerleri okuma ve çalıştırma',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-12T14:00:00Z'),
    tags: ['linux', 'chmod', 'permissions']
  },
  {
    id: 68,
    content: 'Kubernetes\'te liveness probe container\'ın çalışıp çalışmadığını kontrol eder',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-13T10:00:00Z'),
    tags: ['kubernetes', 'liveness-probe', 'health']
  },
  {
    id: 69,
    content: 'MongoDB\'de aggregation pipeline ile karmaşık sorgular yazılır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-14T11:00:00Z'),
    tags: ['mongodb', 'aggregation', 'pipeline']
  },
  {
    id: 70,
    content: 'Redis\'te SETEX ile TTL ile birlikte değer atanır: SETEX key 3600 value',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-15T09:00:00Z'),
    tags: ['redis', 'setex', 'ttl']
  },
  {
    id: 71,
    content: 'Elasticsearch\'te match query full-text search için kullanılır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-16T14:00:00Z'),
    tags: ['elasticsearch', 'match-query', 'search']
  },
  {
    id: 72,
    content: 'RabbitMQ\'da dead letter queue başarısız mesajları toplar',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-17T10:00:00Z'),
    tags: ['rabbitmq', 'dead-letter', 'queue']
  },
  {
    id: 73,
    content: 'GraphQL\'de fragment ile tekrar kullanılabilir alan grupları tanımlanır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-18T11:00:00Z'),
    tags: ['graphql', 'fragment', 'reusable']
  },
  {
    id: 74,
    content: 'WebSocket\'te ping/pong frame\'leri bağlantı canlılığını kontrol eder',
    category: 'technical',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-19T09:00:00Z'),
    tags: ['websocket', 'ping-pong', 'heartbeat']
  },
  {
    id: 75,
    content: 'OAuth 2.0\'ta refresh token ile access token yenilenir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-20T14:00:00Z'),
    tags: ['oauth', 'refresh-token', 'auth']
  },

  // ----- Proje Bilgileri - ID 76-130 -----
  {
    id: 76,
    content: 'PenceAI projesi local-first AI agent platformudur',
    category: 'project',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    tags: ['penceai', 'proje', 'ai-agent']
  },
  {
    id: 77,
    content: 'PenceAI SQLite veritabanı kullanır, local-first yaklaşımla',
    category: 'project',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-02T11:00:00Z'),
    tags: ['penceai', 'sqlite', 'local-first']
  },
  {
    id: 78,
    content: 'PenceAI Ebbinghaus unutma eğrisi tabanlı bellek sistemi kullanır',
    category: 'project',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-03T09:00:00Z'),
    tags: ['penceai', 'ebbinghaus', 'memory']
  },
  {
    id: 79,
    content: 'PenceAI ReAct döngüsü ile otonom ajan davranışı sergiler',
    category: 'project',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-04T14:00:00Z'),
    tags: ['penceai', 'react', 'agent']
  },
  {
    id: 80,
    content: 'PenceAI çoklu LLM provider desteği sunar: OpenAI, Anthropic, Ollama, Groq',
    category: 'project',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-05T10:00:00Z'),
    tags: ['penceai', 'llm', 'provider']
  },
  {
    id: 81,
    content: 'PenceAI semantic router ile intent eşleştirme yapar',
    category: 'project',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-06T11:00:00Z'),
    tags: ['penceai', 'semantic-router', 'intent']
  },
  {
    id: 82,
    content: 'PenceAI otonom düşünme için inner monologue kullanır',
    category: 'project',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-07T09:00:00Z'),
    tags: ['penceai', 'inner-monologue', 'autonomous']
  },
  {
    id: 83,
    content: 'PenceAI merak motoru ile bağımsız düşünme yeteneğine sahip',
    category: 'project',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-08T14:00:00Z'),
    tags: ['penceai', 'curiosity', 'autonomous']
  },
  {
    id: 84,
    content: 'PenceAI memory graph ile ilişkisel bellek yönetimi sağlar',
    category: 'project',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-09T10:00:00Z'),
    tags: ['penceai', 'memory-graph', 'relations']
  },
  {
    id: 85,
    content: 'PenceAI hybrid search ile FTS + semantic + RRF fusion kullanır',
    category: 'project',
    memoryType: 'semantic',
    importance: 8,
    createdAt: new Date('2026-01-10T11:00:00Z'),
    tags: ['penceai', 'hybrid-search', 'retrieval']
  },
  {
    id: 86,
    content: 'PenceAI TypeScript ile end-to-end geliştirilmiştir',
    category: 'project',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-11T09:00:00Z'),
    tags: ['penceai', 'typescript', 'stack']
  },
  {
    id: 87,
    content: 'PenceAI React web arayüzü sunar',
    category: 'project',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-12T14:00:00Z'),
    tags: ['penceai', 'react', 'frontend']
  },
  {
    id: 88,
    content: 'PenceAI WebSocket ile real-time iletişim sağlar',
    category: 'project',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-13T10:00:00Z'),
    tags: ['penceai', 'websocket', 'real-time']
  },
  {
    id: 89,
    content: 'PenceAI MIT lisansı ile açık kaynak olarak yayınlanmıştır',
    category: 'project',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-14T11:00:00Z'),
    tags: ['penceai', 'mit', 'license']
  },
  {
    id: 90,
    content: 'PenceAI memory extraction pipeline ile otomatik bellek çıkarımı yapar',
    category: 'project',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-15T09:00:00Z'),
    tags: ['penceai', 'extraction', 'pipeline']
  },

  // ----- Kullanıcı Bağlamı - ID 91-140 -----
  {
    id: 91,
    content: 'Kullanıcı adı Ahmet, yazılım geliştirici olarak çalışıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    tags: ['kullanıcı', 'isim', 'meslek']
  },
  {
    id: 92,
    content: 'Kullanıcı İstanbul\'da yaşıyor, UTC+3 zaman diliminde',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-02T11:00:00Z'),
    tags: ['kullanıcı', 'konum', 'zaman-dilimi']
  },
  {
    id: 93,
    content: 'Kullanıcı 5 yıllık yazılım deneyimine sahip',
    category: 'context',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-03T09:00:00Z'),
    tags: ['kullanıcı', 'deneyim', 'yazılım']
  },
  {
    id: 94,
    content: 'Kullanıcı full-stack geliştirme üzerine odaklanıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-04T14:00:00Z'),
    tags: ['kullanıcı', 'full-stack', 'odak']
  },
  {
    id: 95,
    content: 'Kullanıcı İngilizce ve Türkçe biliyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-05T10:00:00Z'),
    tags: ['kullanıcı', 'dil', 'yabancı-dil']
  },
  {
    id: 96,
    content: 'Kullanıcı bir fintech şirketinde çalışıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-06T11:00:00Z'),
    tags: ['kullanıcı', 'şirket', 'fintech']
  },
  {
    id: 97,
    content: 'Kullanıcı microservices mimarisi üzerinde çalışıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-01-07T09:00:00Z'),
    tags: ['kullanıcı', 'microservices', 'mimari']
  },
  {
    id: 98,
    content: 'Kullanıcı CI/CD pipeline\'ları kuruyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-01-08T14:00:00Z'),
    tags: ['kullanıcı', 'cicd', 'devops']
  },
  {
    id: 99,
    content: 'Kullanıcı açık source projelere katkıda bulunuyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-01-09T10:00:00Z'),
    tags: ['kullanıcı', 'open-source', 'katkı']
  },
  {
    id: 100,
    content: 'Kullanıcı teknik blog yazıları yazıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-01-10T11:00:00Z'),
    tags: ['kullanıcı', 'blog', 'yazı']
  },

  // ----- Ek Bellekler - ID 101-200 -----
  {
    id: 101,
    content: 'Kullanıcı unit testing için TDD yaklaşımını benimsiyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-01T10:00:00Z'),
    tags: ['test', 'tdd', 'yaklaşım']
  },
  {
    id: 102,
    content: 'Kullanıcı code review\'lerde constructive feedback vermeyi tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-02T11:00:00Z'),
    tags: ['code-review', 'feedback', 'takım']
  },
  {
    id: 103,
    content: 'Kullanıcı documentation-first yaklaşımını destekliyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-03T09:00:00Z'),
    tags: ['dokümantasyon', 'yaklaşım', 'öncelik']
  },
  {
    id: 104,
    content: 'Kullanıcı monorepo yapısını tercih ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-04T14:00:00Z'),
    tags: ['monorepo', 'yapı', 'proje']
  },
  {
    id: 105,
    content: 'Kullanıcı semantic versioning kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-05T10:00:00Z'),
    tags: ['versioning', 'semantic', 'release']
  },
  {
    id: 106,
    content: 'Kullanıcı conventional commits formatını kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-06T11:00:00Z'),
    tags: ['git', 'commit', 'format']
  },
  {
    id: 107,
    content: 'Kullanıcı automated testing pipeline\'ı kuruyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-02-10T10:00:00Z'),
    tags: ['test', 'pipeline', 'otomasyon']
  },
  {
    id: 108,
    content: 'Kullanıcı performance optimization için profiling yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-02-15T11:00:00Z'),
    tags: ['performance', 'profiling', 'optimization']
  },
  {
    id: 109,
    content: 'Kullanıcı security audit için dependency scan yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-02-20T09:00:00Z'),
    tags: ['security', 'audit', 'dependency']
  },
  {
    id: 110,
    content: 'Kullanıcı database migration script\'leri yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-02-25T14:00:00Z'),
    tags: ['database', 'migration', 'script']
  },
  {
    id: 111,
    content: 'Kullanıcı API rate limiting implementasyonu yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    tags: ['api', 'rate-limiting', 'security']
  },
  {
    id: 112,
    content: 'Kullanıcı logging ve monitoring setup\'ını tamamladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-05T11:00:00Z'),
    tags: ['logging', 'monitoring', 'observability']
  },
  {
    id: 113,
    content: 'Kullanıcı error handling strategy\'si belirledi',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-10T09:00:00Z'),
    tags: ['error-handling', 'strateji', 'best-practice']
  },
  {
    id: 114,
    content: 'Kullanıcı feature flag sistemi kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-15T14:00:00Z'),
    tags: ['feature-flag', 'deployment', 'release']
  },
  {
    id: 115,
    content: 'Kullanıcı load testing yaptı ve bottleneck\'leri tespit etti',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-20T10:00:00Z'),
    tags: ['load-testing', 'performance', 'bottleneck']
  },
  {
    id: 116,
    content: 'Express.js middleware\'ler request-response döngüsünde sıralı çalışır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-01T10:00:00Z'),
    tags: ['express', 'middleware', 'request']
  },
  {
    id: 117,
    content: 'React Context API global state yönetimi için kullanılır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-05T11:00:00Z'),
    tags: ['react', 'context', 'state']
  },
  {
    id: 118,
    content: 'TypeScript generics ile yeniden kullanılabilir tipler oluşturulur',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-10T09:00:00Z'),
    tags: ['typescript', 'generics', 'types']
  },
  {
    id: 119,
    content: 'Webpack code splitting ile bundle boyutu küçültülür',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-15T14:00:00Z'),
    tags: ['webpack', 'code-splitting', 'optimization']
  },
  {
    id: 120,
    content: 'JWT token\'lar stateless authentication için kullanılır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-20T10:00:00Z'),
    tags: ['jwt', 'auth', 'stateless']
  },
  {
    id: 121,
    content: 'CORS header\'ları cross-origin istekleri kontrol eder',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-25T11:00:00Z'),
    tags: ['cors', 'security', 'http']
  },
  {
    id: 122,
    content: 'Connection pooling database performansını artırır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-01T09:00:00Z'),
    tags: ['database', 'connection-pool', 'performance']
  },
  {
    id: 123,
    content: 'Event-driven architecture loose coupling sağlar',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-05T14:00:00Z'),
    tags: ['architecture', 'event-driven', 'coupling']
  },
  {
    id: 124,
    content: 'CQRS pattern read/write işlemlerini ayırır',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-10T10:00:00Z'),
    tags: ['cqrs', 'pattern', 'architecture']
  },
  {
    id: 125,
    content: 'Circuit breaker pattern distributed system failures\'ları handle eder',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-15T11:00:00Z'),
    tags: ['circuit-breaker', 'pattern', 'resilience']
  },
  {
    id: 126,
    content: 'Saga pattern distributed transactions\'ı yönetir',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-20T09:00:00Z'),
    tags: ['saga', 'pattern', 'distributed']
  },
  {
    id: 127,
    content: 'Kullanıcı clean code prensiplerini takip ediyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 7,
    createdAt: new Date('2026-02-01T10:00:00Z'),
    tags: ['clean-code', 'prensipler', 'kalite']
  },
  {
    id: 128,
    content: 'Kullanıcı SOLID prensiplerini uyguluyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-02-05T11:00:00Z'),
    tags: ['solid', 'prensipler', 'oop']
  },
  {
    id: 129,
    content: 'Kullanıcı DDD (Domain-Driven Design) yaklaşımını biliyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-10T09:00:00Z'),
    tags: ['ddd', 'design', 'architecture']
  },
  {
    id: 130,
    content: 'Kullanıcı pair programming deneyimine sahip',
    category: 'context',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-02-15T14:00:00Z'),
    tags: ['pair-programming', 'deneyim', 'takım']
  },
  {
    id: 131,
    content: 'Kullanıcı agile metodolojiler ile çalışıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-02-20T10:00:00Z'),
    tags: ['agile', 'metodoloji', 'sprint']
  },
  {
    id: 132,
    content: 'Kullanıcı daily standup toplantılarına katılıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-02-25T11:00:00Z'),
    tags: ['standup', 'toplantı', 'agile']
  },
  {
    id: 133,
    content: 'Kullanıcı sprint planning\'de aktif rol alıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-01T09:00:00Z'),
    tags: ['sprint', 'planning', 'agile']
  },
  {
    id: 134,
    content: 'Kullanıcı retrospective toplantılarında feedback veriyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-05T14:00:00Z'),
    tags: ['retrospective', 'feedback', 'agile']
  },
  {
    id: 135,
    content: 'Kullanıcı technical debt tracking yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-10T10:00:00Z'),
    tags: ['technical-debt', 'tracking', 'kalite']
  },
  {
    id: 136,
    content: 'Kullanıcı code freeze dönemlerinde deployment yapmıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-03-15T11:00:00Z'),
    tags: ['code-freeze', 'deployment', 'kural']
  },
  {
    id: 137,
    content: 'Kullanıcı hotfix için özel branch kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-20T09:00:00Z'),
    tags: ['hotfix', 'branch', 'git']
  },
  {
    id: 138,
    content: 'Kullanıcı release notes yazıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-25T14:00:00Z'),
    tags: ['release-notes', 'dokümantasyon', 'release']
  },
  {
    id: 139,
    content: 'Kullanıcı incident response prosedürlerini biliyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-28T10:00:00Z'),
    tags: ['incident', 'response', 'prosedür']
  },
  {
    id: 140,
    content: 'Kullanıcı on-call rotation\'da yer alıyor',
    category: 'context',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-03-29T11:00:00Z'),
    tags: ['on-call', 'rotation', 'sorumluluk']
  },
  // Ek bellekler - ID 141-200
  {
    id: 141,
    content: 'Kullanıcı A/B testing metodolojilerini uyguluyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    tags: ['ab-testing', 'testing', 'methodology']
  },
  {
    id: 142,
    content: 'Kullanıcı canary deployment stratejisini kullanıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-02T11:00:00Z'),
    tags: ['canary', 'deployment', 'strategy']
  },
  {
    id: 143,
    content: 'Kullanıcı blue-green deployment deneyimine sahip',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-03T09:00:00Z'),
    tags: ['blue-green', 'deployment', 'strategy']
  },
  {
    id: 144,
    content: 'Kullanıcı infrastructure as code (IaC) kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-04T14:00:00Z'),
    tags: ['iac', 'infrastructure', 'terraform']
  },
  {
    id: 145,
    content: 'Kullanıcı Terraform ile cloud resource yönetimi yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-05T10:00:00Z'),
    tags: ['terraform', 'cloud', 'infrastructure']
  },
  {
    id: 146,
    content: 'Kullanıcı Ansible ile configuration management yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-06T11:00:00Z'),
    tags: ['ansible', 'configuration', 'automation']
  },
  {
    id: 147,
    content: 'Kullanıcı Prometheus ile monitoring kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-07T09:00:00Z'),
    tags: ['prometheus', 'monitoring', 'metrics']
  },
  {
    id: 148,
    content: 'Kullanıcı Grafana dashboard\'ları oluşturdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-08T14:00:00Z'),
    tags: ['grafana', 'dashboard', 'visualization']
  },
  {
    id: 149,
    content: 'Kullanıcı ELK stack ile log analysis yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-09T10:00:00Z'),
    tags: ['elk', 'logging', 'analysis']
  },
  {
    id: 150,
    content: 'Kullanıcı distributed tracing için Jaeger kullanıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-10T11:00:00Z'),
    tags: ['jaeger', 'tracing', 'distributed']
  },
  {
    id: 151,
    content: 'Kullanıcı service mesh (Istio) deneyimine sahip',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-11T09:00:00Z'),
    tags: ['istio', 'service-mesh', 'kubernetes']
  },
  {
    id: 152,
    content: 'Kullanıcı API gateway (Kong) kullanıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-12T14:00:00Z'),
    tags: ['kong', 'api-gateway', 'microservices']
  },
  {
    id: 153,
    content: 'Kullanıcı event sourcing pattern\'ini uyguladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-13T10:00:00Z'),
    tags: ['event-sourcing', 'pattern', 'architecture']
  },
  {
    id: 154,
    content: 'Kullanıcı event store olarak EventStoreDB kullandı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-14T11:00:00Z'),
    tags: ['eventstore', 'database', 'event-sourcing']
  },
  {
    id: 155,
    content: 'Kullanıcı Apache Kafka ile event streaming kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-15T09:00:00Z'),
    tags: ['kafka', 'streaming', 'events']
  },
  {
    id: 156,
    content: 'Kullanıcı gRPC ile high-performance IPC yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-16T14:00:00Z'),
    tags: ['grpc', 'ipc', 'performance']
  },
  {
    id: 157,
    content: 'Kullanıcı Protocol Buffers ile serialization yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-17T10:00:00Z'),
    tags: ['protobuf', 'serialization', 'grpc']
  },
  {
    id: 158,
    content: 'Kullanıcı GraphQL subscription ile real-time updates sağladı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-18T11:00:00Z'),
    tags: ['graphql', 'subscription', 'real-time']
  },
  {
    id: 159,
    content: 'Kullanıcı Apollo Client ile GraphQL state management yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-19T09:00:00Z'),
    tags: ['apollo', 'graphql', 'state']
  },
  {
    id: 160,
    content: 'Kullanıcı React Query ile server state yönetimi yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-20T14:00:00Z'),
    tags: ['react-query', 'state', 'server']
  },
  {
    id: 161,
    content: 'Kullanıcı Zustand ile client state yönetimi yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-21T10:00:00Z'),
    tags: ['zustand', 'state', 'client']
  },
  {
    id: 162,
    content: 'Kullanıcı Tailwind CSS ile styling yapıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-22T11:00:00Z'),
    tags: ['tailwind', 'css', 'styling']
  },
  {
    id: 163,
    content: 'Kullanıcı Storybook ile component documentation yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-23T09:00:00Z'),
    tags: ['storybook', 'documentation', 'components']
  },
  {
    id: 164,
    content: 'Kullanıcı Chromatic ile visual regression testing yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-24T14:00:00Z'),
    tags: ['chromatic', 'visual-testing', 'regression']
  },
  {
    id: 165,
    content: 'Kullanıcı Playwright ile E2E testing yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-25T10:00:00Z'),
    tags: ['playwright', 'e2e', 'testing']
  },
  {
    id: 166,
    content: 'Kullanıcı Cypress ile E2E testing deneyimi var',
    category: 'context',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-26T11:00:00Z'),
    tags: ['cypress', 'e2e', 'testing']
  },
  {
    id: 167,
    content: 'Kullanıcı Testing Library ile component testing yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 6,
    createdAt: new Date('2026-03-27T09:00:00Z'),
    tags: ['testing-library', 'react', 'testing']
  },
  {
    id: 168,
    content: 'Kullanıcı MSW (Mock Service Worker) ile API mocking yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-28T14:00:00Z'),
    tags: ['msw', 'mocking', 'testing']
  },
  {
    id: 169,
    content: 'Kullanıcı Nx monorepo tool\'unu kullanıyor',
    category: 'preference',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-29T10:00:00Z'),
    tags: ['nx', 'monorepo', 'tool']
  },
  {
    id: 170,
    content: 'Kullanıcı Turborepo ile build optimization yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-30T11:00:00Z'),
    tags: ['turborepo', 'build', 'optimization']
  },
  // ID 171-200 - Ek çeşitli bellekler
  {
    id: 171,
    content: 'Kullanıcı WebSocket connection pooling implementasyonu yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    tags: ['websocket', 'pooling', 'optimization']
  },
  {
    id: 172,
    content: 'Kullanıcı Redis pub/sub ile real-time notifications kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-02T11:00:00Z'),
    tags: ['redis', 'pub-sub', 'notifications']
  },
  {
    id: 173,
    content: 'Kullanıcı Server-Sent Events (SSE) deneyimine sahip',
    category: 'context',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-03-03T09:00:00Z'),
    tags: ['sse', 'real-time', 'streaming']
  },
  {
    id: 174,
    content: 'Kullanıcı Long Polling fallback mekanizması kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-04T14:00:00Z'),
    tags: ['long-polling', 'fallback', 'real-time']
  },
  {
    id: 175,
    content: 'Kullanıcı WebSocket reconnection logic yazdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-05T10:00:00Z'),
    tags: ['websocket', 'reconnection', 'reliability']
  },
  {
    id: 176,
    content: 'Kullanıcı heartbeat mechanism ile connection health monitoring yapıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-06T11:00:00Z'),
    tags: ['heartbeat', 'monitoring', 'websocket']
  },
  {
    id: 177,
    content: 'Kullanıcı binary WebSocket frames ile performans optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-07T09:00:00Z'),
    tags: ['websocket', 'binary', 'performance']
  },
  {
    id: 178,
    content: 'Kullanıcı WebSocket compression (permessage-deflate) aktif etti',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-08T14:00:00Z'),
    tags: ['websocket', 'compression', 'performance']
  },
  {
    id: 179,
    content: 'Kullanıcı rate limiting için token bucket algorithm kullanıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-09T10:00:00Z'),
    tags: ['rate-limiting', 'token-bucket', 'algorithm']
  },
  {
    id: 180,
    content: 'Kullanıcı sliding window rate limiting implementasyonu yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-10T11:00:00Z'),
    tags: ['rate-limiting', 'sliding-window', 'implementation']
  },
  {
    id: 181,
    content: 'Kullanıcı distributed rate limiting için Redis kullanıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-11T09:00:00Z'),
    tags: ['rate-limiting', 'redis', 'distributed']
  },
  {
    id: 182,
    content: 'Kullanıcı request coalescing ile duplicate request\'leri önlüyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-12T14:00:00Z'),
    tags: ['coalescing', 'optimization', 'caching']
  },
  {
    id: 183,
    content: 'Kullanıcı response caching için stale-while-revalidate kullanıyor',
    category: 'technical',
    memoryType: 'semantic',
    importance: 5,
    createdAt: new Date('2026-03-13T10:00:00Z'),
    tags: ['caching', 'stale-while-revalidate', 'http']
  },
  {
    id: 184,
    content: 'Kullanıcı cache invalidation strategy belirledi',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-14T11:00:00Z'),
    tags: ['caching', 'invalidation', 'strategy']
  },
  {
    id: 185,
    content: 'Kullanıcı cache stampede prevention için mutex kullandı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-15T09:00:00Z'),
    tags: ['caching', 'stampede', 'prevention']
  },
  {
    id: 186,
    content: 'Kullanıcı CDN configuration optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-16T14:00:00Z'),
    tags: ['cdn', 'optimization', 'performance']
  },
  {
    id: 187,
    content: 'Kullanıcı image optimization pipeline kurdu',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-17T10:00:00Z'),
    tags: ['image', 'optimization', 'pipeline']
  },
  {
    id: 188,
    content: 'Kullanıcı lazy loading ile initial load time\'ı düşürdü',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-18T11:00:00Z'),
    tags: ['lazy-loading', 'performance', 'optimization']
  },
  {
    id: 189,
    content: 'Kullanıcı prefetching ile navigation performance\'ı artırdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 4,
    createdAt: new Date('2026-03-19T09:00:00Z'),
    tags: ['prefetching', 'performance', 'navigation']
  },
  {
    id: 190,
    content: 'Kullanıcı Core Web Vitals optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-20T14:00:00Z'),
    tags: ['core-web-vitals', 'performance', 'seo']
  },
  {
    id: 191,
    content: 'Kullanıcı LCP (Largest Contentful Paint) optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-21T10:00:00Z'),
    tags: ['lcp', 'performance', 'optimization']
  },
  {
    id: 192,
    content: 'Kullanıcı FID (First Input Delay) optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-22T11:00:00Z'),
    tags: ['fid', 'performance', 'optimization']
  },
  {
    id: 193,
    content: 'Kullanıcı CLS (Cumulative Layout Shift) optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-23T09:00:00Z'),
    tags: ['cls', 'performance', 'optimization']
  },
  {
    id: 194,
    content: 'Kullanıcı INP (Interaction to Next Paint) optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-24T14:00:00Z'),
    tags: ['inp', 'performance', 'optimization']
  },
  {
    id: 195,
    content: 'Kullanıcı bundle analysis ile code splitting optimization yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-25T10:00:00Z'),
    tags: ['bundle', 'code-splitting', 'analysis']
  },
  {
    id: 196,
    content: 'Kullanıcı tree shaking ile unused code\'ları kaldırdı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-26T11:00:00Z'),
    tags: ['tree-shaking', 'optimization', 'bundle']
  },
  {
    id: 197,
    content: 'Kullanıcı source map generation production\'da devre dışı bıraktı',
    category: 'preference',
    memoryType: 'semantic',
    importance: 4,
    createdAt: new Date('2026-03-27T09:00:00Z'),
    tags: ['source-map', 'production', 'security']
  },
  {
    id: 198,
    content: 'Kullanıcı error boundary ile graceful error handling yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-28T14:00:00Z'),
    tags: ['error-boundary', 'react', 'error-handling']
  },
  {
    id: 199,
    content: 'Kullanıcı error tracking için Sentry entegrasyonu yaptı',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 6,
    createdAt: new Date('2026-03-29T10:00:00Z'),
    tags: ['sentry', 'error-tracking', 'monitoring']
  },
  {
    id: 200,
    content: 'Kullanıcı session replay ile user experience analysis yapıyor',
    category: 'episodic',
    memoryType: 'episodic',
    importance: 5,
    createdAt: new Date('2026-03-30T11:00:00Z'),
    tags: ['session-replay', 'ux', 'analysis']
  }
];

// ========== Sorgu Veri Seti (50+ sorgu) ==========

export const benchmarkQueries: BenchmarkQuery[] = [
  // ----- Kolay Sorgular (Easy) - Doğrudan eşleşme -----
  {
    id: 'q-easy-1',
    query: 'TypeScript kullanıyor musun?',
    relevantMemoryIds: [1],
    difficulty: 'easy',
    category: 'preference',
    description: 'Kullanıcının TypeScript tercihini sorgulama'
  },
  {
    id: 'q-easy-2',
    query: 'Hangi editörü kullanıyorsun?',
    relevantMemoryIds: [4],
    difficulty: 'easy',
    category: 'preference',
    description: 'Editör tercihi sorgulama'
  },
  {
    id: 'q-easy-3',
    query: 'Koyu tema mı açık tema mı?',
    relevantMemoryIds: [3],
    difficulty: 'easy',
    category: 'preference',
    description: 'Tema tercihi sorgulama'
  },
  {
    id: 'q-easy-4',
    query: 'React mi Vue mu?',
    relevantMemoryIds: [9],
    difficulty: 'easy',
    category: 'preference',
    description: 'Framework tercihi sorgulama'
  },
  {
    id: 'q-easy-5',
    query: 'PostgreSQL mi MySQL mi?',
    relevantMemoryIds: [10],
    difficulty: 'easy',
    category: 'preference',
    description: 'Veritabanı tercihi sorgulama'
  },
  {
    id: 'q-easy-6',
    query: 'PenceAI nedir?',
    relevantMemoryIds: [76, 77],
    difficulty: 'easy',
    category: 'factual',
    description: 'Proje tanımı sorgulama'
  },
  {
    id: 'q-easy-7',
    query: 'PenceAI hangi veritabanını kullanıyor?',
    relevantMemoryIds: [77],
    difficulty: 'easy',
    category: 'factual',
    description: 'Teknik detay sorgulama'
  },
  {
    id: 'q-easy-8',
    query: 'Kullanıcı adın ne?',
    relevantMemoryIds: [91],
    difficulty: 'easy',
    category: 'factual',
    description: 'Kullanıcı bilgisi sorgulama'
  },
  {
    id: 'q-easy-9',
    query: 'Nerede yaşıyorsun?',
    relevantMemoryIds: [92],
    difficulty: 'easy',
    category: 'factual',
    description: 'Konum bilgisi sorgulama'
  },
  {
    id: 'q-easy-10',
    query: 'Kaç yıllık deneyimin var?',
    relevantMemoryIds: [93],
    difficulty: 'easy',
    category: 'factual',
    description: 'Deneyim bilgisi sorgulama'
  },

  // ----- Orta Zorlukta Sorgular (Medium) - İlişkisel eşleşme -----
  {
    id: 'q-med-1',
    query: 'Frontend geliştirme için hangi teknolojileri kullanıyorsun?',
    relevantMemoryIds: [1, 9, 18, 162],
    difficulty: 'medium',
    category: 'preference',
    description: 'Birden fazla tercih bilgisini birleştirme'
  },
  {
    id: 'q-med-2',
    query: 'Test yazarken ne kullanıyorsun?',
    relevantMemoryIds: [20, 101, 165, 167],
    difficulty: 'medium',
    category: 'preference',
    description: 'Test araçları tercihlerini sorgulama'
  },
  {
    id: 'q-med-3',
    query: 'PenceAI\'ın bellek sistemi nasıl çalışıyor?',
    relevantMemoryIds: [78, 84, 85],
    difficulty: 'medium',
    category: 'factual',
    description: 'Sistem mimarisi sorgulama'
  },
  {
    id: 'q-med-4',
    query: 'Docker ile ne tür çalışmalar yaptın?',
    relevantMemoryIds: [15, 44, 60],
    difficulty: 'medium',
    category: 'follow_up',
    description: 'Geçmiş deneyimleri sorgulama'
  },
  {
    id: 'q-med-5',
    query: 'API geliştirme deneyimlerin neler?',
    relevantMemoryIds: [19, 45, 53, 111],
    difficulty: 'medium',
    category: 'follow_up',
    description: 'API deneyimlerini sorgulama'
  },
  {
    id: 'q-med-6',
    query: 'Authentication için ne kullanıyorsun?',
    relevantMemoryIds: [51, 75, 120],
    difficulty: 'medium',
    category: 'preference',
    description: 'Auth teknolojilerini sorgulama'
  },
  {
    id: 'q-med-7',
    query: 'Performance optimization için neler yaptın?',
    relevantMemoryIds: [108, 115, 188, 190],
    difficulty: 'medium',
    category: 'follow_up',
    description: 'Optimizasyon deneyimlerini sorgulama'
  },
  {
    id: 'q-med-8',
    query: 'Monitoring ve observability için ne kullanıyorsun?',
    relevantMemoryIds: [112, 147, 148, 149],
    difficulty: 'medium',
    category: 'preference',
    description: 'Monitoring araçlarını sorgulama'
  },
  {
    id: 'q-med-9',
    query: 'Microservices mimarisinde ne tür pattern\'ler kullandın?',
    relevantMemoryIds: [123, 124, 125, 126],
    difficulty: 'medium',
    category: 'follow_up',
    description: 'Architecture pattern\'lerini sorgulama'
  },
  {
    id: 'q-med-10',
    query: 'State management için ne kullanıyorsun?',
    relevantMemoryIds: [117, 159, 160, 161],
    difficulty: 'medium',
    category: 'preference',
    description: 'State management araçlarını sorgulama'
  },

  // ----- Zor Sorgular (Hard) - Karmaşık ilişkisel eşleşme -----
  {
    id: 'q-hard-1',
    query: 'Son projelerinde karşılaştığın technical challenge\'lar nelerdi ve nasıl çözdün?',
    relevantMemoryIds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Geçmiş deneyimleri ve çözümleri kapsamlı sorgulama'
  },
  {
    id: 'q-hard-2',
    query: 'Full-stack geliştirme sürecinde kullandığın tüm teknolojileri ve neden tercih ettiğini anlat',
    relevantMemoryIds: [1, 4, 9, 10, 15, 18, 19, 20, 94],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Kapsamlı teknoloji stack\'ini sorgulama'
  },
  {
    id: 'q-hard-3',
    query: 'PenceAI projesinin tüm özelliklerini ve nasıl çalıştığını detaylı açıkla',
    relevantMemoryIds: [76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Proje mimarisini kapsamlı sorgulama'
  },
  {
    id: 'q-hard-4',
    query: 'DevOps ve deployment süreçlerinde kullandığın tüm araçlar ve metodolojiler neler?',
    relevantMemoryIds: [14, 15, 25, 33, 50, 98, 142, 143, 144, 145],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'DevOps süreçlerini kapsamlı sorgulama'
  },
  {
    id: 'q-hard-5',
    query: 'Real-time uygulamalar geliştirirken kullandığın teknolojiler ve karşılaştığın zorluklar neler?',
    relevantMemoryIds: [48, 171, 172, 173, 174, 175, 176],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Real-time development deneyimlerini sorgulama'
  },
  {
    id: 'q-hard-6',
    query: 'Kod kalitesi ve best practices için neler yapıyorsun?',
    relevantMemoryIds: [101, 102, 103, 127, 128],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Kod kalitesi süreçlerini sorgulama'
  },
  {
    id: 'q-hard-7',
    query: 'Agile süreçlerindeki rolün ve deneyimlerin neler?',
    relevantMemoryIds: [131, 132, 133, 134, 135],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Agile deneyimlerini sorgulama'
  },
  {
    id: 'q-hard-8',
    query: 'Frontend performance optimization için tüm yaptıklarını anlat',
    relevantMemoryIds: [188, 189, 190, 191, 192, 193, 194, 195, 196],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Frontend optimizasyonlarını kapsamlı sorgulama'
  },
  {
    id: 'q-hard-9',
    query: 'Event-driven architecture ve message queue deneyimlerin neler?',
    relevantMemoryIds: [37, 55, 123, 153, 154, 155],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Event-driven sistem deneyimlerini sorgulama'
  },
  {
    id: 'q-hard-10',
    query: 'Security ve error handling için uyguladığın tüm önlemler neler?',
    relevantMemoryIds: [51, 109, 113, 121, 198, 199],
    difficulty: 'hard',
    category: 'exploratory',
    description: 'Security süreçlerini kapsamlı sorgulama'
  },

  // ----- Follow-up Sorgular -----
  {
    id: 'q-follow-1',
    query: 'TypeScript öğrenmeye ne zaman başladın?',
    relevantMemoryIds: [41],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-2',
    query: 'İlk React component\'ini ne zaman yazdın?',
    relevantMemoryIds: [42],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-3',
    query: 'PostgreSQL kurulumunu ne zaman tamamladın?',
    relevantMemoryIds: [43],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-4',
    query: 'Docker ile ilk container\'ı ne zaman oluşturdun?',
    relevantMemoryIds: [44],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-5',
    query: 'WebSocket ile chat uygulamasını ne zaman yaptın?',
    relevantMemoryIds: [48],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-6',
    query: 'OAuth authentication\'ı ne zaman tamamladın?',
    relevantMemoryIds: [51],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-7',
    query: 'Elasticsearch search\'ü ne zaman ekledin?',
    relevantMemoryIds: [52],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-8',
    query: 'GraphQL API gateway\'i ne zaman oluşturdun?',
    relevantMemoryIds: [53],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-9',
    query: 'MongoDB migration\'ı ne zaman tamamladın?',
    relevantMemoryIds: [54],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },
  {
    id: 'q-follow-10',
    query: 'RabbitMQ entegrasyonunu ne zaman yaptın?',
    relevantMemoryIds: [55],
    difficulty: 'easy',
    category: 'follow_up',
    description: 'Geçmiş olayı sorgulama'
  },

  // ----- Factual Sorgular -----
  {
    id: 'q-fact-1',
    query: 'TypeScript ne zaman yayınlandı?',
    relevantMemoryIds: [21],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-2',
    query: 'React hangi yıl yayınlandı?',
    relevantMemoryIds: [22],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-3',
    query: 'Node.js\'i kim oluşturdu?',
    relevantMemoryIds: [23],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-4',
    query: 'Git\'i kim geliştirdi?',
    relevantMemoryIds: [26],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-5',
    query: 'JavaScript kaç yılında oluşturuldu?',
    relevantMemoryIds: [27],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-6',
    query: 'Docker ne zaman yayınlandı?',
    relevantMemoryIds: [25],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-7',
    query: 'Kubernetes hangi yıl açık source oldu?',
    relevantMemoryIds: [33],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    id: 'q-fact-8',
    query: 'GraphQL ne zaman yayınlandı?',
    relevantMemoryIds: [38],
    difficulty: 'easy',
    category: 'factual',
    description: 'Tarihi bilgi sorgulama'
  },
  {
    'id': 'q-fact-9',
    'query': 'OAuth 2.0 ne zaman standardize edildi?',
    'relevantMemoryIds': [40],
    'difficulty': 'easy',
    'category': 'factual',
    'description': 'Tarihi bilgi sorgulama'
  },
  {
    'id': 'q-fact-10',
    'query': 'WebSocket ne zaman standardize edildi?',
    'relevantMemoryIds': [39],
    'difficulty': 'easy',
    'category': 'factual',
    'description': 'Tarihi bilgi sorgulama'
  },

  // ----- Exploratory Sorgular -----
  {
    'id': 'q-exp-1',
    'query': 'Yazılım geliştirme sürecinde en çok hangi teknolojileri kullanıyorsun ve neden?',
    'relevantMemoryIds': [1, 4, 9, 10, 15, 18, 19, 20, 94, 97],
    'difficulty': 'hard',
    'category': 'exploratory',
    'description': 'Kapsamlı teknoloji tercihlerini sorgulama'
  },
  {
    'id': 'q-exp-2',
    'query': 'Öğrenme sürecinde hangi kaynakları ve yöntemleri kullanıyorsun?',
    'relevantMemoryIds': [5, 7, 100, 103],
    'difficulty': 'medium',
    'category': 'exploratory',
    'description': 'Öğrenme yöntemlerini sorgulama'
  },
  {
    'id': 'q-exp-3',
    'query': 'Takım çalışması ve collaboration için neler yapıyorsun?',
    'relevantMemoryIds': [102, 130, 131, 132, 133, 134],
    'difficulty': 'medium',
    'category': 'exploratory',
    'description': 'Takım çalışması süreçlerini sorgulama'
  },
  {
    'id': 'q-exp-4',
    'query': 'Proje yönetimi ve organizasyon için hangi araçları kullanıyorsun?',
    'relevantMemoryIds': [14, 16, 47, 104, 169],
    'difficulty': 'medium',
    'category': 'exploratory',
    'description': 'Proje yönetimi araçlarını sorgulama'
  },
  {
    'id': 'q-exp-5',
    'query': 'Continuous integration ve deployment için ne tür süreçlerin var?',
    'relevantMemoryIds': [98, 107, 142, 143, 145],
    'difficulty': 'hard',
    'category': 'exploratory',
    'description': 'CI/CD süreçlerini sorgulama'
  }
];

// ========== Dataset Metadata ==========

export function getBenchmarkDataset(): BenchmarkDataset {
  const categoryDistribution: Record<string, number> = {};
  const difficultyDistribution: Record<string, number> = {};

  for (const query of benchmarkQueries) {
    categoryDistribution[query.category] = (categoryDistribution[query.category] || 0) + 1;
    difficultyDistribution[query.difficulty] = (difficultyDistribution[query.difficulty] || 0) + 1;
  }

  return {
    queries: benchmarkQueries,
    memories: benchmarkMemories,
    metadata: {
      totalQueries: benchmarkQueries.length,
      totalMemories: benchmarkMemories.length,
      categoryDistribution,
      difficultyDistribution
    }
  };
}

// ========== MemoryRow Dönüşümü ==========

export function toMemoryRow(memory: BenchmarkMemory): MemoryRow {
  return {
    id: memory.id,
    user_id: 'benchmark-user',
    category: memory.category,
    content: memory.content,
    importance: memory.importance,
    access_count: 0,
    is_archived: 0,
    last_accessed: null,
    created_at: memory.createdAt.toISOString(),
    updated_at: memory.createdAt.toISOString(),
    provenance_source: 'benchmark',
    provenance_conversation_id: 'benchmark-conv',
    provenance_message_id: null,
    confidence: 0.9,
    review_profile: 'standard',
    memory_type: memory.memoryType,
    stability: null,
    retrievability: null,
    next_review_at: null,
    review_count: null,
    max_importance: null
  };
}

export function toMemoryRows(memories: BenchmarkMemory[]): MemoryRow[] {
  return memories.map(toMemoryRow);
}
