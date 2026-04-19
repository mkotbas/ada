import { escapeHtml, setSafeHtml } from "@core/dom";

export type ProductLike = {
  code?: string;
  name?: string;
  qty?: string;
  alternatives?: Array<{ code?: string; name?: string; qty?: string }>;
};

export function normalizeCategoryKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

export function normalizeProductCode(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "");
}

export function normalizeExcelHeader(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

export function isAlternativeHeader(value: unknown): boolean {
  return normalizeExcelHeader(value).includes("muadil");
}

export function normalizeQuantityValue(value: unknown, fallback = "1"): string {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return fallback;
  const normalizedNumber = rawValue.replace(/,/g, ".").match(/\d+(?:\.\d+)?/);
  return normalizedNumber?.[0] || fallback;
}

export function normalizeAlternativeProduct(item: ProductLike | null | undefined): { code: string; name: string; qty: string; normalizedCode: string } | null {
  const code = String(item?.code || "").trim();
  const name = String(item?.name || "").trim();
  if (!code || !name) return null;

  const normalizedCode = normalizeProductCode(code);
  if (!normalizedCode) return null;

  return {
    code,
    name,
    qty: normalizeQuantityValue(item?.qty, "1"),
    normalizedCode,
  };
}

export function mergeAlternativeProducts(existingAlternatives: ProductLike[] = [], incomingAlternatives: ProductLike[] = []) {
  const mergedAlternatives: Array<{ code: string; name: string; qty: string }> = [];
  const seenCodes = new Set<string>();

  [...existingAlternatives, ...incomingAlternatives].forEach((item) => {
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

export function ensureAlternativeContainer(row: HTMLElement): HTMLElement {
  let container = row.querySelector(".product-alternative-container-styling");
  if (container instanceof HTMLElement) return container;

  const createdContainer = document.createElement("div");
  createdContainer.className = "product-alternative-container-styling";
  createdContainer.hidden = true;
  row.appendChild(createdContainer);
  return createdContainer;
}

export function addProductAlternativeRow(container: HTMLElement, alternativeData: ProductLike = {}) {
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

export function getExistingStylingMainCategoryNames(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      ".styling-list-editor-container .main-category-input",
    ) as NodeListOf<HTMLInputElement>,
  )
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

export function getMainCategoryMappingSelect(container: HTMLElement, sourceKey: string): HTMLSelectElement | null {
  return container.querySelector(
    `.main-category-target-select[data-source-key="${sourceKey}"]`,
  ) as HTMLSelectElement | null;
}

export function resolveMappedMainCategoryName(container: HTMLElement, excelMainCategoryName: string): string {
  const normalizedSource = normalizeCategoryKey(excelMainCategoryName);
  if (!normalizedSource) return String(excelMainCategoryName || "").trim();

  const mappingSelect = getMainCategoryMappingSelect(container, normalizedSource);
  if (!(mappingSelect instanceof HTMLSelectElement)) return String(excelMainCategoryName || "").trim();

  const selectedValue = String(mappingSelect.value || "").trim();
  if (!selectedValue || selectedValue === "__same__" || selectedValue === "__new__") {
    return String(excelMainCategoryName || "").trim();
  }

  return selectedValue;
}
