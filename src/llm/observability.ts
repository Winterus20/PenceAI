/**
 * LLM Provider Observability Helpers
 *
 * No-op stubs — Langfuse removed.
 * These functions now pass through directly without tracing.
 */

/**
 * LLM çağrısını çalıştırır — tracing disabled.
 */
export async function traceLLMCall<T>(
  _providerName: string,
  _model: string,
  fn: () => Promise<T>
): Promise<T> {
  return fn();
}

/**
 * Streaming LLM çağrısını çalıştırır — tracing disabled.
 */
export async function traceLLMStream<T>(
  _providerName: string,
  _model: string,
  fn: () => Promise<T>
): Promise<T> {
  return fn();
}
