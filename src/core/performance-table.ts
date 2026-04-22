import { MONTH_NAMES } from "./state";
import { parseScore } from "./utils";

type ScoreMap = Record<number, string | number | null | undefined> | null | undefined;

type PerformanceRow = {
  label: string;
  scores?: ScoreMap;
  manualScore?: string | null;
  manualMonthIdx?: number;
};

type PerformanceTableOptions = {
  mode?: "default" | "email";
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

function getInlineStyles(mode: PerformanceTableOptions["mode"]) {
  if (mode !== "email") {
    return {
      wrapper: "",
      table: "",
      header: "",
      score: "",
      average: "",
    };
  }

  return {
    wrapper: ' style="overflow-x:auto;margin:20px 0;"',
    table: ' style="border-collapse:collapse;width:auto;font-family:Aptos, Arial, sans-serif;font-size:10pt;"',
    header: ' style="border:1px solid #000;padding:8px 6px;text-align:center;font-weight:700;background-color:#ff0000;color:#000;white-space:nowrap;font-family:Aptos, Arial, sans-serif;font-size:10pt;"',
    score: ' style="border:1px solid #000;padding:8px 6px;text-align:center;white-space:nowrap;font-family:Aptos, Arial, sans-serif;font-size:10pt;"',
    average: ' style="border:1px solid #000;padding:8px 6px;text-align:center;font-weight:700;font-family:Aptos, Arial, sans-serif;font-size:10pt;"',
  };
}

function renderRow(
  { label, scores, manualScore, manualMonthIdx }: PerformanceRow,
  styles: ReturnType<typeof getInlineStyles>,
): string {
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

    return `<td class="pt-score"${styles.score}>${formatScoreCell(value)}</td>`;
  }).join("");

  return `
    <tr>
      <td class="pt-label"${styles.header}>${label}</td>
      ${monthCells}
      <td class="pt-avg"${styles.average}>${calculateAverage(scores, manualMonthIdx, manualScore)}</td>
    </tr>`;
}

export function renderPerformanceTable(
  rows: [PerformanceRow, PerformanceRow],
  year = new Date().getFullYear(),
  options: PerformanceTableOptions = {},
): string {
  const styles = getInlineStyles(options.mode ?? "default");
  const monthHeaders = Array.from(
    { length: 12 },
    (_, index) => `<th class="pt-header"${styles.header}>${MONTH_NAMES[index + 1].toUpperCase()}</th>`,
  ).join("");

  return `
    <div class="performance-table-wrapper"${styles.wrapper}>
      <table class="performance-table"${styles.table}>
        <thead>
          <tr>
            <th class="pt-header"${styles.header}>${year}</th>
            ${monthHeaders}
            <th class="pt-header pt-header--year-average"${styles.header}>YIL<br>ORTALAMASI</th>
          </tr>
        </thead>
        <tbody>
          ${renderRow(rows[0], styles)}
          ${renderRow(rows[1], styles)}
        </tbody>
      </table>
    </div>`;
}

// TOTAL_LINES: 128
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
