import { errorService } from './error';
import { REPORT_META_KEY, type FideQuestion } from './state';

export interface LoginResult {
  success: boolean;
  message: string;
}

export interface ReportData {
  questions_status: Record<string, unknown>;
}

export interface PocketBaseRecord {
  id: string;
  [key: string]: unknown;
}

export interface ExpandedStoreRecord {
  bayiKodu?: string;
}

export interface ExpandedBayiRecord {
  bayi?: ExpandedStoreRecord;
}

export function debugSilentError(scope: string, error: unknown): void {
  errorService.handle(error, { silent: true, userMessage: `${scope} islemi sirasinda hata olustu.` });
}

export function isPocketBaseNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractReportFideMonthlyScores(questionStatusMap: Record<string, unknown>): Record<string, string> {
  const meta = questionStatusMap[REPORT_META_KEY];
  if (!isPlainObject(meta) || !isPlainObject(meta['fideMonthlyScores'])) return {};

  return Object.entries(meta['fideMonthlyScores']).reduce((acc, [monthKey, value]) => {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (normalizedValue) acc[String(monthKey)] = normalizedValue;
    return acc;
  }, {} as Record<string, string>);
}

export function stripReportMeta(questionStatusMap: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...questionStatusMap };
  delete cleaned[REPORT_META_KEY];
  return cleaned;
}

export function buildSingleReportFilter(args: { storeId: string }): string {
  const { storeId } = args;
  return `bayi="${storeId}"`;
}

export function normalizeProductList(input: unknown): import('./state').ProductListEntry[] {
  if (!Array.isArray(input)) return [];
  const out: import('./state').ProductListEntry[] = [];

  for (const it of input) {
    if (typeof it === 'object' && it) {
      const row = it as Record<string, unknown>;
      const rawType = typeof row['type'] === 'string' ? row['type'] : null;
      const hasCode = row['code'] !== undefined && row['code'] !== null;
      const hasName = typeof row['name'] === 'string' && row['name'].trim().length > 0;

      if ((rawType === 'header' || (!rawType && !hasCode)) && hasName) {
        out.push({ type: 'header', name: String(row['name']).trim() });
        continue;
      }

      if ((rawType === 'item' || (!rawType && hasCode)) && hasName) {
        out.push({
          type: 'item',
          code: String(row['code'] ?? '').trim(),
          name: String(row['name']).trim(),
          qty: String(row['qty'] ?? '').trim(),
        });
        continue;
      }
    }

    if (typeof it === 'string') {
      const s = it.trim();
      if (!s) continue;
      const parts = s.split('-').map(p => p.trim()).filter(Boolean);
      const code = parts[0] ?? s;
      const name = parts.slice(1).join(' - ') || code;
      out.push({ type: 'item', code, name, qty: '' });
    }
  }

  return out;
}

export function extractPopCodes(questions: FideQuestion[]): { popCodes: string[]; expiredCodes: string[] } {
  const popQuestion = questions.find(q => q.type === 'pop_system');
  return {
    popCodes: popQuestion?.popCodes ?? [],
    expiredCodes: popQuestion?.expiredCodes ?? [],
  };
}
