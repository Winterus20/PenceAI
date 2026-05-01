/**
 * MCP (Model Context Protocol) — Ortak Yardımcı Fonksiyonlar
 */

/**
 * JSON schema properties nesnesinden tüm description alanlarini recursive olarak kaldirir.
 * LLM token optimizasyonu icin kullanilir.
 */
export function stripDescriptions(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const strippedProps: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof propValue === 'object' && propValue !== null) {
          strippedProps[propKey] = stripDescriptions(propValue as Record<string, unknown>);
        } else {
          strippedProps[propKey] = propValue;
        }
      }
      result[key] = strippedProps;
    } else {
      result[key] = value;
    }
  }
  return result;
}
