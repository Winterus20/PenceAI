/**
 * MCP Marketplace — Tip Tanımları
 *
 * Marketplace catalog entry'leri ve kurulu server kayıtları
 * için TypeScript tip tanımlamaları.
 */

// ============================================================
// MCP Marketplace Catalog Entry
// ============================================================

/**
 * MCP Marketplace'teki bir server'ın catalog tanımı.
 * Local catalog veya registry API'den gelen server bilgilerini içerir.
 */
export interface MCPServerCatalogEntry {
  /** Server adı (unique identifier) */
  name: string;

  /** Server açıklaması */
  description: string;

  /** Versiyon */
  version: string;

  /** Yazar/yayıncı */
  author: string;

  /** Etiketler (arama ve kategorizasyon için) */
  tags: string[];

  /** İkon (opsiyonel, emoji veya URL) */
  icon?: string;

  /** Çalıştırılacak komut */
  command: string;

  /** Varsayılan argümanlar */
  defaultArgs: string[];

  /** Varsayılan ortam değişkenleri */
  defaultEnv: Record<string, string>;

  /** Kaynak URL (dökümantasyon, GitHub, vs.) */
  sourceUrl: string;

  /** NPM paket adı (opsiyonel) */
  npmPackage?: string;

  /** GitHub repository (opsiyonel) */
  githubRepo?: string;

  /** Sunulan araçlar listesi */
  tools: string[];

  /** Kullanıcı puanı (1-5, opsiyonel) */
  rating?: number;

  /** Kurulum sayısı (opsiyonel) */
  installCount?: number;
}

// ============================================================
// MCP Server Record (Installed)
// ============================================================

/**
 * Kurulu bir MCP server'ın yaşam döngüsü durumu.
 *
 * - `available`: Catalog'da mevcut ama kurulu değil
 * - `installed`: Kuruldu ama aktif değil
 * - `active`: Kurulu ve çalışıyor
 * - `disabled`: Kurulu ama devre dışı bırakıldı
 * - `error`: Kurulum veya çalıştırma hatası
 */
export type MCPServerLifecycleStatus = 'available' | 'installed' | 'active' | 'disabled' | 'error';

/**
 * Kurulu bir MCP server'ın kayıt bilgileri.
 * Marketplace'ten kurulum veya manuel ekleme ile oluşur.
 */
export interface MCPServerRecord {
  /** Veritabanı ID (opsiyonel, SQLite için) */
  id?: number;

  /** Server adı */
  name: string;

  /** Server açıklaması */
  description: string;

  /** Çalıştırılacak komut */
  command: string;

  /** Komut argümanları */
  args: string[];

  /** Ortam değişkenleri */
  env: Record<string, string>;

  /** Çalışma dizini (opsiyonel) */
  cwd?: string;

  /** Timeout (ms) */
  timeout: number;

  /** Mevcut durum */
  status: MCPServerLifecycleStatus;

  /** Kurulu versiyon */
  version: string;

  /** Kaynak türü */
  source: 'local' | 'marketplace' | 'npm' | 'github';

  /** Kaynak URL (opsiyonel) */
  sourceUrl?: string;

  /** Kurulum zamanı (timestamp) */
  installedAt?: number;

  /** Son aktivasyon zamanı (timestamp) */
  lastActivated?: number;

  /** Son hata mesajı (opsiyonel) */
  lastError?: string;

  /** Kullanılabilir araç sayısı */
  toolCount: number;

  /** Ek metadata */
  metadata: Record<string, unknown>;
}

// ============================================================
// API Response Types
// ============================================================

/**
 * Marketplace catalog API yanıtı.
 */
export interface MarketplaceCatalogResponse {
  success: boolean;
  catalog?: MCPServerCatalogEntry[];
  error?: string;
}

/**
 * Kurulu server'lar API yanıtı.
 */
export interface InstalledServersResponse {
  success: boolean;
  servers?: MCPServerRecord[];
  summary?: {
    total: number;
    active: number;
    disabled: number;
    error: number;
  };
  error?: string;
}

/**
 * Server işlem sonucu (install, activate, deactivate, uninstall).
 */
export interface ServerActionResult {
  success: boolean;
  server?: MCPServerRecord;
  error?: string;
}

/**
 * Server araç listesi API yanıtı.
 */
export interface ServerToolsResponse {
  success: boolean;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  error?: string;
}
