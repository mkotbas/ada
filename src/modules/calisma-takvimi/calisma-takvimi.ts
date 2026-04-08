/* fide/src/modules/calisma-takvimi/calisma-takvimi.ts */
import type PocketBase from 'pocketbase';
import { getWorkDaysOfMonth } from '../../core/utils';
import {
  buildExactDailyDistribution,
  calculateAdjustedMonthlyTarget,
  calculateCurrentMonthPlan,
  type DayCountMap,
  type DailyPlanMap,
} from '../../core/monthly-plan';
import {
  MONTHLY_AUDIT_DATA_CHANGED_EVENT,
  dispatchMonthlyAuditDataChanged,
  getDailyAuditCompletionWarning,
  getDateKey,
  loadMonthlyAuditState,
  monitorMonthlyAuditConsistency,
  validateMonthlyAuditState,
  type LeaveDataMap,
  type ManualAuditMap,
  type MonthlyAuditState,
} from '../../core/monthly-audit-state';
import { notify } from '../../core/notify';
import { errorService } from '../../core/error';
import { getBusinessDateParts } from '../../core/temporal';

export const __calismaTakvimiTestUtils = {
  buildExactDailyDistribution,
};

type CurrentMonthState = {
  planByDay: DailyPlanMap;
  doneByDayUnique: DayCountMap;
  doneByDayRaw: DayCountMap;
};

type AyarRecord = {
  id: string;
  deger: unknown;
};

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getSettingRecord(pb: PocketBase, anahtar: string): Promise<AyarRecord | null> {
  try {
    const record = await pb.collection('ayarlar').getFirstListItem(`anahtar="${anahtar}"`);
    return { id: record['id'] as string, deger: record['deger'] };
  } catch (error: unknown) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: number }).status : undefined;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

function sanitizeSettingValue(deger: unknown): unknown {
  if (deger === null || deger === undefined) {
    return {};
  }

  return JSON.parse(JSON.stringify(deger));
}

function isEmptySettingValue(deger: unknown): boolean {
  if (!deger || typeof deger !== 'object' || Array.isArray(deger)) {
    return false;
  }

  return Object.keys(deger as Record<string, unknown>).length === 0;
}

async function upsertSetting(pb: PocketBase, anahtar: string, deger: unknown): Promise<void> {
  const normalizedValue = sanitizeSettingValue(deger);
  const existingRecord = await getSettingRecord(pb, anahtar);

  if (isEmptySettingValue(normalizedValue)) {
    if (existingRecord) {
      await pb.collection('ayarlar').delete(existingRecord.id);
    }
    return;
  }

  if (existingRecord) {
    await pb.collection('ayarlar').update(existingRecord.id, { deger: normalizedValue });
    return;
  }

  await pb.collection('ayarlar').create({ anahtar, deger: normalizedValue });
}

export async function initializeCalismaTakvimiModule(pb: PocketBase): Promise<void> {
  const MONTH_NAMES = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];
  const WEEKDAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz'];

  let { year: currentYear, month: currentMonth, day: todayDay } = getBusinessDateParts();
  const container = document.querySelector<HTMLElement>('.calendar-grid-main');
  const userId = pb.authStore.model?.['id'] as string;
  const leaveSettingsKey = `leaveData_${userId}`;
  const manualSettingsKey = `manualAuditData_${userId}`;

  let leaveData: LeaveDataMap = {};
  let manualAuditData: ManualAuditMap = {};
  let globalAylikHedef = 0;
  let globalMinDaily = 2;
  let currentMonthState: MonthlyAuditState | null = null;

  function getManualCount(month: number, day: number): number {
    return manualAuditData[getDateKey(currentYear, month, day)] ?? 0;
  }

  const consistencyWarningEl = document.getElementById('calisma-takvimi-consistency-warning');

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

  async function loadInitialData(): Promise<void> {
    currentMonthState = await loadMonthlyAuditState(pb, {
      year: currentYear,
      month: currentMonth,
      todayDay,
      settingsUserId: userId,
      reportUserId: userId,
    });
    monitorMonthlyAuditConsistency(currentMonthState, 'calisma-takvimi');
    renderConsistencyWarning(currentMonthState);

    leaveData = currentMonthState.leaveData;
    manualAuditData = currentMonthState.manualAuditData;
    globalAylikHedef = currentMonthState.globalAylikHedef;
    globalMinDaily = currentMonthState.globalMinDaily;

    const targetInput = document.getElementById('global-target-input') as HTMLInputElement | null;
    if (targetInput) targetInput.value = String(globalAylikHedef);

    const minInput = document.getElementById('global-min-daily-input') as HTMLInputElement | null;
    if (minInput) minInput.value = String(globalMinDaily);
  }

  function recalculateCurrentMonthState(): void {
    if (!currentMonthState) return;

    const adjustedTarget = calculateAdjustedMonthlyTarget(
      globalAylikHedef,
      currentMonthState.allWorkDays,
      currentMonthState.activeWorkDays,
      globalMinDaily,
    );
    const nextPlan = calculateCurrentMonthPlan(
      adjustedTarget,
      currentMonthState.activeWorkDays,
      todayDay,
      currentMonthState.completedReports,
      currentMonthState.rawReports,
      globalMinDaily,
      currentYear + currentMonth,
    );
    const plannedToday = nextPlan.planByDay[todayDay] ?? 0;
    const completedTodayRaw = nextPlan.doneByDayRaw[todayDay] ?? 0;
    const todayRequirement = Math.max(0, plannedToday - completedTodayRaw);

    currentMonthState = {
      ...currentMonthState,
      todayDay,
      adjustedTarget,
      globalAylikHedef,
      globalMinDaily,
      planByDay: nextPlan.planByDay,
      doneByDayUnique: nextPlan.doneByDayUnique,
      doneByDayRaw: nextPlan.doneByDayRaw,
      diagnostics: nextPlan.diagnostics,
      todayRequirement,
      remainingWorkdays: nextPlan.diagnostics.futureActiveDayCount + (todayRequirement > 0 ? 1 : 0),
    };
    currentMonthState.consistency = validateMonthlyAuditState(currentMonthState);
    monitorMonthlyAuditConsistency(currentMonthState, 'calisma-takvimi');
    renderConsistencyWarning(currentMonthState);
  }

  function getCurrentMonthPlanState(): CurrentMonthState {
    if (!currentMonthState) {
      return {
        planByDay: {},
        doneByDayUnique: {},
        doneByDayRaw: {},
      };
    }

    return {
      planByDay: currentMonthState.planByDay,
      doneByDayUnique: currentMonthState.doneByDayUnique,
      doneByDayRaw: currentMonthState.doneByDayRaw,
    };
  }

  async function saveLeaveData(): Promise<void> {
    await upsertSetting(pb, leaveSettingsKey, leaveData);
  }

  async function saveManualAuditData(): Promise<void> {
    await upsertSetting(pb, manualSettingsKey, manualAuditData);
  }

  function dispatchCalendarChanged(): void {
    window.dispatchEvent(new CustomEvent('calendarDataChanged', {
      detail: {
        leaveData,
        manualAuditData,
      },
    }));
    dispatchMonthlyAuditDataChanged('calendarDataChanged');
  }

  function promptManualCount(month: number, day: number): number | null {
    const currentValue = getManualCount(month, day);
    const promptMessage = 'Bu gün için manuel denetim adedini girin. Silmek için 0 yazın.';
    const rawValue = window.prompt(promptMessage, currentValue > 0 ? String(currentValue) : '');

    if (rawValue === null) return null;

    const trimmedValue = rawValue.trim();
    if (!trimmedValue) return 0;

    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 20) {
      notify.warning('Lütfen 0 ile 20 arasında geçerli bir denetim adedi girin.');
      return null;
    }

    return Math.floor(parsedValue);
  }

  async function refreshCalendarAfterDataChange(successMessage?: string): Promise<void> {
    await loadInitialData();
    dispatchCalendarChanged();
    renderCalendar();
    if (successMessage) notify.success(successMessage);
  }

  async function updateManualCount(month: number, day: number): Promise<void> {
    const dateKey = getDateKey(currentYear, month, day);

    if (leaveData[dateKey]) {
      notify.warning('İzinli güne manuel denetim girilemez. Önce izin kaydını kaldırın.');
      return;
    }

    const nextValue = promptManualCount(month, day);
    if (nextValue === null) return;

    if (nextValue <= 0) {
      delete manualAuditData[dateKey];
    } else {
      manualAuditData[dateKey] = nextValue;
    }

    try {
      await saveManualAuditData();
      await refreshCalendarAfterDataChange(nextValue > 0 ? 'Manuel denetim kaydedildi.' : 'Manuel denetim kaydı temizlendi.');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('manualAuditData save failed', error);
        console.error('manualAuditData save failed details', (error as { response?: unknown })?.response ?? null);
      }
      errorService.handle(error, {
        userMessage: 'Manuel denetim kaydı güncellenemedi.',
      });
    }
  }

  async function toggleLeave(month: number, day: number): Promise<void> {
    const dateKey = getDateKey(currentYear, month, day);

    if (!leaveData[dateKey] && getManualCount(month, day) > 0) {
      notify.warning('Bu güne manuel denetim girilmiş. Önce manuel denetimi temizleyin.');
      return;
    }

    if (leaveData[dateKey]) {
      delete leaveData[dateKey];
    } else {
      leaveData[dateKey] = true;
    }

    try {
      await saveLeaveData();
      await refreshCalendarAfterDataChange();
      return;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('leaveData save failed', error);
        console.error('leaveData save failed details', (error as { response?: unknown })?.response ?? null);
      }
      // Yerel görünüm yine güncellensin.
    }

    renderCalendar();
  }

  async function clearDayOverrides(month: number, day: number): Promise<void> {
    const dateKey = getDateKey(currentYear, month, day);
    const hadLeave = Boolean(leaveData[dateKey]);
    const hadManual = getManualCount(month, day) > 0;

    if (!hadLeave && !hadManual) {
      notify.warning('Bu gün için temizlenecek manuel denetim veya izin kaydı yok.');
      return;
    }

    delete leaveData[dateKey];
    delete manualAuditData[dateKey];

    try {
      await saveLeaveData();
      await saveManualAuditData();
      await refreshCalendarAfterDataChange('Gün kaydı temizlendi.');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('day override clear failed', error);
        console.error('day override clear failed details', (error as { response?: unknown })?.response ?? null);
      }
      errorService.handle(error, {
        userMessage: 'Gün kaydı temizlenemedi.',
      });
    }
  }

  type CalendarAction = 'manual' | 'leave' | 'clear';
  type PendingDayAction = { month: number; day: number };

  let pendingDayAction: PendingDayAction | null = null;
  let dayActionDialog: HTMLDialogElement | null = null;
  let dayActionTitle: HTMLElement | null = null;

  function closeDayActionDialog(): void {
    if (dayActionDialog?.open) {
      dayActionDialog.close();
    }
    pendingDayAction = null;
  }

  function ensureDayActionDialog(): HTMLDialogElement {
    if (dayActionDialog) return dayActionDialog;

    const dialog = document.createElement('dialog');
    dialog.className = 'calendar-day-action-dialog';
    dialog.setAttribute('aria-labelledby', 'calendar-day-action-title');

    const content = document.createElement('div');
    content.className = 'calendar-day-action-content';

    const header = document.createElement('div');
    header.className = 'calendar-day-action-header';

    dayActionTitle = document.createElement('h3');
    dayActionTitle.id = 'calendar-day-action-title';
    dayActionTitle.className = 'calendar-day-action-title';
    header.appendChild(dayActionTitle);

    const actions = document.createElement('div');
    actions.className = 'calendar-day-action-buttons';

    const buttonConfigs: Array<{ action: CalendarAction; label: string; className: string }> = [
      { action: 'manual', label: 'Manuel denetim ekle', className: 'calendar-day-action-btn is-primary' },
      { action: 'leave', label: 'İzin işaretle', className: 'calendar-day-action-btn is-secondary' },
      { action: 'clear', label: 'Temizle', className: 'calendar-day-action-btn is-ghost' },
    ];

    buttonConfigs.forEach(({ action, label, className }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.action = action;
      button.textContent = label;
      actions.appendChild(button);
    });

    const footer = document.createElement('div');
    footer.className = 'calendar-day-action-footer';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'calendar-day-action-close';
    closeButton.textContent = 'Kapat';
    footer.appendChild(closeButton);

    content.append(header, actions, footer);
    dialog.appendChild(content);

    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeDayActionDialog();
    });

    dialog.addEventListener('close', () => {
      pendingDayAction = null;
    });

    actions.addEventListener('click', event => {
      const target = event.target as HTMLElement | null;
      const action = target?.closest<HTMLButtonElement>('button[data-action]')?.dataset.action as CalendarAction | undefined;
      if (!action || !pendingDayAction) return;

      const { month, day } = pendingDayAction;
      closeDayActionDialog();

      if (action === 'manual') {
        void updateManualCount(month, day);
        return;
      }

      if (action === 'leave') {
        void toggleLeave(month, day);
        return;
      }

      void clearDayOverrides(month, day);
    });

    closeButton.addEventListener('click', () => {
      closeDayActionDialog();
    });

    document.body.appendChild(dialog);
    dayActionDialog = dialog;
    return dialog;
  }

  function openDayActionDialog(month: number, day: number): void {
    const dialog = ensureDayActionDialog();
    pendingDayAction = { month, day };

    if (dayActionTitle) {
      dayActionTitle.textContent = `${day} ${MONTH_NAMES[month]}`;
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function setupAdminControls(): void {
    const isAdmin = pb.authStore.model?.['role'] === 'admin';
    const adminConfig = document.getElementById('admin-goal-config');
    if (!isAdmin || !adminConfig) return;

    adminConfig.classList.add('is-active');

    document.getElementById('btn-save-global-target')?.addEventListener('click', async () => {
      const targetInput = document.getElementById('global-target-input') as HTMLInputElement | null;
      const minInput = document.getElementById('global-min-daily-input') as HTMLInputElement | null;

      const targetVal = Math.floor(normalizeNumber(targetInput?.value, NaN));
      const minVal = Math.floor(normalizeNumber(minInput?.value, NaN));

      if (!Number.isFinite(targetVal) || targetVal < 1) {
        notify.warning('Geçerli bir aylık hedef giriniz.');
        return;
      }

      if (!Number.isFinite(minVal) || minVal < 0) {
        notify.warning('Geçerli bir minimum günlük değer giriniz.');
        return;
      }

      try {
        await upsertSetting(pb, 'aylikHedef', targetVal);
        await upsertSetting(pb, 'minZiyaret', minVal);

        globalAylikHedef = targetVal;
        globalMinDaily = minVal;
        recalculateCurrentMonthState();
        dispatchCalendarChanged();
        renderCalendar();
        notify.success('Ayarlar başarıyla güncellendi.');
      } catch (error) {
        errorService.handle(error, {
          userMessage: `Güncelleme hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
        });
      }
    });
  }

  function appendPlanBadge(dayEl: HTMLElement, displayCount: number): void {
    if (displayCount <= 0) return;

    const badge = document.createElement('span');
    badge.className = 'visit-badge-cal';
    badge.textContent = String(displayCount);
    dayEl.appendChild(badge);
  }


  function bindDayInteractions(dayEl: HTMLElement, month: number, day: number): void {
    const monthLabel = MONTH_NAMES[month];
    dayEl.title = month === currentMonth
      ? `${day} ${monthLabel}: işlem menüsü`
      : `${day} ${monthLabel}`;

    if (month !== currentMonth) return;

    dayEl.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
    });

    dayEl.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDayActionDialog(month, day);
    });
  }

  function renderCalendar(): void {
    if (!container) return;
    container.replaceChildren();

    const currentMonthPlan = getCurrentMonthPlanState();

    for (let month = 0; month < 12; month += 1) {
      const firstDayOfWeek = new Date(currentYear, month, 1).getDay();
      const totalDays = new Date(currentYear, month + 1, 0).getDate();
      const workDays = getWorkDaysOfMonth(currentYear, month);
      const activeDays = workDays.filter(day => !leaveData[getDateKey(currentYear, month, day)]);
      const adjustedTarget = calculateAdjustedMonthlyTarget(globalAylikHedef, workDays, activeDays, globalMinDaily);
      const leaveCount = Object.keys(leaveData).filter(key => key.startsWith(`${currentYear}-${month}-`)).length;

      let planMap: DailyPlanMap = {};
      let doneByDayUnique: DayCountMap = {};
      let doneByDayRaw: DayCountMap = {};

      if (month === currentMonth) {
        planMap = currentMonthPlan.planByDay;
        doneByDayUnique = currentMonthPlan.doneByDayUnique;
        doneByDayRaw = currentMonthPlan.doneByDayRaw;
      } else if (month > currentMonth) {
        planMap = buildExactDailyDistribution(
          activeDays,
          adjustedTarget,
          globalMinDaily,
          currentYear + month,
        );
      }

      const card = document.createElement('div');
      card.className = 'month-card-cal';

      const header = document.createElement('div');
      header.className = 'month-header-cal';
      header.textContent = `${MONTH_NAMES[month]} ${currentYear}`;

      const stats = document.createElement('div');
      stats.className = 'month-stats-cal';

      const statItems = [
        { label: 'Hedef', value: String(adjustedTarget) },
        { label: 'İzin', value: `${leaveCount} Gün` },
        { label: 'Mesai', value: `${activeDays.length} Gün` },
      ];

      statItems.forEach(({ label, value }) => {
        const statEl = document.createElement('div');
        statEl.className = 'stat-item-cal';
        statEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.textContent = value;
        statEl.appendChild(valueEl);
        stats.appendChild(statEl);
      });

      const weekdaysRow = document.createElement('div');
      weekdaysRow.className = 'weekdays-row-cal';
      WEEKDAY_NAMES.forEach(name => {
        const cell = document.createElement('div');
        cell.className = 'weekday-cal';
        cell.textContent = name;
        weekdaysRow.appendChild(cell);
      });

      const daysGrid = document.createElement('div');
      daysGrid.className = 'days-grid-cal';

      const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
      for (let spacer = 0; spacer < offset; spacer += 1) {
        const empty = document.createElement('div');
        empty.className = 'day-cal empty-cal';
        daysGrid.appendChild(empty);
      }

      for (let day = 1; day <= totalDays; day += 1) {
        const dayEl = document.createElement('div');
        dayEl.className = 'day-cal';

        const dayNumber = document.createElement('span');
        dayNumber.className = 'day-number-cal';
        dayNumber.textContent = String(day);
        dayEl.appendChild(dayNumber);

        const dayOfWeek = new Date(currentYear, month, day).getDay();
        const dateKey = getDateKey(currentYear, month, day);
        const isLeave = Boolean(leaveData[dateKey]);
        const manualCount = getManualCount(month, day);
        const doneCount = month === currentMonth ? (doneByDayUnique[day] ?? 0) : 0;
        const doneRawCount = month === currentMonth ? (doneByDayRaw[day] ?? 0) : 0;
        const plannedCount = planMap[day] ?? 0;
        const remainingCount = month === currentMonth ? Math.max(0, plannedCount - doneRawCount) : plannedCount;
        const isCompletedForDay = month === currentMonth && plannedCount > 0 && doneRawCount >= plannedCount;
        const isOverCompletedForDay = month === currentMonth && plannedCount > 0 && doneRawCount > plannedCount;
        const isPastCurrentMonthWorkday = month === currentMonth && day < todayDay && workDays.includes(day);
        const isUnprocessed = isPastCurrentMonthWorkday && !isLeave && doneRawCount <= 0;

        if (dayOfWeek !== 0) {
          dayEl.classList.add('interactive-cal');
          bindDayInteractions(dayEl, month, day);

          if (isLeave) {
            dayEl.classList.add('leave-cal');
          } else if (dayOfWeek !== 6) {
            dayEl.classList.add('workday-cal');

            if (isCompletedForDay) {
              dayEl.classList.add('completed-audit-cal');
            }

            if (isOverCompletedForDay) {
              dayEl.classList.add('over-completed-audit-cal');
            }

            if (manualCount > 0) {
              dayEl.classList.add('manual-entry-cal');
            }

            if (isUnprocessed) {
              dayEl.classList.add('unprocessed-cal');
            } else if (!isCompletedForDay && remainingCount >= 4) {
              dayEl.classList.add('four-plus-cal');
            } else if (!isCompletedForDay && remainingCount === 3) {
              dayEl.classList.add('three-cal');
            } else if (!isCompletedForDay && remainingCount === 2) {
              dayEl.classList.add('two-cal');
            } else if (!isCompletedForDay && remainingCount === 1) {
              dayEl.classList.add('one-cal');
            }

            appendPlanBadge(dayEl, plannedCount);
          }
        }

        daysGrid.appendChild(dayEl);
      }

      card.appendChild(header);
      card.appendChild(stats);
      card.appendChild(weekdaysRow);
      card.appendChild(daysGrid);
      container.appendChild(card);
    }
  }

  const refreshCalendarFromSharedState = async (): Promise<void> => {
    await loadInitialData();
    renderCalendar();
  };

  window.setInterval(() => {
    const nextParts = getBusinessDateParts();
    if (nextParts.year === currentYear && nextParts.month === currentMonth && nextParts.day === todayDay) return;
    currentYear = nextParts.year;
    currentMonth = nextParts.month;
    todayDay = nextParts.day;
    void refreshCalendarFromSharedState();
  }, 60_000);

  window.addEventListener('reportFinalized', async () => {
    await refreshCalendarFromSharedState();
  });

  window.addEventListener('calendarDataChanged', async () => {
    await refreshCalendarFromSharedState();
  });

  window.addEventListener(MONTHLY_AUDIT_DATA_CHANGED_EVENT, async () => {
    await refreshCalendarFromSharedState();
  });

  await loadInitialData();
  setupAdminControls();
  renderCalendar();
}


// TOTAL_LINES: 632
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
