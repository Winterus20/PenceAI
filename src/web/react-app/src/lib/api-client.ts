/**
 * Merkezi API İstek Yöneticisi
 * Tüm HTTP istekleri bu istemci üzerinden geçirilir.
 * Bu sayede auth token, hata yönetimi ve baseURL ekleme işlemleri tek bir yerden çözülür.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getDashboardAuthHeader, promptForDashboardPassword } from './dashboardAuth.js';

const API_BASE_URL = '/api'; // Gerekirse çevre değişkenlerinden alınabilir (import.meta.env.VITE_API_URL)

interface FetchOptions extends RequestInit {
  query?: Record<string, string | number | boolean>;
}

// Standart API hatası fırlatıcı
export class ApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Gelişmiş Fetch Sarmalayıcı
 */
function buildRequestConfig(options: FetchOptions): RequestInit {
  const { query: _query, headers, ...customConfig } = options;
  const dashboardAuth = getDashboardAuthHeader();
  return {
    ...customConfig,
    headers: {
      'Content-Type': 'application/json',
      ...(dashboardAuth ? { Authorization: dashboardAuth } : {}),
      ...headers,
    },
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function isDashboardAuthChallenge(status: number, data: unknown): boolean {
  if (status !== 401) return false;
  if (typeof data === 'string') {
    return data.includes('Kimlik doğrulama') || data.includes('Geçersiz parola');
  }
  return false;
}

export const apiClient = async <TResponse = any>(
  endpoint: string,
  options: FetchOptions = {},
  allowAuthRetry = true,
): Promise<TResponse> => {
  const { query, ...rest } = options;

  let url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    url += `?${params.toString()}`;
  }

  const config = buildRequestConfig(rest);

  try {
    const response = await fetch(url, config);
    const data = await parseResponseBody(response);

    if (!response.ok) {
      if (allowAuthRetry && isDashboardAuthChallenge(response.status, data) && promptForDashboardPassword()) {
        return apiClient<TResponse>(endpoint, options, false);
      }

      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: string }).message)
            : typeof data === 'string' && data.length > 0
              ? data
              : 'Bir API hatası oluştu';

      throw new ApiError(message, response.status, data);
    }

    return data as TResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('[API Network Error]:', error);
      throw new ApiError('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.', 0);
    }
    throw error;
  }
};

// Kolay erişim metotları
export const api = {
  get: <T = any>(endpoint: string, options?: Omit<FetchOptions, 'method'>) =>
    apiClient<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = unknown, R = any>(endpoint: string, data?: T, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<R>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = unknown, R = any>(endpoint: string, data?: T, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<R>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T = unknown, R = any>(endpoint: string, data?: T, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<R>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = unknown, R = any>(endpoint: string, data?: T, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<R>(endpoint, {
      ...options,
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
};
