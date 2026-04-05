import { pb } from '../core/db-config';
import { clear, make, appendIconText, parseHtmlFragment } from '../core/dom';
import { setupAuthPopupHandlers, updateAuthButtons } from '../core/utils';
import { errorService } from '../core/error';
import { loginUser, logoutUser } from '../core/api';
import { notify } from '../core/notify';

// ─── Modül Tanımları ──────────────────────────────────────────────────────────

interface ModuleItem {
  id: string;
  name: string;
  icon: string;
  path?: string;
  submenu?: ModuleItem[];
}

const MODULES: ModuleItem[] = [
  {
    id: 'denetim-takip',
    name: 'Denetim Takip',
    icon: 'fas fa-calendar-check',
    path: '../modules/denetim-takip/',
  },
  {
    id: 'calisma-takvimi',
    name: 'Çalışma Takvimi',
    icon: 'fas fa-calendar-alt',
    path: '../modules/calisma-takvimi/',
  },
  {
    id: 'eposta-taslagi',
    name: 'E-posta Taslağı',
    icon: 'fas fa-envelope-open-text',
    path: '../modules/eposta-taslagi/',
  },
  {
    id: 'bayi-yoneticisi',
    name: 'Bayi Yöneticisi',
    icon: 'fas fa-store',
    path: '../modules/bayi-yoneticisi/',
  },
  {
    id: 'soru-yoneticisi',
    name: 'Soru Yöneticisi',
    icon: 'fas fa-edit',
    path: '../modules/soru-yoneticisi/',
  },
  {
    id: 'veritabani-yonetim',
    name: 'Veritabanı Yönetimi',
    icon: 'fas fa-cogs',
    path: '../modules/veritabani-yonetim/',
  },
  {
    id: 'kullanici-yoneticisi',
    name: 'Kullanıcı Yönetimi',
    icon: 'fas fa-users-cog',
    path: '../modules/kullanici-yoneticisi/',
  },
];

// Vite build için: modül dosyalarını derleme zamanında keşfet
const moduleHtmlLoaders = import.meta.glob('../modules/*/*.html', { query: '?raw', import: 'default' });
const moduleCssLoaders = import.meta.glob('../modules/*/*.css');
const moduleJsLoaders = import.meta.glob('../modules/*/*.ts');


// ─── State ────────────────────────────────────────────────────────────────────

let currentModuleId: string | null = null;
let adminSubscriptionCleanup: (() => void) | null = null;
const LAST_MODULE_STORAGE_KEY = 'fide.admin.lastModuleId';


function getAccessibleModules(userRole: string): ModuleItem[] {
  return userRole === 'admin'
    ? MODULES
    : MODULES.filter(m => m.id === 'denetim-takip');
}

function getAllModuleIds(modules: ModuleItem[]): string[] {
  return modules.flatMap(module => [
    module.id,
    ...(module.submenu ? getAllModuleIds(module.submenu) : []),
  ]);
}

function getInitialModuleId(userRole: string): string {
  const accessibleModules = getAccessibleModules(userRole);
  const accessibleModuleIds = getAllModuleIds(accessibleModules);
  const storedModuleId = window.sessionStorage.getItem(LAST_MODULE_STORAGE_KEY);

  if (storedModuleId && accessibleModuleIds.includes(storedModuleId)) {
    return storedModuleId;
  }

  return accessibleModuleIds[0] ?? 'denetim-takip';
}

// ─── Uygulama Başlangıcı ──────────────────────────────────────────────────────

async function initializeAdminPanel(): Promise<void> {
  errorService.init();
  const isLoggedIn = pb.authStore.isValid;
  const userRole = isLoggedIn ? (pb.authStore.model?.['role'] as string | undefined) : null;

  updateAuthButtons(isLoggedIn);
  updateConnectionIndicator(isLoggedIn);

  if (userRole === 'admin' || userRole === 'client') {
    renderModuleMenu(userRole);
    if (!currentModuleId) {
      await loadModule(getInitialModuleId(userRole));
    }
    subscribeToAdminChanges();
  } else {
    window.sessionStorage.removeItem(LAST_MODULE_STORAGE_KEY);
    const menu = document.getElementById('module-menu');
    if (menu) clear(menu);
    showAccessDenied();
  }

  setupEventListeners();
}

// ─── Erişim Reddedildi ────────────────────────────────────────────────────────

function showAccessDenied(): void {
  const container = document.getElementById('module-container');
  if (!container) return;

  clear(container);

  const wrapper = document.createElement('div');
  wrapper.className = 'access-denied';

  const icon = document.createElement('i');
  icon.className = 'fas fa-exclamation-triangle';
  icon.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('h2');
  heading.textContent = 'Erişim Reddedildi';

  const text = document.createElement('p');
  text.textContent = 'Lütfen sisteme giriş yapın.';

  wrapper.appendChild(icon);
  wrapper.appendChild(heading);
  wrapper.appendChild(text);
  container.appendChild(wrapper);
}

// ─── Menü Oluşturma ───────────────────────────────────────────────────────────

function renderModuleMenu(userRole: string): void {
  const menu = document.getElementById('module-menu');
  if (!menu) return;
  clear(menu);

  const accessibleModules = getAccessibleModules(userRole);

  accessibleModules.forEach(module => {
    menu.appendChild(createMenuItemElement(module));
  });
}

function createMenuItemElement(module: ModuleItem): HTMLLIElement {
  const li = document.createElement('li');
  li.setAttribute('role', 'none');

  if (module.submenu) {
    li.classList.add('has-submenu');

    const link = document.createElement('a');
    link.href = '#';
    link.setAttribute('role', 'menuitem');
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', 'false');
    const icon = make('i');
    icon.className = module.icon;
    icon.setAttribute('aria-hidden', 'true');
    const label = make('span', { text: module.name });
    link.append(icon, label);

    const subMenu = document.createElement('ul');
    subMenu.className = 'submenu';
    subMenu.setAttribute('role', 'menu');

    link.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = li.classList.toggle('open');
      subMenu.classList.toggle('open', isOpen);
      link.setAttribute('aria-expanded', String(isOpen));
    });

    module.submenu.forEach(sub => {
      const subLi = document.createElement('li');
      subLi.setAttribute('role', 'none');

      const subLink = document.createElement('a');
      subLink.href = '#';
      subLink.dataset['moduleId'] = sub.id;
      subLink.setAttribute('role', 'menuitem');
      const subIcon = make('i');
      subIcon.className = sub.icon;
      subIcon.setAttribute('aria-hidden', 'true');
      const subLabel = make('span', { text: sub.name });
      subLink.append(subIcon, subLabel);

      subLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void loadModule(sub.id);
      });

      subLi.appendChild(subLink);
      subMenu.appendChild(subLi);
    });

    li.appendChild(link);
    li.appendChild(subMenu);

  } else {
    const link = document.createElement('a');
    link.href = '#';
    link.dataset['moduleId'] = module.id;
    link.setAttribute('role', 'menuitem');
    const icon = make('i');
    icon.className = module.icon;
    icon.setAttribute('aria-hidden', 'true');
    const label = make('span', { text: module.name });
    link.append(icon, label);

    link.addEventListener('click', (e) => {
      e.preventDefault();
      void loadModule(module.id);
    });

    li.appendChild(link);
  }

  return li;
}

// ─── Modül Yükleme (Lazy) ────────────────────────────────────────────────────


async function loadModule(moduleId: string): Promise<void> {
  let module: ModuleItem | undefined;
  for (const m of MODULES) {
    if (m.id === moduleId) { module = m; break; }
    const sub = m.submenu?.find(s => s.id === moduleId);
    if (sub) { module = sub; break; }
  }
  if (!module) return;

  currentModuleId = moduleId;
  window.sessionStorage.setItem(LAST_MODULE_STORAGE_KEY, moduleId);

  // Aktif menü bağlantısını güncelle
  document.querySelectorAll<HTMLAnchorElement>('.sidebar-menu a').forEach(a => {
    a.classList.remove('active');
    a.removeAttribute('aria-current');
  });
  const activeLink = document.querySelector<HTMLAnchorElement>(`.sidebar-menu a[data-module-id="${moduleId}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
    activeLink.setAttribute('aria-current', 'page');
  }

  // Başlık güncelle
  const title = document.getElementById('module-title');
  if (title) {
    const t = title as HTMLElement;
    clear(t);
    const i = make('i');
    i.className = module.icon;
    i.setAttribute('aria-hidden', 'true');
    t.append(i, document.createTextNode(` ${module.name}`));
  }

  const container = document.getElementById('module-container');
  if (!container) return;
  clear(container);

  const loadingMsg = document.createElement('p');
  loadingMsg.className = 'module-loading';
  appendIconText(loadingMsg, 'fas fa-spinner fa-spin', 'Modül yükleniyor...');
  container.appendChild(loadingMsg);

  // Klasik path’i tek bir anahtar üretmek için kullanıyoruz
  const keyBase = `../modules/${module.id}/${module.id}`;

  try {
    // HTML’i (raw) yükle
    const htmlLoader = moduleHtmlLoaders[`${keyBase}.html`];
    if (!htmlLoader) throw new Error(`${module.id}.html bulunamadı.`);
    const html = await htmlLoader();
    clear(container);
    container.appendChild(parseHtmlFragment(String(html)));

    // CSS’i yükle (Vite otomatik inject eder)
    const cssLoader = moduleCssLoaders[`${keyBase}.css`];
    if (cssLoader) await cssLoader();

    // TS modülünü yükle ve init çalıştır
    const jsLoader = moduleJsLoaders[`${keyBase}.ts`];
    if (!jsLoader) return;

    const initFnName = moduleIdToInitFn(module.id);
    const mod = (await jsLoader()) as Record<string, unknown>;
    const init = mod[initFnName];
    if (typeof init === 'function') (init as (pb: unknown) => void)(pb);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Bilinmeyen hata';
    clear(container);

    const errDiv = document.createElement('div');
    errDiv.className = 'module-error';

    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-circle';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.textContent = `Modül yüklenemedi: ${errorMsg}`;

    errDiv.appendChild(icon);
    errDiv.appendChild(text);
    container.appendChild(errDiv);
  }
}


/**
 * Modül ID → init fonksiyon adı
 * "bayi-yoneticisi" → "initializeBayiYoneticisiModule"
 */
function moduleIdToInitFn(moduleId: string): string {
  const pascal = moduleId
    .split('-')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return `initialize${pascal}Module`;
}

// ─── Gerçek Zamanlı Ban Dinleyicisi ──────────────────────────────────────────

function subscribeToAdminChanges(): void {
  adminSubscriptionCleanup?.();
  adminSubscriptionCleanup = null;
  if (!pb.authStore.isValid) return;

  const userId = String(pb.authStore.model?.['id'] ?? '');
  if (!userId) return;

  void pb.collection('users').subscribe(userId, (e) => {
    if (e.record?.['is_banned'] === true) {
      notify.error('Hesabınız kilitlendi.');
      pb.authStore.clear();
      window.location.reload();
    }
  }).then(() => {
    adminSubscriptionCleanup = () => { void pb.collection('users').unsubscribe(userId); };
  }).catch((error: unknown) => {
    errorService.handle(error, { silent: true, userMessage: 'Yönetici dinleme başlatılamadı.' });
  });
}

// ─── Auth UI ──────────────────────────────────────────────────────────────────

function updateConnectionIndicator(isLoggedIn: boolean): void {
  const track = document.getElementById('connection-status-switch');
  const text = document.getElementById('connection-status-text');

  track?.classList.toggle('connected', isLoggedIn);
  track?.classList.toggle('disconnected', !isLoggedIn);
  if (text) text.textContent = isLoggedIn ? 'Buluta Bağlı' : 'Bağlı Değil';
}

// ─── Event Listener Kurulumu (onclick="" kullanılmaz) ────────────────────────

function setupEventListeners(): void {
  setupAuthPopupHandlers({
    onLogout: () => {
      adminSubscriptionCleanup?.();
      logoutUser();
      window.location.reload();
    },
    onLogin: async (email, password, errorDiv) => {
      const result = await loginUser(email, password);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }

      window.location.reload();
    },
  });
}

// ─── Başlat ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => { adminSubscriptionCleanup?.(); });

document.addEventListener('DOMContentLoaded', () => { void initializeAdminPanel(); });
// TOTAL_LINES: 379
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
