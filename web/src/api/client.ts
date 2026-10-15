/**
 * API Client — Nexa Home
 * Token akses HANYA disimpan di memori proses JS (bukan di localStorage).
 * Refresh token dikirimkan otomatis oleh browser via httpOnly cookie.
 */

let memoryAccessToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

export function setMemoryToken(token: string | null) {
  memoryAccessToken = token;
}

export function getMemoryToken(): string | null {
  return memoryAccessToken;
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (memoryAccessToken) {
    headers.set('Authorization', `Bearer ${memoryAccessToken}`);
  }

  // Selalu sertakan kredensial (cookies) untuk httpOnly cookie auth
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Jika 401 dan bukan sedang request auth login/refresh itu sendiri
  if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/refresh')) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setMemoryToken(data.access_token);
          onRefreshed(data.access_token);
          isRefreshing = false;
          // Coba ulangi request awal
          headers.set('Authorization', `Bearer ${data.access_token}`);
          const retryRes = await fetch(url, {
            ...options,
            headers,
            credentials: 'include',
          });
          if (!retryRes.ok) {
            const errData = await retryRes.json().catch(() => ({}));
            throw new Error(errData.detail || `Request gagal (${retryRes.status})`);
          }
          return retryRes.json();
        } else {
          setMemoryToken(null);
          isRefreshing = false;
        }
      } catch {
        setMemoryToken(null);
        isRefreshing = false;
      }
    } else {
      // Tunggu refresh selesai
      return new Promise<T>((resolve, reject) => {
        refreshSubscribers.push(async (newToken: string) => {
          headers.set('Authorization', `Bearer ${newToken}`);
          try {
            const retryRes = await fetch(url, { ...options, headers, credentials: 'include' });
            if (!retryRes.ok) {
              const errData = await retryRes.json().catch(() => ({}));
              reject(new Error(errData.detail || `Request gagal (${retryRes.status})`));
            } else {
              resolve(await retryRes.json());
            }
          } catch (e) {
            reject(e);
          }
        });
      });
    }
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Request gagal (${res.status})`);
  }

  return res.json();
}
