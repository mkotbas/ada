import { pb } from "./core/db-config";
import { saveAuditHistoryForSelectedStore, saveFormState } from "./core/api";
import {
  getAllStores,
  getAuditedThisMonth,
  getDideData,
  getExpiredCodes,
  getFideData,
  getFideQuestions,
  getQuestionDisplayNo,
  getIsPocketBaseConnected,
  getPopCodes,
  getProductList,
  getReportFideMonthlyScore,
  getReportFideMonthlyScores,
  getSelectedStore,
  getStoreEmails,
  MONTH_NAMES,
  setCurrentReportId,
  setReportFideMonthlyScores,
  setSelectedStore,
} from "./core/state";
import { debounce, getYearMonthKey, parseScore } from "./core/utils";
import { renderPerformanceTable } from "./core/performance-table";
import { normalizeQuestionStatusMap } from './core/migration';
import { dispatchMonthlyAuditDataChanged } from './core/monthly-audit-state';
import { notify } from "./core/notify";
import { errorService } from "./core/error";
import {
  appendIconOnly,
  appendIconText,
  make,
  setSafeHtml,
  setSelectPlaceholder,
} from "./core/dom";

type EmailListItem = {
  html: string;
  type: "static" | "dynamic";
  comp?: boolean;
};
type ProductOption = { type?: string; code?: string; name?: string; qty?: string };

const debouncedSave = debounce(() => {
  getIsPocketBaseConnected() &&
    getSelectedStore() &&
    saveFormState(getFormDataForSaving());
}, 800);

// Connection state
function updateConnectionIndicator() {
  const statusSwitch = document.getElementById(
      "connection-stat\
us-switch",
    ),
    statusText = document.getElementById("connection-status-text");
  if (!statusSwitch || !statusText) return;
  const isOnline = getIsPocketBaseConnected() && pb.authStore.isValid;
  statusSwitch.classList.toggle("connected", isOnline),
    statusSwitch.classList.toggle("disconnected", !isOnline),
    (statusText.textContent = isOnline
      ? "Buluta Ba\u011Fl\u0131"
      : "Ba\u011Fl\u0131 De\u011Fil");
}
let formListenersAttached = !1;
function buildForm() {
  const formContainer = document.getElementById("form-content");
  if (!formContainer) return;
  const fragment = document.createDocumentFragment();
  getFideQuestions()
    .filter((q) => !q.isArchived)
    .forEach((q) => {
      const el = createQuestionElement(q);
      fragment.appendChild(el);
    }),
    formContainer.replaceChildren(),
    formContainer.appendChild(fragment);
  const popContainer = document.getElementById("popCodesContainer");
  popContainer && initializePopSystem(popContainer),
    formListenersAttached ||
      (formContainer.addEventListener("change", handleFormChange),
      formContainer.addEventListener("click", handleFormClick),
      formContainer.addEventListener("input", handleFormInput),
      (formListenersAttached = !0));
}
function resetForm() {
  setCurrentReportId(null), setReportFideMonthlyScores({}), buildForm();
}
function startNewReport() {
  setSelectedStore(null), setCurrentReportId(null);
  const searchInput = document.getElementById("store-search-input");
  searchInput && (searchInput.value = ""),
    resetForm(),
    updateFormInteractivity(!1);
}
function updateFormInteractivity(enable) {
  document
    .getElementById("form-content")
    ?.querySelectorAll("button, input, select")
    .forEach((el) => {
      el.disabled = !enable;
    });
}
function handleFormClick(e) {
  const btn = e.target.closest("button");
  if (btn) {
    if (btn.classList.contains("styling-selection-remove-btn")) {
      removeStylingSelection(btn);
      return;
    }
    if (btn.classList.contains("add-item-btn")) {
      const fideItem = btn.closest(".fide-item");
      const questionId = fideItem?.id?.replace("fide-item-", "") ?? "";
      const question = getFideQuestions().find((q) => String(q.id) === questionId);
      if (question?.type === "styling_list") {
        prepareNextStylingSelection(questionId);
        return;
      }
      const containerId = btn.dataset.containerId ?? "";
      addDynamicInput(containerId);
      return;
    }
    if (
      btn.classList.contains("status-btn") &&
      btn.closest(".dynamic-input-item")
    ) {
      toggleCompleted(btn);
      return;
    }
    if (btn.classList.contains("status-btn") && btn.dataset.questionId) {
      toggleQuestionCompleted(btn, btn.dataset.questionId);
      return;
    }
    if (btn.classList.contains("remove-btn") && btn.dataset.questionId) {
      toggleQuestionRemoved(btn, btn.dataset.questionId);
      return;
    }
    if (btn.classList.contains("delete-bar")) {
      if (btn.closest(".static-item")) {
        toggleStaticItemInactive(btn);
        return;
      }
      initiateDeleteItem(btn);
      return;
    }
    if (btn.classList.contains("delete-item-btn")) {
      initiateDeleteItem(btn);
      return;
    }
    if (btn.classList.contains("add-product-btn")) {
      addProductToList(undefined, undefined, !0, undefined, btn.closest(".fide-item") ?? undefined);
      return;
    }
    if (btn.classList.contains("pop-copy-btn")) {
      copySelectedCodes();
      return;
    }
    if (btn.classList.contains("pop-clear-btn")) {
      clearSelectedCodes();
      return;
    }
    if (btn.classList.contains("pop-expired-btn")) {
      selectExpiredCodes();
      return;
    }
    if (btn.classList.contains("pop-email-btn")) {
      openEmailDraft();
      return;
    }
    if (btn.id === "back-to-form-btn") {
      returnToMainPage();
      return;
    }
    if (btn.id === "generate-email-btn") {
      generateEmail();
      return;
    }
  }
}
function handleFormChange(e) {
  const target = e.target;
  if (target.classList.contains("styling-mode-toggle")) {
    const cb = target,
      qId = cb.dataset.questionId ?? "";
    toggleStylingView(cb, qId);
    return;
  }
  if (target.classList.contains("styling-main-category-select")) {
    handleStylingMainCatChange(e);
    return;
  }
  if (target.classList.contains("styling-sub-category-select")) {
    handleStylingSubCatChange(e);
    return;
  }
  if (target.classList.contains("sub-category-qty-input")) {
    handleStylingSubQtyChange(e);
    return;
  }
  if (target.classList.contains("pop-checkbox")) {
    checkExpiredPopCodes(), debouncedSave();
    return;
  }
  if (target.classList.contains("qty-edit-input")) {
    debouncedSave();
    return;
  }
}
function handleFormInput(e) {
  const target = e.target;
  if (target.classList?.contains("sub-category-qty-input")) {
    handleStylingSubQtyChange(e);
    return;
  }
  target.tagName === "INPUT" && target.type === "text" && debouncedSave();
}
function createButton(spec) {
  const button = make("button", { className: spec.className });
  return (
    Object.entries(spec.dataset ?? {}).forEach(([key, value]) => {
      button.dataset[key] = String(value ?? "");
    }),
    appendIconText(button, spec.icon, spec.label),
    button
  );
}
function createSectionLead(text, className = "") {
  const paragraph = make("p", { className }),
    bold = make("b");
  return bold.append(make("i", { text })), paragraph.append(bold), paragraph;
}
function appendSelectOptions(select, options) {
  options.forEach(({ value, label }) => {
    const option = make("option", { text: label });
    (option.value = value), select.append(option);
  });
}
function createSwitchToggle(questionId) {
  const switchLabel = make("label", { className: "switch" }),
    input = make("input");
  return (
    (input.type = "checkbox"),
    (input.className = "styling-mode-toggle"),
    (input.dataset.questionId = questionId),
    switchLabel.append(input, make("span", { className: "slider round" })),
    switchLabel
  );
}
function createStylingRow(label, opts = undefined) {
  const row = make("div", { className: "styling-row" });
  opts?.id && (row.id = opts.id), opts?.hidden && (row.hidden = !0);
  const labelEl = make("div", {
      className:
        "\
styling-label",
      text: label,
    }),
    content = make("div", {
      className: opts?.contentClassName ?? "styling-content",
    });
  return row.append(labelEl, content), { row, content };
}
function getProductPackageLabel(product) {
  const packageQty = String(product?.qty ?? "").trim();
  return packageQty ? ` (Paket İçi: ${packageQty})` : "";
}
function populateProductSelect(select) {
  let currentOptgroup = null;
  getProductList().forEach((product) => {
    if (product.type === "header") {
      currentOptgroup && select.append(currentOptgroup),
        (currentOptgroup = document.createElement("optgroup")),
        (currentOptgroup.label = product.name);
      return;
    }
    const option = make("option", {
      text: `${product.code} - ${product.name}${getProductPackageLabel(product)}`,
    });
    (option.value = product.code), (currentOptgroup ?? select).append(option);
  }),
    currentOptgroup && select.append(currentOptgroup);
}

// Question builders
function createQuestionContent(q) {
  if (q.type === "product_list") return createProductListContent(q);
  if (
    q.type ===
    "pop_sys\
tem"
  )
    return createPopContent(q);
  if (q.type === "styling_list") return createStylingContent(q);
  const wrapper = make("div"),
    inputArea = make("div", {
      className:
        "\
input-area",
    }),
    container = make("div");
  return (
    (container.id = `sub-items-container-fide${q.id}`),
    (q.staticItems ?? []).forEach((item, index) =>
      container.append(createStaticItem(item, index)),
    ),
    inputArea.append(container),
    wrapper.append(inputArea),
    wrapper
  );
}
function createQuestionElement(q) {
  const item = make(
    "di\
v",
    { className: `fide-item${q.isArchived ? " archived-item" : ""}` },
  );
  item.id = `fide-item-${q.id}`;
  const titleContainer = make("div", {
    className:
      "fide-\
title-container",
  });
  titleContainer.append(
    make("span", { className: "badge", text: `FiDe ${getQuestionDisplayNo(q)}` }),
    make("p", { className: "fide-question-title", text: q.title }),
  );
  const actionsDiv = make("div", { className: "fide-actions" }),
    actionButtons = [];
  return (
    q.type !== "pop_system" &&
      actionButtons.push({
        className:
          "\
add-item-btn btn btn-sm btn-light",
        icon: "fas fa-plus",
        label: "Yeni Ekle",
        dataset: {
          containerId:
            q.type === "product_list"
              ? `fide${q.id}_pleksi`
              : q.type === "styling_list"
                ? `fide${q.id}_notes`
                : `fide${q.id}`,
        },
      }),
    actionButtons.push(
      {
        className: "status-btn btn btn-sm btn-success",
        icon: "fas fa-ch\
eck",
        label: "Tamamland\u0131",
        dataset: { questionId: String(q.id) },
      },
      {
        className: "remove-btn btn btn-sm btn-danger",
        icon: "fas fa-times-circle",
        label:
          "\
\xC7\u0131kar",
        dataset: { questionId: String(q.id) },
      },
    ),
    actionsDiv.append(...actionButtons.map(createButton)),
    item.append(titleContainer, createQuestionContent(q), actionsDiv),
    item
  );
}
function createStaticItem(text, staticIndex = undefined) {
  const div = make("div", { className: "static-item" }),
    content = make("div", { className: "content" });
  staticIndex !== undefined && (div.dataset.staticIndex = String(staticIndex));
  return (
    setSafeHtml(content, text),
    div.append(
      content,
      createButton({
        className: "delete-bar btn btn-sm btn-danger",
        icon: "fas fa-trash",
        label: "",
      }),
    ),
    setStaticItemInactive(div, !1, !1),
    div
  );
}
function setStaticItemInactive(item, inactive, save = !0) {
  const button = item.querySelector(".delete-bar"),
    content = item.querySelector(".content");
  item.classList.toggle("is-inactive", inactive),
    item.setAttribute("aria-disabled", inactive ? "true" : "false"),
    content?.setAttribute("aria-hidden", inactive ? "true" : "false"),
    button &&
      (appendIconOnly(button, inactive ? "fas fa-undo" : "fas fa-trash"),
      button.classList.toggle("btn-danger", !inactive),
      button.classList.toggle("btn-primary", inactive),
      button.setAttribute("title", inactive ? "Geri Al" : "Pasif Yap"),
      button.setAttribute("aria-label", inactive ? "Geri Al" : "Pasif Yap"));
  save && debouncedSave();
}
function toggleStaticItemInactive(btn) {
  const item = btn.closest(".static-item");
  item && setStaticItemInactive(item, !item.classList.contains("is-inactive"));
}
function collectInactiveStaticItemIndexes(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll(".static-item.is-inactive"))
    .map((item) => Number(item.dataset.staticIndex))
    .filter((index) => Number.isInteger(index));
}
function applyInactiveStaticItemIndexes(containerId, indexes) {
  const container = document.getElementById(containerId),
    inactiveSet = new Set((indexes ?? []).map((index) => String(index)));
  container?.querySelectorAll(".static-item").forEach((item) => {
    setStaticItemInactive(item, inactiveSet.has(item.dataset.staticIndex ?? ""), !1);
  });
}

// Email helpers
function escapeEmailText(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function isAllowedEmailHref(value) {
  return /^(https?:|mailto:|tel:|#)/i.test(value);
}
function sanitizeEmailFragment(html) {
  const doc = new DOMParser().parseFromString(
      html,
      "text/htm\
l",
    ),
    allowedTags = new Set(["A", "B", "BR", "EM", "I", "STRONG", "U"]),
    sanitizeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE)
        return escapeEmailText(node.textContent ?? "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node,
        tag = el.tagName.toUpperCase();
      if (!allowedTags.has(tag))
        return Array.from(el.childNodes)
          .map((child) => sanitizeNode(child))
          .join("");
      if (tag === "BR") return "<br>";
      if (tag === "A") {
        const href = el.getAttribute("href")?.trim() ?? "",
          safeHref = isAllowedEmailHref(href) ? escapeEmailText(href) : "",
          text =
            Array.from(el.childNodes)
              .map((child) => sanitizeNode(child))
              .join("") || escapeEmailText(el.textContent ?? "");
        return safeHref
          ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : text;
      }
      const content = Array.from(el.childNodes)
          .map((child) => sanitizeNode(child))
          .join(""),
        lowerTag = tag.toLowerCase();
      return `<${lowerTag}>${content}</${lowerTag}>`;
    };
  return Array.from(doc.body.childNodes)
    .map((node) => sanitizeNode(node))
    .join("");
}
function buildEmailListItemsFromContainer(container) {
  return Array.from(container.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter(
      (node) => !node.classList.contains("is-deleting") && !node.classList.contains("is-inactive"),
    )
    .map((node): EmailListItem => {
      if (node.classList.contains("static-item")) {
        const content = node.querySelector<HTMLElement>(".content");
        return {
          html: sanitizeEmailFragment(content?.innerHTML ?? "").trim(),
          type: "static",
          comp: !1,
        };
      }
      const input = node.querySelector<HTMLInputElement>('input[type="text"]');
      return {
        html: escapeEmailText(input?.value.trim() ?? ""),
        type: "dynamic",
        comp: input?.classList.contains("completed") ?? !1,
      };
    })
    .filter((item) => item.html);
}
function renderEmailList(items) {
  return items.length === 0
    ? ""
    : `<ul>${items
        .map((item) =>
          item.comp
            ? `<li>${item.html} <span class="status-tag status-tag--done">Tamamland\u0131</span></l\
i>`
            : `<li>${item.html}</li>`,
        )
        .join("")}</ul>`;
}
function collectStaticEmailItems(container) {
  return Array.from(
    container.querySelectorAll(
      ".static-item .content",
    ) as NodeListOf<HTMLElement>,
  )
    .filter((item) => !item.closest(".static-item")?.classList.contains("is-inactive"))
    .map((item) => sanitizeEmailFragment(item.innerHTML).trim())
    .filter(Boolean)
    .map((html) => ({ html }));
}
function createProductListContent(q) {
  const inputArea = make("div", { className: "input-area" }),
    adderRow = make("div", { className: "product-selector-row" }),
    select = make("select", {
      className:
        "\
form-select",
      attrs: {
        id: `product-selector-${q.id}`,
        name: `productSelector${q.id}`,
      },
    });
  (select.className += " product-selector"),
    setSelectPlaceholder(select, "-- Malzeme Se\xE7in --"),
    populateProductSelect(select);
  const qtyInput = make("input", {
    className: "form-input qty-edit-input",
    attrs: {
      id: `product-qty-${q.id}`,
      name: `productQty${q.id}`,
      placeholder: "Adet",
      min: "1",
      value: "1",
    },
  });
  (qtyInput.type = "number"),
    (qtyInput.className += " product-qty");
  const productsList = make("div", { className: "selected-products-list" });
  const pleksiContainer = make("div");
  return (
    (pleksiContainer.id = `sub-\
items-container-fide${q.id}_pleksi`),
    adderRow.append(
      select,
      qtyInput,
      createButton({
        className: "add-product-btn btn btn-success btn-sm",
        icon: "fas fa-plus",
        label:
          "\
Ekle",
        dataset: {},
      }),
    ),
    inputArea.append(
      createSectionLead("Sipari\u015F verilmesi gerekenler:"),
      adderRow,
      productsList,
      make("hr"),
      createSectionLead(
        "Pleksiyle sergilenmesi gerekenler veya yanl\u0131\u015F pleksi malzemeyle kullan\u0131lanlar",
        "pleksi-section-lead",
      ),
      pleksiContainer,
    ),
    inputArea
  );
}
function createPopContent(q) {
  const inputArea = make("div", { className: "input-area" }),
    popContainer = make("div", {
      className:
        "\
pop-grid",
    });
  popContainer.id = "popCodesContainer";
  const warning = make("div", {
    className: "warning-message",
    text: "Se\xE7iminizde s\xFCresi dolmu\u015F kodlar\
 bulunmaktad\u0131r.",
  });
  (warning.id = "expiredWarning"), (warning.hidden = !0);
  const btnRow = make("div", { className: "pop-button-container" });
  return (
    [
      {
        className:
          "\
btn btn-sm pop-copy-btn btn-success",
        label: "Kopyala",
        icon: "",
      },
      {
        className: "btn btn-sm pop-clear-btn btn-danger",
        label: "Temizle",
        icon: "",
      },
      {
        className:
          "\
btn btn-sm pop-expired-btn btn-secondary",
        label: "Bitenler",
        icon: "",
      },
      {
        className: "btn btn-sm pop-email-btn btn-primary",
        label: "E-Posta",
        icon: "",
      },
    ].forEach(({ className, label }) =>
      btnRow.append(make("button", { className, text: label })),
    ),
    q.popEmailTo?.length &&
      btnRow
        .querySelector(
          ".pop-email-bt\
n",
        )
        ?.setAttribute("data-email-to", q.popEmailTo.join(",")),
    inputArea.append(popContainer, warning, btnRow),
    inputArea
  );
}
function createStylingContent(q) {
  const wrapper = make("div"),
    notesContainer = make("div", { className: "notes-container" });
  notesContainer.id = `sub-items-container-fide${q.id}_notes`;
  const toggleRow = make("div", { className: "mode-toggle-container" });
  toggleRow.append(
    make("span", {
      className: "mode-toggle-label",
      text: "Detayl\u0131 Gi\
ri\u015F / Malzeme Ekle",
    }),
    createSwitchToggle(String(q.id)),
  );
  const standardView = make("div");
  (standardView.id = `standard-view-container-${q.id}`),
    (q.staticItems ?? []).forEach((item, index) =>
      standardView.append(createStaticItem(item, index)),
    );
  const stylingContainer = make("div", {
    className:
      "input-area styl\
ing-list-container",
  });
  (stylingContainer.id = `styling-container-${q.id}`),
    (stylingContainer.dataset.questionId = String(q.id)),
    (stylingContainer.hidden = !0);
  const mainRow = createStylingRow("Ana Kategori"),
    mainSelect = make("select", {
      className: "styling-main-category-select form-select",
      attrs: {
        id: `styling-main-category-${q.id}`,
        name: `stylingMainCategory${q.id}`,
      },
    });
  setSelectPlaceholder(mainSelect, "-- Ana Kategori Se\xE7in --"),
    appendSelectOptions(
      mainSelect,
      (q.stylingData ?? []).map((item) => ({
        value: item.name,
        label: item.name,
      })),
    ),
    mainRow.content.append(mainSelect);
  const subRow = createStylingRow("Alt Kategori", {
      id: `styling-sub-container-${q.id}`,
      hidden: !0,
      contentClassName:
        "\
styling-content styling-sub-row",
    }),
    subSelect = make("select", {
      className: "styling-sub-category-select form-select",
      attrs: {
        id: `styling-sub-category-${q.id}`,
        name: `stylingSubCategory${q.id}`,
      },
    });
  setSelectPlaceholder(subSelect, "-- Alt Kategori Se\xE7in --");
  const subQty = make("input", {
    className: "sub-category-qty-input form-input",
    attrs: {
      id: `styling-sub-category-qty-${q.id}`,
      name: `stylingSubCategoryQty${q.id}`,
      min: "1",
      value: "1",
    },
  });
  (subQty.type = "number"), subRow.content.append(subSelect, subQty);
  const productRow = createStylingRow("Sipari\u015F Listesi");
  return (
    productRow.content.append(
      make("div", { className: "styling-selected-products-list" }),
    ),
    stylingContainer.append(mainRow.row, subRow.row, productRow.row),
    wrapper.append(notesContainer, toggleRow, standardView, stylingContainer),
    wrapper
  );
}

// Form state
function getFormDataForSaving() {
  const reportData = /** @type {{ questions_status: Record<string, any> }} */ {
    questions_status: {},
  };
  return (
    getFideQuestions().forEach((q) => {
      const itemDiv = document.getElementById(`fide-item-${q.id}`);
      if (!itemDiv) return;
      const isRemoved =
          itemDiv.classList.contains(
            "questi\
on-removed",
          ),
        isCompleted =
          itemDiv
            .querySelector(".fide-title-container")
            ?.classList.contains("question-completed") ?? !1,
        questionData = {
          removed: isRemoved,
          completed: isCompleted,
          dynamicInputs: [],
          selectedProducts: [],
          selectedPops: [],
          inactiveStaticItemIndexes: [],
        };
      if (q.type === "standard") {
        const container = document.getElementById(
          `sub-items-container-fide${q.id}`,
        );
        questionData.inactiveStaticItemIndexes = collectInactiveStaticItemIndexes(
          `sub-items-container-fide${q.id}`,
        );
        container &&
          Array.from(container.children)
            .reverse()
            .forEach((node) => {
              if (
                node.classList.contains(
                  "dynamic-in\
put-item",
                )
              ) {
                const input =
                  /** @type {HTMLInputElement | null} */ node.querySelector(
                    'input[type="text"]',
                  );
                input?.value.trim() &&
                  questionData.dynamicInputs.push({
                    text: input.value.trim(),
                    completed: input.classList.contains("completed"),
                  });
              }
            });
      } else if (q.type === "product_list")
        itemDiv
          .querySelectorAll(
            ".selected-products-list .selected-product-item",
          )
          .forEach((item) => {
            questionData.selectedProducts.push({
              code: item.dataset.code ?? "",
              name: item.dataset.name ?? "",
              qty: item.dataset.qty ?? "1",
            });
          }),
          collectDynamicInputs(
            `sub-items-container-fide${q.id}_pleksi`,
            questionData.dynamicInputs,
          );
      else if (q.type === "pop_system")
        questionData.selectedPops = Array.from(
          itemDiv.querySelectorAll(".pop-checkbox:checked"),
        ).map((cb) => cb.value);
      else if (q.type === "styling_list") {
        const container = itemDiv.querySelector(".styling-list-container");
        if (container) {
          itemDiv
            .querySelectorAll(
              ".styling-selected-products-list .selected-product-item",
            )
            .forEach((item) => {
              const distributionItems = item.querySelectorAll(
                ".styling-distribution-item",
              );
              if (distributionItems.length > 0) {
                distributionItems.forEach((distributionItem) => {
        const row = /** @type {HTMLElement} */ (distributionItem);
                  const qtyInput =
                    /** @type {HTMLInputElement | null} */ distributionItem.querySelector(
                      ".qty-edit-input",
                    );
                  const qty = qtyInput?.value ?? distributionItem.dataset.qty ?? "0";
                  if (normalizePositiveInteger(qty, 0) < 1) return;
                  questionData.selectedProducts.push({
                    code: row.dataset.code ?? "",
                    name: row.dataset.name ?? "",
                    qty,
                    originalCode:
                      row.dataset.originalCode ?? item.dataset.originalCode ?? "",
                    originalName:
                      row.dataset.originalName ?? item.dataset.originalName ?? "",
                  });
                });
                return;
              }
              const qtyInput =
                /** @type {HTMLInputElement | null} */ item.querySelector(
                  ":scope > .product-qty-row .qty-edit-input",
                );
              const qty = qtyInput?.value ?? item.dataset.qty ?? "1";
              if (normalizePositiveInteger(qty, 0) < 1) return;
              questionData.selectedProducts.push({
                code: item.dataset.code ?? "",
                name: item.dataset.name ?? "",
                qty,
                originalCode: item.dataset.originalCode ?? item.dataset.code ?? "",
                originalName: item.dataset.originalName ?? item.dataset.name ?? "",
              });
            });
          const stylingSelections = Array.from(
            container.querySelectorAll(".styling-selection-group"),
          )
            .map((group) => {
              const removedAlternativeCodesByProduct = Array.from(
                group.querySelectorAll<HTMLElement>(".selected-product-item"),
              )
                .map((productItem) => ({
                  originalCode:
                    productItem.dataset.originalCode ?? productItem.dataset.code ?? "",
                  removedAlternativeCodes: normalizeRemovedAlternativeCodes(
                    productItem.dataset.removedAlternativeCodes
                      ? productItem.dataset.removedAlternativeCodes.split("|")
                      : [],
                  ),
                }))
                .filter(
                  (productState) =>
                    productState.originalCode && productState.removedAlternativeCodes.length > 0,
                );
              return {
                mainCategory: group.dataset.mainCategory ?? "",
                subCategory: group.dataset.subCategory ?? "",
                subCategoryQty: group.dataset.subCategoryQty ?? "1",
                ...(removedAlternativeCodesByProduct.length > 0
                  ? { removedAlternativeCodesByProduct }
                  : {}),
              };
            })
            .filter((selection) => selection.mainCategory && selection.subCategory);
          if (stylingSelections.length > 0) {
            Object.assign(questionData, { stylingCategorySelections: stylingSelections });
          }
        }
        questionData.inactiveStaticItemIndexes = collectInactiveStaticItemIndexes(
          `standard-view-container-${q.id}`,
        );
        collectDynamicInputs(
          `sub-items-container-fide${q.id}_notes`,
          questionData.dynamicInputs,
        );
      }
      reportData.questions_status[String(q.id)] = questionData;
    }),
    reportData
  );
}
function collectDynamicInputs(containerId, target) {
  const container = document.getElementById(containerId);
  container &&
    Array.from(container.children)
      .reverse()
      .forEach((node) => {
        if (node.classList.contains("dynamic-input-item")) {
          const input =
            /** @type {HTMLInputElement | null} */ node.querySelector(
              'input[type="text"]',
            );
          input?.value.trim() &&
            target.push({
              text: input.value.trim(),
              completed: input.classList.contains("completed"),
            });
        }
      });
}
function loadReportUI(reportData) {
  if (!reportData) {
    resetForm(), updateFormInteractivity(!0);
    return;
  }
  try {
    resetForm();
    const normalizedReportData = normalizeQuestionStatusMap(
      reportData,
    ) as Record<string, any>;
    for (const qId of Object.keys(normalizedReportData)) {
      const resolvedQId = String(qId),
        item = document.getElementById(`fide-item-${resolvedQId}`);
      if (!item) continue;
      const data = normalizedReportData[qId],
        qInfo = getFideQuestions().find((q) => String(q.id) === resolvedQId);
      if (!qInfo) continue;

      data.removed
        ? toggleQuestionRemoved(item.querySelector(".remove-btn"), resolvedQId, !1)
        : data.completed &&
          toggleQuestionCompleted(item.querySelector(".status-btn"), resolvedQId, !1);

      applyInactiveStaticItemIndexes(
        qInfo.type === "styling_list"
          ? `standard-view-container-${resolvedQId}`
          : `sub-items-container-fide${resolvedQId}`,
        data.inactiveStaticItemIndexes,
      );

      data.dynamicInputs?.forEach((inp) => {
        let cid = `fide${resolvedQId}`;
        qInfo.type === "product_list"
          ? (cid = `fide${resolvedQId}_pleksi`)
          : qInfo.type === "styling_list" && (cid = `fide${resolvedQId}_notes`);
        addDynamicInput(cid, inp.text, inp.completed, !1);
      });

      if (qInfo.type === "product_list") {
        data.selectedProducts?.forEach((p) => {
          addProductToList(p.code, p.qty, !1, p.name, item);
        });
      } else if (qInfo.type === "styling_list") {
        const stylingSelections = normalizeStylingSelections(
          data.stylingCategorySelections,
        );
        if (
          stylingSelections.length > 0 ||
          (data.selectedProducts && data.selectedProducts.length > 0)
        ) {
          const toggle = item.querySelector(".styling-mode-toggle");
          toggle &&
            !toggle.checked &&
            ((toggle.checked = !0), toggleStylingView(toggle, resolvedQId));
        }
        if (stylingSelections.length > 0) {
          stylingSelections.forEach((selection) => {
            addStylingSelectionGroup(
              resolvedQId,
              selection.mainCategory,
              selection.subCategory,
              selection.subCategoryQty,
              !1,
              data.selectedProducts,
            );
          });
          prepareNextStylingSelection(resolvedQId, !1);
        } else {
          data.selectedProducts?.forEach((p) => {
            addStylingProductToList(resolvedQId, p.code, Number(p.qty), p.name, !1);
          });
        }
      }

      data.selectedPops?.forEach((pc) => {
        const cb = document.querySelector(`.pop-checkbox[value="${pc}"]`);
        cb && (cb.checked = !0);
      });
      checkExpiredPopCodes();
    }
    updateFormInteractivity(!0);
  } catch {
    resetForm(), updateFormInteractivity(!0);
  }
}

// POP actions
function initializePopSystem(container) {
  container.replaceChildren(),
    getPopCodes().forEach((code) => {
      const lbl = document.createElement("label");
      lbl.className = "checkbox-label";
      const cb = document.createElement("input");
      (cb.type = "checkbox"),
        (cb.value = code),
        (cb.className = "pop-checkbox"),
        lbl.appendChild(cb),
        lbl.appendChild(document.createTextNode(` ${code}`)),
        container.appendChild(lbl);
    });
}
function checkExpiredPopCodes() {
  const warn = document.getElementById("expiredWarning");
  if (!warn) return;
  Array.from(document.querySelectorAll(".pop-checkbox:checked")).some((cb) =>
    getExpiredCodes().includes(cb.value),
  )
    ? warn.removeAttribute("hidden")
    : warn.setAttribute("hidden", "");
}
function copySelectedCodes() {
  const codes = Array.from(document.querySelectorAll(".pop-checkbox:checked"))
    .map((cb) => cb.value)
    .filter((c) => !getExpiredCodes().includes(c));
  codes.length &&
    navigator.clipboard
      .writeText(codes.join(", "))
      .then(() => notify.success("Kodlar kopyaland\u0131!"))
      .catch((e) =>
        errorService.handle(e, {
          userMessage:
            "Kopyalama i\u015Flemi ba\u015Far\u0131s\u0131\
z oldu.",
        }),
      );
}
function clearSelectedCodes() {
  document.querySelectorAll(".pop-checkbox").forEach((cb) => {
    cb.checked = !1;
  }),
    checkExpiredPopCodes(),
    debouncedSave();
}
function selectExpiredCodes() {
  const expired = getExpiredCodes();
  document.querySelectorAll(".pop-checkbox").forEach((cb) => {
    cb.checked = expired.includes(cb.value);
  }),
    checkExpiredPopCodes(),
    debouncedSave();
}
function openEmailDraft() {
  const codes = Array.from(
    document.querySelectorAll(
      ".pop-checkbox\
:checked",
    ),
  )
    .map((cb) => cb.value)
    .filter((c) => !getExpiredCodes().includes(c));
  if (!codes.length) return;
  const q = getFideQuestions().find((f) => f.type === "pop_system"),
    toEmails = q?.popEmailTo?.join(", ") ?? "",
    ccEmails = q?.popEmailCc?.join(", ") ?? "",
    w = window.open("", "_blank");
  if (!w) return;
  const doc = w.document;
  (doc.title = "E-posta Tasla\u011F\u0131"), doc.body.replaceChildren();
  const wrap = doc.createElement("div"),
    line = (label, value) => {
      const p = doc.createElement("p"),
        b2 = doc.createElement("b");
      return (
        (b2.textContent = label),
        p.append(b2, doc.createTextNode(` ${value}`)),
        p
      );
    };
  wrap.appendChild(line("Kime:", toEmails)),
    ccEmails && wrap.appendChild(line("Bilgi (CC):", ccEmails));
  const h = doc.createElement("p"),
    b = doc.createElement("b");
  (b.textContent = "\u0130\xE7erik:"), h.appendChild(b), wrap.appendChild(h);
  const pre = doc.createElement("pre");
  (pre.textContent = codes.join(", ")),
    wrap.appendChild(pre),
    doc.body.appendChild(wrap);
}
function toggleCompleted(btn) {
  const inp = btn.parentElement?.querySelector('input[type="text"]');
  if (!inp) return;
  const comp = inp.classList.toggle("completed");
  (inp.readOnly = comp),
    appendIconText(
      btn,
      comp ? "fas fa-undo" : "fas fa-check",
      comp
        ? "Geri Al"
        : "Tamamlan\
d\u0131",
    ),
    btn.classList.toggle("undo", comp),
    debouncedSave();
}
function toggleQuestionCompleted(btn, id, save = !0) {
  const div = document.getElementById(`fide-item-${id}`);
  if (!div) return;
  const comp =
    div
      .querySelector(".fide-title-container")
      ?.classList.toggle("question-completed") ?? !1;
  appendIconText(
    btn,
    comp ? "fas fa-undo" : "fas fa-check",
    comp ? "Geri Al" : "Tamamland\u0131",
  ),
    btn.classList.toggle("undo", comp);
  const styl = div.querySelector(
      ".sty\
ling-mode-toggle",
    ),
    area = div.querySelector(".input-area");
  if (
    (!styl &&
      area &&
      (comp ? area.setAttribute("hidden", "") : area.removeAttribute("hidden")),
    styl)
  ) {
    const sCont = div.querySelector(".styling-list-container"),
      vCont = document.getElementById(`standard-view-container-${id}`),
      tCont = div.querySelector(".mode-toggle-container"),
      nCont = document.getElementById(`sub-items-container-fide${id}_notes`);
    comp
      ? [sCont, vCont, tCont, nCont].forEach((el) =>
          el?.setAttribute("hidden", ""),
        )
      : (tCont?.removeAttribute("hidden"),
        nCont?.removeAttribute("hidden"),
        vCont?.removeAttribute("hidden"),
        styl.checked || sCont?.setAttribute("hidden", ""));
  }
  save && debouncedSave();
}
function toggleQuestionRemoved(btn, id, save = !0) {
  const div = document.getElementById(`fi\
de-item-${id}`);
  if (!div) return;
  const rem = div.classList.toggle("question-removed"),
    area = div.querySelector(".input-area"),
    tCont = div.querySelector(".mode-toggle-container"),
    nCont = document.getElementById(`sub-items-container-fide${id}_notes`);
  tCont &&
    (rem ? tCont.setAttribute("hidden", "") : tCont.removeAttribute("hidden")),
    area &&
      (rem ? area.setAttribute("hidden", "") : area.removeAttribute("hidden")),
    nCont &&
      (rem
        ? nCont.setAttribute("hidden", "")
        : nCont.removeAttribute("hidden")),
    appendIconText(
      btn,
      rem ? "fas fa-undo" : "fas fa-times-circle",
      rem ? "Geri Al" : "\xC7\u0131kar",
    ),
    btn.classList.toggle("btn-danger", !rem),
    btn.classList.toggle("btn-primary", rem),
    div.querySelectorAll(".add-item-btn, .status-btn").forEach((b) => {
      b.disabled = rem;
    }),
    save && debouncedSave();
}
function addDynamicInput(id, val = "", comp = !1, save = !0) {
  const cont = document.getElementById(`sub-items-container-${id}`);
  if (!cont) return;
  const div = document.createElement("div");
  div.className = "dynamic-input-item";
  const inp = document.createElement("input");
  (inp.type = "text"), (inp.value = val), (inp.className = "form-input");
  const statusBtn = document.createElement("button");
  (statusBtn.className =
    "status-btn btn btn-sm \
btn-success"),
    appendIconText(statusBtn, "fas fa-check", "Tamamland\u0131");
  const deleteBtn = document.createElement("button");
  (deleteBtn.className = "delete-bar btn btn-sm btn-danger"),
    appendIconOnly(deleteBtn, "fas fa-trash"),
    inp.addEventListener("keydown", (e) => {
      e.key === "Enter" && (e.preventDefault(), addDynamicInput(id));
    }),
    div.appendChild(inp),
    div.appendChild(statusBtn),
    div.appendChild(deleteBtn),
    comp && toggleCompleted(statusBtn),
    cont.prepend(div),
    val || inp.focus(),
    save && debouncedSave();
}
function initiateDeleteItem(btn) {
  const item = btn.parentElement;
  if (!btn.parentElement) return;
  const timerId =
    "\
deleteTimer";
  if (item.classList.contains("is-deleting")) {
    clearTimeout(Number(item.dataset[timerId])),
      item.classList.remove("is-deleting");
    const icon = btn.querySelector("i");
    icon && (icon.className = "fas fa-trash"),
      btn.classList.replace("btn-warning", "btn-danger");
  } else {
    item.classList.add(
      "is-delet\
ing",
    );
    const icon = btn.querySelector("i");
    icon && (icon.className = "fas fa-undo"),
      btn.classList.replace("btn-danger", "btn-warning"),
      (item.dataset[timerId] = String(
        setTimeout(() => {
          item.remove(), debouncedSave();
        }, 4e3),
      ));
  }
  debouncedSave();
}
let stylingSelectionCounter = 0;

function normalizeStylingSelections(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item?.mainCategory && item?.subCategory);
  }
  return value?.mainCategory && value?.subCategory ? [value] : [];
}

function normalizeRemovedAlternativeCodes(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((code) => String(code ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeRemovedAlternativesByProduct(value) {
  const removedMap = new Map();
  (Array.isArray(value) ? value : []).forEach((entry) => {
    const originalCode = normalizeStylingProductKey(
      entry?.originalCode ?? entry?.code,
    );
    if (!originalCode) return;
    const removedAlternativeCodes = normalizeRemovedAlternativeCodes(
      entry?.removedAlternativeCodes,
    );
    if (removedAlternativeCodes.length === 0) return;
    removedMap.set(originalCode, removedAlternativeCodes);
  });
  return removedMap;
}

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStylingQuestionById(questionId) {
  return getFideQuestions().find((question) => String(question.id) === String(questionId));
}

function getStylingContainerById(questionId) {
  return document.getElementById(`styling-container-${questionId}`);
}

function getStylingSelectionList(questionId) {
  return getStylingContainerById(questionId)?.querySelector(
    ".styling-selected-products-list",
  );
}

function getActiveStylingSelectionGroup(questionId) {
  const container = getStylingContainerById(questionId);
  const activeKey = container?.dataset.activeSelectionKey ?? "";
  if (!container || !activeKey) return null;
  return container.querySelector(
    `.styling-selection-group[data-entry-key="${activeKey}"]`,
  );
}

function clearStylingSelectionControls(questionId) {
  const container = getStylingContainerById(questionId);
  if (!container) return;
  const mainSelect = container.querySelector(".styling-main-category-select"),
    subContainer = document.getElementById(`styling-sub-container-${questionId}`),
    subSelect = container.querySelector(".styling-sub-category-select"),
    subQty = container.querySelector(".sub-category-qty-input");
  container.dataset.activeSelectionKey = "";
  container
    .querySelectorAll(".styling-selection-group")
    .forEach((group) => group.classList.remove("active"));
  if (mainSelect instanceof HTMLSelectElement) {
    mainSelect.value = "";
  }
  if (subSelect instanceof HTMLSelectElement) {
    setSelectPlaceholder(subSelect, "-- Alt Kategori Seçin --");
  }
  if (subQty instanceof HTMLInputElement) {
    subQty.value = "1";
  }
  subContainer?.setAttribute("hidden", "");
}

function prepareNextStylingSelection(questionId, save = !0) {
  clearStylingSelectionControls(questionId);
  save && debouncedSave();
}

function removeActiveStylingSelection(questionId, resetControls = !1) {
  const container = getStylingContainerById(questionId);
  const activeGroup = getActiveStylingSelectionGroup(questionId);
  activeGroup?.remove();
  if (container) {
    container.dataset.activeSelectionKey = "";
  }
  if (resetControls) {
    clearStylingSelectionControls(questionId);
  }
}

function normalizeStylingProductKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("tr-TR");
}

function normalizeStylingProductSelections(value) {
  const selectionMap = new Map();
  (Array.isArray(value) ? value : []).forEach((product) => {
    const originalCode = normalizeStylingProductKey(
      product?.originalCode ?? product?.code,
    );
    if (!originalCode) return;
    const nextSelection = {
      code: String(product?.code ?? "").trim(),
      name: String(product?.name ?? "").trim(),
      qty: String(product?.qty ?? "1").trim() || "1",
      originalCode: String(product?.originalCode ?? product?.code ?? "").trim(),
      originalName: String(product?.originalName ?? product?.name ?? "").trim(),
    };
    const currentSelections = selectionMap.get(originalCode) ?? [];
    currentSelections.push(nextSelection);
    selectionMap.set(originalCode, currentSelections);
  });
  return selectionMap;
}

function captureStylingProductSelections(scope: ParentNode | null | undefined) {
  const selectionMap = new Map();
  scope?.querySelectorAll?.(".selected-product-item").forEach((item) => {
    const originalCode = normalizeStylingProductKey(
      item.dataset.originalCode || item.dataset.code || "",
    );
    if (!originalCode) return;
    const selections: Array<{ code: string; name: string; qty: string; originalCode: string; originalName: string }> = [];
    const distributionItems = Array.from(
      item.querySelectorAll<HTMLElement>(".styling-distribution-item"),
    );

    if (distributionItems.length > 0) {
      const mainQtyInput = item.querySelector(":scope > .styling-distribution-summary-row .styling-total-qty-input");
      selections.push({
        code: item.dataset.code ?? "",
        name: item.dataset.name ?? "",
        qty:
          mainQtyInput instanceof HTMLInputElement
            ? mainQtyInput.value
            : item.dataset.qty ?? "1",
        originalCode: item.dataset.originalCode ?? item.dataset.code ?? "",
        originalName: item.dataset.originalName ?? item.dataset.name ?? "",
      });
      distributionItems.forEach((row: HTMLElement) => {
        const qtyInput = row.querySelector(".qty-edit-input");
        selections.push({
          code: row.dataset.code ?? "",
          name: row.dataset.name ?? "",
          qty:
            qtyInput instanceof HTMLInputElement
              ? qtyInput.value
              : row.dataset.qty ?? "0",
          originalCode:
            row.dataset.originalCode ?? item.dataset.originalCode ?? "",
          originalName:
            row.dataset.originalName ?? item.dataset.originalName ?? "",
        });
      });
    } else {
      const qtyInput = item.querySelector(":scope > .product-qty-row .qty-edit-input");
      selections.push({
        code: item.dataset.code ?? "",
        name: item.dataset.name ?? "",
        qty: qtyInput instanceof HTMLInputElement ? qtyInput.value : item.dataset.qty ?? "1",
        originalCode: item.dataset.originalCode ?? item.dataset.code ?? "",
        originalName: item.dataset.originalName ?? item.dataset.name ?? "",
      });
    }

    selectionMap.set(originalCode, selections);
  });
  return selectionMap;
}

function captureStylingRemovedAlternatives(scope: ParentNode | null | undefined) {
  const removedMap = new Map();
  scope?.querySelectorAll?.(".selected-product-item").forEach((item) => {
    const originalCode = normalizeStylingProductKey(
      item.dataset.originalCode || item.dataset.code || "",
    );
    if (!originalCode) return;
    const removedAlternativeCodes = normalizeRemovedAlternativeCodes(
      item.dataset.removedAlternativeCodes
        ? item.dataset.removedAlternativeCodes.split("|")
        : [],
    );
    if (removedAlternativeCodes.length === 0) return;
    removedMap.set(originalCode, removedAlternativeCodes);
  });
  return removedMap;
}

function captureStylingDistributionPanelState(scope: ParentNode | null | undefined) {
  const openMap = new Map();
  scope?.querySelectorAll?.(".selected-product-item").forEach((item) => {
    const originalCode = normalizeStylingProductKey(
      item.dataset.originalCode || item.dataset.code || "",
    );
    if (!originalCode) return;
    const panel = item.querySelector<HTMLElement>(":scope > .styling-distribution-panel");
    if (!panel) return;
    openMap.set(originalCode, !panel.hidden);
  });
  return openMap;
}

function cloneStylingSelectionsWithoutQty(selections) {
  return Array.isArray(selections)
    ? selections.map((selection) => ({
        code: String(selection?.code ?? "").trim(),
        name: String(selection?.name ?? "").trim(),
        originalCode: String(
          selection?.originalCode ?? selection?.code ?? "",
        ).trim(),
        originalName: String(
          selection?.originalName ?? selection?.name ?? "",
        ).trim(),
      }))
    : undefined;
}

function buildStylingSelectionProducts(questionId, mainCategory, subCategory, multiplier) {
  const question = getStylingQuestionById(questionId);
  const resolvedMultiplier = normalizePositiveInteger(multiplier, 1);
  return (
    question?.stylingData
      ?.find((mainItem) => mainItem.name === mainCategory)
      ?.subCategories.find((subItem) => subItem.name === subCategory)
      ?.products.map((product) => ({
        code: product.code,
        name: product.name,
        qty: normalizePositiveInteger(product.qty, 1) * resolvedMultiplier,
        baseQty: normalizePositiveInteger(product.qty, 1),
        alternatives: (product.alternatives ?? []).map((alternative) => ({
          code: alternative.code,
          name: alternative.name,
          qty: normalizePositiveInteger(alternative.qty, 1) * resolvedMultiplier,
          baseQty: normalizePositiveInteger(alternative.qty, 1),
        })),
      })) ?? []
  );
}

function collectStylingEmailItems(group: HTMLElement, qtyByCode: Map<string, string>) {
  return Array.from(group.querySelectorAll<HTMLElement>(".selected-product-item"))
    .flatMap((item: HTMLElement) => {
      const distributionItems = Array.from(
        item.querySelectorAll<HTMLElement>(".styling-distribution-item"),
      );
      const sourceItems = distributionItems.length > 0
        ? [{
            code: item.dataset.code ?? "",
            name: item.dataset.name ?? "",
            element: item.querySelector(":scope > .styling-distribution-summary-row .styling-total-qty-input"),
            fallbackQty: item.dataset.qty ?? "0",
          }, ...distributionItems.map((row: HTMLElement) => ({
            code: row.dataset.code ?? "",
            name: row.dataset.name ?? "",
            element: row.querySelector(".qty-edit-input"),
            fallbackQty: row.dataset.qty ?? "0",
          }))]
        : [{
            code: item.dataset.code ?? "",
            name: item.dataset.name ?? "",
            element: item.querySelector(":scope > .product-qty-row .qty-edit-input"),
            fallbackQty: item.dataset.qty ?? "0",
          }];
      return sourceItems.map((row) => {
        const code = row.code ?? "";
        const name = row.name ?? "";
        const normalizedCode = String(code).trim().toLocaleUpperCase("tr-TR");
        const qty = row.element instanceof HTMLInputElement
          ? row.element.value
          : (qtyByCode.get(normalizedCode) ?? row.fallbackQty ?? "0");
        return { code, name, qty };
      });
    })
    .filter((item) => item.code && item.name && normalizePositiveInteger(item.qty, 0) > 0)
    .map(
      (item) =>
        `<li>${escapeEmailText(`${item.code} ${item.name}`)}: <b>${escapeEmailText(String(item.qty))} Adet</b></li>`,
    )
    .join("");
}

function buildStylingEmailSections(questionId, qStatus) {
  const container = getStylingContainerById(questionId);
  const selectionGroups = Array.from(
    container?.querySelectorAll<HTMLElement>(".styling-selection-group") ?? [],
  );
  if (selectionGroups.length === 0) return "";

  const selectedProducts = Array.isArray(qStatus?.selectedProducts)
    ? qStatus.selectedProducts
    : [];
  const qtyByCode = new Map();
  selectedProducts.forEach((product) => {
    const normalizedCode = String(product?.code ?? "")
      .trim()
      .toLocaleUpperCase("tr-TR");
    if (normalizedCode) {
      qtyByCode.set(normalizedCode, String(product?.qty ?? "1"));
    }
  });

  const sections = selectionGroups
    .map((group) => {
      const mainCategory = group.dataset.mainCategory ?? "";
      const subCategory = group.dataset.subCategory ?? "";
      const heading = [mainCategory, subCategory].filter(Boolean).join(" > ");
      const items = collectStylingEmailItems(group, qtyByCode);
      if (!heading || !items) return "";
      return `<p class="email-styling-group-title"><b>${escapeEmailText(heading)}</b></p><ul>${items}</ul>`;
    })
    .filter(Boolean)
    .join("");

  return sections
    ? `<p class="email-styling-title"><b><i>Sipariş verilmesi gereken Styling malzemeler:</i></b></p>${sections}`
    : "";
}

function createStylingQtyInput(initialValue, onChange, readOnly = false) {
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.inputMode = "numeric";
  qtyInput.min = "0";
  qtyInput.step = "1";
  qtyInput.className = "qty-edit-input form-input";
  qtyInput.value = String(initialValue);
  qtyInput.disabled = readOnly;
  qtyInput.classList.toggle("is-readonly", readOnly);
  qtyInput.addEventListener("input", onChange);
  qtyInput.addEventListener("change", onChange);
  return qtyInput;
}

function createStylingDistributionRow(
  choice,
  originalProduct,
  savedQty = undefined,
  onDelete = undefined,
) {
  const row = document.createElement("div");
  row.className = "styling-distribution-item";
  row.dataset.code = choice.code;
  row.dataset.name = choice.name;
  row.dataset.originalCode = originalProduct.code;
  row.dataset.originalName = originalProduct.name;
  row.dataset.defaultQty = String(choice.qty);

  const infoWrap = document.createElement("div");
  infoWrap.className = "styling-distribution-info";

  const label = document.createElement("span");
  label.className = `styling-distribution-label ${choice.isAlternative ? "is-alternative" : "is-main"}`;
  label.textContent = choice.isAlternative ? "Muadil" : "Ana Ürün";

  const nameWrap = document.createElement("div");
  nameWrap.className = "product-name styling-distribution-name";
  nameWrap.textContent = `${choice.code} ${choice.name}`;

  infoWrap.append(label, nameWrap);

  const qtyRow = document.createElement("div");
  qtyRow.className = "product-qty-row styling-distribution-qty-row";
  const qtyInput = createStylingQtyInput(savedQty ?? choice.qty, () => undefined);
  const unit = document.createElement("span");
  unit.className = "product-unit";
  unit.textContent = "Adet";
  qtyRow.append(qtyInput, unit);

  if (choice.isAlternative && typeof onDelete === "function") {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-item-btn btn btn-sm btn-danger styling-distribution-row-delete-btn";
    appendIconOnly(deleteBtn, "fas fa-trash");
    deleteBtn.addEventListener("click", () => onDelete(row, choice));
    qtyRow.append(deleteBtn);
  }

  row.append(infoWrap, qtyRow);
  return row;
}

function updateStylingDistributionSummary(item: HTMLElement) {
  const distributionItems = Array.from(
    item.querySelectorAll<HTMLElement>(".styling-distribution-item"),
  );
  const mainQtyInput = item.querySelector(".styling-total-qty-input");
  const mainQty = normalizePositiveInteger(
    mainQtyInput instanceof HTMLInputElement ? mainQtyInput.value : item.dataset.defaultQty,
    0,
  );
  const alternativeTotalQty = distributionItems.reduce((sum: number, row: HTMLElement) => {
    const qtyInput = row.querySelector(".qty-edit-input");
    return sum + normalizePositiveInteger(qtyInput instanceof HTMLInputElement ? qtyInput.value : 0, 0);
  }, 0);
  const usedAlternativeCount = distributionItems.reduce((count: number, row: HTMLElement) => {
    const qtyInput = row.querySelector(".qty-edit-input");
    return count + (normalizePositiveInteger(qtyInput instanceof HTMLInputElement ? qtyInput.value : 0, 0) > 0 ? 1 : 0);
  }, 0);
  const totalQty = mainQty + alternativeTotalQty;
  const totalChoiceCount = 1 + distributionItems.length;
  const usedCount = (mainQty > 0 ? 1 : 0) + usedAlternativeCount;

  const totalBadge = item.querySelector(".styling-distribution-total-badge");
  if (totalBadge) {
    totalBadge.textContent = `Toplam: ${totalQty}`;
  }
  const usageBadge = item.querySelector(".styling-distribution-usage-badge");
  if (usageBadge) {
    usageBadge.textContent = `Dağılım: ${usedCount}/${totalChoiceCount}`;
  }
}

function distributeStylingChoicesEqually(item: HTMLElement) {
  const distributionItems = Array.from(
    item.querySelectorAll<HTMLElement>(".styling-distribution-item"),
  );
  const mainQtyInput = item.querySelector(".styling-total-qty-input");
  if (!(mainQtyInput instanceof HTMLInputElement)) return;

  const currentMainQty = normalizePositiveInteger(mainQtyInput.value, 0);
  const alternativeTotalQty = distributionItems.reduce((sum: number, row: HTMLElement) => {
    const qtyInput = row.querySelector(".qty-edit-input");
    return sum + normalizePositiveInteger(qtyInput instanceof HTMLInputElement ? qtyInput.value : 0, 0);
  }, 0);
  const fallbackQty = normalizePositiveInteger(item.dataset.defaultQty, 1);
  const distributableQty = currentMainQty + alternativeTotalQty > 0
    ? currentMainQty + alternativeTotalQty
    : fallbackQty;
  const totalChoiceCount = 1 + distributionItems.length;
  const baseShare = Math.floor(distributableQty / totalChoiceCount);
  let remainder = distributableQty % totalChoiceCount;

  mainQtyInput.value = String(baseShare + (remainder > 0 ? 1 : 0));
  if (remainder > 0) remainder -= 1;

  distributionItems.forEach((row: HTMLElement) => {
    const qtyInput = row.querySelector(".qty-edit-input");
    if (!(qtyInput instanceof HTMLInputElement)) return;
    const nextValue = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    qtyInput.value = String(nextValue);
  });

  updateStylingDistributionSummary(item);
  debouncedSave();
}

function createStylingSelectionProductItem(
  product,
  savedSelections = undefined,
  removedAlternativeCodes = undefined,
  keepDistributionPanelOpen = false,
) {
  const item = document.createElement("div");
  item.className = "selected-product-item";
  item.dataset.originalCode = product.code;
  item.dataset.originalName = product.name;
  item.dataset.code = product.code;
  item.dataset.name = product.name;
  item.dataset.qty = String(product.qty);
  item.dataset.baseQty = String(product.baseQty);
  item.dataset.defaultQty = String(product.qty);

  const normalizedRemovedAlternativeCodes = normalizeRemovedAlternativeCodes(
    removedAlternativeCodes,
  );
  item.dataset.removedAlternativeCodes = normalizedRemovedAlternativeCodes.join("|");

  const availableAlternatives = (product.alternatives ?? []).filter(
    (alternative) => !normalizedRemovedAlternativeCodes.includes(String(alternative?.code ?? "").trim()),
  );
  const hasAlternatives = availableAlternatives.length > 0;
  const normalizedSavedSelections = Array.isArray(savedSelections)
    ? savedSelections
        .map((selection) => {
          const hasQty = selection != null && Object.prototype.hasOwnProperty.call(selection, "qty");
          return {
            code: String(selection?.code ?? "").trim(),
            name: String(selection?.name ?? "").trim(),
            qty: hasQty ? (String(selection?.qty ?? "0").trim() || "0") : undefined,
          };
        })
        .filter((selection) => selection.code)
    : [];

  const mainSavedSelection = normalizedSavedSelections.find(
    (selection) => selection.code === product.code,
  );

  const summaryName = document.createElement("div");
  summaryName.className = "product-name styling-distribution-summary-name";
  summaryName.textContent = `${product.code} ${product.name}`;

  const qtyRow = document.createElement("div");
  qtyRow.className = "product-qty-row";

  if (!hasAlternatives) {
    const qtyInput = createStylingQtyInput(
      mainSavedSelection?.qty ?? product.qty,
      () => debouncedSave(),
    );
    const unit = document.createElement("span");
    unit.className = "product-unit";
    unit.textContent = "Adet";
    qtyRow.append(qtyInput, unit);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-item-btn btn btn-sm btn-danger";
    appendIconOnly(deleteBtn, "fas fa-trash");
    deleteBtn.addEventListener("click", () => {
      item.remove();
      debouncedSave();
    });

    item.append(summaryName, qtyRow, deleteBtn);
    return item;
  }

  item.classList.add("has-alternatives");

  const summaryRow = document.createElement("div");
  summaryRow.className = "styling-distribution-summary-row";

  const summarySpacer = document.createElement("div");
  summarySpacer.className = "styling-distribution-summary-spacer";
  summarySpacer.setAttribute("aria-hidden", "true");

  const summaryControls = document.createElement("div");
  summaryControls.className = "styling-distribution-summary-controls";

  const summaryMeta = document.createElement("div");
  summaryMeta.className = "styling-distribution-summary-meta";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn btn-sm btn-secondary styling-distribution-toggle-btn";
  toggleBtn.textContent = "Muadil";
  toggleBtn.setAttribute("aria-expanded", "false");

  const totalBadge = document.createElement("span");
  totalBadge.className = "styling-selection-badge styling-distribution-total-badge";

  const usageBadge = document.createElement("span");
  usageBadge.className = "styling-selection-badge styling-distribution-usage-badge is-success";

  summaryMeta.append(toggleBtn, totalBadge, usageBadge);

  const totalInput = createStylingQtyInput(mainSavedSelection?.qty ?? product.qty, () => undefined);
  totalInput.classList.add("styling-total-qty-input");
  const totalUnit = document.createElement("span");
  totalUnit.className = "product-unit";
  totalUnit.textContent = "Adet";

  const totalInputWrap = document.createElement("div");
  totalInputWrap.className = "product-qty-row styling-distribution-summary-main-qty-row";
  totalInputWrap.append(totalInput, totalUnit);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-item-btn btn btn-sm btn-danger styling-distribution-delete-btn";
  appendIconOnly(deleteBtn, "fas fa-trash");
  deleteBtn.addEventListener("click", () => {
    item.remove();
    debouncedSave();
  });

  const summaryQtyActions = document.createElement("div");
  summaryQtyActions.className = "styling-distribution-summary-qty-actions";
  summaryQtyActions.append(totalInputWrap, deleteBtn);

  summaryControls.append(summaryMeta, summaryQtyActions);
  summaryRow.append(summaryName, summaryControls, summarySpacer);

  const panel = document.createElement("div");
  panel.className = "styling-distribution-panel";
  panel.hidden = true;

  const choices = availableAlternatives.map((alternative) => ({
    code: alternative.code,
    name: alternative.name,
    qty: alternative.qty,
    isAlternative: true,
  }));

  const savedQtyByCode = new Map(
    normalizedSavedSelections
      .filter((selection) => selection.qty !== undefined)
      .map((selection) => [selection.code, selection.qty]),
  );

  const distributionRows = choices.map((choice) => {
    const savedQty = savedQtyByCode.has(choice.code)
      ? savedQtyByCode.get(choice.code)
      : "0";
    const row = createStylingDistributionRow(choice, product, savedQty, (rowElement, removedChoice) => {
      rowElement.remove();
      const nextRemovedAlternativeCodes = normalizeRemovedAlternativeCodes([
        ...(item.dataset.removedAlternativeCodes ? item.dataset.removedAlternativeCodes.split("|") : []),
        removedChoice.code,
      ]);
      item.dataset.removedAlternativeCodes = nextRemovedAlternativeCodes.join("|");
      const hasRemainingAlternatives =
        item.querySelectorAll(".styling-distribution-item").length > 0;
      if (!hasRemainingAlternatives) {
        panel.hidden = true;
        toggleBtn.hidden = true;
        toggleBtn.classList.remove("is-open");
        toggleBtn.setAttribute("aria-expanded", "false");
      }
      updateStylingDistributionSummary(item);
      debouncedSave();
    });
    const qtyInput = row.querySelector(".qty-edit-input");
    if (qtyInput instanceof HTMLInputElement) {
      const handleDistributionQtyChange = () => {
        updateStylingDistributionSummary(item);
        debouncedSave();
      };
      qtyInput.addEventListener("input", handleDistributionQtyChange);
      qtyInput.addEventListener("change", handleDistributionQtyChange);
    }
    return row;
  });

  panel.append(...distributionRows);

  const panelActions = document.createElement("div");
  panelActions.className = "styling-distribution-actions";

  const panelMeta = document.createElement("div");
  panelMeta.className = "styling-distribution-panel-meta";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-sm btn-light styling-distribution-cancel-btn";
  cancelBtn.textContent = "Vazgeç";

  const distributeBtn = document.createElement("button");
  distributeBtn.type = "button";
  distributeBtn.className = "btn btn-sm btn-light styling-distribution-equal-btn";
  distributeBtn.textContent = "Eşit Dağıt";

  panelActions.append(panelMeta, cancelBtn, distributeBtn);
  panel.append(panelActions);

  const syncDistributionToMainQty = (forcedQty = undefined) => {
    const nextQty = normalizePositiveInteger(forcedQty ?? totalInput.value, 1);
    totalInput.value = String(nextQty);
    distributionRows.forEach((row: HTMLElement) => {
      const qtyInput = row.querySelector(".qty-edit-input");
      if (!(qtyInput instanceof HTMLInputElement)) return;
      qtyInput.value = "0";
    });
    item.dataset.defaultQty = String(nextQty);
    updateStylingDistributionSummary(item);
  };

  const toggleDistributionPanel = (nextState) => {
    panel.hidden = !nextState;
    toggleBtn.classList.toggle("is-open", nextState);
    toggleBtn.setAttribute("aria-expanded", nextState ? "true" : "false");
    toggleBtn.hidden = nextState;

    if (nextState) {
      panelMeta.append(totalBadge, usageBadge);
    } else {
      summaryMeta.append(toggleBtn, totalBadge, usageBadge);
    }
  };

  toggleBtn.addEventListener("click", () => {
    toggleDistributionPanel(panel.hidden);
    debouncedSave();
  });

  const handleMainQtyChange = () => {
    item.dataset.defaultQty = String(normalizePositiveInteger(totalInput.value, 1));
    updateStylingDistributionSummary(item);
    debouncedSave();
  };

  totalInput.addEventListener("input", handleMainQtyChange);
  totalInput.addEventListener("change", handleMainQtyChange);

  cancelBtn.addEventListener("click", () => {
    const fallbackQty = normalizePositiveInteger(totalInput.value, 1);
    syncDistributionToMainQty(fallbackQty);
    toggleDistributionPanel(false);
    debouncedSave();
  });

  distributeBtn.addEventListener("click", () => distributeStylingChoicesEqually(item));

  item.append(summaryRow, panel);
  updateStylingDistributionSummary(item);

  const hasSavedAlternativeUsage = normalizedSavedSelections.some(
    (selection) =>
      selection.code !== product.code && normalizePositiveInteger(selection.qty, 0) > 0,
  );
  const shouldKeepDistributionPanelOpen = keepDistributionPanelOpen || hasSavedAlternativeUsage;
  toggleDistributionPanel(shouldKeepDistributionPanelOpen);
  if (!shouldKeepDistributionPanelOpen) {
    syncDistributionToMainQty(mainSavedSelection?.qty ?? product.qty);
  }
  return item;
}

function renderStylingSelectionGroup(questionId, group, save = !0, persistedSelections = undefined) {
  const container = getStylingContainerById(questionId);
  const list = getStylingSelectionList(questionId);
  if (!container || !list) return;

  const persistedSelectionMap = normalizeStylingProductSelections(persistedSelections);
  const persistedRemovedAlternativesMap = normalizeRemovedAlternativesByProduct(
    group.removedAlternativeCodesByProduct,
  );

  const products = buildStylingSelectionProducts(
    questionId,
    group.mainCategory,
    group.subCategory,
    group.subCategoryQty,
  );
  if (products.length === 0) {
    removeActiveStylingSelection(questionId, !0);
    save && debouncedSave();
    return;
  }

  let groupElement = list.querySelector(
    `.styling-selection-group[data-entry-key="${group.entryKey}"]`,
  );
  const previousMultiplier = normalizePositiveInteger(
    groupElement?.dataset.subCategoryQty,
    normalizePositiveInteger(group.subCategoryQty, 1),
  );
  const nextMultiplier = normalizePositiveInteger(group.subCategoryQty, 1);
  const multiplierChanged = groupElement ? previousMultiplier !== nextMultiplier : false;
  const existingSelections = groupElement
    ? captureStylingProductSelections(groupElement)
    : new Map();
  const existingRemovedAlternatives = groupElement
    ? captureStylingRemovedAlternatives(groupElement)
    : new Map();
  const existingDistributionPanelState = groupElement
    ? captureStylingDistributionPanelState(groupElement)
    : new Map();

  if (!groupElement) {
    groupElement = document.createElement("div");
    groupElement.className = "styling-selection-group";
    groupElement.dataset.entryKey = group.entryKey;
    list.append(groupElement);
  }

  groupElement.dataset.mainCategory = group.mainCategory;
  groupElement.dataset.subCategory = group.subCategory;
  groupElement.dataset.subCategoryQty = String(nextMultiplier);

  const header = document.createElement("div");
  header.className = "styling-selection-header";

  const title = document.createElement("div");
  title.className = "styling-selection-title";
  title.textContent = `${group.mainCategory} / ${group.subCategory}`;

  const qtyBadge = document.createElement("span");
  qtyBadge.className = "styling-selection-badge";
  qtyBadge.textContent = `x${nextMultiplier}`;

  const removeBtn = document.createElement("button");
  removeBtn.className = "styling-selection-remove-btn btn btn-sm btn-danger";
  removeBtn.dataset.questionId = String(questionId);
  removeBtn.dataset.entryKey = group.entryKey;
  appendIconOnly(removeBtn, "fas fa-trash");

  const productsWrap = document.createElement("div");
  productsWrap.className = "styling-selection-products";
  products.forEach((product) => {
    const selectionKey = normalizeStylingProductKey(product.code);
    const matchedSelection =
      existingSelections.get(selectionKey) ?? persistedSelectionMap.get(selectionKey);
    const removedAlternativeCodes =
      existingRemovedAlternatives.get(selectionKey) ??
      persistedRemovedAlternativesMap.get(selectionKey);
    productsWrap.append(
      createStylingSelectionProductItem(
        product,
        multiplierChanged
          ? cloneStylingSelectionsWithoutQty(matchedSelection)
          : matchedSelection,
        removedAlternativeCodes,
        existingDistributionPanelState.get(selectionKey) === true,
      ),
    );
  });

  header.append(title, qtyBadge, removeBtn);
  groupElement.replaceChildren(header, productsWrap);
  container.dataset.activeSelectionKey = group.entryKey;
  container
    .querySelectorAll(".styling-selection-group")
    .forEach((item) => item.classList.toggle("active", item === groupElement));

  save && debouncedSave();
}

function addStylingSelectionGroup(
  questionId,
  mainCategory,
  subCategory,
  subCategoryQty = "1",
  save = !0,
  persistedSelections = undefined,
) {
  stylingSelectionCounter += 1;
  renderStylingSelectionGroup(
    questionId,
    {
      entryKey: `styling-${questionId}-${stylingSelectionCounter}`,
      mainCategory,
      subCategory,
      subCategoryQty: String(normalizePositiveInteger(subCategoryQty, 1)),
    },
    save,
    persistedSelections,
  );
}

function upsertActiveStylingSelection(questionId, save = !0) {
  const container = getStylingContainerById(questionId);
  if (!container) return;
  const mainSelect = container.querySelector(".styling-main-category-select"),
    subSelect = container.querySelector(".styling-sub-category-select"),
    subQty = container.querySelector(".sub-category-qty-input");
  if (
    !(mainSelect instanceof HTMLSelectElement) ||
    !(subSelect instanceof HTMLSelectElement) ||
    !(subQty instanceof HTMLInputElement)
  ) {
    return;
  }
  if (!mainSelect.value || !subSelect.value) {
    removeActiveStylingSelection(questionId);
    save && debouncedSave();
    return;
  }
  const entryKey =
    container.dataset.activeSelectionKey ||
    `styling-${questionId}-${++stylingSelectionCounter}`;
  renderStylingSelectionGroup(
    questionId,
    {
      entryKey,
      mainCategory: mainSelect.value,
      subCategory: subSelect.value,
      subCategoryQty: String(normalizePositiveInteger(subQty.value, 1)),
    },
    save,
  );
}

function removeStylingSelection(btn) {
  const questionId = btn.dataset.questionId ?? "";
  const entryKey = btn.dataset.entryKey ?? "";
  const container = getStylingContainerById(questionId);
  const group = entryKey
    ? container?.querySelector(
        `.styling-selection-group[data-entry-key="${entryKey}"]`,
      )
    : btn.closest(".styling-selection-group");
  if (!group) return;
  const isActive = container?.dataset.activeSelectionKey === entryKey;
  group.remove();
  if (isActive) {
    clearStylingSelectionControls(questionId);
  }
  debouncedSave();
}

function handleStylingSubQtyChange(e) {
  const input = e.target;
  const container = input.closest(".styling-list-container");
  const questionId = container?.dataset.questionId ?? "";
  if (!questionId) return;
  upsertActiveStylingSelection(questionId);
}

function addProductToList(
  code = undefined,
  qty = undefined,
  save = !0,
  name = undefined,
  scope = undefined,
) {
  const root = scope ?? document,
    sel = root.querySelector?.(".product-selector") ?? null,
    qInp = root.querySelector?.(".product-qty") ?? null,
    existingList = root.querySelector?.(".selected-products-list") ?? null,
    pCode = code || sel?.value || "",
    pQty = qty || qInp?.value || "1";
  if (!pCode || Number(pQty) < 1 || !existingList) return;
  const matchedProduct = getProductList().find(
      (p) => p.type === "item" && "code" in p && p.code === pCode,
    ) as ProductOption | undefined,
    prod: ProductOption | undefined = name
      ? { code: pCode, name, qty: matchedProduct?.qty }
      : matchedProduct;
  if (
    !prod ||
    existingList.querySelector(
      `.selected-product-item[data-code="${prod.code ?? ""}"]`,
    )
  )
    return;
  const div = document.createElement("div");
  (div.className = "selected-product-item"),
    (div.dataset.code = prod.code ?? ""),
    (div.dataset.qty = pQty),
    (div.dataset.name = prod.name ?? "");
  const span = document.createElement("span"),
    packageLabel = getProductPackageLabel(prod);
  span.textContent = `${prod.code ?? ""} ${prod.name ?? ""}${packageLabel} - `;
  const bold = document.createElement("b");
  (bold.textContent = `${pQty} Adet`), span.appendChild(bold);
  const deleteBtn = document.createElement("button");
  (deleteBtn.className =
    "delete-item-btn btn btn-sm btn-danger"),
    appendIconOnly(deleteBtn, "fas fa-trash"),
    deleteBtn.addEventListener("click", () => {
      div.remove(), debouncedSave();
    }),
    div.appendChild(span),
    div.appendChild(deleteBtn),
    existingList.appendChild(div),
    !code && sel && qInp && ((sel.value = ""), (qInp.value = "1")),
    save && debouncedSave();
}
function addStylingProductToList(qId, code, qty, name, save = !0) {
  const list = document
    .getElementById(`fide-item-${qId}`)
    ?.querySelector(".styling-selected-products-list");
  if (
    !list ||
    list.querySelector(`[data\
-code="${code}"]`)
  )
    return;
  const div = document.createElement("div");
  (div.className = "selected-product-item"),
    (div.dataset.code = code),
    (div.dataset.originalCode = code),
    (div.dataset.qty = String(qty)),
    (div.dataset.name = name),
    (div.dataset.originalName = name);
  const span = document.createElement("span");
  (span.className = "product-name"), (span.textContent = `${code} ${name}`);
  const qtyRow = document.createElement("div");
  qtyRow.className = "product-qty-row";
  const qtyInput = document.createElement("input");
  (qtyInput.type =
    "\
number"),
    (qtyInput.className = "qty-edit-input form-input"),
    (qtyInput.value = String(qty)),
    qtyInput.addEventListener("change", () => debouncedSave());
  const unit = document.createElement("span");
  (unit.className = "product-unit"), (unit.textContent = "Adet");
  const delBtn = document.createElement("button");
  (delBtn.className =
    "\
delete-item-btn btn btn-sm btn-danger"),
    appendIconOnly(delBtn, "fas fa-trash"),
    delBtn.addEventListener("click", () => {
      div.remove(), debouncedSave();
    }),
    qtyRow.appendChild(qtyInput),
    qtyRow.appendChild(unit),
    div.append(span, qtyRow, delBtn),
    list.appendChild(div),
    save && debouncedSave();
}
function toggleStylingView(cb, id) {
  const s = document.getElementById(`styling-container-${id}`),
    v = document.getElementById(`standard-view-container-${id}`);
  cb.checked
    ? (s?.removeAttribute("hidden"), v?.setAttribute("hidden", ""))
    : (s?.setAttribute("hidden", ""), v?.removeAttribute("hidden"));
}
function handleStylingMainCatChange(e) {
  const sel = e.target,
    cont = sel.closest(".styling-list-container");
  if (!cont) return;
  const qId = cont.dataset.questionId ?? "",
    q = getStylingQuestionById(qId),
    sub = document.getElementById(`styling-sub-container-${qId}`),
    sSel = sub?.querySelector(
      ".styling-sub-category-select",
    ) as HTMLSelectElement | null,
    subQty = cont.querySelector(".sub-category-qty-input") as HTMLInputElement | null;
  removeActiveStylingSelection(qId),
    sSel && setSelectPlaceholder(sSel, "-- Alt Kategori Seçin --"),
    subQty && (subQty.value = "1"),
    sel.value && q?.stylingData && sub && sSel
      ? (q.stylingData
          .find((mc) => mc.name === sel.value)
          ?.subCategories.forEach((sc) =>
            sSel.add(new Option(sc.name, sc.name)),
          ),
        sub.removeAttribute("hidden"))
      : sub?.setAttribute("hidden", ""),
    debouncedSave();
}
function handleStylingSubCatChange(e) {
  const sel = e.target,
    cont = sel.closest(".styling-list-container");
  if (!cont) return;
  const qId = cont.dataset.questionId ?? "";
  if (!sel.value) {
    removeActiveStylingSelection(qId), debouncedSave();
    return;
  }
  upsertActiveStylingSelection(qId);
}
// Performance table is rendered from the shared core renderer.
function formatFideScoreForPrompt(value) {
  return value != null && value !== "" ? String(value).replace(".", ",") : null;
}
function validateFideScoreInput(rawValue, allowDash = !1) {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) return { ok: !1, empty: !0, value: null };
  if (normalizedValue.includes(".")) {
    notify.error(
      "Hata: Nokta (.) kullanılamaz. Ondalık için virgül (,) kullanın. (Örn: 56,6)",
    );
    return { ok: !1, empty: !1, value: null };
  }
  if (allowDash && normalizedValue === "-") {
    return { ok: !0, empty: !1, value: "-" };
  }
  if (isNaN(parseScore(normalizedValue))) {
    notify.error(`Hata: "${normalizedValue}" geçerli bir sayı değildir.`);
    return { ok: !1, empty: !1, value: null };
  }
  return { ok: !0, empty: !1, value: normalizedValue };
}
// Email workflow
async function generateEmail() {
  const selectedStore = getSelectedStore();
  if (!selectedStore) {
    notify.warning("Lütfen denetime başlamadan önce bir bayi seçin!");
    return;
  }
  const currentDate = new Date(),
    currentMonthIdx = currentDate.getMonth() + 1,
    currentMonthKey = getYearMonthKey(currentDate),
    fideStoreInfo =
      getFideData().find(
        (row) => String(row["Bayi Kodu"]) === String(selectedStore.bayiKodu),
      ) ?? null,
    isRepeatedMonthlyAudit = getAuditedThisMonth().includes(String(selectedStore.bayiKodu)),
    savedMonthlyFideScore = getReportFideMonthlyScore(currentMonthKey),
    existingScore = formatFideScoreForPrompt(fideStoreInfo?.scores?.[currentMonthIdx]),
    nextReportFideScores = { ...getReportFideMonthlyScores() };
  let manualFideScore = savedMonthlyFideScore ?? null;
  if (isRepeatedMonthlyAudit) {
    const promptValue = prompt(
      `${MONTH_NAMES[currentMonthIdx]} ayı için bu bayi bu ay zaten denetlendi.
Mevcut puan: ${savedMonthlyFideScore ?? existingScore ?? "-"}
Yeni FiDe puanı girmek isterseniz yazın. Boş bırakırsanız mevcut puan korunur.`,
      "",
    );
    if (promptValue === null) {
      notify.warning("İşlem kullanıcı tarafından iptal edildi.");
      return;
    }
    const trimmedPromptValue = promptValue.trim();
    if (trimmedPromptValue && trimmedPromptValue !== "-") {
      const validation = validateFideScoreInput(trimmedPromptValue);
      if (!validation.ok || !validation.value) return;
      manualFideScore = validation.value;
      nextReportFideScores[currentMonthKey] = validation.value;
    } else if (savedMonthlyFideScore) {
      manualFideScore = savedMonthlyFideScore;
    }
  } else if (!existingScore && !savedMonthlyFideScore) {
    const promptValue = prompt(`${MONTH_NAMES[currentMonthIdx]} ayı FiDe puanını giriniz (Zorunludur, dahil edilmeyecekse - yazınız):`);
    if (!promptValue?.trim()) {
      notify.warning("Puan girilmediği için işlem durduruldu.");
      return;
    }
    const validation = validateFideScoreInput(promptValue, !0);
    if (!validation.ok) return;
    manualFideScore = validation.value;
    if (validation.value && validation.value !== "-") {
      nextReportFideScores[currentMonthKey] = validation.value;
    } else {
      delete nextReportFideScores[currentMonthKey];
    }
  }
  setReportFideMonthlyScores(nextReportFideScores);
  let emailTemplate =
    "\
<p>{YONETMEN_ADI} Bey Merhaba,</p><p>Ziyaret etmi\u015F oldu\u011Fum {BAYI_BILGISI} bayi karnesi a\u015Fa\u011F\u0131dad\u0131r.</p><p><br></p>{DENETIM_ICERIGI}<p><br></p\
>{PUAN_TABLOSU}";
  if (pb.authStore.isValid)
    try {
      const rec = await pb
        .collection("ayarlar")
        .getFirstListItem('anahtar="emailTemplate"');
      rec.deger && (emailTemplate = rec.deger);
    } catch {}
  const reportData = {
    questions_status: normalizeQuestionStatusMap(
      getFormDataForSaving().questions_status,
    ),
  };
  const finalizedAtIso = await saveFormState(reportData, !0);
  if (!finalizedAtIso) return;

  await saveAuditHistoryForSelectedStore(finalizedAtIso);
  window.dispatchEvent(new CustomEvent("reportFinalized"));
  dispatchMonthlyAuditDataChanged("reportFinalized");
  const storeInfo =
      getDideData().find(
        (row) => String(row["Bayi Kodu"]) === String(selectedStore.bayiKodu),
      ) ?? null,
    storeEmail = getStoreEmails()[selectedStore.bayiKodu] ?? null,
    storeEmailTag = storeEmail
      ? ` <a href="mailto:${storeEmail}" class="email-tag">@${storeEmail}</a>`
      : "",
    managerFullName =
      (
        getAllStores().find(
          (s) => String(s.bayiKodu) === String(selectedStore.bayiKodu),
        ) ?? null
      )?.yonetmen?.trim() ||
      selectedStore.yonetmen?.trim() ||
      storeInfo?.[
        "Bayi Y\xF6n\
etmeni"
      ]?.trim() ||
      "",
    yonetmenFirstName = managerFullName
      ? managerFullName.split(/\s+/)[0]
      : "Yetkili",
    shortBayiAdi =
      selectedStore.bayiAdi.length > 20
        ? `${selectedStore.bayiAdi.substring(0, 20)}...`
        : selectedStore.bayiAdi;
  let fideReportHtml = "";
  getFideQuestions().forEach((q) => {
    const itemDiv = document.getElementById(`fide-item-${q.id}`);
    if (!itemDiv || itemDiv.classList.contains("question-removed")) return;
    const qStatus = reportData.questions_status[String(q.id)] as any;
    if (!qStatus) return;
    let contentHtml = "";
    if (q.type === "standard") {
      const container = document.getElementById(
        `sub-items-container-fide${q.id}`,
      );
      if (container) {
        const items = buildEmailListItemsFromContainer(container),
          emailItems = items.some((item) => item.type === "dynamic")
            ? items
            : items.filter((item) => item.type === "static");
        emailItems.length > 0 && (contentHtml = renderEmailList(emailItems));
      }
    } else if (
      q.type === "product_list" ||
      q.type ===
        "styli\
ng_list"
    ) {
      const prods = (qStatus.selectedProducts ?? [])
        .map(
          (
            p,
          ) => `<li>${escapeEmailText(`${p.code} ${p.name}`)}: <b>${escapeEmailText(p.qty)} Ade\
t</b></li>`,
        )
        .join("");
      if (q.type === "product_list") {
        const pleksi = Array.from(
          document.querySelectorAll(`#sub-items-container-fide${q.id}_pleksi\
 input[type="text"]`),
        )
          .filter((i) => !i.classList.contains("completed") && i.value.trim())
          .map((i) => `<li>${escapeEmailText(i.value)}</li>`)
          .join("");
        prods &&
          (contentHtml += `<b><i>Sipari\u015F verilmesi gerekenler:</i></b><ul>${prods}</ul>`),
          pleksi &&
            (contentHtml += `<b><i>Pleksiyle sergilenmes\
i gerekenler:</i></b><ul>${pleksi}</ul>`);
      } else {
        const staticBox = document.getElementById(
          `standard-view-container-${q.id}`,
        );
        if (staticBox) {
          const staticItems = collectStaticEmailItems(staticBox);
          staticItems.length > 0 &&
            (contentHtml += renderEmailList(staticItems));
        }
        const notes = Array.from(
          document.querySelectorAll(`#sub-items-container-fide${q.id}_notes input[type="text"]`),
        )
          .filter((i) => !i.classList.contains("completed") && i.value.trim())
          .map((i) => `<li>${escapeEmailText(i.value)}</li>`)
          .join("");
        notes && (contentHtml += `<ul>${notes}</ul>`);
        contentHtml += buildStylingEmailSections(String(q.id), qStatus);
      }
    } else if (q.type === "pop_system") {
      const pops = Array.from(
        document.querySelectorAll(".pop-checkbox:checked"),
      )
        .map((cb) => cb.value)
        .filter((c) => !getExpiredCodes().includes(c));
      pops.length && (contentHtml = `<ul><li>${pops.join(", ")}</li></ul>`);
    }
    if (contentHtml || qStatus.completed) {
      const compSpan = qStatus.completed
          ? ' <span class="status-tag status-tag--done">Tamamland\u0131</span>'
          : "",
        tag =
          q.wantsStoreEmail && q.type !== "pop_system"
            ? storeEmailTag
            : q.type ===
                  "\
pop_system" && q.popEmailTo?.length
              ? ` <a href="mailto:${q.popEmailTo.join(",")}" class="email-tag">@${q.popEmailTo.join(", ")}</a>`
              : "";
      fideReportHtml += `<p><b>FiDe ${getQuestionDisplayNo(q)}. ${q.title}</b>${compSpan}${tag}</p>${contentHtml}`;
    }
  });
  const tableHtml = renderPerformanceTable(
      [
        { label: "DİDE", scores: storeInfo?.scores },
        {
          label: "FİDE",
          scores: fideStoreInfo?.scores,
          manualScore: manualFideScore,
          manualMonthIdx: currentMonthIdx,
        },
      ],
      undefined,
      { mode: "email" },
    ),
    finalBody = emailTemplate
      .replace(/{YONETMEN_ADI}/g, yonetmenFirstName ?? "")
      .replace(/{BAYI_BILGISI}/g, `${selectedStore.bayiKodu} ${shortBayiAdi}`)
      .replace(/{DENETIM_ICERIGI}/g, fideReportHtml)
      .replace(/{PUAN_TABLOSU}/g, tableHtml);
  document.getElementById("store-selection-card")?.setAttribute("hidden", ""),
  document.getElementById("dide-upload-card")?.setAttribute("hidden", ""),
    document.getElementById("form-content")?.setAttribute("hidden", ""),
    document.getElementById("generate-email-btn")?.setAttribute("hidden", "");
  const existing = document.getElementById("email-draft-container");
  existing && existing.remove();
  const draft = document.createElement("div");
  (draft.id = "email-draft-container"), (draft.className = "card");
  const heading = document.createElement("h2"),
    backBtn =
      document.createElement(
        "bu\
tton",
      );
  (backBtn.id = "back-to-form-btn"),
    (backBtn.className = "btn btn-light btn-sm"),
    appendIconOnly(backBtn, "fas fa-arrow-left"),
    backBtn.addEventListener("click", returnToMainPage),
    heading.appendChild(backBtn),
    heading.appendChild(
      document.createTextNode(" Kopyalanacak E-posta Tasla\u011F\u0131"),
    );
  const editArea = document.createElement("div");
  (editArea.id = "email-draft-area"),
    (editArea.contentEditable = "true"),
    setSafeHtml(editArea, finalBody),
    draft.appendChild(heading),
    draft.appendChild(editArea),
    document.querySelector(".container")?.appendChild(draft);
}
function returnToMainPage() {
  document.getElementById("email-draft-container")?.remove(),
    document.getElementById("store-selection-card")?.removeAttribute("hidden"),
    document.getElementById("dide-upload-card")?.removeAttribute("hidden"),
    document.getElementById("form-content")?.removeAttribute("hidden"),
    document.getElementById("generate-email-btn")?.removeAttribute("hidden");
}

export {
  buildForm,
  generateEmail,
  loadReportUI,
  resetForm,
  returnToMainPage,
  startNewReport,
  updateConnectionIndicator,
  updateFormInteractivity,
};

// TOTAL_LINES: 2500
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
