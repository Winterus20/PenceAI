/**
 * Merkezi API İstek Yöneticisi
 * Tüm HTTP istekleri bu istemci üzerinden geçirilir.
 * Bu sayede auth token, hata yönetimi ve baseURL ekleme işlemleri tek bir yerden çözülür.
 */

const API_BASE_URL = '/api'; // Gerekirse çevre değişkenlerinden alınabilir (import.meta.env.VITE_API_URL)

interface FetchOptions extends RequestInit {
  query?: Record<string, string | number | boolean>;
}

// Standart API hatası fırlatıcı
class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Gelişmiş Fetch Sarmalayıcı
 */
export const apiClient = async <TResponse = any>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<TResponse> => {
  const { query, headers, ...customConfig } = options;

  let url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  // Query parametresi varsa ?key=value formatında ekle
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    url += `?${params.toString()}`;
  }

  const config: RequestInit = {
    ...customConfig,
    headers: {
      'Content-Type': 'application/json',
      // Authorization gerekiyorsa buraya eklenebilir
      ...headers,
    },
  };

  try {
    const response = await fetch(url, config);
    
    // Eğer istek 'boş' dönüyorsa parse etmeye çalışma
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new ApiError(data?.error || data?.message || 'Bir API hatası oluştu', response.status, data);
    }

    return data as TResponse;
  } catch (error) {
    // Network hatası (Offline vs)
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

  delete: <T = any>(endpoint: string, options?: Omit<FetchOptions, 'method'>) =>
    apiClient<T>(endpoint, { ...options, method: 'DELETE' }),
};
