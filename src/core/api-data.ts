import { pb } from './db-config';
import { fetchAllRecords } from './pocketbase-helpers';
import { normalizeQuestionStatusMap } from './migration';
import { errorService } from './error';
import { notify } from './notify';
import {
  getBusinessDateParts,
  getBusinessYearMonthKey,
  getBusinessYearUtcRange,
  showLoadingOverlay,
  hideLoadingOverlay,
  toDbDateString,
  getYearMonthKey,
} from './utils';
import { getBusinessUtcIsoNow, toBusinessZonedDateTime } from './temporal';
import {
  getAllStores,
  getAuditedThisMonth,
  getCurrentReportId,
  getSelectedStore,
  getSelectedStoreVersion,
  getReportFideMonthlyScores,
  setAllStores,
  setAuditedThisMonth,
  setCurrentReportId,
  setDideData,
  setExpiredCodes,
  setFideData,
  setFideQuestions,
  setIsPocketBaseConnected,
  setPopCodes,
  setProductList,
  setReportFideMonthlyScores,
  setStoreEmails,
  FALLBACK_FIDE_QUESTIONS,
  REPORT_META_KEY,
  type DideEntry,
  type FideEntry,
  type FideQuestion,
  type Store,
} from './state';
import {
  buildSingleReportFilter,
  debugSilentError,
  extractPopCodes,
  extractReportFideMonthlyScores,
  normalizeProductList,
  stripReportMeta,
  type ExpandedBayiRecord,
  type PocketBaseRecord,
  type ReportData,
} from './api-shared';

let lastSaveRequestId = 0;

function normalizePocketBaseDateFilterValue(isoValue: string): string {
  return isoValue.replace('T', ' ');
}

function buildAuditHistoryPayload(storeId: string, finalizedAtIso: string): Record<string, unknown> {
  const zonedDate = toBusinessZonedDateTime(finalizedAtIso);
  const month = String(zonedDate.month).padStart(2, '0');
  const day = String(zonedDate.day).padStart(2, '0');
  const dateKey = `${zonedDate.year}-${month}-${day}`;

  return {
    bayi: storeId,
    denetimTarihi: finalizedAtIso,
    denetimYili: zonedDate.year,
    denetimAyi: zonedDate.month,
    durum: 'tamamlandi',
    uniqueKeyGun: `${storeId}_${dateKey}`,
    uniqueKeyAy: `${storeId}_${zonedDate.year}-${month}`,
    kaynak: 'form',
  };
}

export async function saveAuditHistory(storeId: string, finalizedAtIso: string): Promise<void> {
  const payload = buildAuditHistoryPayload(storeId, finalizedAtIso);

  try {
    await pb.collection('denetim_gecmisi').create(payload);
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : null;
    const responseData = typeof error === 'object' && error !== null && 'response' in error ? error.response : null;
    const duplicateKeyError = Boolean(
      responseData &&
      typeof responseData === 'object' &&
      'data' in responseData &&
      responseData.data &&
      typeof responseData.data === 'object' &&
      'uniqueKeyGun' in responseData.data,
    );

    if (status === 400 && duplicateKeyError) {
      return;
    }

    throw error;
  }
}

function shouldApplyStoreBoundResult(version: number, bayiKodu: string): boolean {
  return getSelectedStoreVersion() == version && String(getSelectedStore()?.bayiKodu ?? '') === bayiKodu;
}

async function loadMonthlyAuditData(): Promise<void> {
  setAuditedThisMonth([]);
  if (!pb.authStore.isValid) return;

  const businessToday = getBusinessDateParts();
  const currentMonthKey = getBusinessYearMonthKey();
  const businessYearRange = getBusinessYearUtcRange(businessToday.year);

  let revertedCodes: string[] = [];
  try {
    const revertedRecords = await fetchAllRecords<PocketBaseRecord>(pb.collection('denetim_geri_alinanlar'), {
      filter: `yil_ay = "${currentMonthKey}"`,
      expand: 'bayi',
    });
    revertedCodes = revertedRecords
      .map(record => String((record['expand'] as ExpandedBayiRecord | undefined)?.bayi?.bayiKodu ?? '').trim())
      .filter((code): code is string => code !== '');
  } catch (error) {
    debugSilentError('Geri alinan kayitlari yukleme', error);
  }

  try {
    const startDbValue = normalizePocketBaseDateFilterValue(businessYearRange.startUtcIso);
    const endDbValue = normalizePocketBaseDateFilterValue(businessYearRange.endUtcIso);
    const records = await fetchAllRecords<PocketBaseRecord>(pb.collection('denetim_raporlari'), {
      filter: `((denetimTamamlanmaTarihi != "" && denetimTamamlanmaTarihi >= "${startDbValue}" && denetimTamamlanmaTarihi < "${endDbValue}") || (denetimTamamlanmaTarihi = "" && created >= "${startDbValue}" && created < "${endDbValue}"))`,
      expand: 'bayi',
    });

    const allAuditedCodes = records
      .filter(record => {
        const rawDate = String(record['denetimTamamlanmaTarihi'] ?? record['created'] ?? '');
        if (!rawDate) return false;
        const businessDate = toBusinessZonedDateTime(rawDate);
        return businessDate.year === businessToday.year && (businessDate.month - 1) === businessToday.month;
      })
      .map(record => String((record['expand'] as ExpandedBayiRecord | undefined)?.bayi?.bayiKodu ?? '').trim())
      .filter((code): code is string => code !== '');

    const uniqueCodes: string[] = [...new Set(allAuditedCodes)];
    setAuditedThisMonth(uniqueCodes.filter(code => !revertedCodes.includes(code)));
  } catch (error) {
    debugSilentError('Aylik raporlari yukleme', error);
  }
}

async function loadQuestionSettings(): Promise<void> {
  const ayarlarRecords = await fetchAllRecords<PocketBaseRecord>(pb.collection('ayarlar'));
  const fideQuestionsRecord = ayarlarRecords.find(record => record['anahtar'] === 'fideQuestionsData');
  if (!fideQuestionsRecord) throw new Error('fideQuestionsData bulunamadi');

  const cloudData = fideQuestionsRecord['deger'] as {
    questions?: FideQuestion[];
    productList?: unknown;
  };

  const questions = cloudData.questions ?? [];
  setFideQuestions(questions);
  setProductList(normalizeProductList(cloudData.productList));

  const { popCodes, expiredCodes } = extractPopCodes(questions);
  setPopCodes(popCodes);
  setExpiredCodes(expiredCodes);
}

async function loadStoreList(): Promise<void> {
  const records = await fetchAllRecords<Store>(pb.collection('bayiler'), { sort: 'bayiAdi' });
  const stores = records.map(store => ({
    ...store,
    bayiKodu: String(store.bayiKodu ?? '').trim(),
  }));

  setAllStores(stores);

  const emails: Record<string, string> = {};
  stores.forEach((store) => {
    if (store.email) emails[store.bayiKodu] = store.email;
  });
  setStoreEmails(emails);
}

export async function loadInitialData(): Promise<boolean> {
  if (!pb.authStore.isValid) {
    setFideQuestions(FALLBACK_FIDE_QUESTIONS);
    return false;
  }

  showLoadingOverlay('Veriler yukleniyor...');

  try {
    await loadMonthlyAuditData();
    await loadQuestionSettings();
    await loadStoreList();
    await loadExcelDataFromCloud();
    setIsPocketBaseConnected(true);
    return true;
  } catch (error) {
    debugSilentError('Baslangic verilerini yukleme', error);
    setFideQuestions(FALLBACK_FIDE_QUESTIONS);
    const errDiv = document.getElementById('initialization-error');
    if (errDiv) errDiv.removeAttribute('hidden');
    return false;
  } finally {
    hideLoadingOverlay();
  }
}

export async function loadExcelDataFromCloud(): Promise<void> {
  if (!pb.authStore.isValid) return;

  try {
    const dideRecord = await pb.collection('excel_verileri').getFirstListItem<PocketBaseRecord>('tip="dide"');
    setDideData(dideRecord['veri'] as DideEntry[]);
  } catch (error) {
    debugSilentError('DiDe bulut verisi yukleme', error);
  }

  try {
    const fideRecord = await pb.collection('excel_verileri').getFirstListItem<PocketBaseRecord>('tip="fide"');
    setFideData(fideRecord['veri'] as FideEntry[]);
  } catch (error) {
    debugSilentError('FiDe bulut verisi yukleme', error);
  }
}

export async function saveFormState(reportData: ReportData, isFinalizing = false): Promise<string | null> {
  const currentRequestId = ++lastSaveRequestId;
  const selectedStore = getSelectedStore();
  if (!selectedStore || !pb.authStore.isValid) return null;

  const bayiKodu = String(selectedStore.bayiKodu);
  const storeVersion = getSelectedStoreVersion();
  const storeRecord = getAllStores().find(store => store.bayiKodu === bayiKodu);
  if (!storeRecord) return null;

  if (isFinalizing) {
    try {
      const monthKey = getBusinessYearMonthKey();
      const undoneRecord = await pb.collection('denetim_geri_alinanlar').getFirstListItem(
        `yil_ay="${monthKey}" && bayi="${storeRecord.id}"`,
      );
      await pb.collection('denetim_geri_alinanlar').delete(String(undoneRecord['id'] ?? ''));
    } catch (error) {
      debugSilentError('Geri alinan kaydi temizleme', error);
    }
  }

  const normalizedQuestionStatus = normalizeQuestionStatusMap(reportData.questions_status);
  const reportFideMonthlyScores = getReportFideMonthlyScores();

  if (Object.keys(reportFideMonthlyScores).length > 0) {
    normalizedQuestionStatus[REPORT_META_KEY] = { fideMonthlyScores: reportFideMonthlyScores };
  } else {
    delete normalizedQuestionStatus[REPORT_META_KEY];
  }

  const dataToSave: Record<string, unknown> = {
    bayi: storeRecord.id,
    soruDurumlari: normalizedQuestionStatus,
    user: pb.authStore.model?.['id'],
  };

  let finalizedAtIso = '';

  if (isFinalizing) {
    finalizedAtIso = getBusinessUtcIsoNow();
    dataToSave['denetimTamamlanmaTarihi'] = finalizedAtIso;
    showLoadingOverlay('Rapor kaydediliyor...');
  }

  try {
    const currentId = getCurrentReportId();
    if (currentId) {
      await pb.collection('denetim_raporlari').update(currentId, dataToSave);
    } else {
      const singleFilter = buildSingleReportFilter({ storeId: String(storeRecord.id) });

      try {
        const existing = await pb.collection('denetim_raporlari').getFirstListItem(singleFilter, { sort: '-created' });
        const existingId = String(existing['id'] ?? '');
        await pb.collection('denetim_raporlari').update(existingId, dataToSave);
        if (shouldApplyStoreBoundResult(storeVersion, bayiKodu) && currentRequestId === lastSaveRequestId) {
          setCurrentReportId(existingId);
        }
      } catch (error) {
        debugSilentError('Mevcut rapor arama', error);
        const newRecord = await pb.collection('denetim_raporlari').create(dataToSave);
        if (shouldApplyStoreBoundResult(storeVersion, bayiKodu) && currentRequestId === lastSaveRequestId) {
          setCurrentReportId(String(newRecord['id'] ?? ''));
        }
      }
    }

    if (isFinalizing) {
      const audited = getAuditedThisMonth();
      if (!audited.includes(bayiKodu)) {
        setAuditedThisMonth([...audited, bayiKodu]);
      }
    }
  } catch (error) {
    if (isFinalizing) errorService.handle(error, { userMessage: 'Rapor kaydedilirken bir hata olustu!' });
    return null;
  } finally {
    if (isFinalizing) hideLoadingOverlay();
  }

  return isFinalizing ? finalizedAtIso : null;
}

export async function saveAuditHistoryForSelectedStore(finalizedAtIso: string): Promise<void> {
  const selectedStore = getSelectedStore();
  if (!selectedStore || !pb.authStore.isValid) return;

  const bayiKodu = String(selectedStore.bayiKodu ?? '');
  const storeRecord = getAllStores().find(store => store.bayiKodu === bayiKodu);
  if (!storeRecord) return;

  await saveAuditHistory(String(storeRecord.id), finalizedAtIso);
}

export async function loadReportForStore(bayiKodu: string): Promise<Record<string, unknown> | null> {
  if (!pb.authStore.isValid) return null;

  showLoadingOverlay('Rapor yukleniyor...');

  try {
    const storeRecord = getAllStores().find(store => store.bayiKodu === bayiKodu);
    if (!storeRecord) throw new Error('Bayi bulunamadi.');

    const filter = buildSingleReportFilter({ storeId: String(storeRecord.id) });

    try {
      const record = await pb.collection('denetim_raporlari').getFirstListItem(filter, { sort: '-created' });
      setCurrentReportId(String(record['id'] ?? ''));
      const normalizedQuestionStatus = normalizeQuestionStatusMap(
        record['soruDurumlari'] as Record<string, unknown>,
      );
      setReportFideMonthlyScores(extractReportFideMonthlyScores(normalizedQuestionStatus));
      return stripReportMeta(normalizedQuestionStatus);
    } catch (error) {
      debugSilentError('Rapor arama', error);
      setCurrentReportId(null);
      setReportFideMonthlyScores({});
      return null;
    }
  } catch (error) {
    setReportFideMonthlyScores({});
    debugSilentError('Rapor yukleme', error);
    return null;
  } finally {
    hideLoadingOverlay();
  }
}

export async function clearExcelFromCloud(type: 'dide' | 'fide'): Promise<void> {
  if (!pb.authStore.isValid) return;

  try {
    const record = await pb.collection('excel_verileri').getFirstListItem<PocketBaseRecord>(`tip="${type}"`);
    await pb.collection('excel_verileri').delete(String(record['id'] ?? ''));
    notify.info(`${type.toUpperCase()} verisi silindi. Sayfa yenileniyor.`);
    window.location.reload();
  } catch (error) {
    errorService.handle(error, { userMessage: 'Silme islemi sirasinda bir hata olustu.' });
  }
}
