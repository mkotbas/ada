// ─── Tip Tanımları ────────────────────────────────────────────────────────────

export interface DideEntry {
  'Bayi Kodu': string;
  'Bayi': string;
  'Bayi Yönetmeni': string;
  scores: Record<number, number | string>;
}

export interface FideEntry {
  'Bayi Kodu': string;
  scores: Record<number, number | string>;
}

export interface Store {
  id: string;
  bayiKodu: string;
  bayiAdi: string;
  bolge: string;
  yonetmen: string;
  sehir: string;
  ilce: string;
  email?: string;
  sorumlu_kullanici?: string;
}

export type QuestionType =
  | 'standard'
  | 'pop_system'
  | 'product_order'
  | 'text_input'
  | 'product_list'
  | 'styling_list';

export type ProductListEntry =
  | { type: 'header'; name: string }
  | { type: 'item'; code: string; name: string; qty?: string };

export interface StylingAlternativeProduct {
  code: string;
  name: string;
  qty: string;
}

export interface StylingProduct {
  code: string;
  name: string;
  qty: string;
  alternatives?: StylingAlternativeProduct[];
}

export interface StylingSubCategory {
  name: string;
  products: StylingProduct[];
}

export interface StylingMainCategory {
  name: string;
  subCategories: StylingSubCategory[];
}

export interface FideQuestion {
  id: number;
  displayNo?: number;
  type: QuestionType;
  title: string;

  // POP
  popCodes?: string[];
  expiredCodes?: string[];
  popEmailTo?: string[];
  popEmailCc?: string[];
  wantsStoreEmail?: boolean;

  // Product / styling
  staticItems?: string[];
  stylingData?: StylingMainCategory[];

  // Admin lifecycle
  isArchived?: boolean;
}

export interface ExcelMapping {
  headerRowIndex: number;
  bayiKoduIndex: number;
  bayiAdiIndex: number;
  yonetmenIndex: number;
  signature: string;
}

// ─── Uygulama State'i ─────────────────────────────────────────────────────────

let _dideData: DideEntry[] = [];
let _fideData: FideEntry[] = [];
let _allStores: Store[] = [];
let _fideQuestions: FideQuestion[] = [];
let _productList: ProductListEntry[] = [];
let _popCodes: string[] = [];
let _expiredCodes: string[] = [];
let _storeEmails: Record<string, string> = {};
let _auditedThisMonth: string[] = [];
let _reportFideMonthlyScores: Record<string, string> = {};
let _selectedStore: Store | null = null;
let _selectedStoreVersion = 0;
let _currentReportId: string | null = null;
let _isPocketBaseConnected = false;

// ─── Okuma Erişimleri (Getter'lar) ───────────────────────────────────────────

export const getDideData = (): DideEntry[] => _dideData;
export const getFideData = (): FideEntry[] => _fideData;
export const getAllStores = (): Store[] => _allStores;
export const getFideQuestions = (): FideQuestion[] => _fideQuestions;
export const getQuestionDisplayNo = (question: FideQuestion): number => {
  const rawValue = Number(question.displayNo);
  return Number.isInteger(rawValue) && rawValue > 0 ? rawValue : question.id;
};
export const getProductList = (): ProductListEntry[] => _productList;
export const getPopCodes = (): string[] => _popCodes;
export const getExpiredCodes = (): string[] => _expiredCodes;
export const getStoreEmails = (): Record<string, string> => _storeEmails;
export const getAuditedThisMonth = (): string[] => _auditedThisMonth;
export const getReportFideMonthlyScores = (): Record<string, string> => _reportFideMonthlyScores;
export const getReportFideMonthlyScore = (monthKey: string): string | null => _reportFideMonthlyScores[monthKey] ?? null;
export const getSelectedStore = (): Store | null => _selectedStore;
export const getSelectedStoreVersion = (): number => _selectedStoreVersion;
export const getCurrentReportId = (): string | null => _currentReportId;
export const getIsPocketBaseConnected = (): boolean => _isPocketBaseConnected;

// ─── Yazma Erişimleri (Setter'lar) ───────────────────────────────────────────

export const setDideData = (data: DideEntry[]): void => { _dideData = data; };
export const setFideData = (data: FideEntry[]): void => { _fideData = data; };
export const setAllStores = (data: Store[]): void => { _allStores = data; };
export const setFideQuestions = (data: FideQuestion[]): void => { _fideQuestions = data; };
export const setProductList = (data: ProductListEntry[]): void => { _productList = data; };
export const setPopCodes = (data: string[]): void => { _popCodes = data; };
export const setExpiredCodes = (data: string[]): void => { _expiredCodes = data; };
export const setStoreEmails = (data: Record<string, string>): void => { _storeEmails = data; };
export const setAuditedThisMonth = (data: string[]): void => { _auditedThisMonth = data; };
export const setReportFideMonthlyScores = (data: Record<string, string>): void => { _reportFideMonthlyScores = data; };
export const setSelectedStore = (data: Store | null): void => {
  _selectedStore = data;
  _selectedStoreVersion += 1;
};
export const setCurrentReportId = (data: string | null): void => { _currentReportId = data; };
export const setIsPocketBaseConnected = (data: boolean): void => { _isPocketBaseConnected = data; };

// ─── Sabitler ─────────────────────────────────────────────────────────────────

export const REPORT_META_KEY = '__reportMeta';

export const MONTH_NAMES: readonly string[] = [
  '', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export const FALLBACK_FIDE_QUESTIONS: FideQuestion[] = [
  { id: 0, type: 'standard', title: 'HATA: Sorular buluttan yüklenemedi.' },
];

// TOTAL_LINES: 157
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
