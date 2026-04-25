/**
 * SecretRedactor — Araç çıktıları ve loglar için merkezi redaction middleware.
 * KinBot Mimarisi Faz 4: Hassas verilerin (API key, token, şifre vb.) araç çıktılarından otomatik temizlenmesi.
 */

/** Redaction pattern'leri — eşleşen içerik censor ile değiştirilir */
const REDACTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    // API Keys (genel format)
    { pattern: /\b[Aa][Pp][Ii][_\-]?[Kk][Ee][Yy]\s*[:=]\s*['"]?[\w\-]{20,}['"]?/g, label: 'api_key' },
    // Bearer tokens
    { pattern: /\b[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, label: 'bearer_token' },
    // AWS Access Keys
    { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, label: 'aws_access_key' },
    // AWS Secret Keys — sadece AWS_SECRET_ACCESS_KEY ile prefixlendiğinde eşleşir
    { pattern: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, label: 'aws_secret_key' },
    // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghc_)
    { pattern: /\bgh[posuc]_[A-Za-z0-9]{36}\b/g, label: 'github_token' },
    // Slack tokens (xoxb-, xoxp-)
    { pattern: /\bxox[bpras]-[A-Za-z0-9\-]+/g, label: 'slack_token' },
    // JWT tokens (3 parçalı base64)
    { pattern: /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g, label: 'jwt_token' },
    // Private keys (PEM formatı)
    { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, label: 'private_key' },
    // Connection strings (password içeren)
    { pattern: /\b(?:mongodb|postgres|mysql|redis|amqp):\/\/[^:\s]+:[^@\s]+@[^\s]+/g, label: 'connection_string' },
    // Environment variable assignments (şüpheli)
    { pattern: /\b(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET_KEY)\s*=\s*['"][^'"]{8,}['"]/gi, label: 'env_secret' },
    // Authorization headers
    { pattern: /\b[Aa]uthorization\s*:\s*(?:Bearer|Basic|Token)\s+\S+/g, label: 'auth_header' },
    // .env dosya içerikleri
    { pattern: /\b(?:DB_PASS|DATABASE_URL|JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY)\s*=\s*\S+/gi, label: 'env_value' },
];

/** Censor string — redacted içerik yerine kullanılır */
const CENSOR = '**redacted**';

/**
 * Verilen metindeki hassas verileri redact eder.
 * Tool çıktıları ve log mesajları için kullanılır.
 * 
 * @param text Redact edilecek metin
 * @returns Redact edilmiş metin
 */
export function redactSecrets(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let result = text;
    for (const { pattern, label } of REDACTION_PATTERNS) {
        // Yeni RegExp oluşturma (global flag ile son kullanım sorunu önleme)
        const re = new RegExp(pattern.source, pattern.flags);
        result = result.replace(re, `[${label}:${CENSOR}]`);
    }
    return result;
}

/**
 * Tool çıktısını redact eder — sadece belirli araçlar için.
 * Dosya okuma, web aracı ve shell çıktılarındaki hassas verileri temizler.
 */
export function redactToolOutput(toolName: string, output: string): string {
    // Sadece belirli araçların çıktılarını redact et
    const toolsToRedact = new Set([
        'readFile', 'webTool', 'webSearch', 'executeShell', 'searchFiles',
    ]);

    if (!toolsToRedact.has(toolName)) return output;
    return redactSecrets(output);
}

/**
 * Test amaçlı — kaç tane pattern eşleşmesi olduğunu döndürür (redaction yapmaz).
 */
export function countSecretMatches(text: string): { total: number; labels: Record<string, number> } {
    const labels: Record<string, number> = {};
    let total = 0;

    for (const { pattern, label } of REDACTION_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        const matches = text.match(re);
        if (matches && matches.length > 0) {
            labels[label] = (labels[label] ?? 0) + matches.length;
            total += matches.length;
        }
    }

    return { total, labels };
}
