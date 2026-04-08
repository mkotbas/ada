import { appendIconText, escapeHtml, make, setSafeHtml } from "@core/dom";
import { notify } from "../../core/notify";
import { errorService } from "../../core/error";
import { showLoadingOverlay, hideLoadingOverlay } from "../../core/utils";
import { preloadExcelJs, readExcelRowsFromFile } from "../../core/exceljs";
import { setupSortableContainer } from "@core/sortable";

type ManagerQuestion = {
  id: number;
  displayNo?: number;
  title: string;
  isArchived: boolean;
  type: string;
  answerType: string;
  wantsStoreEmail: boolean;
  staticItems: string[];
  popCodes?: string[];
  expiredCodes?: string[];
  popEmailTo?: string[];
  popEmailCc?: string[];
  stylingData?: Array<{
    name: string;
    subCategories: Array<{
      name: string;
      products: Array<{
        code: string;
        name: string;
        qty: string;
        alternatives?: Array<{ code: string; name: string; qty: string }>;
      }>;
    }>;
  }>;
};
type ManagerOptions = {
  isNew?: boolean;
  onClear?: (qid?: string) => void;
  onCancel?: () => void;
};
type CategoryLike = { name?: string };
type ProductLike = {
  code?: string;
  name?: string;
  qty?: string;
  alternatives?: Array<{ code?: string; name?: string; qty?: string }>;
};

let fideQuestions = [],
  productList = [];
const fallbackFideQuestions = [
  {
    id: 0,
    type: "standard",
    title:
      "HATA: Sorular buluttan y\xFCklene\
medi.",
  },
];
let currentManagerView = "active",
  pbInstance = null,
  parsedExcelData = null,
  parsedProductExcelData = null;

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function normalizeProductCode(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "");
}

function normalizeExcelHeader(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function isAlternativeHeader(value) {
  return normalizeExcelHeader(value).includes("muadil");
}

function normalizeQuantityValue(value, fallback = "1") {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return fallback;
  }
  const normalizedNumber = rawValue
    .replace(/,/g, ".")
    .match(/\d+(?:\.\d+)?/);
  return normalizedNumber?.[0] || fallback;
}

function normalizeAlternativeProduct(item) {
  const code = String(item?.code || "").trim();
  const name = String(item?.name || "").trim();
  if (!code || !name) {
    return null;
  }
  const normalizedCode = normalizeProductCode(code);
  if (!normalizedCode) {
    return null;
  }
  return {
    code,
    name,
    qty: normalizeQuantityValue(item?.qty, "1"),
    normalizedCode,
  };
}

function mergeAlternativeProducts(existingAlternatives, incomingAlternatives) {
  const mergedAlternatives = [];
  const seenCodes = new Set();
  [...(existingAlternatives || []), ...(incomingAlternatives || [])].forEach((item) => {
    const normalizedAlternative = normalizeAlternativeProduct(item);
    if (!normalizedAlternative || seenCodes.has(normalizedAlternative.normalizedCode)) return;
    seenCodes.add(normalizedAlternative.normalizedCode);
    mergedAlternatives.push({
      code: normalizedAlternative.code,
      name: normalizedAlternative.name,
      qty: normalizedAlternative.qty,
    });
  });
  return mergedAlternatives;
}

function ensureAlternativeContainer(row) {
  let container = row.querySelector(".product-alternative-container-styling");
  if (container instanceof HTMLElement) return container;
  container = document.createElement("div");
  container.className = "product-alternative-container-styling";
  container.hidden = true;
  row.appendChild(container);
  return container;
}

function addProductAlternativeRow(container, alternativeData: ProductLike = {}) {
  const alternativeRow = document.createElement("div");
  alternativeRow.className = "product-alternative-row-styling";
  setSafeHtml(
    alternativeRow,
    `
      <input type="text" class="product-alternative-code-styling" placeholder="Muadil Ürün Kodu" value="${escapeHtml(String(alternativeData.code || ""))}">
      <input type="text" class="product-alternative-name-styling" placeholder="Muadil Ürün Adı" value="${escapeHtml(String(alternativeData.name || ""))}">
      <input type="number" class="product-alternative-qty-styling" placeholder="Adet" value="${escapeHtml(String(alternativeData.qty || "1"))}">
      <button class="btn-danger btn-sm btn-remove-alternative-row" title="Muadil Ürünü Sil" type="button"><i class="fas fa-trash"></i></button>
    `,
  );
  container.appendChild(alternativeRow);
  alternativeRow
    .querySelector(".btn-remove-alternative-row")
    ?.addEventListener("click", () => {
      alternativeRow.remove();
      if (!container.children.length) {
        container.hidden = true;
      }
    });
  return alternativeRow;
}

function getExistingStylingMainCategoryNames(container) {
  return Array.from(
    container.querySelectorAll(
      ".styling-list-editor-container .main-category-input",
    ) as NodeListOf<HTMLInputElement>,
  )
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function getMainCategoryMappingSelect(container, sourceKey) {
  return container.querySelector(
    `.main-category-target-select[data-source-key="${sourceKey}"]`,
  );
}

function resolveMappedMainCategoryName(container, excelMainCategoryName) {
  const normalizedSource = normalizeCategoryKey(excelMainCategoryName);
  if (!normalizedSource) {
    return String(excelMainCategoryName || "").trim();
  }
  const mappingSelect = getMainCategoryMappingSelect(container, normalizedSource);
  if (!(mappingSelect instanceof HTMLSelectElement)) {
    return String(excelMainCategoryName || "").trim();
  }
  const selectedValue = String(mappingSelect.value || "").trim();
  if (!selectedValue || selectedValue === "__same__" || selectedValue === "__new__") {
    return String(excelMainCategoryName || "").trim();
  }
  return selectedValue;
}
async function initializeSoruYoneticisiModule(pb) {
  (pbInstance = pb),
    await loadInitialData(),
    setupModuleEventListeners(),
    renderQuestionManager();
} // Data loading
async function loadInitialData() {
  let questionsLoaded = !1;
  if (!pbInstance || !pbInstance.authStore.isValid) {
    console.error(
      "Soru Yöneticisi: Yükleme işlemi durduruldu çünkü giriş geçerli değil.",
    ),
      (fideQuestions = fallbackFideQuestions);
    return;
  }
  try {
    const cloudData = (
      await pbInstance
        .collection("ayarlar")
        .getFirstListItem('anahtar="fideQuestionsData"')
    ).deger;
    (fideQuestions = cloudData.questions || []),
      (productList = cloudData.productList || []),
      (questionsLoaded = !0);
  } catch (error) {
    (error as { status?: number }).status !== 404 &&
      (console.error(
        "PocketBase'den soru verisi okunurken hata oluştu:",
        error,
      ),
      errorService.network(
        error,
        "Soru listesi yüklenemedi. Lütfen internet bağlantınızı kontrol edin.",
      ));
  }
  questionsLoaded || (fideQuestions = fallbackFideQuestions);
}
function setupModuleEventListeners() {

  const listenerKey = "soruYoneticisiListenersAttached";
  document.body.dataset[listenerKey] ||
    ((document.body.dataset[listenerKey] = "true"),
    document.getElementById("view-active-btn").addEventListener("click", () => {
      (currentManagerView = "active"), filterManagerView();
    }),
    document
      .getElementById("view-archived-btn")
      .addEventListener("click", () => {
        (currentManagerView = "archived"), filterManagerView();
      }),
    document
      .getElementById("add-new-question-btn")
      .addEventListener("click", addNewQuestionUI),
    document
      .getElementById("save-questions-btn")
      .addEventListener("click", () => {
        void saveQuestions();
      }),
    document
      .getElementById("delete-all-archived-btn")
      .addEventListener("click", deleteAllArchivedQuestions),
    document
      .getElementById("restore-all-archived-btn")
      .addEventListener("click", restoreAllArchivedQuestions),
    document.getElementById("unlock-ids-btn").addEventListener("click", () => {
      const authModel = pbInstance?.authStore?.model as { role?: string } | null;
      if (authModel?.role !== "admin") {
        notify.error("Bu işlem yalnızca yönetici hesabı ile açılabilir.");
        return;
      }
      if (
        !confirm(
          "Teknik ID alanlarını düzenlemek rapor eşleşmelerini etkileyebilir. Yalnızca zorunlu durumda devam edin.",
        )
      )
        return;
      document
        .querySelectorAll<HTMLInputElement>(".manager-id-input")
        .forEach((input) => {
          input.disabled = !1;
        });
      const unlockBtn = document.getElementById("unlock-ids-btn");
      if (unlockBtn) {
        unlockBtn.disabled = !0;
        appendIconText(
          unlockBtn,
          "fas fa-lock-open",
          "Teknik ID Alanları Düzenlenebilir",
        );
      }
      notify.info(
        "Teknik ID alanları yalnızca bu oturum için düzenlenebilir hale getirildi.",
      );
    }));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getQuestionDisplayNo(question) {
  const rawValue = Number(question?.displayNo);
  return Number.isInteger(rawValue) && rawValue > 0 ? rawValue : Number(question?.id || 0);
}

function getManagerItems() {
  return Array.from(
    document.querySelectorAll("#manager-list .manager-item:not(.to-be-deleted)"),
  ) as HTMLElement[];
}

function updateManagerItemDisplayNo(item, nextDisplayNo) {
  const displayNoValue = String(nextDisplayNo);
  item.dataset.displayNo = displayNoValue;
  const input = item.querySelector(".manager-display-no-input");
  input instanceof HTMLInputElement && (input.value = displayNoValue);
}

function getSequentialDisplayStart(items) {
  const firstItem = items.find((item) => !item.classList.contains("hidden-question")) || items[0] || null;
  if (!(firstItem instanceof HTMLElement)) return 1;
  const rawValue = Number(firstItem.querySelector<HTMLInputElement>(".manager-display-no-input")?.value || "");
  return Number.isInteger(rawValue) && rawValue > 0 ? rawValue : 1;
}

function syncQuestionDisplayNumbersWithCurrentOrder() {
  const managerItems = getManagerItems();
  const startNo = getSequentialDisplayStart(managerItems);
  managerItems.forEach((item, index) => {
    updateManagerItemDisplayNo(item, startNo + index);
  });
}

function setupQuestionManagerDragDrop(container) {
  setupSortableContainer(container, '.manager-item', {
    readyKey: 'questionManagerDragReady',
    handleSelector: '.question-drag-handle',
    itemFilter: (item) => !item.classList.contains('hidden-question'),
    onDragEnd: () => {
      syncQuestionDisplayNumbersWithCurrentOrder();
    },
  });
}



async function rollbackReportUpdates(snapshots) {
  if (!pbInstance || !pbInstance.authStore.isValid || !Array.isArray(snapshots) || snapshots.length === 0) {
    return;
  }
  for (const snapshot of [...snapshots].reverse()) {
    try {
      await pbInstance
        .collection("denetim_raporlari")
        .update(snapshot.id, { soruDurumlari: snapshot.originalSoruDurumlari });
    } catch (error) {
      console.error("Rapor geri alma işlemi başarısız oldu:", error);
    }
  }
}

async function applyReportUpdates(updateFunction, options: { message?: string; userMessage?: string; manageOverlay?: boolean } = {}) {
  const {
    message = "İşlem sürüyor, lütfen bekleyin...",
    userMessage = "Kritik Hata: Raporlardaki veriler güncellenemedi.",
    manageOverlay = !0,
  } = options;
  manageOverlay && showLoadingOverlay(message);
  const appliedSnapshots = [];
  try {
    if (!pbInstance || !pbInstance.authStore.isValid) {
      notify.info("Bu işlem için bulut bağlantısı gereklidir.");
      return { success: !1, snapshots: [] };
    }
    const allReports = await pbInstance
      .collection("denetim_raporlari")
      .getFullList({ fields: "id,soruDurumlari" });
    const pendingUpdates = [];
    for (const report of allReports) {
      const originalSoruDurumlari = isPlainObject(report.soruDurumlari)
        ? cloneJsonValue(report.soruDurumlari)
        : {};
      const nextSoruDurumlari = updateFunction(
        cloneJsonValue(originalSoruDurumlari),
        report,
      );
      if (
        JSON.stringify(nextSoruDurumlari) !==
        JSON.stringify(originalSoruDurumlari)
      ) {
        pendingUpdates.push({
          id: report.id,
          originalSoruDurumlari,
          nextSoruDurumlari,
        });
      }
    }
    for (const updateEntry of pendingUpdates) {
      await pbInstance
        .collection("denetim_raporlari")
        .update(updateEntry.id, { soruDurumlari: updateEntry.nextSoruDurumlari });
      appliedSnapshots.push({
        id: updateEntry.id,
        originalSoruDurumlari: updateEntry.originalSoruDurumlari,
      });
    }
    return { success: !0, snapshots: appliedSnapshots };
  } catch (error) {
    appliedSnapshots.length > 0 && (await rollbackReportUpdates(appliedSnapshots));
    console.error("Toplu rapor güncelleme sırasında bir hata oluştu:", error);
    errorService.handle(error, { userMessage });
    return { success: !1, snapshots: [] };
  } finally {
    manageOverlay && hideLoadingOverlay();
  }
}

function buildQuestionIdChangePlan(managerItems) {
  const knownQuestionIds = new Set(
    fideQuestions.map((question) => String(question.id)),
  );
  const currentOriginalIds = new Set<string>();
  const idMap = {};
  managerItems.forEach((item) => {
    const originalId = String(item.dataset.originalId || "").trim();
    const idInput = item.querySelector(".manager-id-input") as HTMLInputElement | null;
    const nextId = String(idInput?.value || "").trim();
    if (!originalId || !nextId) return;
    currentOriginalIds.add(originalId);
    idMap[originalId] = nextId;
  });
  const removedIds = Array.from(knownQuestionIds).filter(
    (questionId) => !currentOriginalIds.has(questionId),
  );
  const removedIdSet = new Set(removedIds);
  const hasChanges =
    removedIds.length > 0 ||
    Object.entries(idMap).some(([oldId, nextId]) => oldId !== nextId);
  return {
    hasChanges,
    idMap,
    knownQuestionIds,
    removedIds,
    removedIdSet,
  };
}

function remapQuestionStatusMap(questionStatusMap, plan) {
  const source = isPlainObject(questionStatusMap) ? questionStatusMap : {};
  const nextStatusMap = {};
  let changed = !1;

  Object.entries(source).forEach(([questionId, questionState]) => {
    if (!plan.knownQuestionIds.has(String(questionId))) {
      nextStatusMap[questionId] = questionState;
      return;
    }
    if (plan.removedIdSet.has(String(questionId))) {
      changed = !0;
      return;
    }
    const nextId = String(plan.idMap[questionId] || questionId);
    nextId !== String(questionId) && (changed = !0);
    nextStatusMap[nextId] = questionState;
  });

  return { changed, nextStatusMap };
}


async function deleteAllAnswersForQuestion(questionId) {
  const qTitleEl = document.querySelector(
      `.manager-item[data-id="${questionId}"] .question-title-input`,
    ),
    qTitle = qTitleEl
      ? qTitleEl.value
      : "Bilinmeyen Soru";
  if (
    !confirm(`FiDe ${questionId} ("${qTitle}") sorusuna ait TÜM cevapları BÜTÜN raporlardan kalıcı olarak silmek istediğinizden emin misiniz?`)
  )
    return;
  const result = await applyReportUpdates(
    (sd) => {
      sd && sd[questionId] && delete sd[questionId];
      return sd;
    },
    {
      userMessage: "Kritik Hata: Raporlardaki cevaplar güncellenemedi.",
    },
  );
  result.success &&
    notify.info(`FiDe ${questionId} sorusuna ait tüm cevaplar silindi.`);
}

async function saveQuestions(reloadPage = !0) {
  if (!pbInstance || !pbInstance.authStore.isValid) {
    notify.info("Kaydetmek için giriş yapın.");
    return;
  }
  const newProductList = [],
    activeProductManager = document.querySelector(".product-list-manager");
  syncQuestionDisplayNumbersWithCurrentOrder();
  if (activeProductManager && activeProductManager.offsetParent !== null) {
    const editor = activeProductManager.querySelector('.product-list-editor');
    if (editor instanceof HTMLElement) {
      Array.from(editor.children).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.classList.contains('product-category-group')) {
          const nameInput = node.querySelector('.category-manager-row input');
          const categoryName = String(nameInput instanceof HTMLInputElement ? nameInput.value : '').trim();
          if (!categoryName) return;
          newProductList.push({ type: 'header', name: categoryName });
          node.querySelectorAll(':scope > .product-category-products > .product-manager-row').forEach((row) => {
            const codeInput = row.querySelector('.product-code');
            const nameField = row.querySelector('.product-name');
            const qtyField = row.querySelector('.product-qty');
            const code = String(codeInput instanceof HTMLInputElement ? codeInput.value : '').trim();
            const name = String(nameField instanceof HTMLInputElement ? nameField.value : '').trim();
            const qty = String(qtyField instanceof HTMLInputElement ? qtyField.value : '').trim();
            if (code && name) newProductList.push({ type: 'item', code, name, qty: qty || '' });
          });
          return;
        }
        if (node.classList.contains('product-manager-row')) {
          const codeInput = node.querySelector('.product-code');
          const nameField = node.querySelector('.product-name');
          const qtyField = node.querySelector('.product-qty');
          const code = String(codeInput instanceof HTMLInputElement ? codeInput.value : '').trim();
          const name = String(nameField instanceof HTMLInputElement ? nameField.value : '').trim();
          const qty = String(qtyField instanceof HTMLInputElement ? qtyField.value : '').trim();
          if (code && name) newProductList.push({ type: 'item', code, name, qty: qty || '' });
        }
      });
    }
  } else Object.assign(newProductList, productList);
  const newQuestions = [],
    ids = new Set(),
    displayNos = new Set(),
    managerItems = getManagerItems();
  let hasError = !1;
  managerItems.forEach((item) => {
    const id = parseInt(
        item.querySelector<HTMLInputElement>(".manager-id-input")?.value || "",
        10,
      ),
      displayNo = parseInt(
        item.querySelector<HTMLInputElement>(".manager-display-no-input")?.value || "",
        10,
      ),
      title = String(
        item.querySelector<HTMLInputElement>(".question-title-input")?.value || "",
      ).trim();
    if (hasError) return;
    const originalId = String(item.dataset.originalId || "").trim();
    const originalQuestion = fideQuestions.find(
      (fq) => String(fq.id) === originalId,
    ) || {};
    if (!id || !displayNo || !title)
      return (
        (hasError = !0),
        notify.info("FiDe No, Teknik ID veya Başlık boş olamaz.")
      );
    if (ids.has(id))
      return (
        (hasError = !0),
        notify.info(`HATA: ${id} ID'si mükerrer kullanılmış.`)
      );
    ids.add(id);
    if (displayNos.has(displayNo))
      return (
        (hasError = !0),
        notify.info(`HATA: ${displayNo} FiDe numarası mükerrer kullanılmış.`)
      );
    displayNos.add(displayNo);
    const q: ManagerQuestion = {
      id,
      displayNo,
      title,
      isArchived: item.querySelector<HTMLInputElement>(".archive-checkbox")?.checked || !1,
      type: item.querySelector<HTMLSelectElement>(".question-type-select")?.value || "standard",
      answerType: item.querySelector<HTMLSelectElement>(".answer-type-select")?.value || "variable",
      wantsStoreEmail: item.querySelector<HTMLInputElement>(".wants-email-checkbox")?.checked || !1,
      staticItems: String(
        item.querySelector<HTMLElement>(".editable-textarea")?.innerHTML || "",
      )
        .split(/<br\s*\/?>/gi)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    q.type === "pop_system"
      ? ((q.popCodes = (item.querySelector<HTMLTextAreaElement>(".pop-codes-input")?.value || "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)),
        (q.expiredCodes = (
          item.querySelector<HTMLTextAreaElement>(".expired-pop-codes-input")?.value || ""
        )
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)),
        (q.popEmailTo = (
          item.querySelector<HTMLTextAreaElement>(".pop-email-to-input")?.value || ""
        )
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)),
        (q.popEmailCc = (
          item.querySelector<HTMLTextAreaElement>(".pop-email-cc-input")?.value || ""
        )
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)))
      : q.type === "styling_list"
        ? ((q.stylingData = []),
          item
            .querySelectorAll(
              ".styling-list-editor-container > .main-category-row",
            )
            .forEach((mainRow) => {
              const mainCategoryName = mainRow
                .querySelector<HTMLInputElement>(".main-category-input")
                ?.value.trim();
              if (!mainCategoryName) return;
              const mainCat = { name: mainCategoryName, subCategories: [] };
              mainRow
                .querySelectorAll(
                  ".sub-category-container > .sub-category-row",
                )
                .forEach((subRow) => {
                  const subCategoryName = subRow
                    .querySelector<HTMLInputElement>(".sub-category-input")
                    ?.value.trim();
                  if (!subCategoryName) return;
                  const subCat = { name: subCategoryName, products: [] };
                  subRow
                    .querySelectorAll(
                      ".product-container-styling > .product-row-styling",
                    )
                    .forEach((productRow) => {
                      const productCode = productRow
                          .querySelector<HTMLInputElement>(".product-code-styling")
                          ?.value.trim(),
                        productName = productRow
                          .querySelector<HTMLInputElement>(".product-name-styling")
                          ?.value.trim(),
                        productQty = productRow
                          .querySelector<HTMLInputElement>(".product-qty-styling")
                          ?.value.trim();
                      if (productCode && productName) {
                        const alternatives = Array.from(
                          productRow.querySelectorAll(
                            ".product-alternative-container-styling > .product-alternative-row-styling",
                          ),
                        )
                          .map((alternativeRow) =>
                            normalizeAlternativeProduct({
                              code:
                                alternativeRow
                                  .querySelector<HTMLInputElement>(
                                    ".product-alternative-code-styling",
                                  )
                                  ?.value.trim() || "",
                              name:
                                alternativeRow
                                  .querySelector<HTMLInputElement>(
                                    ".product-alternative-name-styling",
                                  )
                                  ?.value.trim() || "",
                              qty:
                                alternativeRow
                                  .querySelector<HTMLInputElement>(
                                    ".product-alternative-qty-styling",
                                  )
                                  ?.value.trim() || "1",
                            }),
                          )
                          .filter(Boolean)
                          .map(({ code, name, qty }) => ({ code, name, qty }));
                        subCat.products.push({
                          code: productCode,
                          name: productName,
                          qty: normalizeQuantityValue(productQty, "1"),
                          ...(alternatives.length > 0 ? { alternatives } : {}),
                        });
                      }
                    }),
                    subCat.products.length > 0 &&
                      mainCat.subCategories.push(subCat);
                }),
                mainCat.subCategories.length > 0 &&
                  q.stylingData.push(mainCat);
            }))
        : originalQuestion.type === "styling_list" &&
          originalQuestion.stylingData &&
          (q.stylingData = originalQuestion.stylingData),
      newQuestions.push(q);
  });
  if (hasError) return;
  newQuestions.sort((a, b) => getQuestionDisplayNo(a) - getQuestionDisplayNo(b) || a.id - b.id);
  const finalJsonData = {
    questions: newQuestions,
    productList: newProductList,
  };
  const questionIdPlan = buildQuestionIdChangePlan(managerItems);
  showLoadingOverlay("Değişiklikler kaydediliyor...");
  let reportRollbackSnapshots = [];
  try {
    if (questionIdPlan.hasChanges) {
      const reportUpdateResult = await applyReportUpdates(
        (questionStatusMap) =>
          remapQuestionStatusMap(questionStatusMap, questionIdPlan).nextStatusMap,
        {
          manageOverlay: !1,
          userMessage:
            "Kritik Hata: Soru sırası kaydedilirken bayi cevapları taşınamadı.",
        },
      );
      if (!reportUpdateResult.success) return;
      reportRollbackSnapshots = reportUpdateResult.snapshots;
    }
    try {
      const record = await pbInstance
        .collection("ayarlar")
        .getFirstListItem('anahtar="fideQuestionsData"');
      await pbInstance
        .collection("ayarlar")
        .update(record.id, { deger: finalJsonData });
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        await pbInstance
          .collection("ayarlar")
          .create({ anahtar: "fideQuestionsData", deger: finalJsonData });
      } else {
        throw error;
      }
    }
    fideQuestions = newQuestions;
    productList = newProductList;
    reloadPage
      ? (notify.info("Değişiklikler kaydedildi. Sayfa yenileniyor."),
        window.location.reload())
      : notify.info("Değişiklikler kaydedildi.");
  } catch (error) {
    reportRollbackSnapshots.length > 0 &&
      (await rollbackReportUpdates(reportRollbackSnapshots));
    console.error("Kaydederken hata oluştu:", error);
    errorService.handle(error, {
      userMessage: "Kaydetme işlemi sırasında bir hata oluştu.",
    });
  } finally {
    hideLoadingOverlay();
  }
}

const QUESTION_TYPE_OPTIONS = [
    "standard",
    "product_list",
    "pop_system",
    "styl\
ing_list",
  ],
  TOOLBAR_HTML =
    '<button data-command="bold"><i class="fas fa-bold"></i></button><button data-command="italic"><i class="fas fa-ital\
ic"></i></button><button data-command="underline"><i class="fas fa-underline"></i></button><button data-command="link"><i class="fas fa-link\
"></i></button>';

// Manager rendering helpers
function optionHtml(value, label, selectedValue) {
  return `<option value="${value}" ${selectedValue === value ? "selected" : ""}>${label}\
</option>`;
}
function boolAttr(value) {
  return value ? "checked" : "";
}
function questionTypeOptions(selectedType) {
  return QUESTION_TYPE_OPTIONS.map((type) =>
    optionHtml(type, type, selectedType),
  ).join("");
}
function answerTypeOptions(selectedType = "variable") {
  return [
    optionHtml("variable", "De\u011Fi\u015Fken", selectedType),
    optionHtml("fixed", "Sabit", selectedType),
  ].join("");
}
function managerSwitchHtml(label, className, checked, green = !1) {
  return `<div class="archive-s\
witch-container"><label>${label}</label><label class="switch"><input type="checkbox" class="${className}" ${boolAttr(checked)}><span class="\
slider${green ? " green" : ""}"></span></label></div>`;
}
function managerItemHtml(question, opts: ManagerOptions = {}) {
  const idInputAttrs = opts.isNew ? "" : " disabled",
    titleValue = opts.isNew ? "" : escapeHtml(question.title || ""),
    titleAttr = opts.isNew
      ? ' placeholder="Yeni soru..."'
      : ` value="${titleValue}"`,
    staticItemsHtml = (question.staticItems || []).join("<br>"),
    displayNo = getQuestionDisplayNo(question),
    footerHtml = opts.isNew
      ? '<button class="btn-sm btn-cancel-new-question"><i class="fas fa-times"></i> İptal</button>'
      : `<button class="btn-warning btn-sm btn-clear-answers" data-qid="${question.id}"><i class="fas fa-eraser"></i>Cevapları Temizle</button>`;
  return `<div class="manager-item-grid"><div class="manager-item-controls"><button class="manager-collapse-toggle" type="button" title="Detayları Göster/Gizle" aria-expanded="false"><i class="fas fa-chevron-right"></i></button><button class="question-drag-handle" type="button" title="Bu soruyu sürükleyip yeni sıraya taşıyın"><i class="fas fa-grip-vertical"></i></button></div><div><label>FiDe No</label><input type="number" min="1" step="1" class="manager-display-no-input" value="${displayNo}"></div><div><label>Teknik ID</label><input type="number" class="manager-id-input" value="${question.id}"${idInputAttrs}></div><div class="manager-title-field"><label>Soru Başlığı</label><input type="text" class="question-title-input"${titleAttr}></div><div class="manager-expanded-only"><label>Soru Tipi</label><select class="question-type-select">${questionTypeOptions(question.type || "standard")}</select></div><div class="manager-expanded-only"><label>Cevap Tipi</label><select class="answer-type-select">${answerTypeOptions(question.answerType || "variable")}</select></div><div class="manager-grid-switch-group manager-expanded-only">${managerSwitchHtml("E-posta Ekle", "wants-email-checkbox", !!question.wantsStoreEmail, !0)}${managerSwitchHtml(
    "Arşivle",
    "archive-checkbox",
    !!question.isArchived,
  )}</div></div><div class="manager-item-details"><div><label>Statik Maddeler</label><div class="editor-toolbar">${TOOLBAR_HTML}</div><div class="editable-textarea" contenteditable="true">${staticItemsHtml}</div></div><div class="special-manager-container"></div><div class="manager-item-footer">${footerHtml}</div></div>`;
}

function setManagerItemCollapsedState(item, shouldCollapse) {
  item.classList.toggle("is-collapsed", shouldCollapse);
  const toggleBtn = item.querySelector(".manager-collapse-toggle");
  const toggleIcon = toggleBtn?.querySelector("i");
  const details = item.querySelector(".manager-item-details");
  toggleBtn instanceof HTMLButtonElement &&
    toggleBtn.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
  toggleIcon instanceof HTMLElement &&
    (toggleIcon.className = shouldCollapse ? "fas fa-chevron-right" : "fas fa-chevron-down");
  details instanceof HTMLElement && (details.hidden = shouldCollapse);
}

function bindManagerItemEvents(item, options: ManagerOptions = {}) {
  item
    .querySelector(".manager-collapse-toggle")
    ?.addEventListener("click", () => {
      setManagerItemCollapsedState(item, !item.classList.contains("is-collapsed"));
    }),
    item
      .querySelector(".question-type-select")
      .addEventListener("change", (e) => toggleSpecialManagerUI(e.currentTarget)),
    item
      .querySelector(".manager-display-no-input")
      ?.addEventListener("input", (e) => {
        const nextValue = Number((e.currentTarget as HTMLInputElement | null)?.value || "");
        if (!Number.isInteger(nextValue) || nextValue < 1) return;
        updateManagerItemDisplayNo(item, nextValue);
      }),
    item
      .querySelector(".manager-id-input")
      ?.addEventListener("input", (e) => {
        const nextValue = String((e.currentTarget as HTMLInputElement | null)?.value || "").trim();
        if (!nextValue) return;
        item.dataset.id = nextValue;
        const clearBtn = item.querySelector(".btn-clear-answers");
        clearBtn instanceof HTMLElement && (clearBtn.dataset.qid = nextValue);
      }),
    item
      .querySelector(".archive-checkbox")
      .addEventListener("change", filterManagerView),
    item.querySelectorAll(".editor-toolbar button").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        formatText(e.currentTarget, e.currentTarget.dataset.command),
      );
    }),
    options.onClear &&
      item
        .querySelector(".btn-clear-answers")
        ?.addEventListener("click", (e) =>
          options.onClear?.(
            (e.currentTarget as HTMLElement | null)?.dataset.qid,
          ),
        ),
    options.onCancel &&
      item
        .querySelector(".btn-cancel-new-question")
        ?.addEventListener("click", (e) =>
          e.currentTarget.closest(".manager-item").remove(),
        );
}
function popManagerFieldHtml(label, className, value, placeholder = "") {
  const placeholderAttr = placeholder ? ` placeholder="${placeholder}"` : "";
  return `\
<div class="pop-manager-group"><label>${label}</label><textarea class="${className}" rows="5"${placeholderAttr}>${escapeHtml(value)}</textar\
ea></div>`;
}
function buildProductCategoryOptions() {
  return productList
    .filter((item) => item.type === "header")
    .reduce(
      (html, category) => `${html}<opt\
ion value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`,
      '<option value="__end">Ana Liste (Sona Ekle)</option>',
    );
}
function getExistingProductCategoryNames(editor) {
  return Array.from(
    editor.querySelectorAll('.category-manager-row input') as NodeListOf<HTMLInputElement>,
  )
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
}

function getExistingProductCategoryNameMap(editor) {
  return getExistingProductCategoryNames(editor).reduce((map, name) => {
    map.set(normalizeCategoryKey(name), name);
    return map;
  }, new Map<string, string>());
}

function getProductExcelCategoryNames(data, categoryIndex) {
  if (!Array.isArray(data) || categoryIndex === -1) {
    return [];
  }
  return Array.from(
    new Set(
      data
        .slice(1)
        .map((row) => String(row?.[categoryIndex] || '').trim())
        .filter(Boolean),
    ),
  );
}

function getPendingProductCategoryMapping(container) {
  const sourceSelect = container.querySelector('.product-excel-category-select');
  const targetSelect = container.querySelector('.product-category-target-single-select');
  if (!(sourceSelect instanceof HTMLSelectElement) || !(targetSelect instanceof HTMLSelectElement)) {
    return { sourceName: '', targetName: '' };
  }
  return {
    sourceName: String(sourceSelect.value || '').trim(),
    targetName: String(targetSelect.value || '').trim(),
  };
}

function resolveMappedProductCategoryName(container, excelCategoryName, existingCategoryMap = null) {
  const normalizedSource = normalizeCategoryKey(excelCategoryName);
  if (!normalizedSource) {
    return '';
  }
  const mappingRow = container.querySelector(
    `.product-category-map-chip[data-source-key="${normalizedSource}"]`,
  );
  if (mappingRow instanceof HTMLElement) {
    const selectedValue = String(mappingRow.dataset.targetValue || '').trim();
    if (selectedValue) {
      return selectedValue;
    }
  }
  const pendingMapping = getPendingProductCategoryMapping(container);
  if (normalizeCategoryKey(pendingMapping.sourceName) === normalizedSource && pendingMapping.targetName) {
    return pendingMapping.targetName;
  }
  if (existingCategoryMap instanceof Map) {
    return existingCategoryMap.get(normalizedSource) || '';
  }
  return '';
}

function buildProductCategoryTargetOptions(existingNames, sourceName, selectedValue = '') {
  const normalizedSource = normalizeCategoryKey(sourceName);
  let optionsHtml = '<option value="">-- Sistem kategorisi seçin --</option>';
  existingNames.forEach((existingName) => {
    const isSelected = selectedValue
      ? selectedValue === existingName
      : normalizeCategoryKey(existingName) === normalizedSource;
    optionsHtml += `<option value="${escapeHtml(existingName)}"${isSelected ? ' selected' : ''}>${escapeHtml(existingName)}</option>`;
  });
  return optionsHtml;
}

function renderSelectedProductCategoryMappingState(container) {
  const sourceSelect = container.querySelector('.product-excel-category-select');
  const targetSelect = container.querySelector('.product-category-target-single-select');
  const editor = container.querySelector('.product-list-editor');
  if (!(sourceSelect instanceof HTMLSelectElement) || !(targetSelect instanceof HTMLSelectElement) || !(editor instanceof HTMLElement)) {
    return;
  }
  const sourceName = String(sourceSelect.value || '').trim();
  const existingNames = getExistingProductCategoryNames(editor);
  if (!sourceName || !existingNames.length) {
    targetSelect.innerHTML = '<option value="">-- Önce mevcut kategori oluşturun --</option>';
    return;
  }
  const normalizedSource = normalizeCategoryKey(sourceName);
  const existingChip = container.querySelector(
    `.product-category-map-chip[data-source-key="${normalizedSource}"]`,
  );
  const selectedValue = existingChip instanceof HTMLElement ? String(existingChip.dataset.targetValue || '').trim() : '';
  targetSelect.innerHTML = buildProductCategoryTargetOptions(existingNames, sourceName, selectedValue);
}

function buildProductCategoryMappingSummaryRow(sourceName, targetValue) {
  const normalizedSource = normalizeCategoryKey(sourceName);
  return `
    <div class="mapping-row product-category-map-chip" data-source-key="${escapeHtml(normalizedSource)}" data-target-value="${escapeHtml(targetValue || '')}">
      <label>${escapeHtml(sourceName)}</label>
      <div>
        <input type="text" value="${escapeHtml(targetValue || '')}" disabled>
        <small><i>Bu Excel kategorisindeki ürünler yalnızca seçtiğiniz mevcut sistem kategorisine aktarılır.</i></small>
      </div>
      <button type="button" class="btn-danger btn-sm btn-remove-product-category-map" title="Eşleştirmeyi sil"><i class="fas fa-trash"></i></button>
    </div>
  `;
}

function addOrUpdateSelectedProductCategoryMapping(container) {
  const sourceSelect = container.querySelector('.product-excel-category-select');
  const targetSelect = container.querySelector('.product-category-target-single-select');
  const matchList = container.querySelector('.product-category-match-list');
  if (!(sourceSelect instanceof HTMLSelectElement) || !(targetSelect instanceof HTMLSelectElement) || !(matchList instanceof HTMLElement)) {
    return;
  }
  const sourceName = String(sourceSelect.value || '').trim();
  if (!sourceName) {
    notify.info('Lütfen önce Excel kategorisini seçin.');
    return;
  }
  const targetValue = String(targetSelect.value || '').trim();
  if (!targetValue) {
    notify.info('Lütfen mevcut bir sistem kategorisi seçin. Excel aktarımı yeni kategori oluşturmaz.');
    return;
  }
  const normalizedSource = normalizeCategoryKey(sourceName);
  const existingRow = matchList.querySelector(`.product-category-map-chip[data-source-key="${normalizedSource}"]`);
  const rowHtml = buildProductCategoryMappingSummaryRow(sourceName, targetValue);
  if (existingRow instanceof HTMLElement) {
    existingRow.insertAdjacentHTML('afterend', rowHtml);
    existingRow.remove();
  } else {
    matchList.insertAdjacentHTML('beforeend', rowHtml);
  }
  matchList.querySelectorAll('.btn-remove-product-category-map').forEach((button) => {
    if ((button as HTMLElement).dataset.listenerAttached === 'true') return;
    (button as HTMLElement).dataset.listenerAttached = 'true';
    button.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement | null)?.closest('.product-category-map-chip')?.remove();
      renderSelectedProductCategoryMappingState(container);
    });
  });
  renderSelectedProductCategoryMappingState(container);
}

function updateExistingProductCategoryMappingUI(container) {
  const mappingSection = container.querySelector('.product-existing-category-mapping');
  const sourceSelect = container.querySelector('.product-excel-category-select');
  const targetSelect = container.querySelector('.product-category-target-single-select');
  const matchList = container.querySelector('.product-category-match-list');
  const categorySelect = container.querySelector('.product-mapper-select[data-map="category"]');
  const manualCategoryInput = container.querySelector('.bulk-product-category-name');
  const editor = container.querySelector('.product-list-editor');
  if (
    !(mappingSection instanceof HTMLElement) ||
    !(sourceSelect instanceof HTMLSelectElement) ||
    !(matchList instanceof HTMLElement)
  ) {
    return;
  }
  sourceSelect.replaceChildren();
  matchList.replaceChildren();
  if (!(categorySelect instanceof HTMLSelectElement) || !(editor instanceof HTMLElement)) {
    mappingSection.hidden = true;
    return;
  }
  const existingNames = getExistingProductCategoryNames(editor);
  const categoryIndex = parseInt(categorySelect.value, 10);
  if (!parsedProductExcelData || Number.isNaN(categoryIndex)) {
    mappingSection.hidden = true;
    return;
  }
  if (categoryIndex === -1) {
    if (!(targetSelect instanceof HTMLSelectElement) || !existingNames.length) {
      mappingSection.hidden = true;
      return;
    }
    sourceSelect.add(new Option('Tek Kategori Aktarımı', '__manual__'));
    const normalizedManualCategory = normalizeCategoryKey(
      manualCategoryInput instanceof HTMLInputElement ? manualCategoryInput.value : '',
    );
    const preselectedTarget = existingNames.find(
      (existingName) => normalizeCategoryKey(existingName) === normalizedManualCategory,
    );
    targetSelect.innerHTML = buildProductCategoryTargetOptions(
      existingNames,
      '',
      preselectedTarget || '',
    );
    mappingSection.hidden = false;
    return;
  }
  const excelCategoryNames = getProductExcelCategoryNames(parsedProductExcelData, categoryIndex);
  if (!excelCategoryNames.length) {
    mappingSection.hidden = true;
    return;
  }
  excelCategoryNames.forEach((sourceName) => {
    sourceSelect.add(new Option(sourceName, sourceName));
  });
  renderSelectedProductCategoryMappingState(container);
  mappingSection.hidden = false;
}

function makeManagerRow(className, type, html, target = null) {
  const row = document.createElement("div");
  return (
    (row.className = className),
    (row.dataset.type = type),
    (row.draggable = !0),
    setSafeHtml(row, html),
    row.querySelector(".btn-remove-row")?.addEventListener("click", (e) => {
      const button = e.currentTarget as HTMLElement | null;
      button?.parentElement?.remove();
    }),
    { row, target }
  );
}
// Manager views
// Manager views
function formatText(b, c) {
  if (
    (b
      .closest(
        ".manage\
r-item",
      )
      .querySelector(".editable-textarea")
      .focus(),
    c === "link")
  ) {
    const s = window.getSelection();
    if (!s.rangeCount) return;
    const a = s.anchorNode,
      l =
        a.nodeType === 3
          ? (a.parentNode as Element | null)?.closest("a")
          : (a as Element).closest("a");
    if (l) {
      const u = l.getAttribute("href"),
        n = prompt("K\xF6pr\xFCy\xFC d\xFCzenle:", u);
      if (n === null) return;
      n === "" ? (l.outerHTML = l.innerHTML) : (l.href = n);
    } else {
      if (s.toString().length === 0) {
        notify.info("L\xFCtfen metin se\xE7in.");
        return;
      }
      const u = prompt("URL girin:", "https://");
      if (u) {
        document.execCommand("createLink", !1, u);
        const n = (s.anchorNode?.parentNode as Element | null)?.closest("a");
        n && (n.target = "_blank");
      }
    }
  } else document.execCommand(c, !1, null);
}
function renderQuestionManager() {
  const m = document.getElementById("manager-list");
  m &&
    (m.replaceChildren(),
    fideQuestions
      .sort((a, b) => getQuestionDisplayNo(a) - getQuestionDisplayNo(b) || a.id - b.id)
      .forEach((q) => {
        const d = document.createElement("div");
        (d.className = "manager-item"),
          (d.dataset.id = String(q.id)),
          (d.dataset.originalId = String(q.id)),
          (d.dataset.displayNo = String(getQuestionDisplayNo(q))),
          (d.draggable = !0),
          setSafeHtml(d, managerItemHtml(q)),
          m.appendChild(d),
          bindManagerItemEvents(d, { onClear: deleteAllAnswersForQuestion }),
          setManagerItemCollapsedState(d, !0),
          toggleSpecialManagerUI(
            d.querySelector(
              ".question-type-select",
            ),
          );
      }),
    setupQuestionManagerDragDrop(m),
    filterManagerView());
}

function toggleSpecialManagerUI(s) {
  const m = s.closest(".manager-item"),
    c = m.querySelector(
      ".special-manager-co\
ntainer",
    ),
    q = fideQuestions.find((q2) => String(q2.id) === String(m.dataset.originalId || m.dataset.id)) || {};
  c.replaceChildren(),
    s.value === "product_list"
      ? (c.classList.add(
          "product-\
list-manager",
        ),
        renderProductManagerUI(c))
      : s.value === "pop_system"
        ? (c.classList.add("pop-manager-container"), renderPopManagerUI(c, q))
        : s.value === "styling_list"
          ? (c.classList.add("styling-list-manager-container"),
            renderStylingListManagerUI(c, q))
          : (c.className = "special-manager-container");
}
function renderPopManagerUI(c, d) {
  const p = (d.popCodes || []).join(", "),
    e = (d.expiredCodes || []).join(", "),
    t = (d.popEmailTo || []).join(", "),
    cc = (d.popEmailCc || []).join(", ");
  setSafeHtml(
    c,
    `<p class="pop-manager-info"><i class="fas fa-info-circle"></i> Kodlar\u0131 ve e-posta adreslerini aralar\u0131na virg\xFCl (,) koyarak girin.</p><div\
 class="pop-manager-grid">${popManagerFieldHtml("Ge\xE7erli POP Kodlar\u0131", "pop-codes-input", p)}${popManagerFieldHtml(
   "S\xFCresi Dolmu\u015F POP \
Kodlar\u0131",
   "expired-pop-codes-input",
   e,
 )}${popManagerFieldHtml(
   "POP E-posta Al\u0131c\u0131lar\u0131 (Kime)",
   "pop-email-to-input",
   t,
   "ornek\
1@mail.com...",
 )}${popManagerFieldHtml("POP E-posta Al\u0131c\u0131lar\u0131 (CC)", "pop-email-cc-input", cc, "ornek2@mail.com...")}</div>`,
  );
}
function renderStylingListManagerUI(container, questionData) {
  const fileInputId = `styling-file-input-${container.closest(".manager-item").dataset.id}`;
  setSafeHtml(
    container,
    `
        <h4><i class="fas fa-sitemap"></i> Styling Listesi Y\xF6neticisi</h4>
        <p class="product-manager-info">
            <i class="fas fa-info-circle"></i> 3 katmanl\u0131 hiyerar\u015Fik yap\u0131y\u0131 y\xF6netin veya Excel'den toplu veri y\xFCkleyin.
        </p>
        
        <div class="bulk-add-container bulk-add-styling">
            <h5><i class="fas fa-file-excel"></i> Ak\u0131ll\u0131 Toplu Y\xFCkleme Sihirbaz\u0131 (Excel)</h5>
            
            <p class="bulk-add-info bulk-add-info-styling">
                <b>1. Ad\u0131m:</b> \xDCr\xFCnleri i\xE7eren Excel dosyas\u0131n\u0131 se\xE7in (.xlsx).<br>
                <small><i>Dosyan\u0131n ilk sat\u0131r\u0131 'Stant \xC7e\u015Fidi', 'Stok Kodu' gibi ba\u015Fl\u0131klar\u0131 i\xE7ermelidir.</i></small>
            </p>
            <input type="file" class="bulk-styling-input-file" id="${fileInputId}" accept=".xlsx">
            <button type="button" class="btn-primary btn-sm btn-file-label btn-open-styling-file">
                <i class="fas fa-file-excel"></i> Excel Dosyası Seç...
            </button>
            <span class="file-name-display" aria-live="polite"></span>

            <div class="styling-mapping-container" hidden>
                <p class="bulk-add-info bulk-add-info-styling-strong"><b>2. Adım:</b> Algılanan sütunları doğru alanlarla eşleştirin.</p>
                
                <div class="styling-mapping-grid">
                    <div class="mapping-row mapping-row-manual-main">
                        <label>Ana Kategori (Manuel)</label>
                        <div>
                            <input type="text" class="bulk-main-cat-name" placeholder="Tüm ürünler için Ana Kategori (Örn: Vitrin)">
                            <small><i>(VEYA aşağıdaki açılır menüden bir sütun seçin)</i></small>
                        </div>
                    </div>
                    
                    <div class="mapping-row"><label>Ana Kategori Sütunu</label><select class="mapper-select" data-map="mainCategory"><option value="-1">-- Sütun Kullanma (Manuel Gir) --</option></select></div>
                    <div class="mapping-row"><label>Alt Kategori Sütunu</label><select class="mapper-select" data-map="subCategory"><option value="-1">-- Gerekli Alan --</option></select></div>
                    <div class="mapping-row"><label>Stok Kodu Sütunu</label><select class="mapper-select" data-map="code"><option value="-1">-- Gerekli Alan --</option></select></div>
                    <div class="mapping-row"><label>Malzeme İsmi Sütunu</label><select class="mapper-select" data-map="name"><option value="-1">-- Gerekli Alan --</option></select></div>
                    <div class="mapping-row"><label>Adet Sütunu</label><select class="mapper-select" data-map="qty"><option value="-1">-- Opsiyonel --</option></select></div>
                    <div class="mapping-row"><label>Muadil Stok Kodu Sütunu</label><select class="mapper-select" data-map="alternativeCode"><option value="-1">-- Opsiyonel --</option></select></div>
                    <div class="mapping-row"><label>Muadil Ürün İsmi Sütunu</label><select class="mapper-select" data-map="alternativeName"><option value="-1">-- Opsiyonel --</option></select></div>
                    <div class="mapping-row"><label>Muadil Adet Sütunu</label><select class="mapper-select" data-map="alternativeQty"><option value="-1">-- Opsiyonel --</option></select></div>
                </div>

                <div class="styling-existing-main-category-mapping" hidden>
                    <p class="bulk-add-info bulk-add-info-styling-strong"><b>3. Adım:</b> Excel'deki ana kategorileri sistemdeki mevcut ana kategorilerle eşleştirin.</p>
                    <div class="styling-main-category-match-list"></div>
                </div>
                
                <div class="styling-mapping-actions">
                    <button class="btn-secondary btn-sm btn-reset-styling-import" type="button"><i class="fas fa-rotate-left"></i> Sıfırla</button>
                    <button class="btn-success btn-sm btn-parse-styling" type="button"><i class="fas fa-magic"></i> Verileri İşle ve Hiyerarşiye Ekle</button>
                </div>
            </div>
        </div>
        
        <div class="product-manager-actions">
             <button class="btn-primary btn-sm btn-add-main-category">
                <i class="fas fa-plus"></i> Ana Kategori Ekle (Manuel)
            </button>
        </div>
        <div class="styling-list-editor-container"></div>
    `,
  );
  const editor = container.querySelector(".styling-list-editor-container"),
    fileInput = container.querySelector(".bulk-styling-input-file"),
    openFileButton = container.querySelector(".btn-open-styling-file");
  questionData.stylingData &&
    Array.isArray(questionData.stylingData) &&
    questionData.stylingData.forEach((mainCat) => {
      addMainCategoryRow(editor, mainCat);
    }),
    setupSortableContainer(editor, '.main-category-row', {
      readyKey: 'mainCategoryDragReady',
      handleSelector: '.sortable-drag-handle',
    }),
    container
      .querySelector(".btn-add-main-category")
      .addEventListener("click", () => {
        addMainCategoryRow(editor, {});
      }),
    openFileButton.addEventListener("click", (e) => {
      e.preventDefault(),
        e.stopPropagation(),
        (fileInput.value = ""),
        requestAnimationFrame(() => {
          fileInput.click();
        });
    }),
    fileInput.addEventListener("change", (e) => {
      handleStylingExcelUpload(e, container);
    }),
    window.addEventListener(
      "focus",
      () => {
        container.isConnected &&
          requestAnimationFrame(() => {
            const panel = document.querySelector(".admin-panel");
            panel &&
              (((panel as HTMLElement).style.transform = "translateZ(0)"),
              void (panel as HTMLElement).offsetHeight,
              ((panel as HTMLElement).style.transform = ""));
          });
      },
      { once: !0 },
    ),
    container
      .querySelector('.mapper-select[data-map="mainCategory"]')
      .addEventListener("change", () => {
        updateExistingMainCategoryMappingUI(container);
      }),
    container
      .querySelector(".btn-reset-styling-import")
      .addEventListener("click", () => {
        resetStylingImportState(container);
      }),
    container
      .querySelector(".btn-parse-styling")
      .addEventListener("click", () => {
        parseStylingBulkData(container);
      });
}

// Styling helpers
function handleStylingExcelUpload(event, container) {
  const file = event.target.files[0],
    fileNameDisplay = container.querySelector(".file-name-display");
  if (!file) {
    fileNameDisplay.textContent = "";
    return;
  }
  fileNameDisplay.textContent = file.name;
  void preloadExcelJs();
  void (async () => {
    try {
      const jsonData = await readExcelRowsFromFile(file);
      if (!jsonData || jsonData.length < 2) {
        notify.info(
          "Hata: Excel dosyası boş veya geçersiz bir formatta.",
        );
        fileNameDisplay.textContent = "Hata oluştu!";
        return;
      }
      parsedExcelData = jsonData;
      analyzeExcelData(container, parsedExcelData);
    } catch (error) {
      console.error("Excel okuma hatası:", error);
      notify.info(
        "Excel dosyası okunurken bir hata oluştu. Dosya şifreli veya bozuk olabilir.",
      );
      fileNameDisplay.textContent = "Hata oluştu!";
    }
  })();
}
function analyzeExcelData(container, data) {
  const headers = data[0];
  if (!headers || headers.length < 2)
    return notify.info(
      "Sütun başlıkları algılanamadı.",
    );
  const mappingContainer = container.querySelector(
    ".styling-mapping-container",
  );
  mappingContainer.querySelectorAll(".mapper-select").forEach((select) => {
    for (; select.options.length > 1; ) select.remove(1);
    let bestGuessIndex = -1;
    const mapKey = select.dataset.map.toLowerCase();
    headers.forEach((header, index) => {
      header || (header = `Sütun ${index + 1}`);
      const option = new Option(header, index);
      select.add(option);
      const headerLower = normalizeExcelHeader(header);
      const alternativeHeader = isAlternativeHeader(headerLower);
      mapKey === "maincategory" &&
        !alternativeHeader &&
        (headerLower.includes("ana kat") ||
          headerLower.includes("ana_kat")) &&
        (bestGuessIndex = index),
        mapKey === "subcategory" &&
          !alternativeHeader &&
          (headerLower.includes("alt kat") ||
            headerLower.includes("stant çeşidi") ||
            headerLower.includes("stand çeşit")) &&
          (bestGuessIndex = index),
        mapKey === "code" &&
          !alternativeHeader &&
          (headerLower.includes("stok") || headerLower.includes("kod")) &&
          (bestGuessIndex = index),
        mapKey === "name" &&
          !alternativeHeader &&
          (headerLower.includes("isim") ||
            headerLower.includes("malzeme") ||
            headerLower.includes("ürün")) &&
          (bestGuessIndex = index),
        mapKey === "qty" &&
          !alternativeHeader &&
          (headerLower.includes("adet") ||
            headerLower.includes("qty") ||
            headerLower.includes("miktar")) &&
          (bestGuessIndex = index),
        mapKey === "alternativecode" &&
          alternativeHeader &&
          (headerLower.includes("stok") || headerLower.includes("kod")) &&
          (bestGuessIndex = index),
        mapKey === "alternativename" &&
          alternativeHeader &&
          (headerLower.includes("isim") ||
            headerLower.includes("malzeme") ||
            headerLower.includes("ürün")) &&
          (bestGuessIndex = index),
        mapKey === "alternativeqty" &&
          alternativeHeader &&
          (headerLower.includes("adet") ||
            headerLower.includes("qty") ||
            headerLower.includes("miktar")) &&
          (bestGuessIndex = index);
    }),
      (select.value = String(bestGuessIndex));
  }),
    (mappingContainer.hidden = !1),
    updateExistingMainCategoryMappingUI(container);
}

function buildExistingMainCategoryMappingRow(sourceName, existingNames) {
  const normalizedSource = normalizeCategoryKey(sourceName);
  const sourceLabel = escapeHtml(sourceName);
  let optionsHtml =
    '<option value="__same__">Aynı isimle eşleştir / yeni oluştur</option>';
  existingNames.forEach((existingName) => {
    const selected =
      normalizeCategoryKey(existingName) === normalizedSource ? " selected" : "";
    optionsHtml += `<option value="${escapeHtml(existingName)}"${selected}>${escapeHtml(existingName)}</option>`;
  });
  return `
    <div class="mapping-row main-category-match-row">
      <label>${sourceLabel}</label>
      <div>
        <select class="main-category-target-select" data-source-key="${escapeHtml(normalizedSource)}">
          ${optionsHtml}
        </select>
        <small><i>Excel'deki ana kategori adını mevcut kategoriye bağlayabilirsiniz.</i></small>
      </div>
    </div>
  `;
}

function updateExistingMainCategoryMappingUI(container) {
  const mappingSection = container.querySelector(
    ".styling-existing-main-category-mapping",
  );
  const matchList = container.querySelector(".styling-main-category-match-list");
  const mainCategorySelect = container.querySelector(
    '.mapper-select[data-map="mainCategory"]',
  );
  if (!(mappingSection instanceof HTMLElement) || !(matchList instanceof HTMLElement)) {
    return;
  }
  matchList.replaceChildren();
  if (!(mainCategorySelect instanceof HTMLSelectElement)) {
    mappingSection.hidden = true;
    return;
  }
  const mainCategoryIndex = parseInt(mainCategorySelect.value, 10);
  if (!parsedExcelData || Number.isNaN(mainCategoryIndex) || mainCategoryIndex === -1) {
    mappingSection.hidden = true;
    return;
  }
  const excelCategoryNames = Array.from(
    new Set(
      parsedExcelData
        .slice(1)
        .map((row) => String(row?.[mainCategoryIndex] || "").trim())
        .filter(Boolean),
    ),
  );
  if (!excelCategoryNames.length) {
    mappingSection.hidden = true;
    return;
  }
  const existingNames = getExistingStylingMainCategoryNames(container);
  if (!existingNames.length) {
    mappingSection.hidden = true;
    return;
  }
  setSafeHtml(
    matchList,
    excelCategoryNames
      .map((sourceName) =>
        buildExistingMainCategoryMappingRow(sourceName, existingNames),
      )
      .join(""),
  );
  mappingSection.hidden = false;
}

function getStylingHierarchySnapshot(editor) {
  return {
    mainCategoryCount: editor.querySelectorAll(":scope > .main-category-row").length,
    subCategoryCount: editor.querySelectorAll(".sub-category-container > .sub-category-row").length,
    productCount: editor.querySelectorAll(".product-container-styling .product-row-styling").length,
  };
}

function replaceStylingHierarchyWithGroupedData(editor, groupedData) {
  editor.replaceChildren();
  let mainCategoryCount = 0,
    subCategoryCount = 0,
    productCount = 0;
  Object.keys(groupedData).forEach((mainName) => {
    const subCategories = Object.keys(groupedData[mainName]).map((subName) => {
      const products = groupedData[mainName][subName];
      subCategoryCount += 1;
      productCount += products.length;
      return {
        name: subName,
        products,
      };
    });
    addMainCategoryRow(editor, {
      name: mainName,
      subCategories,
    });
    mainCategoryCount += 1;
  });
  return {
    mainCategoryCount,
    subCategoryCount,
    productCount,
  };
}

function resetStylingImportState(container) {
  parsedExcelData = null,
  parsedProductExcelData = null;
  const fileInput = container.querySelector(".bulk-styling-input-file");
  const fileNameDisplay = container.querySelector(".file-name-display");
  const mainCategoryInput = container.querySelector(".bulk-main-cat-name");
  const mappingContainer = container.querySelector(".styling-mapping-container");
  const existingMappingSection = container.querySelector(
    ".styling-existing-main-category-mapping",
  );
  const matchList = container.querySelector(".styling-main-category-match-list");
  if (fileInput instanceof HTMLInputElement) {
    fileInput.value = "";
  }
  if (fileNameDisplay instanceof HTMLElement) {
    fileNameDisplay.textContent = "";
  }
  if (mainCategoryInput instanceof HTMLInputElement) {
    mainCategoryInput.value = "";
  }
  container.querySelectorAll(".mapper-select").forEach((select) => {
    select.selectedIndex = 0;
  });
  if (mappingContainer instanceof HTMLElement) {
    mappingContainer.hidden = true;
  }
  if (existingMappingSection instanceof HTMLElement) {
    existingMappingSection.hidden = true;
  }
  if (matchList instanceof HTMLElement) {
    matchList.replaceChildren();
  }
}

function parseStylingBulkData(container) {
  if (!parsedExcelData)
    return notify.info(
      "Hata: Önce bir Excel dosyası yükleyip analiz etmelisiniz.",
    );
  const editor = container.querySelector(".styling-list-editor-container"),
    getIndex = (key) =>
      parseInt(
        container.querySelector(`.mapper-select[data-map="${key}"]`).value,
        10,
      ),
    mainCatIndex = getIndex("mainCategory"),
    subCatIndex = getIndex("subCategory"),
    codeIndex = getIndex("code"),
    nameIndex = getIndex("name"),
    qtyIndex = getIndex("qty"),
    alternativeCodeIndex = getIndex("alternativeCode"),
    alternativeNameIndex = getIndex("alternativeName"),
    alternativeQtyIndex = getIndex("alternativeQty");
  let manualMainCatName = container
    .querySelector(".bulk-main-cat-name")
    .value.trim();
  if (subCatIndex === -1 || codeIndex === -1 || nameIndex === -1)
    return notify.info(
      "Hata: Lütfen Alt Kategori, Stok Kodu ve Malzeme İsmi için sütunları eşleştirin.",
    );
  if (mainCatIndex === -1 && !manualMainCatName)
    return notify.info(
      "Hata: Lütfen manuel bir 'Ana Kategori Adı' girin VEYA bir 'Ana Kategori Sütunu' seçin.",
    );
  const lines = parsedExcelData;
  const finalProducts = [];
  let lastSubCategory = "Tanımsız Alt Kategori",
    lastMainCategory = manualMainCatName || "Tanımsız Ana Kategori";
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i];
    if (!cols) continue;
    const maxIndex = Math.max(mainCatIndex, subCatIndex, codeIndex, nameIndex);
    if (cols.length <= maxIndex) continue;
    if (mainCatIndex !== -1) {
      const mainCatRaw = cols[mainCatIndex]
        ? String(cols[mainCatIndex]).trim()
        : "";
      if (mainCatRaw !== "") {
        lastMainCategory = resolveMappedMainCategoryName(container, mainCatRaw);
      }
    }
    const subCatRaw = cols[subCatIndex] ? String(cols[subCatIndex]).trim() : "";
    subCatRaw !== "" && (lastSubCategory = subCatRaw);
    const code = cols[codeIndex] ? String(cols[codeIndex]).trim() : "",
      normalizedCode = normalizeProductCode(code),
      name = cols[nameIndex] ? String(cols[nameIndex]).trim() : "",
      qty = normalizeQuantityValue(
        qtyIndex !== -1 ? cols[qtyIndex] : "",
        "1",
      ),
      alternativeCode =
        alternativeCodeIndex !== -1 && cols[alternativeCodeIndex]
          ? String(cols[alternativeCodeIndex]).trim()
          : "",
      alternativeName =
        alternativeNameIndex !== -1 && cols[alternativeNameIndex]
          ? String(cols[alternativeNameIndex]).trim()
          : "",
      alternativeQty = normalizeQuantityValue(
        alternativeQtyIndex !== -1 ? cols[alternativeQtyIndex] : "",
        "1",
      ),
      alternativeProduct = normalizeAlternativeProduct({
        code: alternativeCode,
        name: alternativeName,
        qty: alternativeQty,
      });
    if (!normalizedCode || !name) {
      continue;
    }
    finalProducts.push({
      sortIndex: i,
      mainCategory: lastMainCategory,
      subCategory: lastSubCategory,
      product: {
        code,
        name,
        qty,
        ...(alternativeProduct
          ? {
              alternatives: [
                {
                  code: alternativeProduct.code,
                  name: alternativeProduct.name,
                  qty: alternativeProduct.qty,
                },
              ],
            }
          : {}),
      },
    });
  }
  const groupedData = {};
  finalProducts.forEach(({ mainCategory, subCategory, product }) => {
    groupedData[mainCategory] || (groupedData[mainCategory] = {});
    groupedData[mainCategory][subCategory] ||
      (groupedData[mainCategory][subCategory] = []);
    const currentProducts = groupedData[mainCategory][subCategory];
    const existingProduct = currentProducts.find(
      (item) => normalizeProductCode(item.code) === normalizeProductCode(product.code),
    );
    if (existingProduct) {
      existingProduct.name = product.name || existingProduct.name;
      existingProduct.qty = product.qty || existingProduct.qty;
      const mergedAlternatives = mergeAlternativeProducts(
        existingProduct.alternatives,
        product.alternatives,
      );
      if (mergedAlternatives.length > 0) {
        existingProduct.alternatives = mergedAlternatives;
      }
      return;
    }
    currentProducts.push({
      ...product,
      ...(product.alternatives?.length
        ? { alternatives: mergeAlternativeProducts([], product.alternatives) }
        : {}),
    });
  });
  if (finalProducts.length === 0)
    return notify.info(
      "Hiçbir geçerli ürün bulunamadı. Lütfen veriyi ve eşleştirmeleri kontrol edin.",
    );
  const previousSnapshot = getStylingHierarchySnapshot(editor);
  const nextSnapshot = replaceStylingHierarchyWithGroupedData(editor, groupedData);
  if (nextSnapshot.productCount === 0) {
    return notify.info(
      "Hiçbir geçerli ürün bulunamadı. Mevcut liste korunmuştur.",
    );
  }
  const removedProductCount = Math.max(
    0,
    previousSnapshot.productCount - nextSnapshot.productCount,
  );
  const summaryParts = [
    `${nextSnapshot.productCount} adet ürün Excel listesine göre tam senkronize edildi.`,
    `${nextSnapshot.mainCategoryCount} ana kategori ve ${nextSnapshot.subCategoryCount} alt kategori yeniden oluşturuldu.`,
  ];
  if (previousSnapshot.productCount > 0) {
    summaryParts.push(
      `${previousSnapshot.productCount} ürün içeren önceki liste tamamen Excel verisiyle değiştirildi.`,
    );
  }
  if (removedProductCount > 0) {
    summaryParts.push(`${removedProductCount} adet eski ürün listeden kaldırıldı.`);
  }
  notify.info(summaryParts.join(" ")),
    resetStylingImportState(container);
}

function addMainCategoryRow(container, mainCatData) {
  const row = document.createElement("div");
  (row.className = "main-category-row"),
    (row.draggable = !0),
    setSafeHtml(
      row,
      `
        <div class="category-header category-manager-row">
            <button class="sortable-drag-handle" type="button" title="Bu ana kategoriyi sürükleyip yeni sıraya taşıyın"><i class="fas fa-grip-vertical"></i></button>
            <button class="toggle-row-btn" title="İçeriği Göster/Gizle"><i class="fas fa-chevron-right"></i></button>
            <i class="fas fa-layer-group category-icon"></i>
            <input type="text" class="main-category-input" placeholder="Ana Kategori Adı (Örn: Vitrinler)" value="${
              mainCatData.name || ""
            }">
            <button class="btn-success btn-sm btn-add-sub-category" title="Alt Kategori Ekle"><i class="fas fa-plus"></i> Alt Kategori</button>
            <button class="btn-danger btn-sm btn-remove-row" title="Ana Kategoriyi Sil"><i class="fas fa-trash"></i></button>
        </div>
        <div class="sub-category-container" hidden></div>
    `,
    ),
    container.appendChild(row);
  const subCategoryContainer = row.querySelector(".sub-category-container"),
    toggleBtn = row.querySelector(".toggle-row-btn"),
    toggleIcon = toggleBtn.querySelector("i");
  toggleBtn.addEventListener("click", () => {
    subCategoryContainer.hidden
      ? ((subCategoryContainer.hidden = !1),
        (toggleIcon.className = "fas fa-chevron-down"))
      : ((subCategoryContainer.hidden = !0),
        (toggleIcon.className = "fas fa-chevron-right"));
  }),
    mainCatData.subCategories &&
      Array.isArray(mainCatData.subCategories) &&
      mainCatData.subCategories.forEach((subCat) => {
        addSubCategoryRow(subCategoryContainer, subCat);
      }),
    row.querySelector(".btn-add-sub-category").addEventListener("click", () => {
      subCategoryContainer.hidden &&
        ((subCategoryContainer.hidden = !1),
        (toggleIcon.className = "fas fa-chevron-down")),
        addSubCategoryRow(subCategoryContainer, {});
    }),
    row.querySelector(".btn-remove-row").addEventListener("click", () => {
      confirm(
        "Bu ana kategoriyi ve i\xE7indeki t\xFCm alt kategorileri/\xFCr\xFCnleri silmek istedi\u011Finizden emin misiniz?",
      ) && row.remove();
    });
}
function addSubCategoryRow(container, subCatData) {
  const row = document.createElement("div");
  (row.className = "sub-category-row"),
    setSafeHtml(
      row,
      `
        <div class="category-header category-manager-row">
            <i class="fas fa-folder-open category-icon"></i>
            <input type="text" class="sub-category-input" placeholder="Alt Kategori Ad\u0131 (\xD6rn: Vitrin Sol)" value="${
              subCatData.name || ""
            }">
            <button class="btn-primary btn-sm btn-add-product-styling" title="\xDCr\xFCn Ekle"><i class="fas fa-plus"></i> \xDCr\xFCn</button>
            <button class="btn-danger btn-sm btn-remove-row" title="Alt Kategoriyi Sil"><i class="fas fa-trash"></i></button>
        </div>
        <div class="product-container-styling"></div>
    `,
    ),
    container.appendChild(row);
  const productContainer = row.querySelector(".product-container-styling");
  subCatData.products &&
    Array.isArray(subCatData.products) &&
    subCatData.products.forEach((product) => {
      addProductRowStyling(productContainer, product);
    }),
    row
      .querySelector(
        ".btn-add-pro\
duct-styling",
      )
      .addEventListener("click", () => {
        addProductRowStyling(productContainer, {});
      }),
    row.querySelector(".btn-remove-row").addEventListener("click", () => {
      confirm(
        "Bu alt kategoriyi ve i\xE7indeki t\xFCm \xFCr\xFCnleri silmek istedi\u011Finizden emin misiniz?",
      ) && row.remove();
    });
}
function addProductRowStyling(container, productData) {
  const row = document.createElement("div");
  row.className = "product-row-styling product-manager-row";
  setSafeHtml(
    row,
    `
      <input type="text" class="product-code-styling" placeholder="Ürün Kodu" value="${escapeHtml(String(productData.code || ""))}">
      <input type="text" class="product-name-styling" placeholder="Ürün Adı" value="${escapeHtml(String(productData.name || ""))}">
      <input type="number" class="product-qty-styling" placeholder="Adet" value="${escapeHtml(String(productData.qty || "1"))}">
      <button class="btn-secondary btn-sm btn-toggle-alternative-product" title="Muadil Ürün Ekle" type="button"><i class="fas fa-shuffle"></i> Muadil</button>
      <button class="btn-danger btn-sm btn-remove-row" title="Ürünü Sil" type="button"><i class="fas fa-trash"></i></button>
    `,
  );
  container.appendChild(row);

  const alternativeContainer = ensureAlternativeContainer(row);
  const alternatives = Array.isArray(productData.alternatives)
    ? mergeAlternativeProducts([], productData.alternatives)
    : [];
  if (alternatives.length > 0) {
    alternativeContainer.hidden = false;
    alternatives.forEach((alternative) => {
      addProductAlternativeRow(alternativeContainer, alternative);
    });
  }

  row
    .querySelector(".btn-toggle-alternative-product")
    ?.addEventListener("click", () => {
      alternativeContainer.hidden = false;
      addProductAlternativeRow(alternativeContainer, {});
    });

  row.querySelector(".btn-remove-row")?.addEventListener("click", () => {
    row.remove();
  });
}

function renderProductManagerUI(c) {
  setSafeHtml(
    c,
    `
      <h4><i class="fas fa-boxes"></i> Ürün Listesi Yöneticisi</h4>
      <p class="product-manager-info"><i class="fas fa-info-circle"></i> Bu liste tüm "product_list" tipi sorular için ortaktır.</p>
      <div class="bulk-add-container bulk-add-product-excel">
        <h5><i class="fas fa-file-excel"></i> Excel'den Ürün Aktarma</h5>
        <p class="bulk-add-info">
          Excel dosyanızı yükleyin, sütunları seçin ve yalnızca istediğiniz Excel kategorisini sistemdeki kategoriyle eşleştirin.
        </p>
        <input type="file" class="bulk-product-input-file" accept=".xlsx" hidden>
        <div class="product-import-toolbar">
          <button type="button" class="btn-primary btn-sm btn-open-product-file"><i class="fas fa-file-excel"></i> Excel Dosyası Seç...</button>
          <span class="file-name-display product-file-name-display" aria-live="polite"></span>
        </div>
        <div class="product-mapping-container" hidden>
          <p class="bulk-add-info bulk-add-info-styling-strong"><b>1. Adım:</b> Excel sütunlarını sistem alanlarıyla eşleştirin.</p>
          <div class="styling-mapping-grid">
            <div class="mapping-row mapping-row-manual-main">
              <label>Kategori (Manuel)</label>
              <div>
                <input type="text" class="bulk-product-category-name" placeholder="Excel'de kategori sütunu yoksa tek kategori adı girin">
                <small><i>Kategori sütunu kullanmayacaksanız burada yalnızca sistemde zaten var olan bir kategori adı kullanılabilir.</i></small>
              </div>
            </div>
            <div class="mapping-row"><label>Kategori Sütunu</label><div><select class="product-mapper-select" data-map="category"><option value="-1">-- Sütun Kullanma (Manuel Gir) --</option></select><small><i>Örn: Excel'deki 'Kategori Adı' başlığını burada seçin.</i></small></div></div>
            <div class="mapping-row"><label>Stok Kodu Sütunu</label><select class="product-mapper-select" data-map="code"><option value="-1">-- Gerekli Alan --</option></select></div>
            <div class="mapping-row"><label>Ürün Adı Sütunu</label><select class="product-mapper-select" data-map="name"><option value="-1">-- Gerekli Alan --</option></select></div>
            <div class="mapping-row"><label>Paket İçi Adet Sütunu</label><select class="product-mapper-select" data-map="qty"><option value="-1">-- Opsiyonel --</option></select></div>
          </div>
          <div class="product-existing-category-mapping" hidden>
            <p class="bulk-add-info bulk-add-info-styling-strong"><b>2. Adım:</b> Excel kategorisini seçin ve sistemde hangi kategoriye aktarılacağını belirleyin.</p>
            <div class="styling-mapping-grid">
              <div class="mapping-row"><label>Excel Kategorisi</label><div><select class="product-excel-category-select"></select><small><i>Kategori sütununu seçince Excel içindeki kategori değerleri burada otomatik listelenir.</i></small></div></div>
              <div class="mapping-row"><label>Sistem Kategorisi</label><div><select class="product-category-target-single-select"></select><small><i>Burada yalnızca sistemde zaten var olan kategoriler kullanılabilir. Excel aktarımı yeni kategori oluşturmaz.</i></small></div></div>
            </div>
            <div class="styling-mapping-actions">
              <button class="btn-primary btn-sm btn-save-product-category-map" type="button"><i class="fas fa-link"></i> Eşleştirmeyi Kaydet</button>
            </div>
            <div class="product-category-match-list"></div>
          </div>
          <div class="styling-mapping-actions">
            <button class="btn-secondary btn-sm btn-reset-product-import" type="button"><i class="fas fa-rotate-left"></i> Sıfırla</button>
            <button class="btn-success btn-sm btn-parse-product-excel" type="button"><i class="fas fa-magic"></i> Verileri İşle ve Listeye Ekle</button>
          </div>
        </div>
      </div>
      <button id="toggle-detailed-editor-btn" class="btn-sm"><i class="fas fa-edit"></i> Detaylı Editörü Göster</button>
      <div id="detailed-editor-panel">
        <div class="product-manager-actions"><button class="btn-primary btn-sm" id="btn-add-category-row"><i class="fas fa-tags"></i> Kategori Ekle</button><button class="btn-success btn-sm" id="btn-add-product-row"><i class="fas fa-box"></i> Ürün Ekle</button></div>
        <div class="product-list-editor"></div>
      </div>
    `,
  );
  const editor = c.querySelector('.product-list-editor');
  const fileInput = c.querySelector('.bulk-product-input-file');
  const openFileButton = c.querySelector('.btn-open-product-file');
  c
    .querySelector('#toggle-detailed-editor-btn')
    .addEventListener('click', (e_btn) => toggleDetailedEditor(e_btn.currentTarget));
  c
    .querySelector('#btn-add-category-row')
    .addEventListener('click', () => {
      const newCategoryGroup = addCategoryRow(editor);
      focusAndScrollProductCategory(newCategoryGroup);
    });
  c
    .querySelector('#btn-add-product-row')
    .addEventListener('click', () => {
      addProductRowToActiveCategory(editor);
    });
  openFileButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    fileInput.value = '';
    requestAnimationFrame(() => {
      fileInput.click();
    });
  });
  fileInput.addEventListener('change', (event) => {
    handleProductExcelUpload(event, c);
  });
  c
    .querySelector('.product-mapper-select[data-map="category"]')
    .addEventListener('change', () => updateExistingProductCategoryMappingUI(c));
  c
    .querySelector('.bulk-product-category-name')
    .addEventListener('input', () => updateExistingProductCategoryMappingUI(c));
  c
    .querySelector('.product-excel-category-select')
    .addEventListener('change', () => renderSelectedProductCategoryMappingState(c));
  c
    .querySelector('.btn-save-product-category-map')
    .addEventListener('click', () => addOrUpdateSelectedProductCategoryMapping(c));
  c
    .querySelector('.btn-reset-product-import')
    .addEventListener('click', () => resetProductImportState(c));
  c
    .querySelector('.btn-parse-product-excel')
    .addEventListener('click', () => parseProductExcelData(c));
  buildProductGroupsFromList(productList).forEach((item) => {
    item.type === 'category' ? addCategoryRow(editor, item) : addProductRow(editor, item);
  });
  setupSortableContainer(editor, '.product-category-group', {
    readyKey: 'productCategoryDragReady',
    handleSelector: '.sortable-drag-handle',
  });
}

// Product editor
function toggleDetailedEditor(btn) {
  const panel = document.getElementById(
    "detailed-ed\
itor-panel",
  );
  if (!panel) return;
  panel.classList.toggle("open");
  const isOpen = panel.classList.contains("open");
  appendIconText(
    btn,
    isOpen
      ? "fas fa\
-eye-slash"
      : "fas fa-edit",
    isOpen
      ? "Detayl\u0131 Edit\xF6r\xFC Gizle"
      : "Detayl\u0131 Edit\xF6r\xFC G\xF6ster",
  );
}
function handleProductExcelUpload(event, container) {
  const file = event.target.files[0],
    fileNameDisplay = container.querySelector('.product-file-name-display');
  if (!file) {
    fileNameDisplay.textContent = '';
    return;
  }
  fileNameDisplay.textContent = file.name;
  void preloadExcelJs();
  void (async () => {
    try {
      const jsonData = await readExcelRowsFromFile(file);
      if (!jsonData || jsonData.length < 2) {
        notify.info('Hata: Excel dosyası boş veya geçersiz bir formatta.');
        fileNameDisplay.textContent = 'Hata oluştu!';
        return;
      }
      parsedProductExcelData = jsonData;
      analyzeProductExcelData(container, parsedProductExcelData);
    } catch (error) {
      console.error('Ürün Excel okuma hatası:', error);
      notify.info('Excel dosyası okunurken bir hata oluştu. Dosya şifreli veya bozuk olabilir.');
      fileNameDisplay.textContent = 'Hata oluştu!';
    }
  })();
}

function analyzeProductExcelData(container, data) {
  const headers = data[0];
  if (!headers || headers.length < 2) return notify.info('Sütun başlıkları algılanamadı.');
  const mappingContainer = container.querySelector('.product-mapping-container');
  mappingContainer.querySelectorAll('.product-mapper-select').forEach((select) => {
    for (; select.options.length > 1; ) select.remove(1);
    let bestGuessIndex = -1;
    const mapKey = String(select.dataset.map || '').toLocaleLowerCase('tr-TR');
    headers.forEach((header, index) => {
      header || (header = `Sütun ${index + 1}`);
      const option = new Option(header, index);
      select.add(option);
      const headerLower = normalizeExcelHeader(header);
      const alternativeHeader = isAlternativeHeader(headerLower);
      if (mapKey === 'category' && !alternativeHeader && (headerLower.includes('kategori') || headerLower.includes('grup'))) bestGuessIndex = index;
      if (mapKey === 'code' && !alternativeHeader && (headerLower.includes('stok') || headerLower.includes('kod'))) bestGuessIndex = index;
      if (mapKey === 'name' && !alternativeHeader && (headerLower.includes('ürün') || headerLower.includes('malzeme') || headerLower.includes('isim'))) bestGuessIndex = index;
      if (mapKey === 'qty' && !alternativeHeader && (headerLower.includes('paket') || headerLower.includes('adet') || headerLower.includes('miktar') || headerLower.includes('qty'))) bestGuessIndex = index;
    });
    select.value = String(bestGuessIndex);
  });
  mappingContainer.hidden = false;
  updateExistingProductCategoryMappingUI(container);
}

function findExistingProductRowByCode(editor, normalizedCode) {
  return Array.from(editor.querySelectorAll('.product-manager-row') as NodeListOf<HTMLElement>).find((row) => {
    const input = row.querySelector('.product-code');
    return normalizeProductCode(input?.value) === normalizedCode;
  });
}

function updateProductEditorRow(row, productData) {
  if (!(row instanceof HTMLElement)) return;
  const codeInput = row.querySelector('.product-code');
  const nameInput = row.querySelector('.product-name');
  const qtyInput = row.querySelector('.product-qty');
  if (codeInput instanceof HTMLInputElement) codeInput.value = productData.code || '';
  if (nameInput instanceof HTMLInputElement) nameInput.value = productData.name || '';
  if (qtyInput instanceof HTMLInputElement) qtyInput.value = productData.qty || '';
}

function getProductCategoryGroups(editor) {
  return Array.from(editor.querySelectorAll(':scope > .product-category-group') as NodeListOf<HTMLElement>);
}

function getProductCategoryProductsContainer(categoryGroup) {
  return categoryGroup?.querySelector(':scope > .product-category-products') || null;
}

function setProductCategoryExpanded(categoryGroup, expanded) {
  if (!(categoryGroup instanceof HTMLElement)) return;
  const productsContainer = getProductCategoryProductsContainer(categoryGroup);
  const toggleIcon = categoryGroup.querySelector('.toggle-row-btn i');
  if (!(productsContainer instanceof HTMLElement)) return;
  productsContainer.hidden = !expanded;
  if (toggleIcon instanceof HTMLElement) {
    toggleIcon.className = expanded ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
  }
}

function scrollProductEditorTargetIntoView(target) {
  if (!(target instanceof HTMLElement)) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function focusAndScrollProductCategory(categoryGroup) {
  if (!(categoryGroup instanceof HTMLElement)) return;
  setProductCategoryExpanded(categoryGroup, false);
  const input = categoryGroup.querySelector('.category-manager-row input');
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
  scrollProductEditorTargetIntoView(categoryGroup);
}

function setActiveProductCategoryGroup(editor, categoryGroup) {
  if (!(editor instanceof HTMLElement)) return;
  const groups = getProductCategoryGroups(editor);
  groups.forEach((group) => {
    group.classList.toggle('is-active-product-category', group === categoryGroup);
  });
}

function getActiveProductCategoryGroup(editor) {
  const groups = getProductCategoryGroups(editor);
  const explicitActiveGroup = groups.find((group) =>
    group.classList.contains('is-active-product-category'),
  );
  if (explicitActiveGroup) return explicitActiveGroup;

  const expandedGroup = groups.find((group) => {
    const productsContainer = getProductCategoryProductsContainer(group);
    return productsContainer instanceof HTMLElement && !productsContainer.hidden;
  });
  if (expandedGroup) return expandedGroup;

  return groups[groups.length - 1] || null;
}

function addProductRowToActiveCategory(editor) {
  const categoryGroups = getProductCategoryGroups(editor);
  if (categoryGroups.length === 0) {
    notify.info('Önce ürünün ekleneceği bir kategori oluşturmalısınız.');
    const newCategoryGroup = addCategoryRow(editor);
    focusAndScrollProductCategory(newCategoryGroup);
    return;
  }

  const activeCategory = getActiveProductCategoryGroup(editor);
  if (!(activeCategory instanceof HTMLElement)) return;

  const productsContainer = getProductCategoryProductsContainer(activeCategory);
  if (!(productsContainer instanceof HTMLElement)) return;

  setActiveProductCategoryGroup(editor, activeCategory);
  setProductCategoryExpanded(activeCategory, true);

  const newProductRow = addProductRow(productsContainer);
  const productNameInput = newProductRow.querySelector('.product-name');
  if (productNameInput instanceof HTMLInputElement) {
    productNameInput.focus();
  }
  scrollProductEditorTargetIntoView(newProductRow);
}

function ensureProductCategoryRow(editor, categoryName) {
  const normalizedCategory = normalizeCategoryKey(categoryName);
  const existingGroup = getProductCategoryGroups(editor).find((group) => {
    const input = group.querySelector('.category-manager-row input');
    return normalizeCategoryKey(input?.value) === normalizedCategory;
  });
  return existingGroup || addCategoryRow(editor, { name: categoryName, products: [] });
}

function mergeDuplicateProductCategories(editor) {
  const firstCategoryGroups = new Map();
  getProductCategoryGroups(editor).forEach((group) => {
    const input = group.querySelector('.category-manager-row input');
    const normalizedName = normalizeCategoryKey(input?.value);
    if (!normalizedName) return;
    const firstGroup = firstCategoryGroups.get(normalizedName);
    if (!firstGroup) {
      firstCategoryGroups.set(normalizedName, group);
      return;
    }
    const firstContainer = getProductCategoryProductsContainer(firstGroup);
    const currentContainer = getProductCategoryProductsContainer(group);
    if (firstContainer instanceof HTMLElement && currentContainer instanceof HTMLElement) {
      Array.from(currentContainer.children).forEach((child) => {
        firstContainer.appendChild(child);
      });
    }
    group.remove();
  });
}

function removeDuplicateProductRows(editor) {
  const seenCodes = new Set();
  Array.from(editor.querySelectorAll('.product-manager-row') as NodeListOf<HTMLElement>).forEach((row) => {
    const codeInput = row.querySelector('.product-code');
    const normalizedCode = normalizeProductCode(codeInput?.value);
    if (!normalizedCode) return;
    if (seenCodes.has(normalizedCode)) {
      row.remove();
      return;
    }
    seenCodes.add(normalizedCode);
  });
}

function normalizeProductListEditor(editor) {
  if (!(editor instanceof HTMLElement)) return;
  mergeDuplicateProductCategories(editor);
  removeDuplicateProductRows(editor);
}

function getProductListSnapshot(editor, categoryNames = null) {
  const normalizedFilter = Array.isArray(categoryNames)
    ? new Set(
        categoryNames
          .map((name) => normalizeCategoryKey(name))
          .filter(Boolean),
      )
    : null;
  const categoryGroups = getProductCategoryGroups(editor).filter((group) => {
    if (!normalizedFilter) return true;
    const input = group.querySelector('.category-manager-row input');
    return normalizedFilter.has(normalizeCategoryKey(input?.value));
  });
  return {
    categoryCount: categoryGroups.length,
    productCount: categoryGroups.reduce((total, group) => {
      const productsContainer = getProductCategoryProductsContainer(group);
      return (
        total +
        (productsContainer instanceof HTMLElement
          ? productsContainer.querySelectorAll(':scope > .product-manager-row').length
          : 0)
      );
    }, 0),
  };
}

function replaceProductCategoriesWithGroupedData(editor, groupedProducts) {
  const categoryNames = Object.keys(groupedProducts).filter((categoryName) => {
    const products = groupedProducts[categoryName] || [];
    return Array.isArray(products) && products.length > 0;
  });
  let categoryCount = 0;
  let productCount = 0;
  categoryNames.forEach((categoryName) => {
    const products = groupedProducts[categoryName] || [];
    const categoryGroup = ensureProductCategoryRow(editor, categoryName);
    const productsContainer = getProductCategoryProductsContainer(categoryGroup);
    if (!(productsContainer instanceof HTMLElement)) return;
    productsContainer.replaceChildren();
    products.forEach((product) => {
      addProductRow(productsContainer, product);
    });
    categoryCount += 1;
    productCount += products.length;
  });
  normalizeProductListEditor(editor);
  return {
    categoryCount,
    productCount,
  };
}

function resetProductImportState(container) {
  parsedProductExcelData = null;
  const fileInput = container.querySelector('.bulk-product-input-file');
  const fileNameDisplay = container.querySelector('.product-file-name-display');
  const manualCategoryInput = container.querySelector('.bulk-product-category-name');
  const mappingContainer = container.querySelector('.product-mapping-container');
  const existingMappingSection = container.querySelector('.product-existing-category-mapping');
  const matchList = container.querySelector('.product-category-match-list');
  if (fileInput instanceof HTMLInputElement) fileInput.value = '';
  if (fileNameDisplay instanceof HTMLElement) fileNameDisplay.textContent = '';
  if (manualCategoryInput instanceof HTMLInputElement) manualCategoryInput.value = '';
  container.querySelectorAll('.product-mapper-select').forEach((select) => {
    select.selectedIndex = 0;
  });
  if (mappingContainer instanceof HTMLElement) mappingContainer.hidden = true;
  if (existingMappingSection instanceof HTMLElement) existingMappingSection.hidden = true;
  if (matchList instanceof HTMLElement) matchList.replaceChildren();
}

function parseProductExcelData(container) {
  if (!parsedProductExcelData) return notify.info('Hata: Önce bir Excel dosyası yükleyip analiz etmelisiniz.');
  const editor = container.querySelector('.product-list-editor');
  if (!(editor instanceof HTMLElement)) return;
  const getIndex = (key) => parseInt(container.querySelector(`.product-mapper-select[data-map="${key}"]`).value, 10);
  const categoryIndex = getIndex('category');
  const codeIndex = getIndex('code');
  const nameIndex = getIndex('name');
  const qtyIndex = getIndex('qty');
  const manualCategoryInput = container.querySelector('.bulk-product-category-name');
  const manualTargetSelect = container.querySelector('.product-category-target-single-select');
  const manualCategoryName = String(manualCategoryInput?.value || '').trim();
  if (codeIndex === -1 || nameIndex === -1) {
    return notify.info('Hata: Lütfen Stok Kodu ve Ürün Adı sütunlarını eşleştirin.');
  }
  const existingCategoryMap = getExistingProductCategoryNameMap(editor);
  if (existingCategoryMap.size === 0) {
    return notify.info('Hata: Excel aktarımı yeni kategori oluşturmaz. Önce sistemde kategori oluşturmalısınız.');
  }
  let currentCategory = '';
  if (categoryIndex === -1) {
    const selectedManualTarget =
      manualTargetSelect instanceof HTMLSelectElement ? String(manualTargetSelect.value || '').trim() : '';
    const resolvedManualCategory =
      selectedManualTarget || existingCategoryMap.get(normalizeCategoryKey(manualCategoryName)) || '';
    if (!resolvedManualCategory) {
      return notify.info('Hata: Tek kategori aktarımı için mevcut bir sistem kategorisi seçin veya kategori adını doğru girin.');
    }
    currentCategory = resolvedManualCategory;
    if (manualCategoryInput instanceof HTMLInputElement) {
      manualCategoryInput.value = resolvedManualCategory;
    }
  }
  let duplicateInExcelCount = 0;
  let unmappedCategoryCount = 0;
  const productMap = new Map();
  parsedProductExcelData.slice(1).forEach((cols, rowIndex) => {
    if (!cols) return;
    const maxIndex = Math.max(codeIndex, nameIndex, categoryIndex);
    if (cols.length <= maxIndex) return;
    if (categoryIndex !== -1) {
      const rawCategory = cols[categoryIndex] ? String(cols[categoryIndex]).trim() : '';
      if (rawCategory) {
        currentCategory = resolveMappedProductCategoryName(container, rawCategory, existingCategoryMap);
      }
      if (!currentCategory) {
        unmappedCategoryCount += 1;
        return;
      }
    }
    if (!currentCategory) {
      unmappedCategoryCount += 1;
      return;
    }
    const code = cols[codeIndex] ? String(cols[codeIndex]).trim() : '';
    const normalizedCode = normalizeProductCode(code);
    const name = cols[nameIndex] ? String(cols[nameIndex]).trim() : '';
    const qty = normalizeQuantityValue(
      qtyIndex !== -1 && cols[qtyIndex] !== undefined && cols[qtyIndex] !== null ? cols[qtyIndex] : '',
      '',
    );
    if (!normalizedCode || !name) return;
    const productKey = `${normalizeCategoryKey(currentCategory)}__${normalizedCode}`;
    if (productMap.has(productKey)) {
      duplicateInExcelCount += 1;
    }
    productMap.set(productKey, {
      sortIndex: rowIndex,
      categoryName: currentCategory,
      product: { code, name, qty },
    });
  });
  const finalProducts = Array.from(productMap.values()).sort((a, b) => a.sortIndex - b.sortIndex);
  if (finalProducts.length === 0) {
    return notify.info(
      unmappedCategoryCount > 0
        ? 'Hiçbir ürün aktarılmadı. Excel kategorileri mevcut sistem kategorilerine eşleştirilmedi.'
        : duplicateInExcelCount > 0
          ? 'Excel içindeki tüm satırlar aynı stok koduna sahip tekrar ürünlerden oluşuyor.'
          : 'Hiçbir geçerli ürün bulunamadı. Lütfen veriyi ve eşleştirmeleri kontrol edin.',
    );
  }
  const groupedProducts = {};
  finalProducts.forEach(({ categoryName, product }) => {
    groupedProducts[categoryName] || (groupedProducts[categoryName] = []);
    groupedProducts[categoryName].push(product);
  });
  const importedCategoryNames = Object.keys(groupedProducts);
  const previousSnapshot = getProductListSnapshot(editor, importedCategoryNames);
  const totalBeforeSnapshot = getProductListSnapshot(editor);
  const nextSnapshot = replaceProductCategoriesWithGroupedData(editor, groupedProducts);
  if (nextSnapshot.productCount === 0) {
    return notify.info(
      duplicateInExcelCount > 0
        ? 'Excel içindeki tüm satırlar aynı stok koduna sahip tekrar ürünlerden oluşuyor. Mevcut liste korunmuştur.'
        : 'Hiçbir geçerli ürün bulunamadı. Mevcut liste korunmuştur.',
    );
  }
  const totalAfterSnapshot = getProductListSnapshot(editor);
  const removedProductCount = Math.max(0, previousSnapshot.productCount - nextSnapshot.productCount);
  const addedProductCount = Math.max(0, nextSnapshot.productCount - previousSnapshot.productCount);
  const addedCategoryCount = Math.max(0, nextSnapshot.categoryCount - previousSnapshot.categoryCount);
  const preservedCategoryCount = Math.max(0, totalAfterSnapshot.categoryCount - nextSnapshot.categoryCount);
  const summaryParts = [
    `${nextSnapshot.productCount} adet ürün seçtiğiniz kategorilere aktarıldı.`,
    `${nextSnapshot.categoryCount} kategori güncellendi.`,
  ];
  if (addedProductCount > 0) {
    summaryParts.push(`${addedProductCount} adet yeni ürün eklendi.`);
  }
  if (removedProductCount > 0) {
    summaryParts.push(`${removedProductCount} adet eski ürün yalnızca güncellenen kategorilerden kaldırıldı.`);
  }
  if (addedCategoryCount > 0) {
    summaryParts.push(`${addedCategoryCount} adet hedef kategori yeni oluşturulan eşleşme olarak listeye eklendi.`);
  }
  if (preservedCategoryCount > 0) {
    summaryParts.push(`${preservedCategoryCount} adet diğer kategori korundu.`);
  }
  if (totalBeforeSnapshot.categoryCount !== totalAfterSnapshot.categoryCount || totalBeforeSnapshot.productCount !== totalAfterSnapshot.productCount) {
    summaryParts.push(`Toplam liste ${totalAfterSnapshot.categoryCount} kategori ve ${totalAfterSnapshot.productCount} ürün olarak korundu.`);
  }
  if (unmappedCategoryCount > 0) {
    summaryParts.push(`${unmappedCategoryCount} adet satır kategori eşleştirmesi olmadığı için atlandı.`);
  }
  notify.info(summaryParts.join(' '));
  resetProductImportState(container);
}

function buildProductGroupsFromList(items) {
  const groups = [];
  let currentGroup = null;
  (items || []).forEach((item) => {
    if (item?.type === 'header') {
      currentGroup = { type: 'category', name: item.name || '', products: [] };
      groups.push(currentGroup);
      return;
    }
    if (item?.type === 'item' && currentGroup) {
      currentGroup.products.push(item);
      return;
    }
    if (item?.type === 'item') {
      groups.push(item);
    }
  });
  return groups;
}


function addCategoryRow(c, cat = {}, t = null) {
  const group = document.createElement('div');
  group.className = 'product-category-group';
  group.draggable = !0;
  group.dataset.type = 'category';

  const header = document.createElement('div');
  header.className = 'category-manager-row';
  setSafeHtml(
    header,
    `<button class="sortable-drag-handle" type="button" title="Bu kategoriyi sürükleyip yeni sıraya taşıyın"><i class="fas fa-grip-vertical"></i></button><button class="toggle-row-btn" type="button" title="İçeriği Göster/Gizle"><i class="fas fa-chevron-right"></i></button><i class="fas fa-tag category-icon"></i><input type="text" value="${(cat as CategoryLike).name || ''}"><button class="btn-danger btn-sm btn-remove-row"><i class="fas fa-trash"></i></button>`,
  );

  const products = document.createElement('div');
  products.className = 'product-category-products';
  products.hidden = true;

  group.append(header, products);
  if (t instanceof HTMLElement && t.parentElement === c) c.insertBefore(group, t.nextSibling);
  else c.appendChild(group);

  const setGroupAsActive = () => {
    setActiveProductCategoryGroup(c, group);
  };

  header.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.closest('.btn-remove-row')) return;
    setGroupAsActive();
  });

  header.querySelector('.toggle-row-btn')?.addEventListener('click', () => {
    setGroupAsActive();
    setProductCategoryExpanded(group, products.hidden);
  });
  header.querySelector('.btn-remove-row')?.addEventListener('click', () => {
    const wasActive = group.classList.contains('is-active-product-category');
    const fallbackGroup =
      getProductCategoryGroups(c).find((item) => item !== group) || null;

    group.remove();

    if (wasActive && fallbackGroup instanceof HTMLElement) {
      setActiveProductCategoryGroup(c, fallbackGroup);
    }
  });

  const categoryInput = header.querySelector('input');
  if (categoryInput instanceof HTMLInputElement) {
    categoryInput.addEventListener('focus', setGroupAsActive);
  }

  const initialProducts = Array.isArray((cat as CategoryLike & { products?: ProductLike[] }).products)
    ? (cat as CategoryLike & { products?: ProductLike[] }).products
    : [];
  initialProducts.forEach((product) => addProductRow(products, product));

  setGroupAsActive();
  return group;
}

function addProductRow(c, p = {}, t = null) {
  const { row } = makeManagerRow(
    'product-manager-row',
    'product',
    `<input class="product-code" placeholder="Stok Kodu" value="${(p as ProductLike).code || ''}"><input class="product-name" placeholder="Ürün Adı" value="${(p as ProductLike).name || ''}"><input class="product-qty" type="number" min="0" step="1" placeholder="Paket İçi" value="${(p as ProductLike).qty || ''}"><button class="btn-danger btn-sm btn-remove-row"><i class="fas fa-trash"></i></button>`,
    t,
  );
  if (t instanceof HTMLElement && t.parentElement === c) c.insertBefore(row, t.nextSibling);
  else c.appendChild(row);

  const categoryGroup = c.closest('.product-category-group');
  if (categoryGroup instanceof HTMLElement) {
    const editor = categoryGroup.parentElement;
    const setRowCategoryAsActive = () => {
      setActiveProductCategoryGroup(editor, categoryGroup);
    };
    row.addEventListener('click', setRowCategoryAsActive);
    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener('focus', setRowCategoryAsActive);
    });
  }

  return row;
}

// Module actions
function filterManagerView() {
  const vA = document.getElementById("view-active-btn"),
    vC = document.getElementById(
      "vi\
ew-archived-btn",
    ),
    aN = document.getElementById("add-new-question-btn"),
    dC = document.getElementById("delete-all-archived-btn"),
    rA = document.getElementById("restore-all-archived-btn");
  vA.classList.toggle("active", currentManagerView === "active"),
    vC.classList.toggle(
      "active",
      currentManagerView ===
        "a\
rchived",
    ),
    (aN.hidden = currentManagerView !== "active"),
    (dC.hidden = currentManagerView !== "archived"),
    (rA.hidden = currentManagerView !== "archived");
  const i = document.querySelectorAll("#manager-list .manager-item");
  let vis = 0;
  i.forEach((item) => {
    const isA = item.querySelector(".archive-checkbox").checked,
      sV =
        (currentManagerView === "active" && !isA) ||
        (currentManagerView === "archived" && isA);
    item.classList.toggle("hidden-question", !sV), sV && vis++;
  }),
    currentManagerView === "archived" &&
      ((dC.disabled = vis === 0), (rA.disabled = vis === 0));
}
function addNewQuestionUI() {
  if (currentManagerView !== "active") return;
  const m = document.getElementById("manager-list"),
    existingIds = Array.from(m.querySelectorAll(".manager-id-input")).map((i) =>
      parseInt(i.value),
    ),
    existingDisplayNos = Array.from(m.querySelectorAll(".manager-display-no-input")).map((i) =>
      parseInt(i.value),
    ),
    n = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1,
    nextDisplayNo = existingDisplayNos.length > 0 ? Math.max(...existingDisplayNos) + 1 : 1,
    d = document.createElement("div");
  (d.className = "manager-item"),
    d.classList.add("manager-item-new"),
    (d.dataset.id = String(n)),
    (d.dataset.originalId = String(n)),
    (d.dataset.displayNo = String(nextDisplayNo)),
    (d.draggable = !0),
    setSafeHtml(
      d,
      managerItemHtml(
        {
          id: n,
          displayNo: nextDisplayNo,
          type: "standard",
          answerType:
            "\
variable",
          staticItems: [],
        },
        { isNew: !0 },
      ),
    ),
    m.appendChild(d),
    setupQuestionManagerDragDrop(m),
    bindManagerItemEvents(d, { onCancel: () => d.remove() }),
    setManagerItemCollapsedState(d, !1),
    d.querySelector('input[type="text"]').focus();
}
function restoreAllArchivedQuestions() {
  const i = document.querySelectorAll(
    "#manager-list .manager-item:not(.hidden-question)",
  );
  i.length !== 0 &&
    confirm(
      `Ar\u015Fivdeki ${i.length} sorunun t\xFCm\xFCn\xFC aktif hale getirmek ister misiniz?`,
    ) &&
    (i.forEach((item) => {
      item.querySelector(
        ".arc\
hive-checkbox",
      ).checked = !1;
    }),
    filterManagerView(),
    notify.info(
      "Ar\u015Fivdeki sorular aktifle\u015Ftirildi. Kaydetmeyi unutmay\u0131n.",
    ));
}
function deleteAllArchivedQuestions() {
  const i = document.querySelectorAll(
    "#manager-list .manager-item:not(.hidden-question)",
  );
  i.length !== 0 &&
    confirm(`Ar\u015Fivdeki ${i.length} sor\
unun t\xFCm\xFCn\xFC kal\u0131c\u0131 olarak silmek istedi\u011Finizden emin misiniz?`) &&
    (i.forEach((item) => {
      item.classList.add("fade-out"),
        setTimeout(() => {
          item.classList.add("to-be-deleted"), (item.hidden = !0);
        }, 500);
    }),
    (document.getElementById("delete-all-archived-btn").disabled = !0),
    notify.info(
      "\
Ar\u015Fivdeki sorular silinmek \xFCzere i\u015Faretlendi. Kaydetmeyi unutmay\u0131n.",
    ));
}

export { initializeSoruYoneticisiModule };
/*
TOTAL_LINES: 2547
HAS_PLACEHOLDERS: NO
OMITTED_ANY_CODE: NO
IS_THIS_THE_COMPLETE_FILE: YES
*/
