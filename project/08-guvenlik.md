## Güvenlik

### Path Validation

```typescript
// İzin verilen kök dizin (FS_ROOT_DIR)
const resolved = path.resolve(filePath);
const root = path.resolve(config.fsRootDir);
if (!resolved.startsWith(root)) {
  throw new Error(`Erişim reddedildi`);
}
```

### MCP Command Allowlist

```typescript
const ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3', 'curl'];
// OWASP CWE-78: OS Command Injection koruması
```

### MCP Security Katmanları

- Tehlikeli pattern regex engelleme (path traversal, null byte, command injection, SQL injection, XSS)
- Concurrency limiter (semaphore-based)
- Rate limiter (zaman penceresi bazlı)
- Argument boyut limiti (65KB)
- Circular reference kontrolü
- Defense in Depth: Manager + Adapter seviyesinde çift validasyon

### Hook Execution Engine Security

- **Security Monitor** (`HOOK_SECURITY_MONITOR`): Path traversal, secret pattern, destructive command tespiti
- **Output Sanitizer** (`HOOK_OUTPUT_SANITIZER`): API key/password masking
- **Console Log Detector** (`HOOK_CONSOLE_LOG_DETECTOR`): `ask` | `approve` | `block`
- **Dev Server Blocker** (`HOOK_DEV_SERVER_BLOCKER`): Dev server komutlarını uyar (npm run dev, yarn start, vb.)
- **Context Budget Guard** (`HOOK_CONTEXT_BUDGET_GUARD`): ~40 tool call'da compaction öner, ~60'da zorunlu kıl

### Dashboard Auth

- Basic HTTP Authentication
- WebSocket protocol-based auth (`auth-{password}`)
- Health endpoint muafiyeti

### Shell Execution

- `ALLOW_SHELL_EXECUTION` varsayılan `false`
- `SHELL_TIMEOUT` ile komut zaman aşımı (varsayılan: 30000ms)
- Tehlikeli komut engelleme ve path validation

### Sensitive Paths

- `SENSITIVE_PATHS` env değişkeni ile korunan dizinler
- Varsayılan Windows: `C:\Windows`, `C:\Program Files`, `AppData`, `C:\ProgramData`
- Varsayılan Linux/macOS: `/etc`, `/usr`, `/var`, `/boot`, `/root`, `/home`

### Rate Limiting

- Express `express-rate-limit` ile HTTP rate limiting
- Helmet.js ile güvenlik başlıkları
- CORS yapılandırması

---
[← İçindekilere Dön](./README.md)
