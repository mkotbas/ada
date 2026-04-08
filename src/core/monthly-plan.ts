import { seededShuffle } from './utils';

export type DayReport = { date: number };
export type DayCountMap = Record<number, number>;
export type DailyPlanMap = Record<number, number>;

export type MonthlyPlanDiagnostics = {
  adjustedTarget: number;
  totalCompletedUnique: number;
  completedBeforeTodayUnique: number;
  totalRemaining: number;
  totalScheduledFromToday: number;
  todayAdditionalNeed: number;
  futureTotalPlanned: number;
  totalPlannedFromNow: number;
  activeToday: boolean;
  futureActiveDayCount: number;
};

export type MonthlyPlanResult = {
  planByDay: DailyPlanMap;
  doneByDayUnique: DayCountMap;
  doneByDayRaw: DayCountMap;
  diagnostics: MonthlyPlanDiagnostics;
};

export function buildDayCountMap(reports: DayReport[]): DayCountMap {
  return reports.reduce<DayCountMap>((acc, report) => {
    acc[report.date] = (acc[report.date] ?? 0) + 1;
    return acc;
  }, {});
}

export function sumPlan(plan: DailyPlanMap): number {
  return Object.values(plan).reduce((total, value) => total + value, 0);
}

export function calculateAdjustedMonthlyTarget(
  monthlyTarget: number,
  allWorkDays: number[],
  activeWorkDays: number[],
  minDaily: number,
): number {
  const normalizedTarget = Math.max(0, Math.floor(monthlyTarget) || 0);
  const normalizedMin = Math.max(0, Math.floor(minDaily) || 0);
  const leaveWorkdayCount = Math.max(0, allWorkDays.length - activeWorkDays.length);
  const leaveImpact = leaveWorkdayCount * normalizedMin;

  return Math.max(0, normalizedTarget - leaveImpact);
}

export function buildExactDailyDistribution(
  activeDays: number[],
  remainingTarget: number,
  minDaily: number,
  seed: number,
): DailyPlanMap {
  if (remainingTarget <= 0 || activeDays.length === 0) return {};

  const normalizedTarget = Math.max(0, Math.floor(remainingTarget) || 0);
  const normalizedMin = Math.max(1, Math.floor(minDaily) || 1);
  const orderedDays = seededShuffle([...activeDays], seed);
  const distribution: DailyPlanMap = {};

  const minimumCapacity = orderedDays.length * normalizedMin;

  if (normalizedTarget >= minimumCapacity) {
    orderedDays.forEach((day) => {
      distribution[day] = normalizedMin;
    });

    let remainder = normalizedTarget - minimumCapacity;
    let cursor = 0;
    while (remainder > 0) {
      const day = orderedDays[cursor % orderedDays.length]!;
      distribution[day] = (distribution[day] ?? 0) + 1;
      remainder -= 1;
      cursor += 1;
    }

    return distribution;
  }

  const fullMinDayCount = Math.floor(normalizedTarget / normalizedMin);
  const partialRemainder = normalizedTarget % normalizedMin;

  for (let index = 0; index < fullMinDayCount; index += 1) {
    distribution[orderedDays[index]!] = normalizedMin;
  }

  if (partialRemainder > 0 && fullMinDayCount < orderedDays.length) {
    distribution[orderedDays[fullMinDayCount]!] = partialRemainder;
  }

  return distribution;
}

export function calculateCurrentMonthPlan(
  adjustedTarget: number,
  activeDays: number[],
  todayDay: number,
  completedReports: DayReport[],
  rawReports: DayReport[],
  minDaily: number,
  seed: number,
): MonthlyPlanResult {
  const doneByDayUnique = buildDayCountMap(completedReports);
  const doneByDayRaw = buildDayCountMap(rawReports);
  const totalCompletedUnique = completedReports.length;
  const completedBeforeTodayUnique = completedReports.filter(report => report.date < todayDay).length;
  const totalRemaining = Math.max(0, adjustedTarget - totalCompletedUnique);
  const totalScheduledFromToday = totalRemaining;
  const activeToday = activeDays.includes(todayDay);
  const normalizedMin = Math.max(0, Math.floor(minDaily) || 0);

  const planByDay: DailyPlanMap = {};
  const futureActiveDays = activeDays.filter(day => day > todayDay);

  let todayAdditionalNeed = 0;
  if (activeToday && totalRemaining > 0 && normalizedMin > 0) {
    todayAdditionalNeed = Math.min(normalizedMin, totalRemaining);
  }

  const remainingAfterTodayFloor = Math.max(0, totalRemaining - todayAdditionalNeed);
  const futurePlan = buildExactDailyDistribution(
    futureActiveDays,
    remainingAfterTodayFloor,
    normalizedMin,
    seed,
  );
  const futureTotalPlanned = sumPlan(futurePlan);
  const undistributedAfterFuture = Math.max(0, remainingAfterTodayFloor - futureTotalPlanned);

  if (todayAdditionalNeed > 0 || undistributedAfterFuture > 0) {
    planByDay[todayDay] = todayAdditionalNeed + undistributedAfterFuture;
  }

  Object.assign(planByDay, futurePlan);

  return {
    planByDay,
    doneByDayUnique,
    doneByDayRaw,
    diagnostics: {
      adjustedTarget,
      totalCompletedUnique,
      completedBeforeTodayUnique,
      totalRemaining,
      totalScheduledFromToday,
      todayAdditionalNeed: planByDay[todayDay] ?? 0,
      futureTotalPlanned,
      totalPlannedFromNow: sumPlan(planByDay),
      activeToday,
      futureActiveDayCount: futureActiveDays.length,
    },
  };
}

export function calculateRemainingWorkdayCount(
  activeDays: number[],
  todayDay: number,
  todayNeed: number,
): number {
  return activeDays.filter(day => day > todayDay || (day === todayDay && todayNeed > 0)).length;
}

// TOTAL_LINES: 146
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
