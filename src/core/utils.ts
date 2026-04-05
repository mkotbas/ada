// ─── Yükleme Ekranı ───────────────────────────────────────────────────────────
// Tüm stil değişimleri CSS sınıfları üzerinden yapılır; inline style kullanılmaz.

const getOverlay = (): HTMLElement | null => document.getElementById('loading-overlay');

/**
 * Standart yükleme ekranını gösterir.
 */
export function showLoadingOverlay(message: string): void {
  const overlay = getOverlay();
  if (!overlay) return;

  // Lockout CSS sınıfını kaldır, standart görünüme dön
  overlay.classList.remove('loading-overlay--lockout');
  overlay.classList.add('loading-overlay--loading');

  const p = overlay.querySelector<HTMLElement>('p');
  if (p) p.textContent = message;

  overlay.removeAttribute('hidden');
}

/**
 * Yükleme ekranını gizler.
 */
export function hideLoadingOverlay(): void {
  const overlay = getOverlay();
  if (!overlay) return;
  overlay.classList.remove('loading-overlay--loading', 'loading-overlay--lockout');
  overlay.setAttribute('hidden', '');
}

/**
 * Yükleme ekranını göstererek verilen işlemi çalıştırır.
 */
export async function withLoadingOverlay<T>(message: string, task: () => Promise<T>): Promise<T> {
  showLoadingOverlay(message);
  try {
    return await task();
  } finally {
    hideLoadingOverlay();
  }
}

/**
 * Erişim engeli ekranını gösterir (BAN / cihaz kilidi).
 */
export function showLockoutOverlay(message: string): void {
  const overlay = getOverlay();
  if (!overlay) return;

  overlay.classList.remove('loading-overlay--loading');
  overlay.classList.add('loading-overlay--lockout');

  const p = overlay.querySelector<HTMLElement>('p');
  if (p) p.textContent = message;

  overlay.removeAttribute('hidden');
}

// ─── DOM Yardımcıları ─────────────────────────────────────────────────────────

/**
 * Bir elementi DOM'dan güvenli şekilde sorgular.
 * Bulunamazsa hata fırlatır.
 */
export function requireElement<T extends HTMLElement>(
  selector: string,
  context: Document | HTMLElement = document,
): T {
  const el = context.querySelector<T>(selector);
  if (!el) throw new Error(`Element bulunamadı: "${selector}"`);
  return el;
}

export function updateAuthButtons(isLoggedIn: boolean): void {
  const loginBtn = document.getElementById('login-toggle-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (isLoggedIn) {
    loginBtn?.setAttribute('hidden', '');
    logoutBtn?.removeAttribute('hidden');
    return;
  }

  loginBtn?.removeAttribute('hidden');
  logoutBtn?.setAttribute('hidden', '');
}

type AuthPopupHandlers = {
  onLogin: (email: string, password: string, errorDiv: HTMLElement) => Promise<void>;
  onLogout: () => void;
};

/**
 * Ana ekran ve admin panelindeki ortak giriş popup davranışını kurar.
 */
export function setupAuthPopupHandlers(handlers: AuthPopupHandlers): void {
  const loginToggleBtn = document.getElementById('login-toggle-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const loginPopup = document.getElementById('login-popup');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
  const emailInput = document.getElementById('email-input') as HTMLInputElement | null;
  const passwordInput = document.getElementById('password-input') as HTMLInputElement | null;
  const errorDiv = document.getElementById('login-error') as HTMLElement | null;

  const submitLogin = async (): Promise<void> => {
    if (!emailInput || !passwordInput || !errorDiv) return;
    errorDiv.textContent = '';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      errorDiv.textContent = 'Lütfen tüm alanları doldurun.';
      return;
    }

    await handlers.onLogin(email, password, errorDiv);
  };

  loginToggleBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    loginPopup?.toggleAttribute('hidden');
  });

  logoutBtn?.addEventListener('click', handlers.onLogout);
  loginSubmitBtn?.addEventListener('click', () => { void submitLogin(); });
  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitLogin();
  });

  passwordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitLogin();
    }
  });

  window.addEventListener('click', (event) => {
    if (
      loginPopup &&
      !loginPopup.hasAttribute('hidden') &&
      !loginPopup.contains(event.target as Node) &&
      event.target !== loginToggleBtn
    ) {
      loginPopup.setAttribute('hidden', '');
    }
  });
}

/**
 * Sayı formatını standartlaştırır: "95,5" → 95.5
 */
export function parseScore(val: unknown): number {
  if (val === undefined || val === null || val === '') return NaN;
  const cleaned = String(val).replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned);
}

/**
 * Deterministik karıştırma (seeded shuffle).
 * Aynı seed ile her zaman aynı sırayı üretir.
 */
export function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let s = seed;
  const rnd = (): number => {
    const x = Math.sin(s++) * 10000;
    return x - Math.floor(x);
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export {
  BUSINESS_TIMEZONE,
  getBusinessDateParts,
  getBusinessDateKeyFromParts,
  getBusinessMonthUtcRange,
  getBusinessWorkDaysOfMonth as getWorkDaysOfMonth,
  getBusinessYearMonthKey,
  getBusinessYearMonthKeyFromParts,
  getBusinessYearUtcRange,
} from './temporal';

/**
 * Debounce — art arda çağrılarda yalnızca son çağrıyı çalıştırır.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Tarih nesnesini "YYYY-MM-DD HH:MM:SS" formatına çevirir (PocketBase filtresi için).
 */
export function toDbDateString(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Yıl-ay anahtarı üretir: "2026-2" gibi.
 */
export function getYearMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}
