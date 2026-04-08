import { pb } from './db-config';
import { showLoadingOverlay, hideLoadingOverlay } from './utils';
import { setDideData, setFideData, type DideEntry, type FideEntry, type ExcelMapping } from './state';
import { setSelectPlaceholder, make } from './dom';
import { notify } from './notify';
import { errorService } from './error';
import { readExcelRowsFromFile } from './exceljs';

// ─── Bulut Ayar Kaydetme ──────────────────────────────────────────────────────

async function saveMappingToCloud(type: 'dide' | 'fide', mapping: ExcelMapping): Promise<void> {
  if (!pb.authStore.isValid) return;
  const key = `excel_mapping_${type}`;
  try {
    try {
      const record = await pb.collection('ayarlar').getFirstListItem(`anahtar="${key}"`);
      await pb.collection('ayarlar').update(record['id'] as string, { deger: mapping });
    } catch {
      await pb.collection('ayarlar').create({ anahtar: key, deger: mapping });
    }
  } catch {
    // Kayıt sırasında hata — sessizce devam
  }
}

// ─── Bulut Ayar Okuma ─────────────────────────────────────────────────────────

async function checkSavedMapping(
  dataAsArray: unknown[][],
  type: 'dide' | 'fide',
): Promise<ExcelMapping | null> {
  if (!pb.authStore.isValid) return null;
  try {
    const key = `excel_mapping_${type}`;
    const record = await pb.collection('ayarlar').getFirstListItem(`anahtar="${key}"`);
    const savedConfig = record['deger'] as ExcelMapping | undefined;
    if (!savedConfig) return null;

    const { headerRowIndex } = savedConfig;
    if (headerRowIndex >= dataAsArray.length) return null;

    const currentSignature = (dataAsArray[headerRowIndex] ?? [])
      .map(c => String(c ?? '').trim())
      .join('|');

    return currentSignature === savedConfig.signature ? savedConfig : null;
  } catch {
    return null;
  }
}

// ─── Sütun Eşleştirme Modal (HTML <dialog>) ───────────────────────────────────

function openMappingModal(dataAsArray: unknown[][], type: 'dide' | 'fide'): Promise<ExcelMapping> {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById('excel-mapping-modal') as HTMLDialogElement | null;
    const rowSelect = document.getElementById('mapping-row-select') as HTMLSelectElement | null;
    const rowPreview = document.getElementById('row-preview-text');
    const stepColumn = document.getElementById('step-column-mapping');
    const mapBayiKodu = document.getElementById('map-bayi-kodu') as HTMLSelectElement | null;
    const mapBayiAdi = document.getElementById('map-bayi-adi') as HTMLSelectElement | null;
    const mapYonetmen = document.getElementById('map-yonetmen') as HTMLSelectElement | null;
    const dideExtraFields = document.getElementById('dide-extra-fields');
    const saveBtn = document.getElementById('mapping-save-btn') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('mapping-cancel-btn') as HTMLButtonElement | null;

    if (!modal || !rowSelect || !saveBtn || !cancelBtn || !mapBayiKodu) {
      reject(new Error('Modal elementleri bulunamadı.'));
      return;
    }

    // Modal ayarları
    if (stepColumn) stepColumn.setAttribute('hidden', '');
    saveBtn.disabled = true;

    if (dideExtraFields) {
      dideExtraFields.hidden = type === 'fide';
    }

    const rowLabel = modal.querySelector<HTMLElement>('#step-row-selection p');
    if (rowLabel) {
      rowLabel.textContent = type === 'fide'
        ? '1. Yıl Bilgisi (Örn: 2025) Hangi Satırda?'
        : '1. Başlıklar (Bayi Kodu vb.) Hangi Satırda?';
    }

    // Satır seçeneklerini doldur
    setSelectPlaceholder(rowSelect, '-- Satır Seçin --');
    const limit = Math.min(dataAsArray.length, 20);
    for (let i = 0; i < limit; i++) {
      const preview = (dataAsArray[i] ?? [])
        .filter(c => c !== null && c !== undefined && String(c).trim() !== '')
        .slice(0, 3)
        .join(' | ');
      const opt = make('option');
      opt.value = String(i);
      opt.textContent = `Satır ${i + 1}: ${preview || '(Boş)'}`;
      rowSelect.appendChild(opt);
    }

    // Sütun seçeneği doldurma yardımcısı
    const fillSelect = (selectEl: HTMLSelectElement, labelRow: unknown[], dataRow: unknown[]): void => {
      setSelectPlaceholder(selectEl, '-- Sütun Seçin --');
      const count = Math.max(dataRow.length, labelRow.length);
      for (let i = 0; i < count; i++) {
        const cell = labelRow[i];
        const cellText = (cell !== null && cell !== undefined && String(cell).trim() !== '')
          ? String(cell).substring(0, 40)
          : '(Boş)';
        const opt = make('option');
        opt.value = String(i);
        opt.textContent = `Sütun ${i + 1}: ${cellText}`;
        selectEl.appendChild(opt);
      }
    };

    // Satır değişince sütunları güncelle
    const handleRowChange = (): void => {
      const rowIndex = parseInt(rowSelect.value);
      if (isNaN(rowIndex)) {
        if (stepColumn) stepColumn.setAttribute('hidden', '');
        if (rowPreview) rowPreview.textContent = '';
        return;
      }
      const rowData = dataAsArray[rowIndex] ?? [];
      if (rowPreview) rowPreview.textContent = `Seçilen Satır: ${rowData.join(' | ')}`;
      if (stepColumn) stepColumn.removeAttribute('hidden');
      saveBtn.disabled = false;

      const labelRowData = (type === 'fide' && rowIndex + 1 < dataAsArray.length)
        ? (dataAsArray[rowIndex + 1] ?? rowData)
        : rowData;

      fillSelect(mapBayiKodu, labelRowData, rowData);
      if (type === 'dide') {
        if (mapBayiAdi) fillSelect(mapBayiAdi, labelRowData, rowData);
        if (mapYonetmen) fillSelect(mapYonetmen, labelRowData, rowData);
      }
    };

    rowSelect.addEventListener('change', handleRowChange);

    // Kaydet
    const handleSave = (): void => {
      const rowIndex = parseInt(rowSelect.value);
      const bayiKoduIndex = parseInt(mapBayiKodu.value);

      if (isNaN(bayiKoduIndex)) {
        notify.warning("Lütfen 'Bayi Kodu' sütununu seçin.");
        return;
      }

      const mapping: ExcelMapping = {
        headerRowIndex: rowIndex,
        bayiKoduIndex,
        bayiAdiIndex: (type === 'dide' && mapBayiAdi) ? parseInt(mapBayiAdi.value) : -1,
        yonetmenIndex: (type === 'dide' && mapYonetmen) ? parseInt(mapYonetmen.value) : -1,
        signature: (dataAsArray[rowIndex] ?? []).map(c => String(c ?? '').trim()).join('|'),
      };

      void saveMappingToCloud(type, mapping);
      modal.close();
      rowSelect.removeEventListener('change', handleRowChange);
      resolve(mapping);
    };

    // İptal
    const handleCancel = (): void => {
      modal.close();
      rowSelect.removeEventListener('change', handleRowChange);
      reject(new Error('Kullanıcı iptal etti.'));
    };

    saveBtn.addEventListener('click', handleSave, { once: true });
    cancelBtn.addEventListener('click', handleCancel, { once: true });

    modal.showModal();
  });
}

// ─── PocketBase'e Excel Kaydetme ──────────────────────────────────────────────

async function saveExcelToCloud(
  type: 'dide' | 'fide',
  filename: string,
  data: unknown[],
): Promise<void> {
  if (!pb.authStore.isValid) return;
  const payload = { tip: type, dosyaAdi: filename, veri: data };
  try {
    const record = await pb.collection('excel_verileri').getFirstListItem(`tip="${type}"`);
    await pb.collection('excel_verileri').update(record['id'] as string, payload);
  } catch {
    await pb.collection('excel_verileri').create(payload);
  }
}

// ─── DiDe Excel İşleme ────────────────────────────────────────────────────────

export async function processDideExcelData(
  dataAsArray: unknown[][],
  filename: string,
): Promise<DideEntry[] | null> {
  if (dataAsArray.length < 2) return null;
  try {
    let mapping = await checkSavedMapping(dataAsArray, 'dide');
    if (!mapping) mapping = await openMappingModal(dataAsArray, 'dide');

    showLoadingOverlay('Veriler işleniyor...');

    const headerRow = dataAsArray[mapping.headerRowIndex] ?? [];
    const dataRows = dataAsArray.slice(mapping.headerRowIndex + 1);

    const processedData = dataRows
      .map((row): DideEntry | null => {
        if (!row[mapping!.bayiKoduIndex]) return null;
        const scores: Record<number, number | string> = {};
        headerRow.forEach((header, index) => {
          const monthNumber = parseInt(String(header));
          if (!isNaN(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
            const val = row[index];
            if (val !== null && val !== undefined && val !== '') {
              scores[monthNumber] = val as number | string;
            }
          }
        });
        return {
          'Bayi Kodu': String(row[mapping!.bayiKoduIndex]),
          'Bayi': mapping!.bayiAdiIndex > -1 ? String(row[mapping!.bayiAdiIndex] ?? '') : '',
          'Bayi Yönetmeni': mapping!.yonetmenIndex > -1 ? String(row[mapping!.yonetmenIndex] ?? '') : '',
          scores,
        };
      })
      .filter((d): d is DideEntry => d !== null);

    await saveExcelToCloud('dide', filename, processedData);
    notify.success('DiDe puan dosyası başarıyla işlendi.');
    return processedData;
  } catch {
    return null;
  } finally {
    hideLoadingOverlay();
  }
}

// ─── FiDe Excel İşleme ───────────────────────────────────────────────────────

export async function processFideExcelData(
  dataAsArray: unknown[][],
  filename: string,
): Promise<FideEntry[] | null> {
  if (dataAsArray.length < 3) return null;
  try {
    let mapping = await checkSavedMapping(dataAsArray, 'fide');
    if (!mapping) mapping = await openMappingModal(dataAsArray, 'fide');

    showLoadingOverlay('Veriler işleniyor...');

    const yearRowIndex = mapping.headerRowIndex;
    const yearRow = dataAsArray[yearRowIndex] ?? [];
    const monthRow = dataAsArray[yearRowIndex + 1] ?? [];
    const currentYear = new Date().getFullYear();

    // Birleştirilmiş yıl satırı (boş hücreleri bir önceki değerle doldur)
    let lastKnown = '';
    const filledYearRow = yearRow.map(cell => {
      const trimmed = String(cell ?? '').trim();
      if (trimmed !== '') lastKnown = trimmed;
      return lastKnown;
    });

    const dataRows = dataAsArray.slice(yearRowIndex + 2);

    const processedData = dataRows
      .map((row): FideEntry | null => {
        if (!row[mapping!.bayiKoduIndex]) return null;
        const scores: Record<number, number | string> = {};
        filledYearRow.forEach((yearVal, i) => {
          if (String(yearVal) === String(currentYear)) {
            const monthNumber = parseInt(String(monthRow[i] ?? ''));
            if (!isNaN(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
              const val = row[i];
              if (val !== null && val !== undefined && val !== '') {
                scores[monthNumber] = val as number | string;
              }
            }
          }
        });
        return {
          'Bayi Kodu': String(row[mapping!.bayiKoduIndex]),
          scores,
        };
      })
      .filter((d): d is FideEntry => d !== null);

    await saveExcelToCloud('fide', filename, processedData);
    notify.success('FiDe puan dosyası başarıyla işlendi.');
    return processedData;
  } catch {
    return null;
  } finally {
    hideLoadingOverlay();
  }
}

// ─── Dosya Seçimi Handler ─────────────────────────────────────────────────────

export async function handleFileSelect(
  event: Event,
  type: 'dide' | 'fide',
): Promise<boolean> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return false;

  const filename = file.name;

  try {
    const dataAsArray = await readExcelRowsFromFile(file);

    if (type === 'dide') {
      const result = await processDideExcelData(dataAsArray, filename);
      if (result) setDideData(result);
      return !!result;
    }

    const result = await processFideExcelData(dataAsArray, filename);
    if (result) setFideData(result);
    return !!result;
  } catch (err) {
    errorService.handle(err, { userMessage: 'Excel okuma hatası.' });
    return false;
  }
}
