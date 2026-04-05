import { MONTH_NAMES } from "./state";
import { parseScore } from "./utils";

type ScoreMap = Record<number, string | number | null | undefined> | null | undefined;

type PerformanceRow = {
  label: string;
  scores?: ScoreMap;
  manualScore?: string | null;
  manualMonthIdx?: number;
};

function formatScoreCell(value: string | number | null | undefined): string {
  return value != null && value !== "" ? String(value) : "-";
}

function calculateAverage(
  scores: ScoreMap,
  currentMonthIdx?: number,
  manualScore?: string | null,
): string {
  let sum = 0;
  let count = 0;
  const manualNum = manualScore ? parseScore(manualScore) : null;

  for (let month = 1; month <= 12; month += 1) {
    let value = scores?.[month] ?? null;
    if (
      currentMonthIdx === month
      && manualNum !== null
      && !Number.isNaN(manualNum)
    ) {
      value = manualScore ?? "";
    }

    const numericValue = typeof value === "number" ? value : parseScore(value);
    if (!Number.isNaN(numericValue)) {
      sum += numericValue;
      count += 1;
    }
  }

  return count > 0
    ? (sum / count).toLocaleString("tr-TR", { maximumFractionDigits: 1 })
    : "-";
}

function renderRow({ label, scores, manualScore, manualMonthIdx }: PerformanceRow): string {
  const manualNum = manualScore ? parseScore(manualScore) : null;
  const monthCells = Array.from({ length: 12 }, (_, index) => {
    const monthIdx = index + 1;
    let value = scores?.[monthIdx];
    if (
      monthIdx === manualMonthIdx
      && manualNum !== null
      && !Number.isNaN(manualNum)
    ) {
      value = manualScore ?? "";
    }

    return `<td class="pt-score">${formatScoreCell(value)}</td>`;
  }).join("");

  return `
    <tr>
      <td class="pt-label">${label}</td>
      ${monthCells}
      <td class="pt-avg">${calculateAverage(scores, manualMonthIdx, manualScore)}</td>
    </tr>`;
}

export function renderPerformanceTable(
  rows: [PerformanceRow, PerformanceRow],
  year = new Date().getFullYear(),
): string {
  const monthHeaders = Array.from(
    { length: 12 },
    (_, index) => `<th class="pt-header">${MONTH_NAMES[index + 1].toUpperCase()}</th>`,
  ).join("");

  return `
    <div class="performance-table-wrapper">
      <table class="performance-table">
        <thead>
          <tr>
            <th class="pt-header">${year}</th>
            ${monthHeaders}
            <th class="pt-header pt-header--year-average">YIL ORTALAMASI</th>
          </tr>
        </thead>
        <tbody>
          ${renderRow(rows[0])}
          ${renderRow(rows[1])}
        </tbody>
      </table>
    </div>`;
}

// TOTAL_LINES: 101
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
