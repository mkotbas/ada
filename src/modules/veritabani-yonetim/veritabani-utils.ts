import { createModalController, escapeHtml, setSafeHtml, type ModalController } from "@core/dom";

let commonModalController: ModalController | null = null;

export function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) {
    throw new Error(`Beklenen element bulunamadı: #${id}`);
  }
  return el;
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  el.hidden = hidden;
}

function getCommonModalController(): ModalController {
  if (commonModalController) {
    return commonModalController;
  }

  const modal = document.getElementById("db-common-modal");
  if (!(modal instanceof HTMLElement)) {
    throw new Error(
      "Modal DOM elemanları bulunamadı (db-common-modal / modal-title / modal-body / modal-footer).",
    );
  }

  commonModalController = createModalController(modal, {
    closeSelectors: ["#btn-close-modal"],
  });
  return commonModalController;
}

export function showCommonModal(
  title: string,
  bodyHtml: string,
  footerHtml: string,
): void {
  const titleEl = document.getElementById("modal-title");
  const bodyEl = document.getElementById("modal-body");
  const footerEl = document.getElementById("modal-footer");

  if (!titleEl || !bodyEl || !footerEl) {
    throw new Error(
      "Modal DOM elemanları bulunamadı (db-common-modal / modal-title / modal-body / modal-footer).",
    );
  }

  titleEl.textContent = title;
  setSafeHtml(bodyEl, bodyHtml);
  setSafeHtml(footerEl, footerHtml);
  getCommonModalController().open();
}

export function closeCommonModal(): void {
  getCommonModalController().close();
}

export function toDateValue(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function normalizeCompletionValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isCompletedReport(report: {
  denetimTamamlanmaTarihi?: unknown;
}): boolean {
  const value = normalizeCompletionValue(report.denetimTamamlanmaTarihi);
  return (
    value !== "" && value !== "n/a" && value !== "null" && value !== "undefined"
  );
}

export function isEmptyQuestionState(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" || trimmed === "{}" || trimmed === "[]";
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function formatReason(reason?: string): string {
  return reason
    ? `<small class="db-clean-stat-reason">${escapeHtml(reason)}</small>`
    : "";
}

export function buildCleanupListItem(
  label: string,
  count: number,
  reason?: string,
): string {
  return `
    <li class="db-clean-stat-item">
      <div>
        <strong>${escapeHtml(String(count))}</strong> ${escapeHtml(label)}
        ${formatReason(reason)}
      </div>
    </li>
  `;
}

export function buildCleanupOption(
  id: string,
  checked: boolean,
  title: string,
  hint: string,
): string {
  return `
    <label class="db-checkbox-row db-clean-checkbox-row">
      <input type="checkbox" id="${escapeHtml(id)}" name="${escapeHtml(id)}" ${checked ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small class="db-clean-option-hint">${escapeHtml(hint)}</small>
      </span>
    </label>
  `;
}

export function buildCleanupStageItem(
  stageNo: number,
  title: string,
  desc: string,
): string {
  return `
    <li class="db-clean-stage-item">
      <strong>Aşama ${escapeHtml(String(stageNo))}: ${escapeHtml(title)}</strong>
      <small>${escapeHtml(desc)}</small>
    </li>
  `;
}

export function generateSecurePassword(length = 24): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const randomBytes = new Uint32Array(length);
  crypto.getRandomValues(randomBytes);
  return Array.from(
    randomBytes,
    (value) => alphabet[value % alphabet.length],
  ).join("");
}
