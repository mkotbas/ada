/* fide/src/modules/denetim-takip/denetim-takip.ts */
import type PocketBase from 'pocketbase';
import { showLoadingOverlay, hideLoadingOverlay } from '../../core/utils';
import type { DayReport } from '../../core/monthly-plan';
import {
  MONTHLY_AUDIT_DATA_CHANGED_EVENT,
  buildMonthlyAuditState,
  getDailyAuditCompletionWarning,
  loadMonthlyAuditSettings,
  monitorMonthlyAuditConsistency,
  type MonthlyAuditState,
} from '../../core/monthly-audit-state';
import { appendIconText, setSelectPlaceholder } from '../../core/dom';
import { errorService } from '../../core/error';
import { getBusinessDateParts, getBusinessYearMonthKey, getBusinessYearUtcRange } from '../../core/temporal';
import { notify } from '../../core/notify';


// ─── DOM Helpers (no inline styles) ─────────────────────────────────────────
function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  if (hidden) {
    el.setAttribute('hidden', '');
  } else {
    el.removeAttribute('hidden');
  }
}


// ─── Tip Tanımları ────────────────────────────────────────────────────────────

interface StoreRecord {
  id: string;
  bayiKodu: string;
  bayiAdi: string;
  bolge?: string;
  sehir?: string;
  ilce?: string;
  yonetmen?: string;
  sorumlu_kullanici?: string;
}

interface ReportRecord {
  id: string;
  user: string;
  bayi: string;
  denetimTamamlanmaTarihi?: string;
  created?: string;
  expand?: { bayi?: StoreRecord };
}

interface RevertRecord {
  id: string;
  yil_ay: string;
  bayi: string;
  expand?: { bayi?: StoreRecord };
}

interface UserRecord {
  id: string;
  name?: string;
  email: string;
  role?: string;
}

interface AuditedStore {
  code: string;
  timestamp: number;
}

// ─── Modül Durumu ─────────────────────────────────────────────────────────────

let pbInstance: PocketBase | null = null;
let currentUserRole: string | null = null;
let currentUserId: string | null = null;

let allStoresMaster: StoreRecord[] = [];
let allReportsMaster: ReportRecord[] = [];
let allGeriAlinanMaster: RevertRecord[] = [];
let allUsers: UserRecord[] = [];

let allStores: StoreRecord[] = [];
let auditedStoreCodesCurrentMonth: AuditedStore[] = [];
let rawAuditReportsCurrentMonth: DayReport[] = [];
let auditedStoreCodesCurrentYear: AuditedStore[] = [];
let leaveDataBulut: Record<string, boolean> = {};
let manualAuditDataBulut: Record<string, number> = {};
let archivedStoreState: Record<string, boolean> = {};
let archivedStoreIdSet = new Set<string>();
let archivedStoreCodeSet = new Set<string>();

let currentGlobalFilteredStores: StoreRecord[] = [];
let localCityFilterValue = 'Tümü';
let currentViewMode: 'monthly' | 'yearly' = 'monthly';

let globalAylikHedef = 0;
let globalMinDaily = 2;

// ─── Yardımcı: Bugün Gereken Ziyaret ─────────────────────────────────────────

type CurrentMonthDashboardPlan = {
  adjustedTarget: number;
  todayRequirement: number;
  remainingWorkdays: number;
};

let currentMonthlyAuditState: MonthlyAuditState | null = null;

const consistencyWarningEl = document.getElementById('denetim-takip-consistency-warning');

function renderConsistencyWarning(state: MonthlyAuditState | null): void {
  if (!consistencyWarningEl) return;

  const warning = state ? getDailyAuditCompletionWarning(state) : null;
  if (!warning) {
    consistencyWarningEl.setAttribute('hidden', '');
    consistencyWarningEl.textContent = '';
    return;
  }

  consistencyWarningEl.textContent = warning.message;
  consistencyWarningEl.removeAttribute('hidden');
}

function getCurrentMonthDashboardPlan(): CurrentMonthDashboardPlan {
  return {
    adjustedTarget: currentMonthlyAuditState?.adjustedTarget ?? 0,
    todayRequirement: currentMonthlyAuditState?.todayRequirement ?? 0,
    remainingWorkdays: currentMonthlyAuditState?.remainingWorkdays ?? 0,
  };
}

function calculateTodayRequirement(): number {
  return getCurrentMonthDashboardPlan().todayRequirement;
}

function getRemainingWorkdays(): number {
  return getCurrentMonthDashboardPlan().remainingWorkdays;
}

function getViewModeLabels(): {
  dashboardTitle: string;
  targetLabel: string;
  auditedLabel: string;
  auditedListTitle: string;
  remainingListTitle: string;
} {
  const today = getBusinessDateParts();
  const year = today.year;
  const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  if (currentViewMode === 'yearly') {
    return {
      dashboardTitle: `${year} Yıllık Performansı`,
      targetLabel: 'Yıllık Denetim Hedefi',
      auditedLabel: 'Bu Yıl Denetlenen',
      auditedListTitle: 'Bu Yıl Denetlenenler',
      remainingListTitle: 'Bu Yıl Denetlenecek Bayiler',
    };
  }

  return {
    dashboardTitle: `${year} ${MONTH_NAMES[today.month]} Performansı`,
    targetLabel: 'Aylık Denetim Hedefi',
    auditedLabel: 'Bu Ay Denetlenen',
    auditedListTitle: 'Bu Ay Denetlenenler',
    remainingListTitle: 'Denetlenecek Bayiler',
  };
}

function updateDashboardLabels(): void {
  const labels = getViewModeLabels();
  const title = document.getElementById('dashboard-title');
  if (title) {
    appendIconText(title, 'fas fa-calendar-day', labels.dashboardTitle);
  }

  const targetLabelEl = document.getElementById('target-label');
  if (targetLabelEl) targetLabelEl.textContent = labels.targetLabel;

  const auditedLabelEl = document.getElementById('audited-label');
  if (auditedLabelEl) auditedLabelEl.textContent = labels.auditedLabel;

  const auditedListTitleEl = document.getElementById('audited-list-title');
  if (auditedListTitleEl) {
    appendIconText(auditedListTitleEl, 'fas fa-check-double', labels.auditedListTitle);
  }

  const remainingListTitleEl = document.getElementById('remaining-list-title');
  if (remainingListTitleEl) {
    appendIconText(remainingListTitleEl, 'fas fa-list-ul', labels.remainingListTitle);
  }
}

// ─── Veri Yükleme ─────────────────────────────────────────────────────────────

function parseJsonObject<T extends Record<string, any>>(rawValue: unknown): T {
  if (!rawValue) return {} as T;
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch (error) {
      console.warn('Ayar JSON parse edilemedi:', error);
    }
    return {} as T;
  }
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue as T;
  }
  return {} as T;
}


function parseNumberMap(rawValue: unknown): Record<string, number> {
  const parsed = parseJsonObject<Record<string, unknown>>(rawValue);
  return Object.entries(parsed).reduce<Record<string, number>>((acc, [key, value]) => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      acc[key] = Math.floor(numericValue);
    }
    return acc;
  }, {});
}

function expandManualReports(manualMap: Record<string, number>, year: number, month: number): DayReport[] {
  const reports: DayReport[] = [];
  Object.entries(manualMap).forEach(([key, count]) => {
    const [itemYear, itemMonth, itemDay] = key.split('-').map(Number);
    if (itemYear !== year || itemMonth !== month || !Number.isFinite(itemDay) || count <= 0) return;
    for (let index = 0; index < count; index += 1) {
      reports.push({ date: itemDay });
    }
  });
  return reports;
}

function normalizeArchiveState(rawValue: unknown): Record<string, boolean> {
  const parsed = parseJsonObject<Record<string, unknown>>(rawValue);
  return Object.entries(parsed).reduce<Record<string, boolean>>((acc, [key, value]) => {
    acc[key] = value === true || value === 'true' || value === 1 || value === '1';
    return acc;
  }, {});
}

function refreshArchivedStoreSets(): void {
  archivedStoreIdSet = new Set(Object.keys(archivedStoreState).filter(id => archivedStoreState[id]));
  archivedStoreCodeSet = new Set(
    allStoresMaster
      .filter(store => archivedStoreIdSet.has(store.id))
      .map(store => store.bayiKodu)
      .filter(Boolean),
  );
}

async function loadArchiveState(): Promise<void> {
  try {
    const record = await pbInstance!.collection('ayarlar').getFirstListItem('anahtar="bayiArchiveState"');
    archivedStoreState = normalizeArchiveState(record['deger']);
  } catch (error: any) {
    if (error?.status !== 404) {
      console.error('Bayi pasif durumları yüklenemedi:', error);
    }
    archivedStoreState = {};
  }
}

function applyArchiveFilters(): void {
  refreshArchivedStoreSets();

  const archivedCodesBeforeFilter = new Set(archivedStoreCodeSet);
  allStoresMaster = allStoresMaster.filter(store => !archivedStoreIdSet.has(store.id));

  const isArchivedByReportStore = (record: ReportRecord | RevertRecord): boolean => {
    const expandedStore = record.expand?.bayi;
    if (!expandedStore) return false;
    return archivedStoreIdSet.has(expandedStore.id) || archivedCodesBeforeFilter.has(expandedStore.bayiKodu);
  };

  allReportsMaster = allReportsMaster.filter(record => !isArchivedByReportStore(record));
  allGeriAlinanMaster = allGeriAlinanMaster.filter(record => !isArchivedByReportStore(record));
}

function normalizePocketBaseDateFilterValue(isoValue: string): string {
  return isoValue.replace('T', ' ');
}

function getSelectedViewId(): string {
  return (document.getElementById('admin-user-filter') as HTMLSelectElement | null)?.value ?? 'my_data';
}

function getSettingsUserId(viewId: string): string {
  if (currentUserRole !== 'admin' || viewId === 'my_data' || viewId === 'global') {
    return currentUserId ?? '';
  }
  return viewId;
}

async function loadSettings(viewId: string = 'my_data'): Promise<void> {
  const settings = await loadMonthlyAuditSettings(pbInstance!, getSettingsUserId(viewId));
  globalAylikHedef = settings.globalAylikHedef;
  globalMinDaily = settings.globalMinDaily;
  leaveDataBulut = settings.leaveData;
  manualAuditDataBulut = settings.manualAuditData;
}


async function loadMasterData(): Promise<void> {
  try {
    await loadArchiveState();
    allStoresMaster = await pbInstance!.collection('bayiler').getFullList({ sort: 'bayiAdi' }) as StoreRecord[];
    const businessToday = getBusinessDateParts();
    const yearRange = getBusinessYearUtcRange(businessToday.year);
    const startDbValue = normalizePocketBaseDateFilterValue(yearRange.startUtcIso);
    const endDbValue = normalizePocketBaseDateFilterValue(yearRange.endUtcIso);
    const reportDateFilter = [
      `((denetimTamamlanmaTarihi != "" && denetimTamamlanmaTarihi >= "${startDbValue}" && denetimTamamlanmaTarihi < "${endDbValue}")`,
      `(denetimTamamlanmaTarihi = "" && created >= "${startDbValue}" && created < "${endDbValue}"))`,
    ].join(' || ');
    allReportsMaster = await pbInstance!.collection('denetim_raporlari').getFullList({
      filter: reportDateFilter,
      expand: 'bayi',
      sort: '-updated',
    }) as ReportRecord[];
    allGeriAlinanMaster = await pbInstance!.collection('denetim_geri_alinanlar').getFullList({
      filter: `yil_ay ~ "${getBusinessDateParts().year}-"`,
      expand: 'bayi',
    }) as RevertRecord[];
    applyArchiveFilters();
  } catch (error) {
    console.error('Denetim takip master verileri yüklenemedi:', error);
  }
}

async function populateUserFilterDropdown(): Promise<void> {
  try {
    allUsers = await pbInstance!.collection('users').getFullList({ sort: 'name' }) as UserRecord[];
    const sel = document.getElementById('admin-user-filter') as HTMLSelectElement | null;
    if (!sel) return;

    sel.replaceChildren();
    const opts: Array<{ value: string; label: string }> = [
      { value: 'my_data', label: 'Benim Verilerim (Admin)' },
      { value: 'global', label: 'Genel Bakış' },
    ];
    allUsers.filter(u => u.id !== currentUserId).forEach(u => {
      opts.push({ value: u.id, label: u.name || u.email });
    });
    opts.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  } catch { /* boş */ }
}

// ─── Veri Filtresi ────────────────────────────────────────────────────────────

async function applyDataFilterAndRunDashboard(viewId: string): Promise<void> {
  await loadSettings(viewId);
  const today = getBusinessDateParts();

  if (currentUserRole !== 'admin' || viewId === 'global') {
    allStores = [...allStoresMaster];
  } else {
    const userId = viewId === 'my_data' ? currentUserId! : viewId;
    allStores = allStoresMaster.filter(s => s.sorumlu_kullanici === userId);
  }

  let filteredReports: ReportRecord[];
  if (currentUserRole !== 'admin' || viewId === 'global') {
    filteredReports = [...allReportsMaster];
  } else {
    const userId = viewId === 'my_data' ? currentUserId! : viewId;
    filteredReports = allReportsMaster.filter(r => r.user === userId);
  }

  const yearlyCodes = new Set<string>();
  filteredReports.forEach((report) => {
    const code = typeof report.expand?.bayi?.bayiKodu === 'string' ? report.expand.bayi.bayiKodu.trim() : '';
    if (code) {
      yearlyCodes.add(code);
    }
  });

  currentMonthlyAuditState = buildMonthlyAuditState({
    year: today.year,
    month: today.month,
    todayDay: today.day,
    settings: {
      globalAylikHedef,
      globalMinDaily,
      leaveData: leaveDataBulut,
      manualAuditData: manualAuditDataBulut,
    },
    reports: filteredReports,
    reverts: allGeriAlinanMaster,
    excludedStoreIds: archivedStoreIdSet,
    excludedStoreCodes: archivedStoreCodeSet,
    seed: today.year + today.month,
  });
  monitorMonthlyAuditConsistency(currentMonthlyAuditState, 'denetim-takip');
  renderConsistencyWarning(currentMonthlyAuditState);

  auditedStoreCodesCurrentMonth = currentMonthlyAuditState.auditedStores.map(store => ({
    code: store.code,
    timestamp: store.timestamp,
  }));
  rawAuditReportsCurrentMonth = [...currentMonthlyAuditState.rawReports];
  auditedStoreCodesCurrentYear = Array.from(yearlyCodes).map(code => ({ code, timestamp: 0 }));
  runDashboard();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function runDashboard(): void {
  calculateAndDisplayDashboard();
  updateAllFilterOptions();
  applyAndRepopulateFilters();
}

function calculateAndDisplayDashboard(): void {
  const monthlyPlan = getCurrentMonthDashboardPlan();
  const target = currentViewMode === 'monthly' ? monthlyPlan.adjustedTarget : allStores.length;
  const audited = currentViewMode === 'monthly'
    ? auditedStoreCodesCurrentMonth.length
    : auditedStoreCodesCurrentYear.length;

  const setEl = (id: string, val: string | number): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  updateDashboardLabels();

  setEl('total-stores-count', target);
  setEl('audited-stores-count', audited);
  setEl('remaining-stores-count', Math.max(0, target - audited));
  setEl('work-days-count', getRemainingWorkdays());

  const workDaysCard = document.getElementById('work-days-card');
  const todayCard = document.getElementById('today-required-card');

  if (currentViewMode === 'monthly') {
    workDaysCard?.removeAttribute('hidden');
    todayCard?.removeAttribute('hidden');
    setEl('today-required-count', monthlyPlan.todayRequirement);
  } else {
    workDaysCard?.setAttribute('hidden', '');
    todayCard?.setAttribute('hidden', '');
  }

  renderAuditedStores();
  renderRemainingStores(currentGlobalFilteredStores);

  document.getElementById('dashboard-content')?.removeAttribute('hidden');
}

// ─── Filtreler ────────────────────────────────────────────────────────────────

const FILTER_FIELDS: Array<{ id: string; key: keyof StoreRecord }> = [
  { id: 'bolge-filter', key: 'bolge' },
  { id: 'yonetmen-filter', key: 'yonetmen' },
  { id: 'sehir-filter', key: 'sehir' },
  { id: 'ilce-filter', key: 'ilce' },
];

function getFilterValue(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? 'Tümü';
}

function getSelectedFilterValues(): Record<string, string> {
  return FILTER_FIELDS.reduce<Record<string, string>>((acc, filter) => {
    acc[filter.id] = getFilterValue(filter.id);
    return acc;
  }, {});
}

function getStoresMatchingSelections(
  selections: Record<string, string>,
  excludedFilterId?: string,
): StoreRecord[] {
  return allStores.filter(store =>
    FILTER_FIELDS.every(filter => {
      if (filter.id === excludedFilterId) return true;
      const selectedValue = selections[filter.id] ?? 'Tümü';
      return selectedValue === 'Tümü' || store[filter.key] === selectedValue;
    }),
  );
}

function getFilterProcessingOrder(changedFilterId?: string): Array<{ id: string; key: keyof StoreRecord }> {
  if (!changedFilterId) return [...FILTER_FIELDS];

  const changedFilter = FILTER_FIELDS.find(filter => filter.id === changedFilterId);
  if (!changedFilter) return [...FILTER_FIELDS];

  return [
    ...FILTER_FIELDS.filter(filter => filter.id !== changedFilterId),
    changedFilter,
  ];
}

function updateAllFilterOptions(changedFilterId?: string): void {
  getFilterProcessingOrder(changedFilterId).forEach(filter => {
    const sel = document.getElementById(filter.id) as HTMLSelectElement | null;
    if (!sel) return;

    const selections = getSelectedFilterValues();
    const prev = selections[filter.id] ?? 'Tümü';
    const availableStores = getStoresMatchingSelections(selections, filter.id);
    const values = [...new Set(availableStores.map(store => store[filter.key] as string))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'tr'));

    setSelectPlaceholder(sel, 'Tümü');
    sel.options[0]!.value = 'Tümü';

    values.forEach(value => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      sel.appendChild(opt);
    });

    sel.value = values.includes(prev) ? prev : 'Tümü';
  });
}

function applyAndRepopulateFilters(changedFilterId?: string): void {
  updateAllFilterOptions(changedFilterId);

  const selections = getSelectedFilterValues();
  currentGlobalFilteredStores = getStoresMatchingSelections(selections);

  renderRemainingStores(currentGlobalFilteredStores);
}

// ─── Liste Render ─────────────────────────────────────────────────────────────

function renderRemainingStores(filtered: StoreRecord[]): void {
  const cont = document.getElementById('denetlenecek-bayiler-container');
  if (!cont) return;

  const audited = currentViewMode === 'monthly'
    ? auditedStoreCodesCurrentMonth.map(a => a.code)
    : auditedStoreCodesCurrentYear.map(a => a.code);

  const rem = filtered.filter(s => !audited.includes(s.bayiKodu));

  cont.replaceChildren();

  if (!rem.length) {
    const msg = document.createElement('p');
    msg.className = 'empty-list-message';
    msg.textContent = 'Kayıt yok.';
    cont.appendChild(msg);
    return;
  }

  // Şehir filtresi dropdown'ını güncelle
  const cities = [...new Set(rem.map(s => s.sehir ?? ''))].filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const lSel = document.getElementById('local-city-filter') as HTMLSelectElement | null;
  if (lSel) {
    setSelectPlaceholder(lSel, 'Tüm Şehirler');
    lSel.options[0]!.value = 'Tümü';
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      lSel.appendChild(opt);
    });
    lSel.value = cities.includes(localCityFilterValue) ? localCityFilterValue : 'Tümü';
  }

  const show = localCityFilterValue === 'Tümü' ? rem : rem.filter(s => s.sehir === localCityFilterValue);

  // Bölgeye göre grupla
  const byReg = show.reduce<Record<string, StoreRecord[]>>((acc, s) => {
    const r = s.bolge ?? 'Bölgesiz';
    (acc[r] ??= []).push(s);
    return acc;
  }, {});

  Object.keys(byReg).sort().forEach(r => {
    const total = allStores.filter(s => (s.bolge ?? 'Bölgesiz') === r).length;
    const done = allStores.filter(s => (s.bolge ?? 'Bölgesiz') === r && audited.includes(s.bayiKodu)).length;
    const prog = total > 0 ? Math.round(done / total * 100) : 0;

    const regionEl = document.createElement('div');
    regionEl.className = 'region-container';

    const header = document.createElement('div');
    header.className = 'region-header';
    const headerSpan = document.createElement('span');
    headerSpan.textContent = `${r} (${done}/${total})`;
    header.appendChild(headerSpan);

    const progBar = document.createElement('div');
    progBar.className = 'progress-bar';

    const progressEl = document.createElement('progress');
    progressEl.className = 'progress-native';
    progressEl.max = total;
    progressEl.value = done;

    const progLabel = document.createElement('span');
    progLabel.className = 'progress-label';
    progLabel.textContent = `${prog}%`;

    progBar.append(progressEl, progLabel);

    const ul = document.createElement('ul');
    ul.className = 'store-list';
    byReg[r]!.forEach(s => {
      const li = document.createElement('li');
      li.className = 'store-list-item';
      const truncated = s.bayiAdi.length > 35 ? `${s.bayiAdi.substring(0, 35)}...` : s.bayiAdi;
      li.textContent = `${truncated} (${s.bayiKodu}) - ${s.sehir ?? ''}/${s.ilce ?? ''}`;
      ul.appendChild(li);
    });

    regionEl.appendChild(header);
    regionEl.appendChild(progBar);
    regionEl.appendChild(ul);
    cont.appendChild(regionEl);
  });
}

function renderAuditedStores(): void {
  const cont = document.getElementById('denetlenen-bayiler-container');
  if (!cont) return;

  const data = currentViewMode === 'monthly'
    ? auditedStoreCodesCurrentMonth
    : auditedStoreCodesCurrentYear;

  if (!data.length) {
    cont.replaceChildren();
    const msg = document.createElement('p');
    msg.className = 'empty-list-message';
    msg.textContent = 'Kayıt yok.';
    cont.appendChild(msg);
    return;
  }

  const details = data
    .map(a => ({
      ...(allStoresMaster.find(s => s.bayiKodu === a.code) ?? { bayiAdi: 'Bilinmeyen', bayiKodu: a.code } as StoreRecord),
      timestamp: a.timestamp,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  const ul = document.createElement('ul');
  ul.className = 'store-list';

  details.forEach(s => {
    const li = document.createElement('li');
    li.className = 'store-list-item completed-item';

    const truncated = s.bayiAdi.length > 35 ? `${s.bayiAdi.substring(0, 35)}...` : s.bayiAdi;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${truncated} (${s.bayiKodu})`;
    li.appendChild(nameSpan);

    if (currentUserRole === 'admin' && currentViewMode === 'monthly') {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'btn btn-warning btn-sm btn-revert-audit';
      appendIconText(undoBtn, 'fas fa-undo', 'Geri Al');
      undoBtn.addEventListener('click', () => { void revertAudit(s.bayiKodu); });
      li.appendChild(undoBtn);
    }

    ul.appendChild(li);
  });

  cont.replaceChildren();
  cont.appendChild(ul);
}

// ─── Denetim Geri Alma ────────────────────────────────────────────────────────

async function revertAudit(code: string): Promise<void> {
  const store = allStoresMaster.find(x => x.bayiKodu === code);
  if (!store) return;
  if (!confirm('Denetim kaydını geri almak istiyor musunuz?')) return;

  try {
    await pbInstance!.collection('denetim_geri_alinanlar').create({
      yil_ay: getBusinessYearMonthKey(),
      bayi: store.id,
    });
    await loadMasterData();
    await applyDataFilterAndRunDashboard(getSelectedViewId());
  } catch { /* hata sessiz */ }
}

// ─── Event Listener'lar ───────────────────────────────────────────────────────

function setupModuleEventListeners(role: string): void {
  const refreshMonthlyDashboard = async (): Promise<void> => {
    await loadMasterData();
    await applyDataFilterAndRunDashboard(getSelectedViewId());
  };

  window.addEventListener('calendarDataChanged', async () => {
    await refreshMonthlyDashboard();
  });

  window.addEventListener(MONTHLY_AUDIT_DATA_CHANGED_EVENT, async () => {
    await refreshMonthlyDashboard();
  });

  window.addEventListener('reportFinalized', async () => {
    await refreshMonthlyDashboard();
  });


  window.addEventListener('bayiDurumDegisti', async (event) => {
    const detail = (event as CustomEvent<any>).detail ?? {};
    if (detail.archiveState) {
      archivedStoreState = normalizeArchiveState(detail.archiveState);
    }
    await loadMasterData();
    await applyDataFilterAndRunDashboard(getSelectedViewId());
  });

  // Admin kullanıcı filtresi
  if (role === 'admin') {
    document.getElementById('admin-user-filter')?.addEventListener('change', async (e) => {
      await applyDataFilterAndRunDashboard((e.target as HTMLSelectElement).value);
    });
  }

  // Görünüm modu butonu (Aylık / Yıllık)
  document.querySelectorAll<HTMLButtonElement>('#view-mode-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('#view-mode-toggle button').forEach(b => {
        b.classList.remove('active', 'btn-primary');
        b.classList.add('btn-light');
      });
      btn.classList.remove('btn-light');
      btn.classList.add('active', 'btn-primary');
      currentViewMode = (btn.dataset['mode'] as 'monthly' | 'yearly') ?? 'monthly';
      calculateAndDisplayDashboard();
    });
  });

  // Genel filtreler
  ['bolge-filter', 'yonetmen-filter', 'sehir-filter', 'ilce-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      applyAndRepopulateFilters(id);
    });
  });

  // Şehir filtresi
  document.getElementById('local-city-filter')?.addEventListener('change', (e) => {
    localCityFilterValue = (e.target as HTMLSelectElement).value;
    renderRemainingStores(currentGlobalFilteredStores);
  });


}

// ─── Modül Init (Export) ──────────────────────────────────────────────────────

export async function initializeDenetimTakipModule(pb: PocketBase): Promise<void> {
  notify.clear();
  pbInstance = pb;
  if (!pbInstance.authStore.isValid) return;

  currentUserRole = (pbInstance.authStore.model?.['role'] as string) ?? null;
  currentUserId = (pbInstance.authStore.model?.['id'] as string) ?? null;
  // Güvenlik: yükleme ekranı yanlışlıkla açık kalmasın
  hideLoadingOverlay();
showLoadingOverlay('Veriler işleniyor, lütfen bekleyin...');
  try {
    setupModuleEventListeners(currentUserRole ?? '');
    await loadSettings('my_data');
    await loadMasterData();

    if (currentUserRole === 'admin') {
      document.getElementById('admin-user-selector-container')?.removeAttribute('hidden');
      await populateUserFilterDropdown();
    } else {
      document.getElementById('admin-user-selector-container')?.setAttribute('hidden', '');
    }

    await applyDataFilterAndRunDashboard('my_data');

    // Dashboard'u göster
    setHidden(document.getElementById('dashboard-content') as HTMLElement | null, false);
  } catch (e: any) {
    console.error('Denetim Takip init hatası:', e);
    errorService.network(e, 'Denetim Takip verileri yüklenemedi. PocketBase bağlantısını kontrol edin.');
  } finally {
    hideLoadingOverlay();
  }
}

// TOTAL_LINES: 775
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
