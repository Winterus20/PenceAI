/**
 * Result Pattern — Tutarlı hata yönetimi için Either benzeri pattern.
 * throw/catch yerine explicit success/error return.
 */

export type Result<T, E = Error> = SuccessResult<T> | ErrorResult<E>;

interface SuccessResult<T> {
  success: true;
  data: T;
  error?: never;
}

interface ErrorResult<E> {
  success: false;
  data?: never;
  error: E;
}

// Factory fonksiyonlar
export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function error<E>(err: E): Result<never, E> {
  return { success: false, error: err };
}

// Type guard
export function isSuccess<T, E>(result: Result<T, E>): result is SuccessResult<T> {
  return result.success === true;
}

export function isError<T, E>(result: Result<T, E>): result is ErrorResult<E> {
  return result.success === false;
}

// Utility: unwrap veya throw
export function unwrap<T, E extends Error = Error>(result: Result<T, E>): T {
  if (isError(result)) {
    throw result.error;
  }
  return result.data;
}

// Utility: unwrap veya default
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isError(result)) {
    return defaultValue;
  }
  return result.data;
}

// Async utility
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return success(data);
  } catch (err) {
    return error(err instanceof Error ? err : new Error(String(err)));
  }
}
