## Veritabanı Şeması

**Mevcut Şema Versiyonu:** 18 ([`LATEST_SCHEMA_VERSION`](src/memory/database.ts:40))

### Tablolar

| Tablo | Açıklama | Anahtar Alanlar |
|-------|----------|-----------------|
| `conversations` | Konuşmalar | id (PK), channel_type, channel_id, user_id, user_name, title, summary, is_summarized, is_title_custom, message_count, parent_conversation_id, branch_point_message_id, display_order |
| `messages` | Mesajlar | id (PK), conversation_id (FK), role, content, tool_calls, tool_results, attachments |
| `memories` | Bellekler | id (PK), user_id, content, category, importance, stability, retrievability, memory_type, confidence, review_profile, provenance_*, max_importance, is_archived, access_count, review_count, next_review_at |
| `memory_entities` | Entity'ler | id (PK), name, type, normalized_name |
| `memory_relations` | İlişkiler | id (PK), source_memory_id (FK), target_memory_id (FK), relation_type, confidence, decay_rate, description, weight, is_directional, last_scored_at, page_rank_score, last_pagerank_update, last_accessed_at, access_count |
| `memory_embeddings` | Bellek vektörleri | rowid (PK), embedding (float[]) — sqlite-vec |
| `message_embeddings` | Mesaj vektörleri | rowid (PK), embedding (float[]) — sqlite-vec |
| `memory_entity_links` | Entity-Bellek bağlantıları | memory_id (FK), entity_id (FK) |
| `autonomous_tasks` | Otonom görevler | id (PK), type, priority, payload, status, added_at, updated_at |
| `feedback` | Kullanıcı geri bildirimi | id (PK), message_id, conversation_id, type, comment |
| `settings` | Ayarlar (KV) | key (PK), value, updated_at |
| `mcp_servers` | MCP sunucuları | name (PK), description, command, args, env, cwd, timeout, status, version, source, source_url, installed_at, last_activated, last_error, tool_count, metadata |
| `token_usage` | Token kullanımı | id (PK), provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at |
| `graph_traversal_cache` | Graph önbellek | id (PK), query_hash, max_depth, node_ids, relation_ids, score, created_at, expires_at |
| `embedding_cache` | Embedding önbellek | query_hash (PK), embedding (blob), created_at |
| `metrics` | Observability metrikleri | id (PK), conversation_id, message_id, timestamp, performance_json, cost_json, context_json |
| `memory_claims` | Bellek iddiaları | id (PK), memory_id (FK), subject, predicate, object, status, start_date, end_date, confidence, created_at |
| `skills` | Yüklü skill'ler *(reserve edilmiş)* | id (PK), name, description, version, enabled, config, installed_at |
| `scheduled_tasks` | Zamanlanmış görevler *(reserve edilmiş)* | id (PK), name, cron_expression, action, enabled, last_run, next_run, created_at |
| `graph_communities` | Topluluklar | id (PK), modularity_score, dominant_relation_types, level, parent_id, created_at, updated_at |
| `graph_community_members` | Topluluk üyeleri | community_id (FK), node_id (PK composite) |
| `graph_community_summaries` | Topluluk özetleri | community_id (PK), summary, key_entities, key_relations, topics, generated_at |

### İlişkiler

```
conversations ||--o{ messages : contains
conversations ||--o{ memories : has
memories ||--o{ memory_embeddings : embedded_as
memories ||--o{ memory_entity_links : has
memory_entities ||--o{ memory_entity_links : linked_to
memory_entities ||--o{ memory_relations : source
memory_entities ||--o{ memory_relations : target
```

### SQLite Pragmaları

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

### FTS5 Index'leri

`memories` ve `messages` tablolarında content sync trigger'ları (AFTER INSERT/DELETE/UPDATE) ile otomatik güncellenir.

---

---
[← İçindekilere Dön](./README.md)