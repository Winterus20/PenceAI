const STORAGE_KEY = 'pence-dashboard-password';

/** Basic auth header for DASHBOARD_PASSWORD-protected API calls */
export function getDashboardAuthHeader(): string | undefined {
  try {
    const password = sessionStorage.getItem(STORAGE_KEY);
    if (!password) return undefined;
    return `Basic ${btoa(`:${password}`)}`;
  } catch {
    return undefined;
  }
}

export function setDashboardPassword(password: string): void {
  sessionStorage.setItem(STORAGE_KEY, password);
}

export function clearDashboardPassword(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** İlk 401'de kullanıcıdan parola iste (DASHBOARD_PASSWORD tanımlı ortamlar) */
export function promptForDashboardPassword(): string | null {
  const entered = window.prompt('Dashboard parolası (DASHBOARD_PASSWORD):');
  if (!entered?.trim()) return null;
  setDashboardPassword(entered.trim());
  return entered.trim();
}
