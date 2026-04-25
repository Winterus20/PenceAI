import { describe, it, expect } from '@jest/globals';
import { redactSecrets, redactToolOutput, countSecretMatches } from '../../src/utils/secretRedactor.js';

// ─────────────────────────────────────────────────────────────────────────────
// redactSecrets
// ─────────────────────────────────────────────────────────────────────────────

describe('redactSecrets', () => {
    // ── Guard rails ──────────────────────────────────────────────────────────

    it('boş string gelirse boş string döner', () => {
        expect(redactSecrets('')).toBe('');
    });

    it('null/undefined benzeri falsy değerleri olduğu gibi döndürür', () => {
        // Tip sistemi string bekliyor ama runtime koruması test ediliyor
        expect(redactSecrets(null as unknown as string)).toBeNull();
        expect(redactSecrets(undefined as unknown as string)).toBeUndefined();
    });

    it('number tipinde girişi olduğu gibi döndürür', () => {
        expect(redactSecrets(42 as unknown as string)).toBe(42);
    });

    it('sır içermeyen düz metni değiştirmez', () => {
        const plain = 'Merhaba dünya! Bu güvenli bir mesajdır.';
        expect(redactSecrets(plain)).toBe(plain);
    });

    // ── API Key ──────────────────────────────────────────────────────────────

    it('API_KEY=<uzun_değer> formatını redact eder', () => {
        const text = 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456';
        const result = redactSecrets(text);
        expect(result).toContain('[api_key:**redacted**]');
        expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    });

    it('api-key: <değer> formatını redact eder (büyük/küçük harf fark etmez)', () => {
        const text = 'Api-Key: abcdefghij1234567890ABCDEFGHIJ';
        const result = redactSecrets(text);
        expect(result).toContain('[api_key:**redacted**]');
    });

    it('20 karakterden kısa değeri API key olarak redact etmez', () => {
        const text = 'api_key=kisadeger123';
        const result = redactSecrets(text);
        // 20 karakterden kısa — pattern eşleşmemeli
        expect(result).toBe(text);
    });

    // ── Bearer Token ─────────────────────────────────────────────────────────

    it('Bearer token değerini redact eder', () => {
        const text = 'Authorization header değeri: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        const result = redactSecrets(text);
        expect(result).toContain('[bearer_token:**redacted**]');
        expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('bearer (küçük harf) token redact eder', () => {
        const text = 'bearer abc123tokenvalue_xyz';
        const result = redactSecrets(text);
        expect(result).toContain('[bearer_token:**redacted**]');
    });

    // ── AWS Access Key ───────────────────────────────────────────────────────

    it('AWS Access Key (AKIA...) formatını redact eder', () => {
        const text = 'AWS key: AKIAIOSFODNN7EXAMPLE ve devamı';
        const result = redactSecrets(text);
        expect(result).toContain('[aws_access_key:**redacted**]');
        expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('AKIA ile başlamayan benzer stringi redact etmez', () => {
        const text = 'BKIAIOSFODNN7EXAMPLE123456';
        const result = redactSecrets(text);
        expect(result).toBe(text);
    });

    // ── AWS Secret Key ───────────────────────────────────────────────────────

    it('AWS_SECRET_ACCESS_KEY=<40_karakter> formatını redact eder', () => {
        const text = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
        const result = redactSecrets(text);
        expect(result).toContain('[aws_secret_key:**redacted**]');
        expect(result).not.toContain('wJalrXUtnFEMI');
    });

    // ── GitHub Token ─────────────────────────────────────────────────────────

    it('ghp_ önekli GitHub personal access token redact eder', () => {
        const token = 'ghp_' + 'A'.repeat(36);
        const text = `GitHub token: ${token}`;
        const result = redactSecrets(text);
        expect(result).toContain('[github_token:**redacted**]');
        expect(result).not.toContain(token);
    });

    it('gho_ önekli GitHub OAuth token redact eder', () => {
        const token = 'gho_' + 'B'.repeat(36);
        const result = redactSecrets(`token=${token}`);
        expect(result).toContain('[github_token:**redacted**]');
    });

    it('ghs_ önekli GitHub server-to-server token redact eder', () => {
        const token = 'ghs_' + 'C'.repeat(36);
        const result = redactSecrets(token);
        expect(result).toContain('[github_token:**redacted**]');
    });

    it('36 karakterden farklı uzunluktaki ghp_ tokenı redact etmez', () => {
        // 35 karakter — pattern eşleşmemeli
        const token = 'ghp_' + 'A'.repeat(35);
        const result = redactSecrets(token);
        expect(result).toBe(token);
    });

    // ── Slack Token ──────────────────────────────────────────────────────────

    it('xoxb- önekli Slack bot token redact eder', () => {
        // Gerçek token formatı değil — sadece pattern testi için
        const prefix = 'xoxb';
        const fakeToken = `${prefix}-UNITTEST-FAKE-notarealslacktoken`;
        const text = `SLACK_TOKEN=${fakeToken}`;
        const result = redactSecrets(text);
        expect(result).toContain('[slack_token:**redacted**]');
        expect(result).not.toContain(fakeToken);
    });

    it('xoxp- önekli Slack user token redact eder', () => {
        const prefix = 'xoxp';
        const fakeToken = `${prefix}-UNITTEST-FAKE-notarealslacktoken`;
        const text = `token: ${fakeToken}`;
        const result = redactSecrets(text);
        expect(result).toContain('[slack_token:**redacted**]');
    });

    // ── JWT Token ────────────────────────────────────────────────────────────

    it('3 parçalı JWT token redact eder', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const text = `Token: ${jwt} — kullanıcı bilgisi`;
        const result = redactSecrets(text);
        expect(result).toContain('[jwt_token:**redacted**]');
        expect(result).not.toContain(jwt);
    });

    it('eyJ ile başlamayan string JWT olarak redact edilmez', () => {
        const text = 'abcdef.ghijkl.mnopqr';
        expect(redactSecrets(text)).toBe(text);
    });

    // ── Private Key ──────────────────────────────────────────────────────────

    it('RSA PEM private key bloğunu redact eder', () => {
        const text = [
            '-----BEGIN RSA PRIVATE KEY-----',
            'MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5RJr9qqALFEPQ',
            '-----END RSA PRIVATE KEY-----',
        ].join('\n');
        const result = redactSecrets(text);
        expect(result).toContain('[private_key:**redacted**]');
        expect(result).not.toContain('MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5RJr9qqALFEPQ');
    });

    it('EC PRIVATE KEY bloğunu redact eder', () => {
        const text = '-----BEGIN EC PRIVATE KEY-----\nABCDEF123456\n-----END EC PRIVATE KEY-----';
        expect(redactSecrets(text)).toContain('[private_key:**redacted**]');
    });

    it('OPENSSH PRIVATE KEY bloğunu redact eder', () => {
        const text = '-----BEGIN OPENSSH PRIVATE KEY-----\nABCDEF\n-----END OPENSSH PRIVATE KEY-----';
        expect(redactSecrets(text)).toContain('[private_key:**redacted**]');
    });

    // ── Connection String ────────────────────────────────────────────────────

    it('PostgreSQL connection string redact eder', () => {
        const text = 'postgres://myuser:s3cr3tpassword@localhost:5432/mydb';
        const result = redactSecrets(text);
        expect(result).toContain('[connection_string:**redacted**]');
        expect(result).not.toContain('s3cr3tpassword');
    });

    it('MongoDB connection string redact eder', () => {
        const text = 'Bağlantı: mongodb://admin:hunter2@mongo.example.com:27017/prod';
        const result = redactSecrets(text);
        expect(result).toContain('[connection_string:**redacted**]');
    });

    it('Redis connection string redact eder', () => {
        const text = 'redis://default:mypassword123@redis.example.com:6379';
        const result = redactSecrets(text);
        expect(result).toContain('[connection_string:**redacted**]');
    });

    it('şifre içermeyen URL redact edilmez', () => {
        const text = 'https://example.com/api/v1/users';
        expect(redactSecrets(text)).toBe(text);
    });

    // ── Env Secret ───────────────────────────────────────────────────────────

    it("PASSWORD='<değer>' formatını redact eder", () => {
        const text = "PASSWORD='supersecretpassword123'";
        const result = redactSecrets(text);
        expect(result).toContain('[env_secret:**redacted**]');
        expect(result).not.toContain('supersecretpassword123');
    });

    it('SECRET="<değer>" formatını redact eder', () => {
        const text = 'SECRET="my_top_secret_value_here"';
        const result = redactSecrets(text);
        expect(result).toContain('[env_secret:**redacted**]');
    });

    it("TOKEN='<değer>' formatını redact eder", () => {
        const text = "TOKEN='abcdefghijklmnop'";
        const result = redactSecrets(text);
        expect(result).toContain('[env_secret:**redacted**]');
    });

    it('8 karakterden kısa değeri env_secret olarak redact etmez', () => {
        const text = "PASSWORD='kisa'";
        // 5 karakter — threshold altında
        expect(redactSecrets(text)).toBe(text);
    });

    // ── Authorization Header ─────────────────────────────────────────────────

    it('Authorization: Bearer <token> — bearer_token pattern önce koşar, token redact edilir', () => {
        // bearer_token pattern, auth_header pattern'den önce tanımlı olduğundan
        // "Bearer supersecrettoken123abc" kısmı [bearer_token:**redacted**] olur.
        const text = 'Authorization: Bearer supersecrettoken123abc';
        const result = redactSecrets(text);
        expect(result).toContain('[bearer_token:**redacted**]');
        expect(result).not.toContain('supersecrettoken123abc');
    });

    it('Authorization: Basic <credentials> header redact eder', () => {
        const text = 'authorization: Basic dXNlcjpwYXNzd29yZA==';
        const result = redactSecrets(text);
        expect(result).toContain('[auth_header:**redacted**]');
    });

    it('Authorization: Token <token> header redact eder', () => {
        const text = 'Authorization: Token myauthtoken12345';
        const result = redactSecrets(text);
        expect(result).toContain('[auth_header:**redacted**]');
    });

    // ── Env Value (DB_PASS, DATABASE_URL vb.) ────────────────────────────────

    it('DB_PASS=<değer> formatını redact eder', () => {
        const text = 'DB_PASS=supersecretdbpassword';
        const result = redactSecrets(text);
        expect(result).toContain('[env_value:**redacted**]');
        expect(result).not.toContain('supersecretdbpassword');
    });

    it('DATABASE_URL=<değer> formatını redact eder', () => {
        const text = 'DATABASE_URL=postgres://user:pass@host/db';
        const result = redactSecrets(text);
        // DATABASE_URL pattern'e takılmalı
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('JWT_SECRET=<değer> formatını redact eder', () => {
        const text = 'JWT_SECRET=my_very_long_jwt_secret_key_here';
        const result = redactSecrets(text);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('SESSION_SECRET=<değer> formatını redact eder', () => {
        const text = 'SESSION_SECRET=random_session_secret_xyz';
        const result = redactSecrets(text);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('ENCRYPTION_KEY=<değer> formatını redact eder', () => {
        const text = 'ENCRYPTION_KEY=aes256encryptionkey';
        const result = redactSecrets(text);
        expect(result).toContain('[env_value:**redacted**]');
    });

    // ── Çoklu sır ────────────────────────────────────────────────────────────

    it('aynı metinde birden fazla sırı redact eder', () => {
        // Authorization: Token — bearer_token pattern sadece "Bearer"/"bearer" eşleştirir,
        // "Token" için eşleşmez → auth_header pattern devreye girer.
        const text = ['Authorization: Token myauthtoken123abc', 'DB_PASS=myrootpassword', 'Normal metin burada.'].join(
            '\n',
        );
        const result = redactSecrets(text);
        expect(result).toContain('[auth_header:**redacted**]');
        expect(result).toContain('[env_value:**redacted**]');
        expect(result).toContain('Normal metin burada.');
        expect(result).not.toContain('myauthtoken123abc');
        expect(result).not.toContain('myrootpassword');
    });

    it('aynı tipten birden fazla sırı redact eder', () => {
        const t1 = 'AKIA' + 'A'.repeat(16);
        const t2 = 'AKIA' + 'B'.repeat(16);
        const text = `key1=${t1} key2=${t2}`;
        const result = redactSecrets(text);
        expect(result).not.toContain(t1);
        expect(result).not.toContain(t2);
        // Her iki eşleşme için de [aws_access_key:**redacted**] olmalı
        expect(result.split('[aws_access_key:**redacted**]').length - 1).toBe(2);
    });

    // ── Sır içermeyen metinlerin korunması ───────────────────────────────────

    it("normal URL'leri değiştirmez", () => {
        const text = 'Dökümantasyon: https://docs.example.com/guide';
        expect(redactSecrets(text)).toBe(text);
    });

    it('email adreslerini değiştirmez', () => {
        const text = 'İletişim: kullanici@ornek.com';
        expect(redactSecrets(text)).toBe(text);
    });

    it('kod bloklarındaki sır içermeyen değişken atamalarını değiştirmez', () => {
        const text = 'const name = "Yiğit"; const age = 30;';
        expect(redactSecrets(text)).toBe(text);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// redactToolOutput
// ─────────────────────────────────────────────────────────────────────────────

describe('redactToolOutput', () => {
    const secretText = 'DB_PASS=toplayamaz';

    it('readFile aracı için redaction uygular', () => {
        const result = redactToolOutput('readFile', secretText);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('webTool aracı için redaction uygular', () => {
        const result = redactToolOutput('webTool', secretText);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('webSearch aracı için redaction uygular', () => {
        const result = redactToolOutput('webSearch', secretText);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('executeShell aracı için redaction uygular', () => {
        const result = redactToolOutput('executeShell', secretText);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('searchFiles aracı için redaction uygular', () => {
        const result = redactToolOutput('searchFiles', secretText);
        expect(result).toContain('[env_value:**redacted**]');
    });

    it('listede olmayan araç için redaction UYGULAMAZ', () => {
        const result = redactToolOutput('searchMemory', secretText);
        expect(result).toBe(secretText);
    });

    it('listede olmayan MCP aracı için redaction UYGULAMAZ', () => {
        const result = redactToolOutput('mcp:filesystem:readFile', secretText);
        expect(result).toBe(secretText);
    });

    it('sır içermeyen çıktıyı değiştirmeden döndürür', () => {
        const clean = 'Dosya içeriği: merhaba dünya';
        expect(redactToolOutput('readFile', clean)).toBe(clean);
    });

    it('boş string girişini boş string olarak döndürür', () => {
        expect(redactToolOutput('readFile', '')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countSecretMatches
// ─────────────────────────────────────────────────────────────────────────────

describe('countSecretMatches', () => {
    it('sır içermeyen metinde total=0 döner', () => {
        const result = countSecretMatches('Bu güvenli bir metindir.');
        expect(result.total).toBe(0);
        expect(result.labels).toEqual({});
    });

    it('tek sır için doğru label ve total döner', () => {
        const token = 'ghp_' + 'X'.repeat(36);
        const result = countSecretMatches(`token=${token}`);
        expect(result.total).toBe(1);
        expect(result.labels['github_token']).toBe(1);
    });

    it('iki farklı türde sır için doğru sayım yapar', () => {
        // Authorization: Basic — bearer_token pattern sadece "Bearer"/"bearer" eşleştirir,
        // "Basic" için eşleşmez → yalnızca auth_header sayılır.
        const awsKey = 'AKIA' + 'C'.repeat(16);
        const text = `key=${awsKey}\nAuthorization: Basic dXNlcjpwYXNzd29yZA==`;
        const result = countSecretMatches(text);
        expect(result.total).toBe(2);
        expect(result.labels['aws_access_key']).toBe(1);
        expect(result.labels['auth_header']).toBe(1);
    });

    it('aynı türden iki sır için label sayısını 2 olarak raporlar', () => {
        const k1 = 'AKIA' + 'A'.repeat(16);
        const k2 = 'AKIA' + 'B'.repeat(16);
        const result = countSecretMatches(`${k1} ${k2}`);
        expect(result.total).toBe(2);
        expect(result.labels['aws_access_key']).toBe(2);
    });

    it('redaction YAPMAZ — orijinal metni değiştirmez', () => {
        const text = 'DB_PASS=supersecretvalue';
        countSecretMatches(text);
        // Yan etki yok — orijinal değişmemiş olmalı
        expect(text).toBe('DB_PASS=supersecretvalue');
    });

    it('JWT token için doğru label döner', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123defghijklmnopq';
        const result = countSecretMatches(jwt);
        expect(result.labels['jwt_token']).toBe(1);
        expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('boş string için total=0, labels={} döner', () => {
        const result = countSecretMatches('');
        expect(result.total).toBe(0);
        expect(result.labels).toEqual({});
    });
});
