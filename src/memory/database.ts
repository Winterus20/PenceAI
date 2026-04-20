import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as sqliteVec from "sqlite-vec";
import { logger, calculateCost } from '../utils/index.js';
import { REVIEW_SCHEDULE_FACTOR } from './ebbinghaus.js';

/** Token usage kayıt tipi */
export interface TokenUsageRecord {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/** Token usage istatistik tipi */
export interface TokenUsageStats {
  totalTokens: number;
  totalCost: number;
  providerBreakdown: Record<string, { tokens: number; cost: number }>;
}

/** Günlük kullanım entry tipi */
export interface DailyUsageEntry {
  date: string;
  tokens: number;
  cost: number;
}

/**
 * SQLite veritabanı bağlantısı ve şema yönetimi.
 */
export class PenceDatabase {
  private db: Database.Database;
  private embeddingDimensions: number;

  /** En son migration versiyonu. Her yeni migration'da artırın. */
  private static readonly LATEST_SCHEMA_VERSION = 18;

  constructor(dbPath: string, embeddingDimensions: number = 1536) {
    // data dizinini oluştur
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.embeddingDimensions = embeddingDimensions;
    this.db = new Database(dbPath);

    // WAL modu ve optimizasyonlar
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    this.initSchema();

    // Embedding boyut değişikliği kontrolü — mevcut DB farklı boyuttaysa uyarı ver
    this.validateEmbeddingDimensions();
  }

  private initSchema(): void {
    this.db.exec(`
      -- Konuşmalar
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT DEFAULT '',
        title TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        is_summarized INTEGER DEFAULT 0,
        parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        branch_point_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        display_order TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Mesajlar
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL DEFAULT '',
        tool_calls TEXT,      -- JSON
        tool_results TEXT,    -- JSON
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- Uzun vadeli bellekler
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        content TEXT NOT NULL,
        importance INTEGER DEFAULT 5,
        access_count INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        last_accessed DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        provenance_source TEXT,
        provenance_conversation_id TEXT,
        provenance_message_id INTEGER,
        confidence REAL DEFAULT 0.7,
        review_profile TEXT DEFAULT 'standard',
        memory_type TEXT DEFAULT 'semantic' CHECK(memory_type IN ('episodic', 'semantic'))
      );

      -- Yüklü skill'ler
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        version TEXT DEFAULT '1.0.0',
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Zamanlanmış görevler
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        action TEXT NOT NULL,          -- JSON: ne yapılacak
        enabled INTEGER DEFAULT 1,
        last_run DATETIME,
        next_run DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- FTS5 tam metin arama (bellekler için)
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        category,
        content=memories,
        content_rowid=id
      );

      -- FTS5 tam metin arama (mesajlar için)
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=id
      );

      -- FTS tetikleyicileri
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
        INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      -- Bellek embedding vektörleri (semantik benzerlik araması için sqlite-vec ile)
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
        embedding float[${this.embeddingDimensions}]
      );

      -- Mesaj embedding vektörleri (mesajlarda semantik arama için)
      CREATE VIRTUAL TABLE IF NOT EXISTS message_embeddings USING vec0(
        embedding float[${this.embeddingDimensions}]
      );

      -- Bellek entity'leri (kişi, teknoloji, proje, kavram vb.)
      CREATE TABLE IF NOT EXISTS memory_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        normalized_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(normalized_name, type)
      );

      -- Bellek ilişkileri (bellekler arası graph edge'leri)
      CREATE TABLE IF NOT EXISTS memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_memory_id INTEGER NOT NULL,
        target_memory_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'related_to',
        confidence REAL DEFAULT 0.5,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        UNIQUE(source_memory_id, target_memory_id, relation_type)
      );

      -- Bellek-entity bağlantı tablosu
      CREATE TABLE IF NOT EXISTS memory_entity_links (
        memory_id INTEGER NOT NULL,
        entity_id INTEGER NOT NULL,
        PRIMARY KEY (memory_id, entity_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES memory_entities(id) ON DELETE CASCADE
      );

      -- İndeksler
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conv_role_id ON messages(conversation_id, role, id);
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);
      CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_type, channel_id);
      CREATE INDEX IF NOT EXISTS idx_memory_relations_source ON memory_relations(source_memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entity_links_entity ON memory_entity_links(entity_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entities_normalized ON memory_entities(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      
      -- Composite index: Konuşma mesajlarını rol ve tarih ile sıralı getirmek için
      CREATE INDEX IF NOT EXISTS idx_messages_conv_role_created ON messages(conversation_id, role, created_at DESC);

      -- Anahtar-değer ayarlar tablosu
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- MCP Marketplace server'ları (kalıcı depolama)
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY,
        description TEXT DEFAULT '',
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        cwd TEXT,
        timeout INTEGER DEFAULT 30000,
        status TEXT DEFAULT 'installed' CHECK(status IN ('available', 'installed', 'active', 'disabled', 'error')),
        version TEXT DEFAULT '1.0.0',
        source TEXT DEFAULT 'marketplace',
        source_url TEXT,
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activated DATETIME,
        last_error TEXT,
        tool_count INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status);

      -- Token usage tracking (toplam istatistik için, conversation_id yok)
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
      CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider);

      -- Metrics tablosu (yerel observability)
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        performance_json TEXT NOT NULL,
        cost_json TEXT NOT NULL,
        context_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_conversation ON metrics(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_message ON metrics(message_id);
    `);

    this.migrate();
  }

  private getSchemaVersion(): number {
    try {
      // Ensure settings table exists before querying
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
      if (!tableExists) return 0;
      const row = this.db.prepare("SELECT value FROM settings WHERE key='schema_version'").get() as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }

  private setSchemaVersion(version: number): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('schema_version', ?, CURRENT_TIMESTAMP)").run(String(version));
  }

  /**
   * Veritabanı şemasını günceller (Migration).
   */
  private migrate(): void {
    const currentVersion = this.getSchemaVersion();
    if (currentVersion >= PenceDatabase.LATEST_SCHEMA_VERSION) return;

    this.db.transaction(() => {
    // Tablo bilgilerini cache-le (N+1 pragma sorgularını azalt)
    const memoriesTableInfo = this.db.prepare("PRAGMA table_info(memories)").all() as any[];
    const convTableInfo = this.db.prepare("PRAGMA table_info(conversations)").all() as any[];
    const msgTableInfo = this.db.prepare("PRAGMA table_info(messages)").all() as any[];
    const relTableInfo = this.db.prepare("PRAGMA table_info(memory_relations)").all() as any[];

    const hasArchived = memoriesTableInfo.some(col => col.name === 'is_archived');

    if (!hasArchived) {
      logger.info('[Database] 🚀 Migrating: Adding is_archived column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN is_archived INTEGER DEFAULT 0");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived)");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (is_archived):');
      }
    }

    // message_embeddings tablosunu oluştur (yoksa — eski DB'ler için)
    const msgEmbedTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='message_embeddings'"
    ).get();
    if (!msgEmbedTable) {
      logger.info('[Database] 🚀 Migrating: Creating message_embeddings table');
      try {
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS message_embeddings USING vec0(embedding float[${this.embeddingDimensions}])`);
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (message_embeddings):');
      }
    }

    // conversations tablosuna summary ve is_summarized sütunlarını ekle (yoksa)
    if (!convTableInfo.some(col => col.name === 'summary')) {
      logger.info('[Database] 🚀 Migrating: Adding summary column to conversations table');
      try {
        this.db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT ''");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (summary):');
      }
    }
    if (!convTableInfo.some((col: any) => col.name === 'is_summarized')) {
      logger.info('[Database] 🚀 Migrating: Adding is_summarized column to conversations table');
      try {
        this.db.exec("ALTER TABLE conversations ADD COLUMN is_summarized INTEGER DEFAULT 0");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (is_summarized):');
      }
    }

    // conversations tablosuna is_title_custom kolonu ekle (yoksa)
    if (!convTableInfo.some((col: any) => col.name === 'is_title_custom')) {
      logger.info('[Database] 🚀 Migrating: Adding is_title_custom column to conversations table');
      try {
        this.db.exec("ALTER TABLE conversations ADD COLUMN is_title_custom INTEGER DEFAULT 0");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (is_title_custom):');
      }
    }

    // Ebbinghaus Forgetting Curve kolonları — memories tablosuna ekle (yoksa)
    if (!memoriesTableInfo.some(col => col.name === 'stability')) {
      logger.info('[Database] 🚀 Migrating: Adding Ebbinghaus columns to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN stability REAL DEFAULT 2.0");
        this.db.exec("ALTER TABLE memories ADD COLUMN retrievability REAL DEFAULT 1.0");
        this.db.exec("ALTER TABLE memories ADD COLUMN next_review_at INTEGER");
        this.db.exec("ALTER TABLE memories ADD COLUMN review_count INTEGER DEFAULT 0");

        // Mevcut kayıtlar için dinamik stability backfill: stability = importance * 2.0
        // next_review_at: şu andan itibaren stability*REVIEW_SCHEDULE_FACTOR gün sonra (R=0.7 eşiği)
        const now = Math.floor(Date.now() / 1000);
        this.db.prepare(`
          UPDATE memories
          SET
            stability = CAST(importance AS REAL) * 2.0,
            retrievability = 1.0,
            review_count = 0,
            next_review_at = ? + CAST(CAST(importance AS REAL) * 2.0 * ${REVIEW_SCHEDULE_FACTOR} * 86400 AS INTEGER)
          WHERE is_archived = 0
        `).run(now);
        logger.info('[Database] ✅ Ebbinghaus backfill tamamlandı');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (Ebbinghaus columns):');
      }
    }

    // Memory Graph tabloları — memory_entities, memory_relations, memory_entity_links (yoksa oluştur)
    const entityTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entities'"
    ).get();
    if (!entityTable) {
      logger.info('[Database] 🚀 Migrating: Creating memory graph tables (entities, relations, links)');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS memory_entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'concept',
            normalized_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(normalized_name, type)
          );
          CREATE TABLE IF NOT EXISTS memory_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_memory_id INTEGER NOT NULL,
            target_memory_id INTEGER NOT NULL,
            relation_type TEXT NOT NULL DEFAULT 'related_to',
            confidence REAL DEFAULT 0.5,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
            FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
            UNIQUE(source_memory_id, target_memory_id, relation_type)
          );
          CREATE TABLE IF NOT EXISTS memory_entity_links (
            memory_id INTEGER NOT NULL,
            entity_id INTEGER NOT NULL,
            PRIMARY KEY (memory_id, entity_id),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
            FOREIGN KEY (entity_id) REFERENCES memory_entities(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_memory_relations_source ON memory_relations(source_memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_entity_links_entity ON memory_entity_links(entity_id);
          CREATE INDEX IF NOT EXISTS idx_memory_entities_normalized ON memory_entities(normalized_name);
        `);
        logger.info('[Database] ✅ Memory graph tabloları oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (memory graph tables):');
      }
    }

    // Archival Re-learning: max_importance kolonu — memories tablosuna ekle (yoksa)
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'max_importance')) {
      logger.info('[Database] 🚀 Migrating: Adding max_importance column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN max_importance INTEGER");
        // Backfill: max_importance = mevcut importance
        this.db.prepare(`UPDATE memories SET max_importance = importance WHERE max_importance IS NULL`).run();
        logger.info('[Database] ✅ max_importance kolonu eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (max_importance):');
      }
    }

    // Provenance + confidence + review profile kolonları — kontrollü orta vadeli genişletme
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'provenance_source')) {
      logger.info('[Database] 🚀 Migrating: Adding provenance_source column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN provenance_source TEXT");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (provenance_source):');
      }
    }
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'provenance_conversation_id')) {
      logger.info('[Database] 🚀 Migrating: Adding provenance_conversation_id column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN provenance_conversation_id TEXT");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (provenance_conversation_id):');
      }
    }
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'provenance_message_id')) {
      logger.info('[Database] 🚀 Migrating: Adding provenance_message_id column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN provenance_message_id INTEGER");
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (provenance_message_id):');
      }
    }
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'confidence')) {
      logger.info('[Database] 🚀 Migrating: Adding confidence column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.7");
        this.db.prepare(`UPDATE memories SET confidence = 0.7 WHERE confidence IS NULL`).run();
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (confidence):');
      }
    }
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'review_profile')) {
      logger.info('[Database] 🚀 Migrating: Adding review_profile column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN review_profile TEXT DEFAULT 'standard'");
        this.db.prepare(`UPDATE memories SET review_profile = 'standard' WHERE review_profile IS NULL OR review_profile = ''`).run();
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (review_profile):');
      }
    }
    if (memoriesTableInfo.length > 0 && !memoriesTableInfo.some((col: any) => col.name === 'memory_type')) {
      logger.info('[Database] 🚀 Migrating: Adding memory_type column to memories table');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN memory_type TEXT DEFAULT 'semantic'");
        this.db.prepare(`
          UPDATE memories
          SET memory_type = CASE
            WHEN lower(COALESCE(category, '')) IN ('follow_up', 'followup', 'event', 'timeline', 'status', 'task', 'conversation', 'session') THEN 'episodic'
            WHEN lower(COALESCE(provenance_source, '')) = 'conversation' AND provenance_conversation_id IS NOT NULL THEN 'episodic'
            ELSE 'semantic'
          END
          WHERE memory_type IS NULL OR trim(memory_type) = ''
        `).run();
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (memory_type):');
      }
    }

    // İlişki Yaşam Döngüsü kolonları — memory_relations tablosuna ekle (yoksa)
    if (relTableInfo.length > 0 && !relTableInfo.some((col: any) => col.name === 'last_accessed_at')) {
      logger.info('[Database] 🚀 Migrating: Adding lifecycle columns to memory_relations table');
      try {
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN last_accessed_at DATETIME");
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN access_count INTEGER DEFAULT 0");
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN decay_rate REAL DEFAULT 0.05");

        // Backfill: last_accessed_at = created_at
        this.db.prepare(`
          UPDATE memory_relations SET last_accessed_at = created_at WHERE last_accessed_at IS NULL
        `).run();

        // Decay rate differansiyeli:
        //   proximity (Semantik yakınlık) → 0.05 (hızlı çürür)
        //   entity-based (Ortak varlık)   → 0.04 (orta)
        //   LLM-extracted / diğer         → 0.03 (yavaş çürür — daha semantik ve kasıtlı)
        this.db.prepare(`
          UPDATE memory_relations SET decay_rate = CASE
            WHEN description = 'Semantik yakınlık' THEN 0.05
            WHEN description LIKE 'Ortak varlık:%' THEN 0.04
            ELSE 0.03
          END
        `).run();

        // İndeks: decay sorgularını hızlandır
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_relations_last_accessed ON memory_relations(last_accessed_at)");

        logger.info('[Database] ✅ İlişki yaşam döngüsü kolonları eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (relation lifecycle columns):');
      }
    }

    // Embedding Cache tablosu — embedding_cache (yoksa oluştur)
    const embeddingCacheTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_cache'"
    ).get();
    if (!embeddingCacheTable) {
      logger.info('[Database] 🚀 Migrating: Creating embedding_cache table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS embedding_cache (
            query_hash TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        logger.info('[Database] ✅ Embedding cache table created');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (embedding_cache):');
      }
    }

    // Performance Index'leri
    logger.info('[Database] 🚀 Migrating: Creating performance indexes');
    try {
      this.db.exec(`
        -- memory_relations için composite index'ler
        CREATE INDEX IF NOT EXISTS idx_relations_source_confidence
        ON memory_relations(source_memory_id, confidence DESC);

        CREATE INDEX IF NOT EXISTS idx_relations_target_confidence
        ON memory_relations(target_memory_id, confidence DESC);

        -- messages için composite index
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
        ON messages(conversation_id, created_at DESC);

        -- memories için composite index
        CREATE INDEX IF NOT EXISTS idx_memories_archived_category
        ON memories(is_archived, category, updated_at DESC);
      `);
      logger.info('[Database] ✅ Performance indexes created');
    } catch (err) {
      logger.error({ err: err }, '[Database] ❌ Migration failed (indexes):');
    }

    // messages tablosuna attachments kolonu ekle (yoksa)
    if (msgTableInfo.length > 0 && !msgTableInfo.some((col: any) => col.name === 'attachments')) {
      logger.info('[Database] 🚀 Migrating: Adding attachments column to messages table');
      try {
        this.db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
        logger.info('[Database] ✅ attachments kolonu eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (messages.attachments):');
      }
    }

    // OPT-4: conversations tablosuna message_count kolonu + trigger ekle (yoksa)
    if (convTableInfo.length > 0 && !convTableInfo.some((col: any) => col.name === 'message_count')) {
      logger.info('[Database] 🚀 Migrating: Adding message_count column and triggers');
      try {
        this.db.exec("ALTER TABLE conversations ADD COLUMN message_count INTEGER DEFAULT 0");
        // Backfill: mevcut konuşmalar için mesaj sayısını hesapla
        this.db.prepare(`
          UPDATE conversations SET message_count = (
            SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id
              AND (role = 'user' OR (role = 'assistant' AND tool_calls IS NULL))
          )
        `).run();
        // TRIGGER: mesaj eklendiğinde sayacı artır
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_messages_insert_count AFTER INSERT ON messages
          WHEN NEW.role = 'user' OR (NEW.role = 'assistant' AND NEW.tool_calls IS NULL)
          BEGIN
            UPDATE conversations SET message_count = message_count + 1 WHERE id = NEW.conversation_id;
          END;
        `);
        // TRIGGER: mesaj silindiğinde sayacı azalt
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_messages_delete_count AFTER DELETE ON messages
          WHEN OLD.role = 'user' OR (OLD.role = 'assistant' AND OLD.tool_calls IS NULL)
          BEGIN
            UPDATE conversations SET message_count = MAX(0, message_count - 1) WHERE id = OLD.conversation_id;
          END;
        `);
        logger.info('[Database] ✅ message_count kolonu ve trigger\'ları eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (message_count):');
      }
    }
    // autonomous_tasks tablosunu oluştur (yoksa)
    const autonomousTableTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='autonomous_tasks'"
    ).get();
    if (!autonomousTableTable) {
      logger.info('[Database] 🚀 Migrating: Creating autonomous_tasks table for checkpointing');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS autonomous_tasks (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        logger.info('[Database] ✅ autonomous_tasks tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (autonomous_tasks):');
      }
    }
  
    // Feedback tablosunu oluştur (yoksa)
    const feedbackTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'"
    ).get();
    if (!feedbackTable) {
      logger.info('[Database] 🚀 Migrating: Creating feedback table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('positive', 'negative')),
            comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON feedback(conversation_id);
          CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback(message_id);
        `);
        logger.info('[Database] ✅ feedback tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (feedback):');
      }
    }
  
    // ========== GraphRAG Faz 1 Migration ==========

    // GraphRAG: memory_relations tablosuna weight, is_directional, last_scored_at kolonları
    if (relTableInfo.length > 0 && !relTableInfo.some((col: any) => col.name === 'weight')) {
      logger.info('[Database] 🚀 GraphRAG Migration: Adding weight column to memory_relations');
      try {
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN weight REAL DEFAULT 1.0");
        this.db.exec("UPDATE memory_relations SET weight = 1.0 WHERE weight IS NULL");
        logger.info('[Database] ✅ weight kolonu eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (weight):');
      }
    }
    if (relTableInfo.length > 0 && !relTableInfo.some((col: any) => col.name === 'is_directional')) {
      logger.info('[Database] 🚀 GraphRAG Migration: Adding is_directional column to memory_relations');
      try {
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN is_directional INTEGER DEFAULT 0");
        this.db.exec("UPDATE memory_relations SET is_directional = 0 WHERE is_directional IS NULL");
        logger.info('[Database] ✅ is_directional kolonu eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (is_directional):');
      }
    }
    if (relTableInfo.length > 0 && !relTableInfo.some((col: any) => col.name === 'last_scored_at')) {
      logger.info('[Database] 🚀 GraphRAG Migration: Adding last_scored_at column to memory_relations');
      try {
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN last_scored_at DATETIME");
        logger.info('[Database] ✅ last_scored_at kolonu eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (last_scored_at):');
      }
    }

    // GraphRAG Faz 2: PageRank persistence kolonları
    if (relTableInfo.length > 0 && !relTableInfo.some((col: any) => col.name === 'page_rank_score')) {
      logger.info('[Database] 🚀 GraphRAG Faz 2 Migration: Adding page_rank_score column to memory_relations');
      try {
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN page_rank_score REAL DEFAULT 0");
        this.db.exec("ALTER TABLE memory_relations ADD COLUMN last_pagerank_update DATETIME");
        logger.info('[Database] ✅ PageRank persistence kolonları eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (pagerank columns):');
      }
    }

    // GraphRAG: graph_traversal_cache tablosu
    const traversalCacheTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_traversal_cache'"
    ).get();
    if (!traversalCacheTable) {
      logger.info('[Database] 🚀 GraphRAG Migration: Creating graph_traversal_cache table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS graph_traversal_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_hash TEXT NOT NULL,
            max_depth INTEGER NOT NULL,
            node_ids TEXT NOT NULL,
            relation_ids TEXT NOT NULL,
            score REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            UNIQUE(query_hash, max_depth)
          );
          CREATE INDEX IF NOT EXISTS idx_graph_cache_hash ON graph_traversal_cache(query_hash);
          CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON graph_traversal_cache(expires_at);
        `);
        logger.info('[Database] ✅ graph_traversal_cache tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (graph_traversal_cache):');
      }
    }

    // GraphRAG: Yeni indeksler
    logger.info('[Database] 🚀 GraphRAG Migration: Creating new indexes');
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relations_type_confidence ON memory_relations(relation_type, confidence);
        CREATE INDEX IF NOT EXISTS idx_relations_source_target ON memory_relations(source_memory_id, target_memory_id);
        CREATE INDEX IF NOT EXISTS idx_relations_weight ON memory_relations(weight);
      `);
      logger.info('[Database] ✅ GraphRAG indeksleri oluşturuldu');
    } catch (err) {
      logger.error({ err: err }, '[Database] ❌ GraphRAG migration failed (indexes):');
    }

    // ========== GraphRAG Faz 2 Migration ==========

    // GraphRAG Faz 2: graph_communities tablosu
    const communitiesTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_communities'"
    ).get();
    if (!communitiesTable) {
      logger.info('[Database] 🚀 GraphRAG Faz 2 Migration: Creating graph_communities table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS graph_communities (
            id TEXT PRIMARY KEY,
            modularity_score REAL,
            dominant_relation_types TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        logger.info('[Database] ✅ graph_communities tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG Faz 2 migration failed (graph_communities):');
      }
    }

    // GraphRAG Faz 2: graph_community_members tablosu
    const communityMembersTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_community_members'"
    ).get();
    if (!communityMembersTable) {
      logger.info('[Database] 🚀 GraphRAG Faz 2 Migration: Creating graph_community_members table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS graph_community_members (
            community_id TEXT REFERENCES graph_communities(id),
            node_id INTEGER NOT NULL,
            PRIMARY KEY (community_id, node_id)
          );
          CREATE INDEX IF NOT EXISTS idx_community_members_node ON graph_community_members(node_id);
          CREATE INDEX IF NOT EXISTS idx_community_members_community ON graph_community_members(community_id);
        `);
        logger.info('[Database] ✅ graph_community_members tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG Faz 2 migration failed (graph_community_members):');
      }
    }

    // GraphRAG Faz 2: graph_community_summaries tablosu
    const summariesTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_community_summaries'"
    ).get();
    if (!summariesTable) {
      logger.info('[Database] 🚀 GraphRAG Faz 2 Migration: Creating graph_community_summaries table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS graph_community_summaries (
            community_id TEXT PRIMARY KEY REFERENCES graph_communities(id),
            summary TEXT NOT NULL,
            key_entities TEXT NOT NULL,
            key_relations TEXT NOT NULL,
            topics TEXT NOT NULL,
            generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_community_summaries_generated ON graph_community_summaries(generated_at);
        `);
        logger.info('[Database] ✅ graph_community_summaries tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG Faz 2 migration failed (graph_community_summaries):');
      }
    }

    // ========== GraphRAG Hierarchical Communities Migration ==========

    // graph_communities tablosuna level ve parent_id kolonları ekle (yoksa)
    const commTableInfo = this.db.prepare("PRAGMA table_info(graph_communities)").all() as any[];
    if (commTableInfo.length > 0 && !commTableInfo.some((col: any) => col.name === 'level')) {
      logger.info('[Database] 🚀 GraphRAG Hierarchical Migration: Adding level and parent_id columns to graph_communities');
      try {
        this.db.exec("ALTER TABLE graph_communities ADD COLUMN level INTEGER DEFAULT 0");
        this.db.exec("ALTER TABLE graph_communities ADD COLUMN parent_id TEXT");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_community_level ON graph_communities(level)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_community_parent ON graph_communities(parent_id)");
        // Backfill: mevcut topluluklar Level 0
        this.db.prepare("UPDATE graph_communities SET level = 0 WHERE level IS NULL").run();
        logger.info('[Database] ✅ Hierarchical community kolonları eklendi');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG Hierarchical migration failed:');
      }
    }

    // ========== GraphRAG Claim Extraction Migration ==========

    // memory_claims tablosu (yoksa oluştur)
    const claimsTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_claims'"
    ).get();
    if (!claimsTable) {
      logger.info('[Database] 🚀 GraphRAG Claims Migration: Creating memory_claims table');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS memory_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            subject TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            start_date TEXT,
            end_date TEXT,
            confidence REAL DEFAULT 0.7,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_claims_memory ON memory_claims(memory_id);
          CREATE INDEX IF NOT EXISTS idx_claims_subject ON memory_claims(subject);
          CREATE INDEX IF NOT EXISTS idx_claims_status ON memory_claims(status);
        `);
        logger.info('[Database] ✅ memory_claims tablosu oluşturuldu');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ GraphRAG Claims migration failed:');
      }
    }

    if (convTableInfo.length > 0 && !convTableInfo.some((col: any) => col.name === 'parent_conversation_id')) {
      logger.info('[Database] 🚀 Migrating: Adding conversation branching columns');
      try {
        this.db.exec("ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL");
        this.db.exec("ALTER TABLE conversations ADD COLUMN branch_point_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL");
        this.db.exec("ALTER TABLE conversations ADD COLUMN display_order TEXT DEFAULT NULL");
        this.db.exec("UPDATE conversations SET display_order = printf('%04d', rowid) WHERE display_order IS NULL");
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        logger.info('[Database] ✅ Conversation branching columns added');
      } catch (err) {
        logger.error({ err: err }, '[Database] ❌ Migration failed (conversation branching):');
      }
    }

      this.setSchemaVersion(PenceDatabase.LATEST_SCHEMA_VERSION);
    })();
  }

  /**
   * Embedding boyut tutarlılığını doğrular.
   * Mevcut DB'deki settings tablosundaki boyut ile yapılandırılan boyut farklıysa uyarı verir.
   */
  private validateEmbeddingDimensions(): void {
    try {
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
      if (!tableExists) return;

      const stored = this.db.prepare("SELECT value FROM settings WHERE key='embedding_dimensions'").get() as { value: string } | undefined;
      if (!stored) {
        this.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('embedding_dimensions', ?, CURRENT_TIMESTAMP)").run(String(this.embeddingDimensions));
        return;
      }
      const storedDim = parseInt(stored.value, 10);
      if (storedDim !== this.embeddingDimensions) {
        logger.warn(`[Database] ⚠️ Embedding boyutu değişti: ${storedDim} → ${this.embeddingDimensions}. Eski embedding'ler siliniyor.`);
        this.db.prepare("DELETE FROM memory_embeddings").run();
        this.db.prepare("DELETE FROM message_embeddings").run();
        this.db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'embedding_dimensions'").run(String(this.embeddingDimensions));
      }
    } catch (err) {
      logger.warn({ err }, '[Database] Embedding dimension validation failed:');
    }
  }

  /**
   * Yapılandırılan embedding boyutunu döndürür.
   */
  getEmbeddingDimensions(): number {
    return this.embeddingDimensions;
  }

  /**
   * Ham veritabanı instance'ını döndürür.
   */
  getDb(): Database.Database {
    return this.db;
  }

  // ============================================
  // Token Usage Tracking
  // ============================================

  /**
   * Yeni token usage kaydı ekler.
   */
  saveTokenUsage(record: TokenUsageRecord): void {
    const cost = calculateCost(record.provider, record.model, record.promptTokens, record.completionTokens);
    this.db.prepare(`
      INSERT INTO token_usage (provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(record.provider, record.model, record.promptTokens, record.completionTokens, record.totalTokens, cost);
  }

  /**
   * Toplam kullanım istatistiğini döndürür.
   * @param period - 'day', 'week', 'month', 'all'
   */
  getTokenUsageStats(period: string = 'week'): TokenUsageStats {
    const now = Math.floor(Date.now() / 1000);
    let periodSeconds: number;
    switch (period) {
      case 'day': periodSeconds = 86400; break;
      case 'week': periodSeconds = 604800; break;
      case 'month': periodSeconds = 2592000; break;
      default: periodSeconds = 0; // all
    }

    // Toplam istatistik
    const whereClause = periodSeconds > 0 ? `WHERE created_at >= datetime(${now} - ${periodSeconds}, 'unixepoch')` : '';
    
    const totalRow = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(estimated_cost_usd), 0) as totalCost
      FROM token_usage ${whereClause}
    `).get() as { totalTokens: number; totalCost: number };

    // Provider bazlı breakdown
    const providerRows = this.db.prepare(`
      SELECT
        provider,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost
      FROM token_usage ${whereClause}
      GROUP BY provider
      ORDER BY tokens DESC
    `).all() as Array<{ provider: string; tokens: number; cost: number }>;

    const providerBreakdown: Record<string, { tokens: number; cost: number }> = {};
    for (const row of providerRows) {
      providerBreakdown[row.provider] = { tokens: row.tokens, cost: row.cost };
    }

    return {
      totalTokens: totalRow.totalTokens,
      totalCost: totalRow.totalCost,
      providerBreakdown,
    };
  }

  /**
   * Günlük kullanım serisini döndürür.
   * @param period - 'day', 'week', 'month', 'all'
   */
  getDailyUsage(period: string = 'week'): DailyUsageEntry[] {
    const now = Math.floor(Date.now() / 1000);
    let periodSeconds: number;
    switch (period) {
      case 'day': periodSeconds = 86400; break;
      case 'week': periodSeconds = 604800; break;
      case 'month': periodSeconds = 2592000; break;
      default: periodSeconds = 0; // all
    }

    const whereClause = periodSeconds > 0 ? `WHERE created_at >= datetime(${now} - ${periodSeconds}, 'unixepoch')` : '';

    const rows = this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost
      FROM token_usage ${whereClause}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all() as Array<{ date: string; tokens: number; cost: number }>;

    return rows.map(r => ({ date: r.date, tokens: r.tokens, cost: r.cost }));
  }

  /**
   * Veritabanını güvenli şekilde kapatır.
   */
  close(): void {
    this.db.close();
  }
}
