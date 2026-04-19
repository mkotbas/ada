import { pb } from './core/db-config';
import {
  loadInitialData,
  logoutUser,
  loginUser,
  subscribeToRealtimeChanges,
  cleanupRealtimeSubscriptions,
} from './core/api';
import { filterAndDisplayStores } from './core/store';
import { buildForm, updateFormInteractivity, updateConnectionIndicator, startNewReport, generateEmail, loadReportUI } from './ui';
import {
  getSelectedStore,
  setIsPocketBaseConnected,
} from './core/state';
import { debounce, setupAuthPopupHandlers, updateAuthButtons } from './core/utils';
import { errorService } from './core/error';
import { notify } from './core/notify';
import { getAdminPanelButtonLabel, getCurrentUserRole, shouldShowAdminPanelButton } from './core/permissions';


// ─── Uygulama Başlangıcı ──────────────────────────────────────────────────────

let listenersBound = false;
let floatingMailButtonBound = false;

function updateAdminPanelShortcut(): void {
  const button = document.getElementById('toggle-backup-manager-btn') as HTMLButtonElement | null;
  if (!button) return;

  const role = getCurrentUserRole(pb.authStore.model as Record<string, unknown> | null);
  const shouldShow = shouldShowAdminPanelButton(role);
  button.hidden = !shouldShow;
  button.disabled = !shouldShow;

  const label = button.querySelector('span');
  if (label) {
    label.textContent = getAdminPanelButtonLabel(role);
  }
}

async function initializeApp(): Promise<void> {
  errorService.init();
  notify.clear();
  window.addEventListener('beforeunload', () => notify.clear(), { once: true });
  window.addEventListener('pagehide', () => notify.clear(), { once: true });
  updateAuthButtons(pb.authStore.isValid);
  updateAdminPanelShortcut();

  if (pb.authStore.isValid) {
    setIsPocketBaseConnected(true);
    updateConnectionIndicator();

    const dataLoaded = await loadInitialData();
    if (dataLoaded) {
      buildForm();
      updateFloatingMailButtonPosition();
    }

    void subscribeToRealtimeChanges();
  } else {
    setIsPocketBaseConnected(false);
    updateConnectionIndicator();
    buildForm();
    updateFormInteractivity(false);
    updateFloatingMailButtonPosition();
  }

  if (!listenersBound) {
    setupEventListeners();
    bindFloatingMailButtonPositioning();
    listenersBound = true;
  }

  if (!getSelectedStore()) {
    updateFormInteractivity(false);
    updateFloatingMailButtonPosition();
  }
}

// ─── Yardımcı UI Fonksiyonları ─────────────────────────────────────────────────

function updateFloatingMailButtonPosition(): void {
  const button = document.getElementById('generate-email-btn') as HTMLButtonElement | null;
  if (!button) return;

  const formContent = document.getElementById('form-content');
  const anchor = formContent && !formContent.hasAttribute('hidden')
    ? formContent
    : document.querySelector('.container');

  if (!(anchor instanceof HTMLElement)) return;

  const anchorRect = anchor.getBoundingClientRect();
  const gap = 15;
  const viewportPadding = 12;
  const buttonWidth = button.offsetWidth || 30;
  const calculatedLeft = Math.round(anchorRect.right + gap);
  const maxLeft = Math.max(viewportPadding, window.innerWidth - buttonWidth - viewportPadding);
  const finalLeft = Math.min(maxLeft, Math.max(viewportPadding, calculatedLeft));

  button.style.left = `${finalLeft}px`;
  button.style.right = 'auto';
  button.classList.add('is-positioned');
}

function bindFloatingMailButtonPositioning(): void {
  if (floatingMailButtonBound) return;

  const syncPosition = () => { updateFloatingMailButtonPosition(); };
  const debouncedResizeSync = debounce(syncPosition, 80);
  window.addEventListener('resize', debouncedResizeSync);
  window.addEventListener('load', syncPosition);
  requestAnimationFrame(syncPosition);
  floatingMailButtonBound = true;
}


// ─── Auth UI ──────────────────────────────────────────────────────────────────

// ─── Event Listener Kurulumu ──────────────────────────────────────────────────
// Tüm onclick="..." kullanımları buraya taşındı.

function setupEventListeners(): void {
  // ── Giriş / Çıkış ──────────────────────────────────────────────────────────
  setupAuthPopupHandlers({
    onLogin: async (email, password, errorDiv) => {
      const result = await loginUser(email, password);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }

      const loginPopup = document.getElementById('login-popup');
      const emailInput = document.getElementById('email-input') as HTMLInputElement | null;
      const passwordInput = document.getElementById('password-input') as HTMLInputElement | null;

      setIsPocketBaseConnected(pb.authStore.isValid);
      updateAuthButtons(pb.authStore.isValid);
      updateAdminPanelShortcut();
  updateAdminPanelShortcut();
      updateConnectionIndicator();
      loginPopup?.setAttribute('hidden', '');

      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';

      const dataLoaded = await loadInitialData();
      buildForm();
      updateFloatingMailButtonPosition();
      updateFormInteractivity(Boolean(getSelectedStore()));

      if (dataLoaded) {
        void subscribeToRealtimeChanges();
      }
    },
    onLogout: () => {
      cleanupRealtimeSubscriptions();
      logoutUser();
      window.location.reload();
    },
  });

  // ── Bayi Arama ─────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('store-search-input') as HTMLInputElement | null;
  const debouncedFilter = debounce((query: string) => filterAndDisplayStores(query), 200);

  searchInput?.addEventListener('input', (e) => {
    debouncedFilter((e.target as HTMLInputElement).value);
  });

  // Bayi seçildi — raporu yükle veya formu sıfırla
  window.addEventListener('storeSelected', (e) => {
    const { savedState } = (e as CustomEvent<{ savedState: Record<string, unknown> | null }>).detail;
    if (savedState) {
      loadReportUI(savedState as Parameters<typeof loadReportUI>[0]);
      updateFloatingMailButtonPosition();
    } else {
      updateFormInteractivity(true);
      updateFloatingMailButtonPosition();
    }
  });

  // Bayi temizlendi olayı
  window.addEventListener('storeClearred', () => {
    updateFormInteractivity(false);
  });

  // ── Diğer ──────────────────────────────────────────────────────────────────
  document.getElementById('new-report-btn')?.addEventListener('click', () => void startNewReport());

  document.getElementById('generate-email-btn')?.addEventListener('click', () => void generateEmail());

  document.getElementById('toggle-backup-manager-btn')?.addEventListener('click', () => {
    if ((document.getElementById('toggle-backup-manager-btn') as HTMLButtonElement | null)?.disabled) return;
    window.open('admin/admin.html', '_blank');
  });
}

// ─── Başlat ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', cleanupRealtimeSubscriptions);

document.addEventListener('DOMContentLoaded', () => { void initializeApp(); });

// TOTAL_LINES: 197
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
