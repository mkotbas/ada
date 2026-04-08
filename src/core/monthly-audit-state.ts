import type PocketBase from 'pocketbase';
import {
  buildDayCountMap,
  calculateAdjustedMonthlyTarget,
  calculateCurrentMonthPlan,
  calculateRemainingWorkdayCount,
  sumPlan,
  type DailyPlanMap,
  type DayCountMap,
  type DayReport,
  type MonthlyPlanDiagnostics,
} from './monthly-plan';
import { getWorkDaysOfMonth } from './utils';
import { getBusinessDateKeyFromParts, getBusinessDateParts, getBusinessMonthUtcRange, toBusinessZonedDateTime } from './temporal';

export const MONTHLY_AUDIT_DATA_CHANGED_EVENT = 'monthlyAuditDataChanged';
export const MONTHLY_AUDIT_CONSISTENCY_EVENT = 'monthlyAuditConsistencyChanged';

export type LeaveDataMap = Record<string, boolean>;
export type ManualAuditMap = Record<string, number>;

export type MonthlyAuditConsistencyIssueCode =
  | 'remaining-plan-mismatch'
  | 'remaining-diagnostics-mismatch'
  | 'today-requirement-mismatch'
  | 'completed-raw-map-mismatch'
  | 'negative-remaining'
  | 'negative-today-requirement';

export type MonthlyAuditConsistencyIssue = {
  code: MonthlyAuditConsistencyIssueCode;
  message: string;
  details: Record<string, number | string | boolean>;
};

export type MonthlyAuditConsistency = {
  isConsistent: boolean;
  issues: MonthlyAuditConsistencyIssue[];
  signature: string;
};

export type MonthlyAuditConsistencyEventDetail = {
  context: string;
  year: number;
  month: number;
  isConsistent: boolean;
  summary: string;
  issues: MonthlyAuditConsistencyIssue[];
};

export type MonthlyAuditSettings = {
  globalAylikHedef: number;
  globalMinDaily: number;
  leaveData: LeaveDataMap;
  manualAuditData: ManualAuditMap;
};

export type DailyAuditCompletionWarning = {
  message: string;
  remaining: number;
  plannedToday: number;
  completedToday: number;
  todayDay: number;
};

export type AuditStoreRef = {
  code: string;
  timestamp: number;
  date: number;
};

export type ReportStoreLike = {
  id?: string;
  bayiKodu?: string;
};

export type ReportLike = {
  id?: string;
  user?: string;
  bayi?: string;
  denetimTamamlanmaTarihi?: string;
  created?: string;
  expand?: { bayi?: ReportStoreLike };
};

export type RevertLike = {
  yil_ay?: string;
  bayi?: string;
  expand?: { bayi?: ReportStoreLike };
};

export type MonthlyAuditState = MonthlyAuditSettings & {
  year: number;
  month: number;
  todayDay: number;
  allWorkDays: number[];
  activeWorkDays: number[];
  adjustedTarget: number;
  completedReports: DayReport[];
  rawReports: DayReport[];
  auditedStores: AuditStoreRef[];
  doneByDayUnique: DayCountMap;
  doneByDayRaw: DayCountMap;
  planByDay: DailyPlanMap;
  diagnostics: MonthlyPlanDiagnostics;
  todayRequirement: number;
  remainingWorkdays: number;
  consistency: MonthlyAuditConsistency;
};

type BuildMonthlyAuditStateOptions = {
  year: number;
  month: number;
  todayDay?: number;
  settings: MonthlyAuditSettings;
  reports: ReportLike[];
  reverts: RevertLike[];
  excludedStoreIds?: Iterable<string>;
  excludedStoreCodes?: Iterable<string>;
  seed?: number;
};

type LoadMonthlyAuditStateOptions = {
  year?: number;
  month?: number;
  todayDay?: number;
  settingsUserId: string;
  reportUserId?: string | null;
  excludedStoreIds?: Iterable<string>;
  excludedStoreCodes?: Iterable<string>;
};

type AyarRecord = {
  id: string;
  deger: unknown;
};

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}


function buildConsistencySignature(issues: MonthlyAuditConsistencyIssue[]): string {
  return issues
    .map((issue) => `${issue.code}:${Object.entries(issue.details)
      .sort(([left], [right]) => left.localeCompare(right, 'tr'))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(',')}`)
    .join('|');
}

function formatConsistencyAlert(issue: MonthlyAuditConsistencyIssue): string {
  switch (issue.code) {
    case 'remaining-plan-mismatch':
      return `Takvim kontrol uyarısı: Kalan iş ${issue.details.totalRemaining}, takvim toplamı ${issue.details.totalPlannedFromNow}.`;
    case 'remaining-diagnostics-mismatch':
      return `Takvim kontrol uyarısı: Hesaplanan kalan ${issue.details.calculatedRemaining}, tanılama kalan ${issue.details.diagnosticsRemaining}.`;
    case 'today-requirement-mismatch':
      return `Takvim kontrol uyarısı: Bugün kalan ${issue.details.expectedRemainingToday}, kaydedilen kalan ${issue.details.actualTodayRequirement}, günlük hedef ${issue.details.plannedToday}.`;
    case 'completed-raw-map-mismatch':
      return `Takvim kontrol uyarısı: Ham toplam ${issue.details.rawMappedTotal}, ham kayıt ${issue.details.rawReports}.`;
    case 'negative-remaining':
      return `Takvim kontrol uyarısı: Kalan iş negatif görünüyor (${issue.details.totalRemaining}).`;
    case 'negative-today-requirement':
      return `Takvim kontrol uyarısı: Bugün gereken değer negatif görünüyor (${issue.details.todayRequirement}).`;
    default:
      return `Takvim kontrol uyarısı: ${issue.message}`;
  }
}

export function validateMonthlyAuditState(state: Pick<MonthlyAuditState,
  'adjustedTarget' |
  'completedReports' |
  'rawReports' |
  'doneByDayUnique' |
  'doneByDayRaw' |
  'planByDay' |
  'diagnostics' |
  'todayDay' |
  'todayRequirement'
>): MonthlyAuditConsistency {
  const rawRemaining = state.adjustedTarget - state.completedReports.length;
  const totalRemaining = Math.max(0, rawRemaining);
  const totalPlannedFromNow = sumPlan(state.planByDay);
  const rawMappedTotal = Object.values(state.doneByDayRaw).reduce((total, value) => total + value, 0);
  const plannedToday = state.planByDay[state.todayDay] ?? 0;
  const completedTodayRaw = state.doneByDayRaw[state.todayDay] ?? 0;
  const expectedRemainingToday = Math.max(0, plannedToday - completedTodayRaw);
  const issues: MonthlyAuditConsistencyIssue[] = [];

  if (rawRemaining < 0) {
    issues.push({
      code: 'negative-remaining',
      message: 'Hedefe kalan sayı negatif olamaz.',
      details: { totalRemaining: rawRemaining, adjustedTarget: state.adjustedTarget, completedRaw: state.completedReports.length },
    });
  }

  if (state.todayRequirement < 0) {
    issues.push({
      code: 'negative-today-requirement',
      message: 'Bugün gereken sayı negatif olamaz.',
      details: { todayRequirement: state.todayRequirement, todayDay: state.todayDay },
    });
  }

  if (totalPlannedFromNow !== totalRemaining) {
    issues.push({
      code: 'remaining-plan-mismatch',
      message: 'Takvim plan toplamı ile hedefe kalan sayı eşleşmiyor.',
      details: { totalRemaining, totalPlannedFromNow },
    });
  }

  if (state.diagnostics.totalRemaining !== totalRemaining) {
    issues.push({
      code: 'remaining-diagnostics-mismatch',
      message: 'Tanılama verisindeki kalan sayı, hesaplanan kalan sayı ile eşleşmiyor.',
      details: {
        diagnosticsRemaining: state.diagnostics.totalRemaining,
        calculatedRemaining: totalRemaining,
      },
    });
  }

  if (state.todayRequirement !== expectedRemainingToday) {
    issues.push({
      code: 'today-requirement-mismatch',
      message: 'Bugün kalan sayı, planlanan günlük hedeften düşülen tamamlanan denetim sayısı ile eşleşmiyor.',
      details: {
        todayDay: state.todayDay,
        actualTodayRequirement: state.todayRequirement,
        expectedRemainingToday,
        plannedToday,
        completedTodayRaw,
      },
    });
  }

  if (rawMappedTotal !== state.rawReports.length) {
    issues.push({
      code: 'completed-raw-map-mismatch',
      message: 'Ham günlük toplam ile tamamlanan kayıt sayısı eşleşmiyor.',
      details: { rawMappedTotal, completedRaw: state.completedReports.length, rawReports: state.rawReports.length },
    });
  }

  return {
    isConsistent: issues.length === 0,
    issues,
    signature: buildConsistencySignature(issues),
  };
}

export function getDailyAuditCompletionWarning(state: Pick<MonthlyAuditState,
  'todayDay' |
  'todayRequirement' |
  'planByDay' |
  'doneByDayRaw'
>): DailyAuditCompletionWarning | null {
  const plannedToday = state.planByDay[state.todayDay] ?? 0;
  const completedToday = state.doneByDayRaw[state.todayDay] ?? 0;
  const remaining = Math.max(0, state.todayRequirement);

  if (plannedToday <= 0 || remaining <= 0) {
    return null;
  }

  return {
    message: `Denetim hedefi tamamlanmadı. Kalan ${remaining}`,
    remaining,
    plannedToday,
    completedToday,
    todayDay: state.todayDay,
  };
}

const MONTHLY_AUDIT_CONSISTENCY_SEEN = '__monthlyAuditConsistencySeen__';

function getConsistencySeenStore(): Set<string> {
  const scope = globalThis as typeof globalThis & { [key: string]: Set<string> | undefined };
  if (!scope[MONTHLY_AUDIT_CONSISTENCY_SEEN]) {
    scope[MONTHLY_AUDIT_CONSISTENCY_SEEN] = new Set<string>();
  }
  return scope[MONTHLY_AUDIT_CONSISTENCY_SEEN]!;
}

function dispatchMonthlyAuditConsistencyEvent(detail: MonthlyAuditConsistencyEventDetail): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(MONTHLY_AUDIT_CONSISTENCY_EVENT, {
    detail,
  }));
}

export function monitorMonthlyAuditConsistency(state: MonthlyAuditState, context: string): void {
  const firstIssue = state.consistency.issues[0];
  const detail: MonthlyAuditConsistencyEventDetail = {
    context,
    year: state.year,
    month: state.month,
    isConsistent: state.consistency.isConsistent,
    summary: firstIssue ? formatConsistencyAlert(firstIssue) : '',
    issues: state.consistency.issues,
  };

  dispatchMonthlyAuditConsistencyEvent(detail);

  if (state.consistency.isConsistent || state.consistency.signature === '') return;

  const signature = `${context}:${state.year}-${state.month}:${state.consistency.signature}`;
  const seenStore = getConsistencySeenStore();
  if (seenStore.has(signature)) return;
  seenStore.add(signature);

  console.error('[MonthlyAuditConsistency]', {
    context,
    year: state.year,
    month: state.month,
    issues: state.consistency.issues,
  });

}


function parseJsonObject<T extends Record<string, unknown>>(rawValue: unknown): T {
  if (!rawValue) return {} as T;
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      return {} as T;
    }
    return {} as T;
  }
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue as T;
  }
  return {} as T;
}

export function parseBooleanMap(rawValue: unknown): LeaveDataMap {
  const parsed = parseJsonObject<Record<string, unknown>>(rawValue);
  return Object.entries(parsed).reduce<LeaveDataMap>((acc, [key, value]) => {
    acc[key] = value === true || value === 'true' || value === 1 || value === '1';
    return acc;
  }, {});
}

export function parseManualAuditMap(rawValue: unknown): ManualAuditMap {
  const parsed = parseJsonObject<Record<string, unknown>>(rawValue);
  return Object.entries(parsed).reduce<ManualAuditMap>((acc, [key, value]) => {
    const numericValue = Math.max(0, Math.floor(normalizeNumber(value, 0)));
    if (numericValue > 0) {
      acc[key] = numericValue;
    }
    return acc;
  }, {});
}

export function getDateKey(year: number, month: number, day: number): string {
  return getBusinessDateKeyFromParts(year, month, day);
}

export function expandManualCountsToReports(manualAuditData: ManualAuditMap, year: number, month: number): DayReport[] {
  const reports: DayReport[] = [];

  Object.entries(manualAuditData).forEach(([key, count]) => {
    const [itemYear, itemMonth, itemDay] = key.split('-').map(Number);
    const normalizedCount = Math.max(0, Math.floor(count));

    if (itemYear !== year || itemMonth !== month || !Number.isFinite(itemDay) || normalizedCount <= 0) {
      return;
    }

    for (let index = 0; index < normalizedCount; index += 1) {
      reports.push({ date: itemDay });
    }
  });

  return reports;
}


function resolveReportDate(input: ReportLike): string {
  const completionDate = typeof input.denetimTamamlanmaTarihi === 'string' ? input.denetimTamamlanmaTarihi.trim() : '';
  if (completionDate !== '') return completionDate;

  const createdDate = typeof input.created === 'string' ? input.created.trim() : '';
  return createdDate !== '' ? createdDate : '';
}

function normalizePocketBaseDateFilterValue(isoValue: string): string {
  return isoValue.replace('T', ' ');
}

function buildReportDateRangeFilter(startUtcIso: string, endUtcIso: string): string {
  const startDbValue = normalizePocketBaseDateFilterValue(startUtcIso);
  const endDbValue = normalizePocketBaseDateFilterValue(endUtcIso);

  return [
    `((denetimTamamlanmaTarihi != "" && denetimTamamlanmaTarihi >= "${startDbValue}" && denetimTamamlanmaTarihi < "${endDbValue}")`,
    `(denetimTamamlanmaTarihi = "" && created >= "${startDbValue}" && created < "${endDbValue}"))`,
  ].join(' || ');
}

function resolveStoreKey(source: { bayi?: string; expand?: { bayi?: ReportStoreLike } } | null | undefined): string {
  const expandedStore = source?.expand?.bayi;
  const normalizedCode = typeof expandedStore?.bayiKodu === 'string' ? expandedStore.bayiKodu.trim() : '';
  if (normalizedCode) return normalizedCode;

  const expandedId = typeof expandedStore?.id === 'string' ? expandedStore.id.trim() : '';
  if (expandedId) return expandedId;

  return typeof source?.bayi === 'string' ? source.bayi.trim() : '';
}

function isExcludedStore(
  source: { bayi?: string; expand?: { bayi?: ReportStoreLike } } | null | undefined,
  excludedStoreIds: Set<string>,
  excludedStoreCodes: Set<string>,
): boolean {
  const expandedStore = source?.expand?.bayi;
  const normalizedCode = typeof expandedStore?.bayiKodu === 'string' ? expandedStore.bayiKodu.trim() : '';
  const expandedId = typeof expandedStore?.id === 'string' ? expandedStore.id.trim() : '';
  const rawStoreId = typeof source?.bayi === 'string' ? source.bayi.trim() : '';

  return (
    (normalizedCode !== '' && excludedStoreCodes.has(normalizedCode)) ||
    (expandedId !== '' && excludedStoreIds.has(expandedId)) ||
    (rawStoreId !== '' && excludedStoreIds.has(rawStoreId))
  );
}

async function getSettingRecord(pb: PocketBase, anahtar: string): Promise<AyarRecord | null> {
  try {
    const record = await pb.collection('ayarlar').getFirstListItem(`anahtar="${anahtar}"`);
    return { id: String(record['id'] ?? ''), deger: record['deger'] };
  } catch (error: unknown) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: number }).status
      : undefined;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

export async function loadMonthlyAuditSettings(pb: PocketBase, settingsUserId: string): Promise<MonthlyAuditSettings> {
  const [targetRecord, minDailyRecord, leaveRecord, manualRecord] = await Promise.all([
    getSettingRecord(pb, 'aylikHedef'),
    getSettingRecord(pb, 'minZiyaret'),
    settingsUserId ? getSettingRecord(pb, `leaveData_${settingsUserId}`) : Promise.resolve(null),
    settingsUserId ? getSettingRecord(pb, `manualAuditData_${settingsUserId}`) : Promise.resolve(null),
  ]);

  return {
    globalAylikHedef: Math.max(0, Math.floor(normalizeNumber(targetRecord?.deger, 0))),
    globalMinDaily: Math.max(0, Math.floor(normalizeNumber(minDailyRecord?.deger, 2))),
    leaveData: parseBooleanMap(leaveRecord?.deger),
    manualAuditData: parseManualAuditMap(manualRecord?.deger),
  };
}

export function buildMonthlyAuditState({
  year,
  month,
  todayDay,
  settings,
  reports,
  reverts,
  excludedStoreIds,
  excludedStoreCodes,
  seed,
}: BuildMonthlyAuditStateOptions): MonthlyAuditState {
  const normalizedTodayDay = todayDay ?? getBusinessDateParts().day;
  const excludedIds = new Set(Array.from(excludedStoreIds ?? []).filter(Boolean));
  const excludedCodes = new Set(Array.from(excludedStoreCodes ?? []).filter(Boolean));
  const currentMonthKey = `${year}-${month}`;
  const revertedStoreKeys = new Set<string>();

  reverts.forEach((revert) => {
    if (revert.yil_ay !== currentMonthKey) return;
    if (isExcludedStore(revert, excludedIds, excludedCodes)) return;

    const storeKey = resolveStoreKey(revert);
    if (storeKey) {
      revertedStoreKeys.add(storeKey);
    }
  });

  const uniqueStoreMap = new Map<string, AuditStoreRef>();

  reports.forEach((report) => {
    const rawDate = resolveReportDate(report);
    if (!rawDate) return;
    if (isExcludedStore(report, excludedIds, excludedCodes)) return;

    const reportDate = toBusinessZonedDateTime(rawDate);
    if (reportDate.year !== year || (reportDate.month - 1) !== month) return;

    const storeKey = resolveStoreKey(report);
    if (!storeKey || revertedStoreKeys.has(storeKey)) return;


    const nextAuditRef = {
      code: storeKey,
      timestamp: Number(reportDate.epochMilliseconds),
      date: reportDate.day,
    };
    const previousAuditRef = uniqueStoreMap.get(storeKey);
    if (!previousAuditRef || nextAuditRef.timestamp > previousAuditRef.timestamp) {
      uniqueStoreMap.set(storeKey, nextAuditRef);
    }
  });

  const uniqueActualAuditRefs = [...uniqueStoreMap.values()].sort((left, right) => right.timestamp - left.timestamp);
  const uniqueActualReports = uniqueActualAuditRefs.map((auditRef) => ({ date: auditRef.date }));
  const manualReports = expandManualCountsToReports(settings.manualAuditData, year, month);
  const completedReports = [...uniqueActualReports, ...manualReports];
  const rawReports = [...uniqueActualReports, ...manualReports];

  const allWorkDays = getWorkDaysOfMonth(year, month);
  const activeWorkDays = allWorkDays.filter((day) => !settings.leaveData[getDateKey(year, month, day)]);
  const adjustedTarget = calculateAdjustedMonthlyTarget(
    settings.globalAylikHedef,
    allWorkDays,
    activeWorkDays,
    settings.globalMinDaily,
  );
  const currentPlan = calculateCurrentMonthPlan(
    adjustedTarget,
    activeWorkDays,
    normalizedTodayDay,
    completedReports,
    rawReports,
    settings.globalMinDaily,
    seed ?? (year + month),
  );
  const doneByDayUnique = buildDayCountMap(completedReports);
  const doneByDayRaw = buildDayCountMap(rawReports);
  const plannedToday = currentPlan.planByDay[normalizedTodayDay] ?? 0;
  const completedTodayRaw = doneByDayRaw[normalizedTodayDay] ?? 0;
  const remainingTodayRequirement = Math.max(0, plannedToday - completedTodayRaw);

  const stateWithoutConsistency = {
    year,
    month,
    todayDay: normalizedTodayDay,
    allWorkDays,
    activeWorkDays,
    adjustedTarget,
    globalAylikHedef: settings.globalAylikHedef,
    globalMinDaily: settings.globalMinDaily,
    leaveData: settings.leaveData,
    manualAuditData: settings.manualAuditData,
    completedReports,
    rawReports,
    auditedStores: [
      ...uniqueActualAuditRefs,
      ...manualReports.map((report, index) => ({
        code: `manual-${report.date}-${index}`,
        timestamp: Number(toBusinessZonedDateTime(new Date(Date.UTC(year, month, report.date))).epochMilliseconds),
        date: report.date,
      })),
    ],
    doneByDayUnique,
    doneByDayRaw,
    planByDay: currentPlan.planByDay,
    diagnostics: currentPlan.diagnostics,
    todayRequirement: remainingTodayRequirement,
    remainingWorkdays: calculateRemainingWorkdayCount(
      activeWorkDays,
      normalizedTodayDay,
      remainingTodayRequirement,
    ),
  };

  return {
    ...stateWithoutConsistency,
    consistency: validateMonthlyAuditState(stateWithoutConsistency),
  };
}

export async function loadMonthlyAuditState(pb: PocketBase, options: LoadMonthlyAuditStateOptions): Promise<MonthlyAuditState> {
  const businessNow = getBusinessDateParts();
  const year = options.year ?? businessNow.year;
  const month = options.month ?? businessNow.month;
  const todayDay = options.todayDay ?? businessNow.day;
  const monthRange = getBusinessMonthUtcRange(year, month);
  const reportFilterParts = [buildReportDateRangeFilter(monthRange.startUtcIso, monthRange.endUtcIso)];

  if (options.reportUserId) {
    reportFilterParts.unshift(`user="${options.reportUserId}"`);
  }

  const [settings, reports, reverts] = await Promise.all([
    loadMonthlyAuditSettings(pb, options.settingsUserId),
    pb.collection('denetim_raporlari').getFullList<ReportLike>({
      filter: reportFilterParts.join(' && '),
      expand: 'bayi',
      sort: '-updated',
    }),
    pb.collection('denetim_geri_alinanlar').getFullList<RevertLike>({
      filter: `yil_ay="${year}-${month}"`,
      expand: 'bayi',
    }),
  ]);

  return buildMonthlyAuditState({
    year,
    month,
    todayDay,
    settings,
    reports,
    reverts,
    excludedStoreIds: options.excludedStoreIds,
    excludedStoreCodes: options.excludedStoreCodes,
    seed: year + month,
  });
}

export function dispatchMonthlyAuditDataChanged(reason: string): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(MONTHLY_AUDIT_DATA_CHANGED_EVENT, {
    detail: { reason },
  }));
}

// TOTAL_LINES: 523
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
