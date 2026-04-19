import mainCssUrl from "../../styles/main.css?url";
import performanceTableCssUrl from "../../styles/components/performance-table.css?url";
import bayiYoneticisiCssUrl from "./bayi-yoneticisi.css?url";
import { createModalController, escapeHtml, safeHtmlFragment, setSafeHtml, setSelectPlaceholder } from "../../core/dom";
import { notify } from "../../core/notify";
import { errorService } from "../../core/error";
import { renderPerformanceTable } from "../../core/performance-table";
import { exportHtmlTableToExcel, readExcelRowsFromFile } from "../../core/exceljs";
import { handleFileSelect } from "../../core/excel";
import { setDideData, setFideData } from "../../core/state";
import { getBusinessDateParts } from "../../core/utils";
import { toBusinessZonedDateTime } from "../../core/temporal";
import { fetchAllRecords } from "../../core/pocketbase-helpers";
import {
  errToString,
  getCheckedValues,
  processInChunks,
  renderCheckboxList,
  setElementHidden,
  setLoadingState,
  type BayiImportPayload,
} from "./bayi-yoneticisi-utils";


type BayiFrequencyRow = {
  "Bayi Kodu": string;
  "Senelik Frekans": number;
};

const FREQUENCY_STORAGE_KEY = "bayiFrequencyData";

function normalizeDealerCode(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeFrequencyValue(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(String(value).replace(/,/g, ".").trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.trunc(parsed);
  return normalized >= 0 ? normalized : null;
}

function buildFrequencyRowsFromMap(
  frequencyMap: Map<string, number>,
): BayiFrequencyRow[] {
  return Array.from(frequencyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "tr"))
    .map(([bayiKodu, senelikFrekans]) => ({
      "Bayi Kodu": bayiKodu,
      "Senelik Frekans": senelikFrekans,
    }));
}

function normalizePocketBaseDateFilterValue(isoValue: string): string {
  return isoValue.replace("T", " ");
}

function buildUniqueAuditDayKey(record: any, bayiKodu: string): string | null {
  const uniqueKeyGun = typeof record?.uniqueKeyGun === "string" ? record.uniqueKeyGun.trim() : "";
  if (uniqueKeyGun) {
    return `${bayiKodu}__${uniqueKeyGun}`;
  }

  const denetimTarihi = typeof record?.denetimTarihi === "string" ? record.denetimTarihi.trim() : "";
  if (denetimTarihi) {
    try {
      const auditDate = toBusinessZonedDateTime(denetimTarihi);
      const year = auditDate.year;
      const month = String(auditDate.month).padStart(2, "0");
      const day = String(auditDate.day).padStart(2, "0");
      return `${bayiKodu}__${year}-${month}-${day}`;
    } catch {
      // ignore invalid date and fall through to legacy fields
    }
  }

  const denetimYili = Number(record?.denetimYili ?? 0);
  const denetimAyi = Number(record?.denetimAyi ?? 0);
  if (Number.isInteger(denetimYili) && Number.isInteger(denetimAyi) && denetimAyi >= 1 && denetimAyi <= 12) {
    return `${bayiKodu}__${denetimYili}-${String(denetimAyi).padStart(2, "0")}__${String(record?.id ?? "")}`;
  }

  return null;
}

async function initializeBayiYoneticisiModule(pbInstance) {
  const pb = pbInstance;
  let allBayiler = [],
    allUsers = [],
    importedExcelData = null,
    importedFrequencyExcelData = null,
    bayiArchiveState = {},
    filteredBayilerForReport = [],
    scoreDataCache = null,
    frequencyDataMap = new Map<string, number>(),
    auditCountMap = new Map<string, number>(),
    filterListenersBound = false;
  const container = document.getElementById("bayi-yonetici-container");
  if (!container) return;
  const q = (sel) => {
      const el = container.querySelector(sel);
      if (!el) throw new Error(`Bayi Yöneticisi: '${sel}' bulunamadı`);
      return el;
    },
    setHidden = setElementHidden,
    show = (el) => setHidden(el, false),
    hide = (el) => setHidden(el, true),
    tableBody = container.querySelector("#bayi-table-body"),
    loadingSpinner = container.querySelector("#loading-spinner"),
    modal = container.querySelector("#bayi-modal"),
    modalTitle = container.querySelector("#modal-title"),
    bayiForm = container.querySelector("#bayi-form"),
    bayiIdInput = container.querySelector("#bayi-id"),
    uzmanSelect = container.querySelector("#sorumlu_kullanici"),
    dropdownFilter = container.querySelector("#kontrol-filtresi"),
    statusFilter = container.querySelector("#durum-filtresi"),
    searchInputs = container.querySelectorAll(".column-search-input"),
    columnCheckboxesContainer = container.querySelector("#column-checkboxes"),
    scoreReportPicker = container.querySelector("#score-report-picker"),
    scoreReportPickerToggle = container.querySelector(
      "#btn-toggle-score-store-picker",
    ),
    scoreReportPickerPanel = container.querySelector(
      "#score-report-picker-panel",
    ),
    scoreReportStoreChecklist = container.querySelector(
      "#score-report-store-checklist",
    ),
    scoreReportSearchInput = container.querySelector(
      "#score-report-search-input",
    ),
    btnSelectAllScoreStores = container.querySelector(
      "#btn-select-all-score-stores",
    ),
    btnClearScoreStores = container.querySelector("#btn-clear-score-stores"),
    scoreReportSelectionBadge = container.querySelector(
      "#score-report-selection-badge",
    ),
    btnOpenImportModal = container.querySelector("#btn-open-import-modal"),
    btnOpenFrequencyImportModal = container.querySelector(
      "#btn-open-frequency-import-modal",
    ),
    frequencyUploadStatus = container.querySelector("#frequency-upload-status"),
    scoreDideFileInput = container.querySelector("#score-dide-file-input"),
    scoreFideFileInput = container.querySelector("#score-fide-file-input"),
    btnDeleteDideExcel = container.querySelector("#btn-delete-dide-excel"),
    btnDeleteFideExcel = container.querySelector("#btn-delete-fide-excel"),
    frequencyImportModal = container.querySelector("#frequency-import-modal"),
    frequencyExcelInput = container.querySelector("#frequency-file-input"),
    btnProcessFrequencyExcel = container.querySelector(
      "#btn-process-frequency-excel",
    ),
    frequencyMappingContainer = container.querySelector(
      "#frequency-mapping-container",
    ),
    frequencyImportWarning = container.querySelector(
      "#frequency-import-warning",
    ),
    btnExecuteFrequencyImport = container.querySelector(
      "#btn-execute-frequency-import",
    ),
    frequencyImportResults = container.querySelector(
      "#frequency-import-results",
    ),
    frequencyImportLoadingOverlay = container.querySelector(
      "#frequency-import-loading-overlay",
    ),
    frequencyImportLoadingText = container.querySelector(
      "#frequency-import-loading-text",
    ),
    frequencyImportStep1 = container.querySelector("#frequency-import-step-1"),
    frequencyImportStep2 = container.querySelector("#frequency-import-step-2"),
    frequencyImportStep3 = container.querySelector("#frequency-import-step-3"),
    btnFrequencyImportCancel1 = container.querySelector(
      "#btn-frequency-import-cancel-1",
    ),
    btnFrequencyImportCancel2 = container.querySelector(
      "#btn-frequency-import-cancel-2",
    ),
    btnFrequencyImportClose = container.querySelector(
      "#btn-frequency-import-close",
    ),
    importModal = container.querySelector("#import-modal"),
    importExcelInput = container.querySelector("#excel-file-input"),
    btnProcessExcel = container.querySelector("#btn-process-excel"),
    mappingContainer = container.querySelector("#mapping-container"),
    importWarning = container.querySelector("#import-warning"),
    btnExecuteImport = container.querySelector("#btn-execute-import"),
    importGlobalUserSelect = container.querySelector(
      "#import-global-user-select",
    ),
    importResultsArea = container.querySelector("#import-results"),
    importLoadingOverlay = container.querySelector("#import-loading-overlay"),
    importLoadingText = container.querySelector("#import-loading-text"),
    importStep1 = container.querySelector("#import-step-1"),
    importStep2 = container.querySelector("#import-step-2"),
    importStep3 = container.querySelector("#import-step-3"),
    btnImportCancel1 = container.querySelector("#btn-import-modal-cancel-1"),
    btnImportCancel2 = container.querySelector("#btn-import-modal-cancel-2"),
    btnImportClose = container.querySelector("#btn-import-modal-close"),
    btnOpenBulkAssignModal = container.querySelector(
      "#btn-open-bulk-assign-modal",
    ),
    bulkAssignModal = container.querySelector("#bulk-assign-modal"),
    bulkAssignFilterBolge = container.querySelector(
      "#bulk-assign-filter-bolge",
    ),
    bulkAssignFilterSehir = container.querySelector(
      "#bulk-assign-filter-sehir",
    ),
    bulkAssignFilterYonetmen = container.querySelector(
      "#bulk-assign-filter-yonetmen",
    ),
    bulkAssignUserSelect = container.querySelector("#bulk-assign-user-select"),
    btnExecuteBulkAssign = container.querySelector("#btn-execute-bulk-assign"),
    btnBulkAssignCancel = container.querySelector("#btn-bulk-assign-cancel"),
    senelikFrekansInput = container.querySelector("#senelikFrekans"),
    frequencySummaryYearLabel = container.querySelector(
      "#frequency-summary-year-label",
    ),
    frequencyTargetValue = container.querySelector("#frequency-target-value"),
    frequencyCompletedValue = container.querySelector(
      "#frequency-completed-value",
    ),
    frequencyRemainingValue = container.querySelector(
      "#frequency-remaining-value",
    ),
    frequencySummaryNote = container.querySelector("#frequency-summary-note"),
    bulkAssignLoadingOverlay = container.querySelector(
      "#bulk-assign-loading-overlay",
    ),
    bulkAssignLoadingText = container.querySelector(
      "#bulk-assign-loading-text",
    ),
    bulkAssignTypeSelect = container.querySelector("#bulk-assign-type-select"),
    bulkAssignUserContainer = container.querySelector(
      "#bulk-assign-user-select-container",
    ),
    bulkAssignTextContainer = container.querySelector(
      "#bulk-assign-text-input-container",
    ),
    bulkAssignTextInput = container.querySelector("#bulk-assign-text-input"),
    bulkAssignOnlyUnassigned = container.querySelector(
      "#bulk-assign-only-unassigned",
    ),
    dbFields = [
      {
        key: "bayiKodu",
        label: "Bayi Kodu (Zorunlu)",
        required: true,
      },
      { key: "bayiAdi", label: "Bayi Adı", required: false },
      { key: "bolge", label: "Bölge", required: false },
      { key: "sehir", label: "Şehir", required: false },
      { key: "ilce", label: "İlçe", required: false },
      { key: "yonetmen", label: "Bayi Yönetmeni", required: false },
      { key: "email", label: "Mail Adresi", required: false },
    ],
    frequencyDbFields = [
      {
        key: "bayiKodu",
        label: "Bayi Kodu",
        required: true,
      },
      {
        key: "senelikFrekans",
        label: "Senelik Frekans",
        required: true,
      },
    ],
    fields = [
      { key: "bolge", label: "Bölge" },
      { key: "sehir", label: "Şehir" },
      { key: "ilce", label: "İlçe" },
      { key: "bayiKodu", label: "Bayi Kodu" },
      { key: "bayiAdi", label: "Bayi Adı" },
      { key: "yonetmen", label: "Bayi Yönetmeni" },
      { key: "email", label: "Mail" },
      { key: "sorumlu_kullanici_email", label: "Denetim Uzmanı" },
    ],
    allFieldKeys = fields.map((f) => f.key)

  const selectedScoreReportStoreIds = new Set();
  let scoreReportVisibleStoresCache = [];
  let scoreReportRenderToken = 0;

  const bayiModalController =
    modal instanceof HTMLElement
      ? createModalController(modal, { closeSelectors: ["#btn-modal-cancel"] })
      : null;
  const frequencyImportModalController =
    frequencyImportModal instanceof HTMLElement
      ? createModalController(frequencyImportModal, {
          closeButtons: [
            btnFrequencyImportCancel1,
            btnFrequencyImportCancel2,
            btnFrequencyImportClose,
          ].filter((button): button is HTMLElement => button instanceof HTMLElement),
        })
      : null;
  const importModalController =
    importModal instanceof HTMLElement
      ? createModalController(importModal, {
          closeButtons: [btnImportCancel1, btnImportCancel2, btnImportClose].filter(
            (button): button is HTMLElement => button instanceof HTMLElement,
          ),
        })
      : null;
  const bulkAssignModalController =
    bulkAssignModal instanceof HTMLElement
      ? createModalController(bulkAssignModal, {
          closeButtons: [btnBulkAssignCancel].filter(
            (button): button is HTMLElement => button instanceof HTMLElement,
          ),
        })
      : null;

  async function loadFrequencyData() {
    try {
      const settingRecord = await pb
        .collection("ayarlar")
        .getFirstListItem(`anahtar="${FREQUENCY_STORAGE_KEY}"`)
        .catch(() => null);
      const rows = Array.isArray(settingRecord?.deger) ? settingRecord.deger : [];
      const nextMap = new Map<string, number>();
      rows.forEach((row) => {
        const bayiKodu = normalizeDealerCode(row?.["Bayi Kodu"]);
        const senelikFrekans = normalizeFrequencyValue(row?.["Senelik Frekans"]);
        if (!bayiKodu || senelikFrekans === null) {
          return;
        }
        nextMap.set(bayiKodu, senelikFrekans);
      });
      frequencyDataMap = nextMap;
    } catch (error) {
      console.error("Frekans verisi yüklenemedi:", error);
      frequencyDataMap = new Map<string, number>();
    }
  }

  async function saveFrequencyRows(rows: BayiFrequencyRow[]) {
    const payload = {
      anahtar: FREQUENCY_STORAGE_KEY,
      deger: rows,
    };

    try {
      const record = await pb
        .collection("ayarlar")
        .getFirstListItem(`anahtar="${FREQUENCY_STORAGE_KEY}"`);
      await pb.collection("ayarlar").update(record.id, { deger: rows });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : null;

      if (status !== 404) {
        throw error;
      }

      await pb.collection("ayarlar").create(payload);
    }
  }

  async function loadCurrentYearAuditCounts() {
    try {
      const { year } = getBusinessDateParts();
      const records = await fetchAllRecords(pb.collection("denetim_gecmisi"), {
        filter: `durum = "tamamlandi" && denetimYili = ${year}`,
        expand: "bayi",
      });
      const nextMap = new Map<string, number>();
      const countedAuditDays = new Set<string>();
      records.forEach((record) => {
        const bayiKodu = normalizeDealerCode(record.expand?.bayi?.bayiKodu);
        if (!bayiKodu) {
          return;
        }

        const uniqueAuditDayKey = buildUniqueAuditDayKey(record, bayiKodu);
        if (!uniqueAuditDayKey || countedAuditDays.has(uniqueAuditDayKey)) {
          return;
        }

        countedAuditDays.add(uniqueAuditDayKey);
        nextMap.set(bayiKodu, (nextMap.get(bayiKodu) ?? 0) + 1);
      });
      auditCountMap = nextMap;
    } catch (error) {
      console.error("Yıllık denetim sayıları yüklenemedi:", error);
      auditCountMap = new Map<string, number>();
    }
  }

  function applyFrequencyMetricsToStores() {
    allBayiler.forEach((bayi) => {
      const bayiKodu = normalizeDealerCode(bayi.bayiKodu);
      const senelikFrekans = frequencyDataMap.get(bayiKodu) ?? null;
      const yillikDenetimSayisi = auditCountMap.get(bayiKodu) ?? 0;
      bayi.senelikFrekans = senelikFrekans;
      bayi.yillikDenetimSayisi = yillikDenetimSayisi;
      bayi.kalanDenetimSayisi =
        senelikFrekans === null
          ? null
          : Math.max(senelikFrekans - yillikDenetimSayisi, 0);
    });
  }

  function refreshFrequencyUploadStatus() {
    if (!(frequencyUploadStatus instanceof HTMLElement)) {
      return;
    }

    const configuredStores = allBayiler.filter(
      (bayi) => Number.isInteger(bayi.senelikFrekans) && bayi.senelikFrekans >= 0,
    ).length;

    if (!frequencyDataMap.size) {
      frequencyUploadStatus.textContent = "Henüz frekans verisi yüklenmedi.";
      return;
    }

    frequencyUploadStatus.textContent = `${configuredStores} bayi için frekans tanımlı. Sistem dışı kayıtlar dahil toplam ${frequencyDataMap.size} eşleşme yüklü.`;
  }

  function updateFrequencySummary(bayiKoduValue, manualFrequencyValue) {
    const year = getBusinessDateParts().year;
    frequencySummaryYearLabel instanceof HTMLElement &&
      (frequencySummaryYearLabel.textContent = `${year} yılı`);

    const bayiKodu = normalizeDealerCode(bayiKoduValue);
    const manualFrequency = normalizeFrequencyValue(manualFrequencyValue);
    const hasManualFrequency =
      manualFrequencyValue !== "" &&
      manualFrequencyValue !== null &&
      manualFrequencyValue !== undefined;
    const targetValue = hasManualFrequency
      ? manualFrequency
      : frequencyDataMap.get(bayiKodu) ?? null;
    const completedValue = bayiKodu ? auditCountMap.get(bayiKodu) ?? 0 : 0;
    const remainingValue =
      targetValue === null ? null : Math.max(targetValue - completedValue, 0);

    frequencyTargetValue instanceof HTMLElement &&
      (frequencyTargetValue.textContent =
        targetValue === null ? "-" : String(targetValue));
    frequencyCompletedValue instanceof HTMLElement &&
      (frequencyCompletedValue.textContent = String(completedValue));
    frequencyRemainingValue instanceof HTMLElement &&
      (frequencyRemainingValue.textContent =
        remainingValue === null ? "-" : String(remainingValue));

    if (!(frequencySummaryNote instanceof HTMLElement)) {
      return;
    }

    if (!bayiKodu) {
      frequencySummaryNote.textContent =
        "Bayi kodu girildiğinde yıllık denetim özeti burada gösterilir.";
      return;
    }

    if (targetValue === null) {
      frequencySummaryNote.textContent =
        "Bu bayi için henüz senelik frekans tanımlı değil. İsterseniz bu formdan veya Excel yüklemesiyle frekans ekleyebilirsiniz.";
      return;
    }

    frequencySummaryNote.textContent = `${bayiKodu} kodlu bayi ${year} yılında ${completedValue} kez denetlendi. Hedefe ulaşmak için ${remainingValue} denetim daha gerekiyor.`;
  }

  async function persistStoreFrequency(previousDealerCode, nextDealerCode, inputValue) {
    const previousCode = normalizeDealerCode(previousDealerCode);
    const nextCode = normalizeDealerCode(nextDealerCode);
    const nextFrequency = normalizeFrequencyValue(inputValue);
    const nextMap = new Map(frequencyDataMap);

    if (previousCode && previousCode !== nextCode) {
      nextMap.delete(previousCode);
    }

    if (nextCode) {
      if (nextFrequency === null) {
        nextMap.delete(nextCode);
      } else {
        nextMap.set(nextCode, nextFrequency);
      }
    }

    const rows = buildFrequencyRowsFromMap(nextMap);
    await saveFrequencyRows(rows);
    frequencyDataMap = nextMap;
  }

  // Data loading
  async function loadModuleData() {
    showLoading(true);
    try {
      try {
        allUsers = await fetchAllRecords(pb.collection("users"), { sort: "name" });
      } catch (e) {
        console.error("Kullanıcı listesi alınamadı:", e);
      }

      bayiArchiveState = await loadArchiveState();
      await Promise.all([loadFrequencyData(), loadCurrentYearAuditCounts()]);
      allBayiler = await pb
        .collection("bayiler")
        .getList(1, 200, { sort: "-created", expand: "sorumlu_kullanici" })
        .then((result) => result.items);

      allBayiler.forEach((bayi) => {
        const user = bayi.expand?.sorumlu_kullanici;
        bayi.sorumlu_kullanici_email = user ? user.name || user.email : "";
        bayi.sorumlu_kullanici_email_tooltip = user?.email || "";
        bayi.isArchived = !!bayiArchiveState[bayi.id];
      });

      applyFrequencyMetricsToStores();
      populateUserDropdown();
      populateColumnCheckboxes();
      setupFilterListeners();
      refreshFrequencyUploadStatus();
      applyAllFilters();
    } catch (error) {
      console.error("Veri yüklenirken hata:", error);
    } finally {
      showLoading(false);
    }
  }
  let scoreReportSearchTerm = "";

  function renderBayiTable(bayilerToRender) {
    if (!tableBody) {
      return;
    }

    tableBody.replaceChildren();
    if (bayilerToRender.length === 0) {
      const trEmpty = document.createElement("tr");
      const tdEmpty = document.createElement("td");
      tdEmpty.colSpan = 10;
      tdEmpty.textContent = "Görüntülenecek bayi bulunamadı.";
      trEmpty.appendChild(tdEmpty);
      tableBody.appendChild(trEmpty);
      return;
    }

    bayilerToRender.forEach((bayi) => {
      const tr = document.createElement("tr");
      if (bayi.isArchived) {
        tr.classList.add("is-passive");
      }

      const uzmanEmail = bayi.sorumlu_kullanici_email || "";
      const uzmanEmailTooltip = bayi.sorumlu_kullanici_email_tooltip || "";
      const tdBolge = document.createElement("td");
      tdBolge.setAttribute("data-column", "bolge");
      tdBolge.textContent = bayi.bolge || "";
      if (bayi.bolge) {
        tdBolge.title = bayi.bolge;
      }

      const tdSehir = document.createElement("td");
      tdSehir.setAttribute("data-column", "sehir");
      tdSehir.textContent = bayi.sehir || "";
      if (bayi.sehir) {
        tdSehir.title = bayi.sehir;
      }

      const tdIlce = document.createElement("td");
      tdIlce.setAttribute("data-column", "ilce");
      tdIlce.textContent = bayi.ilce || "";
      if (bayi.ilce) {
        tdIlce.title = bayi.ilce;
      }

      const tdKodu = document.createElement("td");
      tdKodu.setAttribute("data-column", "bayiKodu");
      const strongKodu = document.createElement("strong");
      strongKodu.textContent = bayi.bayiKodu || "";
      if (bayi.bayiKodu) {
        tdKodu.title = bayi.bayiKodu;
      }
      tdKodu.appendChild(strongKodu);

      const tdAdi = document.createElement("td");
      tdAdi.setAttribute("data-column", "bayiAdi");
      const bayiAdiTam = bayi.bayiAdi || "";
      const bayiAdiKisa = bayiAdiTam.slice(0, 20);
      tdAdi.textContent = bayiAdiKisa;
      if (bayiAdiTam) {
        tdAdi.title = bayiAdiTam;
      }

      const tdYonetmen = document.createElement("td");
      tdYonetmen.setAttribute("data-column", "yonetmen");
      tdYonetmen.textContent = bayi.yonetmen || "";
      if (bayi.yonetmen) {
        tdYonetmen.title = bayi.yonetmen;
      }

      const tdEmail = document.createElement("td");
      tdEmail.setAttribute("data-column", "email");
      tdEmail.textContent = bayi.email || "";
      if (bayi.email) {
        tdEmail.title = bayi.email;
      }

      const tdUzman = document.createElement("td");
      tdUzman.setAttribute("data-column", "sorumlu_kullanici_email");
      if (uzmanEmailTooltip) {
        tdUzman.title = uzmanEmailTooltip;
      }
      tdUzman.textContent = uzmanEmail || "Atanmamış";
      tdUzman.title = uzmanEmailTooltip || uzmanEmail || "Atanmamış";

      const tdStatus = document.createElement("td");
      tdStatus.setAttribute("data-column", "durum");
      const statusBadge = document.createElement("span");
      statusBadge.className = bayi.isArchived
        ? "status-badge passive"
        : "status-badge active";
      statusBadge.textContent = bayi.isArchived ? "Pasif" : "Aktif";
      tdStatus.appendChild(statusBadge);

      const tdActions = document.createElement("td");
      tdActions.className = "action-buttons";
      tdActions.setAttribute("data-column", "eylemler");

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn btn-warning btn-edit";
      btnEdit.type = "button";
      btnEdit.dataset.id = bayi.id;
      btnEdit.title = "Düzenle";
      const iEdit = document.createElement("i");
      iEdit.className = "fas fa-edit";
      iEdit.setAttribute("aria-hidden", "true");
      btnEdit.appendChild(iEdit);

      const btnToggleStatus = document.createElement("button");
      btnToggleStatus.className = bayi.isArchived
        ? "btn btn-success btn-toggle-status is-activate-action"
        : "btn btn-secondary btn-toggle-status";
      btnToggleStatus.type = "button";
      btnToggleStatus.dataset.id = bayi.id;
      btnToggleStatus.title = bayi.isArchived
        ? "Yeniden Aktif Et"
        : "Pasife Al";

      const iconToggle = document.createElement("i");
      iconToggle.className = bayi.isArchived ? "fas fa-play" : "fas fa-pause";
      iconToggle.setAttribute("aria-hidden", "true");
      btnToggleStatus.appendChild(iconToggle);

      const btnDelete = document.createElement("button");
      btnDelete.className = "btn btn-danger btn-delete";
      btnDelete.type = "button";
      btnDelete.dataset.id = bayi.id;
      btnDelete.title = "Sil";
      const iDel = document.createElement("i");
      iDel.className = "fas fa-trash";
      iDel.setAttribute("aria-hidden", "true");
      btnDelete.appendChild(iDel);

      btnEdit.addEventListener("click", () => handleEditBayi(bayi.id));
      btnToggleStatus.addEventListener("click", () =>
        handleToggleBayiStatus(bayi.id),
      );
      btnDelete.addEventListener("click", () => handleDeleteBayi(bayi.id));

      tdActions.append(btnEdit, btnToggleStatus, btnDelete);
      tr.append(
        tdBolge,
        tdSehir,
        tdIlce,
        tdKodu,
        tdAdi,
        tdYonetmen,
        tdEmail,
        tdUzman,
        tdStatus,
        tdActions,
      );
      tableBody.appendChild(tr);
    });

    applyColumnVisibility();
  }
  function populateUserDropdown() {
    if (!uzmanSelect) {
      return;
    }

    uzmanSelect.replaceChildren();
    setSelectPlaceholder(uzmanSelect as HTMLSelectElement, "Atanmamış");

    if (importGlobalUserSelect) {
      importGlobalUserSelect.replaceChildren();
      setSelectPlaceholder(
        importGlobalUserSelect as HTMLSelectElement,
        "İçe Aktarılan Tüm Bayileri Bu Kullanıcıya Ata (Opsiyonel)",
      );
    }

    allUsers.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name || user.email;
      uzmanSelect.appendChild(option);
      if (importGlobalUserSelect) {
        const clonedOption = option.cloneNode(true);
        importGlobalUserSelect.appendChild(clonedOption);
      }
    });
  }
  function populateColumnCheckboxes() {
    if (!columnCheckboxesContainer) {
      return;
    }

    columnCheckboxesContainer.replaceChildren();
    fields.forEach((field) => {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.className = "column-check";
      input.value = field.key;
      label.replaceChildren(input, document.createTextNode(` ${field.label}`));
      columnCheckboxesContainer.appendChild(label);
    });
  }

  function normalizeArchiveState(rawValue) {
    if (!rawValue) {
      return {};
    }

    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        console.warn("bayiArchiveState parse edilemedi:", error);
      }
      return {};
    }

    if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
      return rawValue;
    }

    return {};
  }

  function buildArchiveStatePayload(state) {
    const normalized = normalizeArchiveState(state);
    return JSON.stringify(normalized);
  }

  function emitBayiStatusChanged(bayi, isArchived) {
    window.dispatchEvent(
      new CustomEvent("bayiDurumDegisti", {
        detail: {
          bayiId: bayi.id,
          bayiKodu: bayi.bayiKodu || null,
          bayiAdi: bayi.bayiAdi || null,
          isArchived,
          isReactivated: !isArchived,
          status: isArchived ? "archived" : "active",
          archiveState: { ...normalizeArchiveState(bayiArchiveState) },
        },
      }),
    );
  }

  async function getArchiveSettingRecord() {
    try {
      return await pb
        .collection("ayarlar")
        .getFirstListItem('anahtar="bayiArchiveState"');
    } catch (error) {
      const pocketBaseError = error as { status?: number };
      if (pocketBaseError.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function loadArchiveState() {
    try {
      const record = await getArchiveSettingRecord();
      return normalizeArchiveState(record?.deger);
    } catch (error) {
      console.error("Bayi pasif durumları yüklenemedi:", error);
      return {};
    }
  }

  async function saveArchiveState() {
    const normalizedState = normalizeArchiveState(bayiArchiveState);
    bayiArchiveState = normalizedState;
    const record = await getArchiveSettingRecord();
    const hasArchivedStores = Object.keys(normalizedState).length > 0;

    if (!hasArchivedStores) {
      if (record) {
        await pb.collection("ayarlar").delete(record.id);
      }
      return;
    }

    const payload = { deger: buildArchiveStatePayload(normalizedState) };

    if (record) {
      await pb.collection("ayarlar").update(record.id, payload);
      return;
    }

    await pb.collection("ayarlar").create({
      anahtar: "bayiArchiveState",
      ...payload,
    });
  }

  async function handleToggleBayiStatus(bayiId) {
    const bayi = allBayiler.find((item) => item.id === bayiId);
    if (!bayi) {
      return;
    }

    const isArchived = !!bayiArchiveState[bayiId];
    const confirmMessage = isArchived
      ? "Bu bayiyi yeniden aktif yapmak istediğinizden emin misiniz?"
      : "Bu bayiyi pasife almak istediğinizden emin misiniz?";

    if (!confirm(confirmMessage)) {
      return;
    }

    showLoading(true);
    try {
      if (isArchived) {
        delete bayiArchiveState[bayiId];
      } else {
        bayiArchiveState[bayiId] = true;
      }

      await saveArchiveState();
      emitBayiStatusChanged(bayi, !isArchived);
      await loadModuleData();
      notify.success(
        isArchived
          ? `${bayi.bayiAdi || bayi.bayiKodu || "Bayi"} yeniden aktif edildi.`
          : `${bayi.bayiAdi || bayi.bayiKodu || "Bayi"} pasife alındı.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      errorService.handle(error, { userMessage: `Hata: ${message}` });
    } finally {
      showLoading(false);
    }
  }

  // CRUD actions
  function handleEditBayi(bayiId) {
    const bayi = allBayiler.find((b) => b.id === bayiId);
    if (!bayi) {
      return;
    }

    bayiForm.reset();
    modalTitle.textContent = "Bayi Bilgileri";
    bayiIdInput.value = bayi.id;
    container.querySelector("#bayiKodu").value = bayi.bayiKodu || "";
    container.querySelector("#bayiAdi").value = bayi.bayiAdi || "";
    container.querySelector("#bolge").value = bayi.bolge || "";
    container.querySelector("#sehir").value = bayi.sehir || "";
    container.querySelector("#ilce").value = bayi.ilce || "";
    container.querySelector("#yonetmen").value = bayi.yonetmen || "";
    container.querySelector("#email").value = bayi.email || "";
    container.querySelector("#sorumlu_kullanici").value =
      bayi.sorumlu_kullanici || "";
    senelikFrekansInput instanceof HTMLInputElement &&
      (senelikFrekansInput.value =
        bayi.senelikFrekans === null || bayi.senelikFrekans === undefined
          ? ""
          : String(bayi.senelikFrekans));
    updateFrequencySummary(bayi.bayiKodu, senelikFrekansInput?.value ?? "");
    bayiModalController?.open();
  }
  async function handleFormSubmit(event) {
    event.preventDefault();
    showLoading(true);
    const bayiId = bayiIdInput.value;
    const frequencyInputValue =
      senelikFrekansInput instanceof HTMLInputElement
        ? senelikFrekansInput.value
        : "";
    const normalizedFrequencyInput = normalizeFrequencyValue(frequencyInputValue);
    if (
      frequencyInputValue !== "" &&
      normalizedFrequencyInput === null
    ) {
      showLoading(false);
      notify.warning("Senelik frekans alanına 0 veya daha büyük bir sayı girmelisiniz.");
      return;
    }
    const existingBayi = bayiId
      ? allBayiler.find((bayi) => bayi.id === bayiId)
      : null;
    const data = {
      bayiKodu: container.querySelector("#bayiKodu").value,
      bayiAdi: container.querySelector("#bayiAdi").value,
      bolge: container.querySelector("#bolge").value,
      sehir: container.querySelector("#sehir").value,
      ilce: container.querySelector("#ilce").value,
      yonetmen: container.querySelector("#yonetmen").value,
      email: container.querySelector("#email").value,
      sorumlu_kullanici:
        container.querySelector("#sorumlu_kullanici").value || null,
    };
    try {
      if (bayiId) {
        await pb.collection("bayiler").update(bayiId, data);
      } else {
        await pb.collection("bayiler").create(data);
      }
      await persistStoreFrequency(
        existingBayi?.bayiKodu,
        data.bayiKodu,
        frequencyInputValue,
      );
      bayiModalController?.close();
      await loadModuleData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      errorService.handle(error, { userMessage: `Hata: ${message}` });
    } finally {
      showLoading(false);
    }
  }
  async function deleteBayiRelations(collectionName, bayiId) {
    const records = await pb
      .collection(collectionName)
      .getList(1, 200, { filter: `bayi="${bayiId}"`, fields: "id" })
      .then((result) => result.items);
    if (!records.length) {
      return 0;
    }

    for (const record of records) {
      await pb.collection(collectionName).delete(record.id);
    }
    return records.length;
  }

  async function handleDeleteBayi(bayiId) {
    if (
      !confirm(
        "Bu bayi kalıcı olarak silinecek. İlişkili denetim raporları ve geri alma kayıtları da silinecek. Devam etmek istediğinizden emin misiniz?",
      )
    ) {
      return;
    }

    showLoading(true);
    try {
      const bayi = allBayiler.find((b) => b.id === bayiId);
      const deletedUndoCount = await deleteBayiRelations(
        "denetim_geri_alinanlar",
        bayiId,
      );
      const deletedReportCount = await deleteBayiRelations(
        "denetim_raporlari",
        bayiId,
      );

      if (bayiArchiveState[bayiId]) {
        delete bayiArchiveState[bayiId];
        await saveArchiveState();
      }

      emitBayiStatusChanged(bayi || { id: bayiId }, true);
      await pb.collection("bayiler").delete(bayiId);
      await loadModuleData();
      notify.success(
        `${bayi?.bayiAdi || bayi?.bayiKodu || "Bayi"} silindi. ${deletedReportCount} denetim raporu ve ${deletedUndoCount} geri alma kaydı temizlendi.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      errorService.handle(error, { userMessage: `Hata: ${message}` });
    } finally {
      showLoading(false);
    }
  }

  function setupFilterListeners() {
    if (filterListenersBound) {
      return;
    }
    filterListenersBound = true;
    dropdownFilter &&
      dropdownFilter.addEventListener("change", applyAllFilters);
    statusFilter && statusFilter.addEventListener("change", applyAllFilters);
    searchInputs.forEach((input) =>
      input.addEventListener("input", applyAllFilters),
    );
  }

  function applyAllFilters() {
    const filterValue = dropdownFilter ? dropdownFilter.value : "all";
    const statusValue = statusFilter ? statusFilter.value : "active";
    const searchValues = {};
    searchInputs.forEach((input) => {
      if (input.dataset.column) {
        searchValues[input.dataset.column] = input.value.toLowerCase();
      }
    });

    const filteredBayiler = allBayiler.filter((bayi) => {
      let passDropdown = true;
      const isEmpty = (val) => !val || val.toString().trim() === "";
      switch (filterValue) {
        case "no_bolge":
          passDropdown = isEmpty(bayi.bolge);
          break;
        case "no_sehir":
          passDropdown = isEmpty(bayi.sehir);
          break;
        case "no_ilce":
          passDropdown = isEmpty(bayi.ilce);
          break;
        case "no_bayiKodu":
          passDropdown = isEmpty(bayi.bayiKodu);
          break;
        case "no_bayiAdi":
          passDropdown = isEmpty(bayi.bayiAdi);
          break;
        case "no_yonetmen":
          passDropdown = isEmpty(bayi.yonetmen);
          break;
        case "no_email":
          passDropdown = isEmpty(bayi.email);
          break;
        case "no_uzman":
          passDropdown = isEmpty(bayi.sorumlu_kullanici_email);
          break;
        default:
          passDropdown = true;
      }

      if (!passDropdown) {
        return false;
      }

      if (statusValue === "active" && bayi.isArchived) {
        return false;
      }
      if (statusValue === "passive" && !bayi.isArchived) {
        return false;
      }

      for (const key in searchValues) {
        const term = searchValues[key];
        if (term && !(bayi[key] || "").toLowerCase().includes(term)) {
          return false;
        }
      }

      return true;
    });

    filteredBayilerForReport = filteredBayiler;
    renderBayiTable(filteredBayiler);
    populateScoreReportStoreOptions();
  }

  function closeScoreReportPicker() {
    if (scoreReportPickerPanel instanceof HTMLElement) {
      scoreReportPickerPanel.hidden = true;
    }
  }

  function updateScoreReportPickerLabel() {
    const selectedBayiler = filteredBayilerForReport.filter((bayi) =>
      selectedScoreReportStoreIds.has(bayi.id),
    );

    if (scoreReportSelectionBadge instanceof HTMLElement) {
      const selectedCount = selectedBayiler.length;
      const totalCount = filteredBayilerForReport.length;
      scoreReportSelectionBadge.textContent = `${selectedCount} seçili${totalCount ? ` / ${totalCount}` : ""}`;
      scoreReportSelectionBadge.title = totalCount
        ? `${selectedCount} bayi seçildi. Filtreye uyan toplam bayi: ${totalCount}`
        : `${selectedCount} bayi seçildi.`;
    }

    if (!(scoreReportPickerToggle instanceof HTMLButtonElement)) {
      return;
    }

    scoreReportPickerToggle.classList.toggle(
      "has-selection",
      selectedBayiler.length > 0,
    );
    scoreReportPickerToggle.replaceChildren();

    const textSpan = document.createElement("span");
    textSpan.className = "performance-report-picker-toggle-text";

    if (!selectedBayiler.length) {
      textSpan.textContent = "Bayi seçin";
      scoreReportPickerToggle.title = "Bayi seçin";
      scoreReportPickerToggle.appendChild(textSpan);
      return;
    }

    if (selectedBayiler.length === 1) {
      const bayi = selectedBayiler[0];
      const label = `${bayi.bayiKodu || "Kodsuz"} - ${bayi.bayiAdi || "Adsız Bayi"}`;
      textSpan.textContent = label;
      scoreReportPickerToggle.title = label;
      scoreReportPickerToggle.appendChild(textSpan);
      return;
    }

    const label = `${selectedBayiler.length} bayi seçildi`;
    const tooltip = selectedBayiler
      .map(
        (bayi) =>
          `${bayi.bayiKodu || "Kodsuz"} - ${bayi.bayiAdi || "Adsız Bayi"}`,
      )
      .join("\n");

    textSpan.textContent = label;
    scoreReportPickerToggle.title = tooltip;
    scoreReportPickerToggle.appendChild(textSpan);
  }

  function populateScoreReportStoreOptions() {
    if (!scoreReportStoreChecklist) {
      return;
    }

    const availableStoreIds = new Set(
      filteredBayilerForReport.map((bayi) => bayi.id),
    );
    const preservedStoreIds = new Set(
      Array.from(availableStoreIds).filter((id) =>
        selectedScoreReportStoreIds.has(id),
      ),
    );

    selectedScoreReportStoreIds.clear();
    preservedStoreIds.forEach((id) => selectedScoreReportStoreIds.add(id));
    renderScoreReportStoreChecklist();
    updateScoreReportPickerLabel();
  }

  function normalizeScoreReportSearchValue(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9çğıöşü]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatScoreReportStoreLabel(bayi) {
    const bayiKodu = (bayi?.bayiKodu || "Kodsuz").trim();
    const bayiAdi = (bayi?.bayiAdi || "Adsız Bayi").trim();
    const truncatedBayiAdi =
      bayiAdi.length > 30 ? `${bayiAdi.slice(0, 30)}...` : bayiAdi;

    return {
      fullLabel: `${bayiKodu} - ${bayiAdi}`,
      shortLabel: `${bayiKodu} - ${truncatedBayiAdi}`,
    };
  }
  function appendScoreReportStoreRows(items, token) {
    if (!(scoreReportStoreChecklist instanceof HTMLElement)) {
      return;
    }

    const batchSize = 120;
    let startIndex = 0;

    const renderNextBatch = () => {
      if (
        !(scoreReportStoreChecklist instanceof HTMLElement) ||
        token !== scoreReportRenderToken
      ) {
        return;
      }

      const fragment = document.createDocumentFragment();
      const endIndex = Math.min(startIndex + batchSize, items.length);

      for (let index = startIndex; index < endIndex; index += 1) {
        const bayi = items[index];
        const label = document.createElement("label");
        label.className = "performance-report-checklist-item";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = bayi.id;
        input.checked = selectedScoreReportStoreIds.has(bayi.id);

        const textSpan = document.createElement("span");
        textSpan.className = "performance-report-checklist-text";
        const { fullLabel, shortLabel } = formatScoreReportStoreLabel(bayi);
        textSpan.textContent = shortLabel;
        textSpan.title = fullLabel;

        label.append(input, textSpan);
        fragment.appendChild(label);
      }

      scoreReportStoreChecklist.appendChild(fragment);
      startIndex = endIndex;

      if (startIndex < items.length) {
        requestAnimationFrame(renderNextBatch);
      }
    };

    renderNextBatch();
  }

  function getVisibleScoreReportStores() {
    const search = normalizeScoreReportSearchValue(scoreReportSearchTerm);
    if (!search) {
      return filteredBayilerForReport;
    }

    return filteredBayilerForReport.filter((bayi) => {
      const bayiKodu = normalizeScoreReportSearchValue(bayi.bayiKodu);
      const bayiAdi = normalizeScoreReportSearchValue(bayi.bayiAdi);
      const combined = normalizeScoreReportSearchValue(
        `${bayi.bayiKodu || ""} ${bayi.bayiAdi || ""}`,
      );
      return (
        bayiKodu.includes(search) ||
        bayiAdi.includes(search) ||
        combined.includes(search)
      );
    });
  }

  function renderScoreReportStoreChecklist() {
    if (!scoreReportStoreChecklist) {
      return;
    }

    const visibleStores = getVisibleScoreReportStores();
    scoreReportStoreChecklist.replaceChildren();
    scoreReportVisibleStoresCache = visibleStores;
    scoreReportStoreChecklist.scrollTop = 0;
    scoreReportRenderToken += 1;

    if (!filteredBayilerForReport.length) {
      const emptyState = document.createElement("div");
      emptyState.className = "performance-report-checklist-empty";
      emptyState.textContent = "Filtreye uyan bayi yok.";
      scoreReportStoreChecklist.appendChild(emptyState);
      scoreReportStoreChecklist.classList.add("is-disabled");
      btnSelectAllScoreStores instanceof HTMLButtonElement &&
        (btnSelectAllScoreStores.disabled = true);
      btnClearScoreStores instanceof HTMLButtonElement &&
        (btnClearScoreStores.disabled = true);
      updateScoreReportPickerLabel();
      return;
    }

    if (!visibleStores.length) {
      const emptyState = document.createElement("div");
      emptyState.className = "performance-report-checklist-empty";
      emptyState.textContent = "Aramaya uygun bayi bulunamadı.";
      scoreReportStoreChecklist.appendChild(emptyState);
      scoreReportStoreChecklist.classList.remove("is-disabled");
      btnSelectAllScoreStores instanceof HTMLButtonElement &&
        (btnSelectAllScoreStores.disabled = false);
      btnClearScoreStores instanceof HTMLButtonElement &&
        (btnClearScoreStores.disabled = false);
      updateScoreReportPickerLabel();
      return;
    }

    scoreReportStoreChecklist.classList.remove("is-disabled");
    btnSelectAllScoreStores instanceof HTMLButtonElement &&
      (btnSelectAllScoreStores.disabled = false);
    btnClearScoreStores instanceof HTMLButtonElement &&
      (btnClearScoreStores.disabled = false);
    appendScoreReportStoreRows(visibleStores, scoreReportRenderToken);
    updateScoreReportPickerLabel();
  }

  function selectAllScoreReportStores() {
    getVisibleScoreReportStores().forEach((bayi) =>
      selectedScoreReportStoreIds.add(bayi.id),
    );
    renderScoreReportStoreChecklist();
  }

  function clearScoreReportStoreSelection() {
    getVisibleScoreReportStores().forEach((bayi) =>
      selectedScoreReportStoreIds.delete(bayi.id),
    );
    renderScoreReportStoreChecklist();
  }

  async function loadScoreData() {
    if (scoreDataCache) {
      return scoreDataCache;
    }

    const [dideRecord, fideRecord] = await Promise.all([
      pb
        .collection("excel_verileri")
        .getFirstListItem('tip="dide"')
        .catch(() => null),
      pb
        .collection("excel_verileri")
        .getFirstListItem('tip="fide"')
        .catch(() => null),
    ]);

    scoreDataCache = {
      dideRows: Array.isArray(dideRecord?.veri) ? dideRecord.veri : [],
      fideRows: Array.isArray(fideRecord?.veri) ? fideRecord.veri : [],
    };

    return scoreDataCache;
  }

  async function refreshScoreUploadStatus() {
    let hasDideRecord = false;
    let hasFideRecord = false;

    if (btnDeleteDideExcel instanceof HTMLElement) {
      btnDeleteDideExcel.hidden = true;
    }
    if (btnDeleteFideExcel instanceof HTMLElement) {
      btnDeleteFideExcel.hidden = true;
    }

    try {
      const dideRecord = await pb.collection("excel_verileri").getFirstListItem('tip="dide"');
      hasDideRecord = !!dideRecord;
    } catch {
      // Sessiz geç: kayıt olmayabilir.
    }

    try {
      const fideRecord = await pb.collection("excel_verileri").getFirstListItem('tip="fide"');
      hasFideRecord = !!fideRecord;
    } catch {
      // Sessiz geç: kayıt olmayabilir.
    }

    if (btnDeleteDideExcel instanceof HTMLElement) {
      btnDeleteDideExcel.hidden = !hasDideRecord;
    }
    if (btnDeleteFideExcel instanceof HTMLElement) {
      btnDeleteFideExcel.hidden = !hasFideRecord;
    }
  }

  async function clearScoreExcelByType(type) {
    const label = type === "dide" ? "DiDe" : "FiDe";
    const records = await pb
      .collection("excel_verileri")
      .getList(1, 200, {
        fields: "id",
        filter: `tip="${type}"`,
      }).then((result) => result.items);

    if (!records.length) {
      notify.info(`${label} için kayıtlı Excel puan verisi bulunamadı.`);
      return;
    }

    for (const record of records) {
      await pb.collection("excel_verileri").delete(record.id);
    }

    if (type === "dide") {
      setDideData([]);
      scoreDideFileInput instanceof HTMLInputElement && (scoreDideFileInput.value = "");
    } else {
      setFideData([]);
      scoreFideFileInput instanceof HTMLInputElement && (scoreFideFileInput.value = "");
    }

    scoreDataCache = null;
    notify.info(`${label} Excel puan verisi temizlendi.`);
    location.reload();
  }

  function parseReportScore(value) {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    if (typeof value === "number") {
      return value;
    }

    const normalized = String(value)
      .trim()
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function buildScoreTableHtml(store, dideRow, fideRow) {
    const rawHeading =
      `${String(store.bayiKodu || "").trim()} ${String(store.bayiAdi || "").trim()}`.trim();
    const heading = escapeHtml(rawHeading.slice(0, 45).trim() || "Adsız Bayi");

    return `
      <section class="score-report-block">
        <h2 class="score-report-title">${heading}</h2>
        ${renderPerformanceTable([
          { label: "DİDE", scores: dideRow?.scores },
          { label: "FİDE", scores: fideRow?.scores },
        ])}
      </section>`;
  }

  function buildScoreReportDocument(reportItems) {
    const bodyHtml = reportItems.join("");
    return `<!doctype html>
      <html lang="tr">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>FiDe / DiDe Puan Tablosu</title>
          <link rel="stylesheet" href="${mainCssUrl}" />
          <link rel="stylesheet" href="${performanceTableCssUrl}" />
          <link rel="stylesheet" href="${bayiYoneticisiCssUrl}" />
        </head>
        <body class="score-report-document">
          <div class="report-shell">
            <div class="report-toolbar">
              <div>
                <h1>FiDe / DiDe Puan Tablosu</h1>
                <p>Oluşturulma Tarihi: ${escapeHtml(new Date().toLocaleString("tr-TR"))}</p>
              </div>
              <button id="score-report-print-btn" type="button">Yazdır</button>
            </div>
            ${bodyHtml}
          </div>
        </body>
      </html>`;
  }

  function buildReportHead(doc, titleText) {
    doc.title = titleText;
    const charsetMeta = doc.createElement("meta");
    charsetMeta.setAttribute("charset", "utf-8");
    const viewportMeta = doc.createElement("meta");
    viewportMeta.setAttribute("name", "viewport");
    viewportMeta.setAttribute("content", "width=device-width, initial-scale=1");
    const mainCssLink = doc.createElement("link");
    mainCssLink.rel = "stylesheet";
    mainCssLink.href = mainCssUrl;
    const performanceTableCssLink = doc.createElement("link");
    performanceTableCssLink.rel = "stylesheet";
    performanceTableCssLink.href = performanceTableCssUrl;
    const moduleCssLink = doc.createElement("link");
    moduleCssLink.rel = "stylesheet";
    moduleCssLink.href = bayiYoneticisiCssUrl;
    doc.head.replaceChildren(charsetMeta, viewportMeta, mainCssLink, performanceTableCssLink, moduleCssLink);
  }

  function createImportedSafeNodes(doc, html) {
    const fragment = safeHtmlFragment(html);
    return Array.from(fragment.childNodes).map((node) => doc.importNode(node, true));
  }

  function renderScoreReportWindow(doc, reportItems) {
    const titleText = "FiDe / DiDe Puan Tablosu";
    doc.open();
    doc.close();
    doc.documentElement.lang = "tr";
    buildReportHead(doc, titleText);

    const shell = doc.createElement("div");
    shell.className = "report-shell";

    const toolbar = doc.createElement("div");
    toolbar.className = "report-toolbar";
    const titleGroup = doc.createElement("div");
    const heading = doc.createElement("h1");
    heading.textContent = titleText;
    const createdAt = doc.createElement("p");
    createdAt.textContent = `Oluşturulma Tarihi: ${new Date().toLocaleString("tr-TR")}`;
    titleGroup.append(heading, createdAt);
    const printButton = doc.createElement("button");
    printButton.id = "score-report-print-btn";
    printButton.type = "button";
    printButton.textContent = "Yazdır";
    toolbar.append(titleGroup, printButton);

    shell.append(toolbar, ...createImportedSafeNodes(doc, reportItems.join("")));
    doc.body.className = "score-report-document";
    doc.body.replaceChildren(shell);
    printButton.addEventListener("click", () => {
      doc.defaultView?.print();
    });
  }

  function renderScoreReportLoading(doc) {
    const titleText = "FiDe / DiDe Puan Tablosu Hazırlanıyor";
    doc.open();
    doc.close();
    doc.documentElement.lang = "tr";
    buildReportHead(doc, titleText);
    doc.body.className = "score-report-document";
    const loading = doc.createElement("p");
    loading.className = "score-report-loading";
    loading.textContent = "FiDe / DiDe puan tablosu hazırlanıyor...";
    doc.body.replaceChildren(loading);
  }

  async function openScoreReport() {
    closeScoreReportPicker();
    if (!filteredBayilerForReport.length) {
      notify.warning("Önce rapor üretilecek bayi listesini filtreleyin.");
      return;
    }

    const targetBayiler = filteredBayilerForReport.filter((bayi) =>
      selectedScoreReportStoreIds.has(bayi.id),
    );

    if (!targetBayiler.length) {
      notify.warning("Rapor oluşturmak için en az bir bayi seçin.");
      return;
    }

    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      notify.error(
        "Rapor penceresi açılamadı. Tarayıcı açılır pencereyi engelliyor olabilir.",
      );
      return;
    }

    renderScoreReportLoading(reportWindow.document);

    try {
      const { dideRows, fideRows } = await loadScoreData();
      const reportItems = targetBayiler.map((bayi) => {
        const bayiKodu = String(bayi.bayiKodu || "").trim();
        const dideRow =
          dideRows.find(
            (row) => String(row["Bayi Kodu"] || "").trim() === bayiKodu,
          ) || null;
        const fideRow =
          fideRows.find(
            (row) => String(row["Bayi Kodu"] || "").trim() === bayiKodu,
          ) || null;
        return buildScoreTableHtml(bayi, dideRow, fideRow);
      });

      renderScoreReportWindow(reportWindow.document, reportItems);
      notify.success("FiDe / DiDe puan tablosu hazırlandı.");
    } catch (error) {
      try {
        reportWindow.close();
      } catch {
        // noop
      }
      console.error(error);
      errorService.handle(error, {
        userMessage: "Puan tablosu hazırlanırken bir hata oluştu.",
      });
    }
  }

  function applyColumnVisibility() {
    if (!columnCheckboxesContainer) {
      return;
    }

    const selectedKeys = Array.from(
      columnCheckboxesContainer.querySelectorAll(".column-check:checked"),
    ).map((cb) => cb.value);
    const showAll = selectedKeys.length === 0;

    allFieldKeys.forEach((key) => {
      container.querySelectorAll(`[data-column="${key}"]`).forEach((cell) => {
        cell.hidden = !(showAll || selectedKeys.includes(key));
      });
    });

    container.querySelectorAll('[data-column="durum"]').forEach((cell) => {
      cell.hidden = false;
    });

    container.querySelectorAll('[data-column="eylemler"]').forEach((cell) => {
      cell.hidden = false;
    });
  }

  function openFrequencyImportModal() {
    if (!frequencyImportModalController) {
      return;
    }

    frequencyImportModalController.onCloseCleanup(() => {
      importedFrequencyExcelData = null;
      frequencyMappingContainer?.replaceChildren();
      setLoadingState(
        frequencyImportLoadingOverlay,
        frequencyImportLoadingText,
        false,
        "",
      );
    });
    frequencyImportModalController.open();
    show(frequencyImportStep1);
    hide(frequencyImportStep2);
    hide(frequencyImportStep3);
    frequencyExcelInput instanceof HTMLInputElement && (frequencyExcelInput.value = "");
    btnProcessFrequencyExcel instanceof HTMLButtonElement &&
      (btnProcessFrequencyExcel.disabled = true);
    frequencyMappingContainer?.replaceChildren();
    importedFrequencyExcelData = null;
  }

  function renderFrequencyMappingUI(headers) {
    frequencyMappingContainer?.replaceChildren();
    frequencyDbFields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "mapping-row";
      let selectedIndex = -1;
      headers.forEach((header, index) => {
        const headerLower = String(header ?? "").toLowerCase();
        if (
          field.key === "bayiKodu" &&
          (headerLower.includes("bayi kodu") ||
            headerLower.includes("kod") ||
            headerLower.includes("bayi no"))
        ) {
          selectedIndex = index;
        }
        if (
          field.key === "senelikFrekans" &&
          (headerLower.includes("senelik frekans") ||
            headerLower.includes("frekans") ||
            headerLower.includes("ziyaret"))
        ) {
          selectedIndex = index;
        }
      });
      let optionsHtml = '<option value="-1">-- Sütun Seçin --</option>';
      headers.forEach((header, index) => {
        optionsHtml += `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${header}</option>`;
      });
      setSafeHtml(
        row,
        `
          <label class="excel-column-label">${field.label} ${field.required ? "*" : ""}</label>
          <i class="fas fa-arrow-right"></i>
          <select class="form-control frequency-db-field-select" data-key="${field.key}">
            ${optionsHtml}
          </select>
        `,
      );
      frequencyMappingContainer?.appendChild(row);
    });

    frequencyMappingContainer
      ?.querySelectorAll(".frequency-db-field-select")
      .forEach((select) => {
        select.addEventListener("change", checkFrequencyImportValidity);
      });
    checkFrequencyImportValidity();
  }

  function checkFrequencyImportValidity() {
    const codeSelect = frequencyMappingContainer?.querySelector(
      'select[data-key="bayiKodu"]',
    );
    const frequencySelect = frequencyMappingContainer?.querySelector(
      'select[data-key="senelikFrekans"]',
    );
    const isValid =
      codeSelect instanceof HTMLSelectElement &&
      codeSelect.value !== "-1" &&
      frequencySelect instanceof HTMLSelectElement &&
      frequencySelect.value !== "-1";
    setHidden(frequencyImportWarning, isValid);
    btnExecuteFrequencyImport instanceof HTMLButtonElement &&
      (btnExecuteFrequencyImport.disabled = !isValid);
  }

  async function executeFrequencyImport() {
    const mappings: Record<string, number> = {};
    frequencyMappingContainer
      ?.querySelectorAll(".frequency-db-field-select")
      .forEach((select) => {
        mappings[select.dataset.key] = parseInt(select.value, 10);
      });

    const dataRows = importedFrequencyExcelData?.slice(1) ?? [];
    show(frequencyImportLoadingOverlay);
    frequencyImportLoadingText instanceof HTMLElement &&
      (frequencyImportLoadingText.textContent = `0 / ${dataRows.length} kayıt işleniyor...`);

    const existingDealerCodes = new Set(
      allBayiler.map((bayi) => normalizeDealerCode(bayi.bayiKodu)).filter(Boolean),
    );
    const nextFrequencyMap = new Map<string, number>();
    let matchedCount = 0;
    let unmatchedCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    const errors = [];

    dataRows.forEach((row, index) => {
      const bayiKodu = normalizeDealerCode(row[mappings.bayiKodu]);
      const senelikFrekans = normalizeFrequencyValue(row[mappings.senelikFrekans]);

      if (!bayiKodu || senelikFrekans === null) {
        invalidCount += 1;
        errors.push(`Satır ${index + 2}: bayi kodu veya frekans geçersiz.`);
        return;
      }

      if (!existingDealerCodes.has(bayiKodu)) {
        unmatchedCount += 1;
        errors.push(`${bayiKodu}: sistemde eşleşen bayi bulunamadı.`);
        return;
      }

      if (nextFrequencyMap.has(bayiKodu)) {
        duplicateCount += 1;
      }

      nextFrequencyMap.set(bayiKodu, senelikFrekans);
      matchedCount += 1;
    });

    try {
      await saveFrequencyRows(buildFrequencyRowsFromMap(nextFrequencyMap));
      frequencyDataMap = nextFrequencyMap;

      frequencyImportResults?.replaceChildren();
      const pre = document.createElement("pre");
      pre.textContent = [
        "İşlem Tamamlandı!",
        "-----------------",
        `Eşleşen Kayıt: ${matchedCount}`,
        `Kaydedilen Benzersiz Bayi: ${nextFrequencyMap.size}`,
        `Sistemde Bulunamayan: ${unmatchedCount}`,
        `Geçersiz Satır: ${invalidCount}`,
        `Tekrarlanan Bayi Kodu: ${duplicateCount}`,
        errors.length ? "\nDetaylar:\n" + errors.join("\n") : "",
      ].join("\n");
      frequencyImportResults?.appendChild(pre);

      hide(frequencyImportStep1);
      hide(frequencyImportStep2);
      show(frequencyImportStep3);
      await loadModuleData();
    } catch (error) {
      console.error("Frekans verisi kaydedilemedi:", error);
      errorService.handle(error, {
        userMessage: "Frekans verisi kaydedilemedi. Lütfen tekrar deneyin.",
      });
    } finally {
      hide(frequencyImportLoadingOverlay);
    }
  }

  frequencyExcelInput instanceof HTMLInputElement &&
    frequencyExcelInput.addEventListener("change", (event) => {
      btnProcessFrequencyExcel instanceof HTMLButtonElement &&
        (btnProcessFrequencyExcel.disabled = !(event.target instanceof HTMLInputElement && event.target.files?.length));
    });

  btnProcessFrequencyExcel instanceof HTMLButtonElement &&
    btnProcessFrequencyExcel.addEventListener("click", () => {
      const file = frequencyExcelInput instanceof HTMLInputElement
        ? frequencyExcelInput.files?.[0]
        : null;
      if (!file) {
        return;
      }

      void (async () => {
        try {
          const jsonData = await readExcelRowsFromFile(file);
          if (jsonData.length < 2) {
            notify.warning("Excel dosyası boş veya başlık satırı yok.");
            return;
          }
          importedFrequencyExcelData = jsonData;
          renderFrequencyMappingUI(jsonData[0]);
          hide(frequencyImportStep1);
          show(frequencyImportStep2);
        } catch (error) {
          errorService.handle(error, {
            userMessage: "Frekans Excel dosyası okunurken bir hata oluştu.",
          });
        }
      })();
    });

  btnExecuteFrequencyImport instanceof HTMLButtonElement &&
    btnExecuteFrequencyImport.addEventListener("click", () => {
      void executeFrequencyImport();
    });

  // Import flow
  function openImportModal() {
    if (!importModalController) {
      return;
    }

    importModalController.onCloseCleanup(() => {
      importedExcelData = null;
      mappingContainer?.replaceChildren();
      setLoadingState(importLoadingOverlay, importLoadingText, false, "");
    });
    importModalController.open();
    show(importStep1);
    hide(importStep2);
    hide(importStep3);
    importExcelInput.value = "";
    btnProcessExcel.disabled = true;
    mappingContainer?.replaceChildren();
    importedExcelData = null;
  }
  importExcelInput &&
    importExcelInput.addEventListener("change", (e) => {
      btnProcessExcel.disabled = !e.target.files.length;
    });
  btnProcessExcel &&
    btnProcessExcel.addEventListener("click", () => {
      const file = importExcelInput.files[0];
      if (!file) return;
      void (async () => {
        try {
          const jsonData = await readExcelRowsFromFile(file);
          if (jsonData.length < 2) {
            notify.warning("Excel dosyası boş veya başlık satırı yok.");
            return;
          }
          importedExcelData = jsonData;
          renderMappingUI(jsonData[0]);
          hide(importStep1);
          show(importStep2);
        } catch (error) {
          errorService.handle(error, { userMessage: "Excel dosyası okunurken bir hata oluştu." });
        }
      })();
    });
  function renderMappingUI(headers) {
    mappingContainer?.replaceChildren();
    dbFields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "mapping-row";
      let selectedIndex = -1;
      const fieldLabelLower = field.label.toLowerCase(),
        fieldKeyLower = field.key.toLowerCase();
      headers.forEach((header, index) => {
        const headerLower = String(header).toLowerCase();
        if (
          headerLower.includes(fieldLabelLower) ||
          headerLower.includes(fieldKeyLower)
        ) {
          selectedIndex = index;
        }
        if (
          field.key === "bayiKodu" &&
          (headerLower.includes("kod") || headerLower.includes("bayi no"))
        ) {
          selectedIndex = index;
        }
        if (
          field.key === "bayiAdi" &&
          (headerLower.includes("ünvan") || headerLower.includes("ad"))
        ) {
          selectedIndex = index;
        }
        if (
          field.key === "yonetmen" &&
          (headerLower.includes("sorumlu") || headerLower.includes("yönetmen"))
        ) {
          selectedIndex = index;
        }
      });
      let optionsHtml = '<option value="-1">-- Sütun Seçin --</option>';
      headers.forEach((header, index) => {
        optionsHtml += `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${header}</option>`;
      });
      setSafeHtml(
        row,
        `
                <label class="excel-column-label">${field.label} ${field.required ? "*" : ""}</label>
                <i class="fas fa-arrow-right"></i>
                <select class="form-control db-field-select" data-key="${field.key}">
                    ${optionsHtml}
                </select>
              `,
      );
      mappingContainer.appendChild(row);
    });
    mappingContainer
      .querySelector('select[data-key="bayiKodu"]')
      .addEventListener("change", checkImportValidity);
    checkImportValidity();
  }
  function checkImportValidity() {
    const codeSelect = mappingContainer.querySelector(
        'select[data-key="bayiKodu"]',
      ),
      isValid = codeSelect && codeSelect.value !== "-1";
    setHidden(importWarning, isValid);
    btnExecuteImport && (btnExecuteImport.disabled = !isValid);
  }
  btnExecuteImport &&
    btnExecuteImport.addEventListener("click", async () => {
      const mappings = {};
      mappingContainer
        .querySelectorAll(".db-field-select")
        .forEach((select) => {
          mappings[select.dataset.key] = parseInt(select.value);
        });
      const globalUserId = importGlobalUserSelect.value,
        dataRows = importedExcelData.slice(1);
      show(importLoadingOverlay);
      importLoadingText.textContent = `0 / ${dataRows.length} kayıt işleniyor...`;
      let successCount = 0,
        updateCount = 0,
        errorCount = 0,
        errors = [];
      const existingBayiMap = new Map();
      allBayiler.forEach((b) =>
        existingBayiMap.set(String(b.bayiKodu).trim(), b),
      );
      const chunkSize = 50;
      for (let i = 0; i < dataRows.length; i += chunkSize) {
        const chunk = dataRows.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (row) => {
            const bayiKoduIndex = (mappings as Record<string, number>).bayiKodu,
              bayiKoduRaw = row[bayiKoduIndex];
            if (!bayiKoduRaw) {
              errorCount++;
              return;
            }
            const cleanDealerCode = String(bayiKoduRaw).trim(),
              bayiData: BayiImportPayload = { bayiKodu: cleanDealerCode };
            ["bayiAdi", "bolge", "sehir", "ilce", "yonetmen", "email"].forEach(
              (key) => {
                const colIdx = mappings[key];
                if (colIdx > -1) {
                  let val = row[colIdx] ? String(row[colIdx]).trim() : "";
                  if (
                    key === "bayiAdi" &&
                    val !== "" &&
                    val.startsWith(cleanDealerCode)
                  ) {
                    val = val.replace(cleanDealerCode, "").trim();
                  }
                  if (val !== "") {
                    bayiData[key] = val;
                  }
                }
              },
            );
            if (globalUserId) {
              bayiData.sorumlu_kullanici = globalUserId;
            }
            try {
              const existing = existingBayiMap.get(cleanDealerCode);
              if (existing) {
                await pb.collection("bayiler").update(existing.id, bayiData);
                updateCount++;
              } else {
                if (!bayiData.bayiAdi) {
                  bayiData.bayiAdi = cleanDealerCode;
                }
                await pb.collection("bayiler").create(bayiData);
                successCount++;
              }
            } catch (err) {
              errorCount++;
              const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
              errors.push(`${cleanDealerCode}: ${message}`);
            }
          }),
        );
        importLoadingText.textContent = `${Math.min(i + chunkSize, dataRows.length)} / ${dataRows.length} kayıt işlendi...`;
      }
      hide(importLoadingOverlay);
      importResultsArea.replaceChildren();
      const pre = document.createElement("pre");
      pre.textContent = [
        "İşlem Tamamlandı!",
        "-----------------",
        `Yeni Eklenen: ${successCount}`,
        `Güncellenen: ${updateCount}`,
        `Hatalı/Atlanan: ${errorCount}`,
        errors.length > 0
          ? `
Hata Detayları:
${errors.slice(0, 10).join("\n")}${errors.length > 10 ? "\n..." : ""}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      importResultsArea.appendChild(pre);
      hide(importStep2);
      show(importStep3);
      await loadModuleData();
    });

  // Bulk assignment
  function openBulkAssignModal() {
    bulkAssignModalController?.onCloseCleanup(() => {
      showBulkAssignLoading(false, "");
    });
    bulkAssignFilterBolge?.replaceChildren();
    bulkAssignFilterSehir?.replaceChildren();
    bulkAssignFilterYonetmen?.replaceChildren();
    bulkAssignTextInput.value = "";
    bulkAssignTypeSelect.value = "sorumlu_kullanici";
    const uniqueYonetmenler = [
      ...new Set(allBayiler.map((b) => b.yonetmen).filter(Boolean)),
    ].sort();
    let datalist = document.getElementById("manager-list");
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "manager-list";
      document.body.appendChild(datalist);
    }
    datalist.replaceChildren();
    uniqueYonetmenler.forEach((yon) => {
      const opt = document.createElement("option");
      opt.value = yon;
      datalist.appendChild(opt);
    });
    bulkAssignTextInput.setAttribute("list", "manager-list");
    function refreshBulkFilters() {
      const selBolge = getCheckedValues(bulkAssignFilterBolge),
        selSehir = getCheckedValues(bulkAssignFilterSehir),
        selYon = getCheckedValues(bulkAssignFilterYonetmen);
      let cityPool = allBayiler;
      if (selBolge.length > 0) {
        cityPool = cityPool.filter((b) => selBolge.includes(b.bolge));
      }
      const availableCities = [
        ...new Set(cityPool.map((b) => b.sehir).filter(Boolean)),
      ].sort();
      renderCheckboxList(
        bulkAssignFilterSehir,
        availableCities,
        selSehir,
        refreshBulkFilters,
      );
      let yonPool = cityPool;
      if (selSehir.length > 0) {
        yonPool = yonPool.filter((b) => selSehir.includes(b.sehir));
      }
      const availableYons = [
        ...new Set(yonPool.map((b) => b.yonetmen).filter(Boolean)),
      ].sort();
      renderCheckboxList(
        bulkAssignFilterYonetmen,
        availableYons,
        selYon,
        refreshBulkFilters,
      );
      if (selYon.length > 0) {
        bulkAssignOnlyUnassigned.checked = false;
      }
    }
    const allBolgeler = [
      ...new Set(allBayiler.map((b) => b.bolge).filter(Boolean)),
    ].sort();
    renderCheckboxList(
      bulkAssignFilterBolge,
      allBolgeler,
      [],
      refreshBulkFilters,
    );
    refreshBulkFilters();
    setSelectPlaceholder(
      bulkAssignUserSelect as HTMLSelectElement,
      "Seçiniz...",
    );
    allUsers.forEach((u) => {
      const o = document.createElement("option");
      o.value = u.id;
      o.textContent = u.name || u.email;
      bulkAssignUserSelect.appendChild(o);
    });
    show(bulkAssignUserContainer);
    hide(bulkAssignTextContainer);
    bulkAssignModalController?.open();
  }
  async function executeBulkAssign() {
    const type = bulkAssignTypeSelect.value,
      val =
        type === "sorumlu_kullanici"
          ? bulkAssignUserSelect.value
          : bulkAssignTextInput.value.trim();
    if (!val && type === "yonetmen") {
      notify.warning("Lütfen atanacak değeri yazın.");
      return;
    }
    if (type === "sorumlu_kullanici" && !val) {
      notify.warning("Lütfen bir kullanıcı seçin.");
      return;
    }
    const selBolge = getCheckedValues(bulkAssignFilterBolge),
      selSehir = getCheckedValues(bulkAssignFilterSehir),
      selYon = getCheckedValues(bulkAssignFilterYonetmen);
    let targets = allBayiler;
    if (selBolge.length > 0) {
      targets = targets.filter((b) => selBolge.includes(b.bolge));
    }
    if (selSehir.length > 0) {
      targets = targets.filter((b) => selSehir.includes(b.sehir));
    }
    if (selYon.length > 0) {
      targets = targets.filter((b) => selYon.includes(b.yonetmen));
    }
    if (bulkAssignOnlyUnassigned.checked) {
      targets = targets.filter((b) => !b[type]);
    }
    if (targets.length === 0) {
      notify.warning("Kriterlere uyan bayi bulunamadı.");
      return;
    }
    if (!confirm(`${targets.length} bayi güncellenecek. Onaylıyor musunuz?`)) {
      return;
    }
    showBulkAssignLoading(true, "Güncelleniyor...");
    await processInChunks(
      targets,
      20,
      async (b) => {
        const data = {};
        data[type] = val;
        try {
          await pb.collection("bayiler").update(b.id, data);
        } catch (e) {
          console.error(e);
        }
      },
      (done, total) => {
        bulkAssignLoadingText.textContent = `${done} / ${total} güncellendi...`;
      },
    );
    showBulkAssignLoading(false, "");
    bulkAssignModalController?.close();
    await loadModuleData();
    notify.success("Toplu güncelleme tamamlandı.");
  }
  function showBulkAssignLoading(s, t) {
    setLoadingState(bulkAssignLoadingOverlay, bulkAssignLoadingText, s, t);
  }
  function showLoading(show2) {
    setLoadingState(loadingSpinner, null, show2);
  }
  container.querySelector("#btn-yeni-bayi").addEventListener("click", () => {
    bayiForm.reset();
    bayiIdInput.value = "";
    modalTitle.textContent = "Yeni Bayi Ekle";
    senelikFrekansInput instanceof HTMLInputElement && (senelikFrekansInput.value = "");
    updateFrequencySummary("", "");
    bayiModalController?.open();
  });
  const bayiKoduInput = container.querySelector("#bayiKodu");
  bayiKoduInput instanceof HTMLInputElement &&
    bayiKoduInput.addEventListener("input", () => {
      updateFrequencySummary(
        bayiKoduInput.value,
        senelikFrekansInput instanceof HTMLInputElement
          ? senelikFrekansInput.value
          : "",
      );
    });
  senelikFrekansInput instanceof HTMLInputElement &&
    senelikFrekansInput.addEventListener("input", () => {
      updateFrequencySummary(
        bayiKoduInput instanceof HTMLInputElement ? bayiKoduInput.value : "",
        senelikFrekansInput.value,
      );
    });
  bayiForm.addEventListener("submit", handleFormSubmit);
  container
    .querySelector("#btn-view-selected")
    .addEventListener("click", applyColumnVisibility);
  container.querySelector("#btn-export-excel").addEventListener("pointerenter", () => {
  });
  container.querySelector("#btn-export-excel").addEventListener("click", async () => {
    const table = document.getElementById("bayi-table");
    if (!(table instanceof HTMLTableElement)) {
      notify.warning("Dışa aktarılacak tablo bulunamadı.");
      return;
    }
    await exportHtmlTableToExcel(table, "Bayi_Listesi.xlsx", "Bayiler");
  });
  scoreReportPickerToggle instanceof HTMLButtonElement &&
    scoreReportPickerToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (scoreReportPickerPanel instanceof HTMLElement) {
        const willOpen = scoreReportPickerPanel.hidden;
        scoreReportPickerPanel.hidden = !scoreReportPickerPanel.hidden;
        if (willOpen) {
          renderScoreReportStoreChecklist();
          scoreReportSearchInput instanceof HTMLInputElement &&
            scoreReportSearchInput.focus();
        }
      }
    });
  scoreReportPickerPanel instanceof HTMLElement &&
    scoreReportPickerPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  document.addEventListener("click", (event) => {
    if (
      !(scoreReportPicker instanceof HTMLElement) ||
      !(event.target instanceof Node)
    ) {
      return;
    }

    if (!scoreReportPicker.contains(event.target)) {
      closeScoreReportPicker();
    }
  });
  container
    .querySelector("#btn-open-score-report")
    ?.addEventListener("click", () => {
      void openScoreReport();
    });
  btnSelectAllScoreStores instanceof HTMLButtonElement &&
    btnSelectAllScoreStores.addEventListener(
      "click",
      selectAllScoreReportStores,
    );
  btnClearScoreStores instanceof HTMLButtonElement &&
    btnClearScoreStores.addEventListener(
      "click",
      clearScoreReportStoreSelection,
    );
  const handleScoreReportSearchChange = () => {
    if (!(scoreReportSearchInput instanceof HTMLInputElement)) {
      return;
    }

    scoreReportSearchTerm = scoreReportSearchInput.value || "";
    renderScoreReportStoreChecklist();
  };
  scoreReportSearchInput instanceof HTMLInputElement &&
    ["input", "keyup", "change", "search"].forEach((eventName) => {
      scoreReportSearchInput.addEventListener(
        eventName,
        handleScoreReportSearchChange,
      );
    });

  scoreReportStoreChecklist instanceof HTMLElement &&
    scoreReportStoreChecklist.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
        return;
      }

      const storeId = target.value;
      if (target.checked) {
        selectedScoreReportStoreIds.add(storeId);
      } else {
        selectedScoreReportStoreIds.delete(storeId);
      }
      updateScoreReportPickerLabel();
    });
  btnOpenImportModal &&
    btnOpenImportModal.addEventListener("click", openImportModal);
  btnOpenFrequencyImportModal &&
    btnOpenFrequencyImportModal.addEventListener(
      "click",
      openFrequencyImportModal,
    );
  const bindScoreFileInput = (
    input: Element | null,
    type: "dide" | "fide",
    successMessage: string,
    failureMessage: string,
  ) => {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.addEventListener("click", () => {
      input.value = "";
    });

    input.addEventListener("change", async (event) => {
      const success = await handleFileSelect(event, type);
      input.value = "";
      if (!success) {
        notify.warning(failureMessage);
        return;
      }

      scoreDataCache = null;
      await refreshScoreUploadStatus();
      notify.success(successMessage);
    });
  };

  bindScoreFileInput(
    scoreDideFileInput,
    "dide",
    "DiDe puan listesi güncellendi.",
    "DiDe Excel dosyası işlenemedi. Dosya yapısını kontrol edin.",
  );
  bindScoreFileInput(
    scoreFideFileInput,
    "fide",
    "FiDe puan listesi güncellendi.",
    "FiDe Excel dosyası işlenemedi. Dosya yapısını kontrol edin.",
  );
  btnDeleteDideExcel instanceof HTMLButtonElement &&
    btnDeleteDideExcel.addEventListener("click", async () => {
      if (!confirm("DiDe Excel puan verisi silinsin mi?")) {
        return;
      }

      try {
        await clearScoreExcelByType("dide");
      } catch (error) {
        errorService.handle(error, {
          userMessage: "DiDe Excel puan verisi silinemedi.",
        });
      }
    });
  btnDeleteFideExcel instanceof HTMLButtonElement &&
    btnDeleteFideExcel.addEventListener("click", async () => {
      if (!confirm("FiDe Excel puan verisi silinsin mi?")) {
        return;
      }

      try {
        await clearScoreExcelByType("fide");
      } catch (error) {
        errorService.handle(error, {
          userMessage: "FiDe Excel puan verisi silinemedi.",
        });
      }
    });
  btnOpenBulkAssignModal.addEventListener("click", openBulkAssignModal);
  btnExecuteBulkAssign.addEventListener("click", executeBulkAssign);
  bulkAssignTypeSelect.addEventListener("change", () => {
    const isUser = bulkAssignTypeSelect.value === "sorumlu_kullanici";
    setHidden(bulkAssignUserContainer, !isUser);
    setHidden(bulkAssignTextContainer, isUser);
  });
  void refreshScoreUploadStatus();
  updateFrequencySummary("", "");
  loadModuleData();
}

export { initializeBayiYoneticisiModule };
/*
TOTAL_LINES: 2348
HAS_PLACEHOLDERS: NO
OMITTED_ANY_CODE: NO
IS_THIS_THE_COMPLETE_FILE: YES
*/
