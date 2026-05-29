/**
 * Shell ve komut güvenlik kuralları — tek kaynak (SSOT).
 * MCP command-validator ve builtin executeShell bu modülü kullanır.
 */

/** Builtin shell aracı için izin verilen komutlar (MCP allowlist'inden daha geniş) */
export const SHELL_COMMAND_ALLOWLIST = new Set([
  'ls', 'cat', 'grep', 'find', 'git', 'npm', 'node', 'python', 'python3',
  'echo', 'pwd', 'head', 'tail', 'wc', 'diff', 'sort', 'uniq', 'awk', 'sed',
]);

/** Tehlikeli komut kalıpları — açıklama ile birlikte */
export const DANGEROUS_COMMAND_PATTERN_DEFS: ReadonlyArray<{ pattern: RegExp; desc: string }> = [
  { pattern: /\brm\s+-rf\s+\/(\s|$|--no-preserve-root)/i, desc: 'rm -rf /' },
  { pattern: /\brm\s+-r\s+\/(\s|$|--no-preserve-root)/i, desc: 'rm -r /' },
  { pattern: /\brm\s+-rf\s+\/\*/i, desc: 'rm -rf /*' },
  { pattern: /\brm\s+-r\s+\/\*/i, desc: 'rm -r /*' },
  { pattern: /rm\s+(-rf?|--recursive)/i, desc: 'rm recursive' },
  { pattern: /(?:^|[;&|])\s*format\s+[a-z]:/i, desc: 'format drive' },
  { pattern: /\bformat\b/i, desc: 'format' },
  { pattern: /\bdel\s+\/f\s+\/s\s+\/q/i, desc: 'del /f /s /q' },
  { pattern: /\bdel\s+\/s\s+\/q/i, desc: 'del /s /q' },
  { pattern: /\bdel\s+\/f/i, desc: 'del /f' },
  { pattern: /\bmkfs\b/i, desc: 'mkfs' },
  { pattern: /:\s*\(\s*\)\s*\{/i, desc: 'fork bomb' },
  { pattern: /:\(\)\s*\{/, desc: 'fork bomb' },
  { pattern: /\brd\s+\/s\s+\/q/i, desc: 'rd /s /q' },
  { pattern: /\brmdir\s+\/s\s+\/q/i, desc: 'rmdir /s /q' },
  { pattern: /remove-item\s+-recurse\s+-force\s+c:/i, desc: 'remove-item C:' },
  { pattern: /remove-item\s+-recurse\s+-force\s+\//i, desc: 'remove-item /' },
  { pattern: />\s*\/dev\/sd[a-z]/i, desc: 'disk overwrite' },
  { pattern: /\bdd\s+if=\/dev\//i, desc: 'dd from /dev' },
  { pattern: /\bchmod\s+-r\s+000\s+\//i, desc: 'chmod -r 000 /' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, desc: 'chmod -R 777 /' },
  { pattern: /\bchmod\s+-r/i, desc: 'chmod -r' },
  { pattern: /\bchown\s+-r\s+/i, desc: 'chown -r' },
  { pattern: /\bshutdown\b/i, desc: 'shutdown' },
  { pattern: /\breboot\b/i, desc: 'reboot' },
  { pattern: /\binit\s+0\b/i, desc: 'init 0' },
  { pattern: /\binit\s+6\b/i, desc: 'init 6' },
  { pattern: /\binit\s+[06]/i, desc: 'init halt/reboot' },
  { pattern: /\breg\s+delete\b/i, desc: 'reg delete' },
  { pattern: /\breg\s+add\b/i, desc: 'reg add' },
  { pattern: /\bcurl\s+.*\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i, desc: 'curl | shell' },
  { pattern: /\bwget\s+.*\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i, desc: 'wget | shell' },
  { pattern: /\bchattr\b/i, desc: 'chattr' },
  { pattern: /\biptables\b/i, desc: 'iptables' },
  { pattern: /\bfdisk\b/i, desc: 'fdisk' },
  { pattern: /\bmount\b/i, desc: 'mount' },
  { pattern: /\bumount\b/i, desc: 'umount' },
  { pattern: /\beval\s+/i, desc: 'eval' },
  { pattern: /\$\(/, desc: 'command substitution' },
  { pattern: /`/, desc: 'backtick substitution' },
];

/** MCP isCommandSafe() için düz RegExp listesi */
export const DANGEROUS_COMMAND_PATTERNS: RegExp[] =
  DANGEROUS_COMMAND_PATTERN_DEFS.map(({ pattern }) => pattern);

/** Shell meta-karakter bypass kalıpları */
export const BYPASS_PATTERNS: RegExp[] = [
  /\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i,
  /\$\(.*\)/,
  /`[^`]+`/,
  /;\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /&&\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /\|\|\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /\b(cmd|powershell|pwsh)\s+\/c\b/i,
  /\beval\s+/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bsudo\s+rm\b/i,
  /\bsudo\s+chmod\b/i,
  /\bsudo\s+chown\b/i,
  /\bsudo\s+dd\b/i,
];

export function findDangerousCommandMatch(command: string): { desc: string } | null {
  const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const { pattern, desc } of DANGEROUS_COMMAND_PATTERN_DEFS) {
    if (pattern.test(normalized) || pattern.test(command)) {
      return { desc };
    }
  }
  return null;
}

export function matchesBypassPattern(command: string): boolean {
  return BYPASS_PATTERNS.some((pattern) => pattern.test(command));
}

export function isShellBaseCommandAllowed(baseCmd: string): boolean {
  return SHELL_COMMAND_ALLOWLIST.has(baseCmd);
}
