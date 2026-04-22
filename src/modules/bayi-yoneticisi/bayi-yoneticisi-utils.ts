export type BayiImportPayload = {
  bayiKodu: string;
  bayiAdi?: string;
  bolge?: string;
  sehir?: string;
  ilce?: string;
  yonetmen?: string;
  email?: string;
  sorumlu_kullanici?: string;
};

export function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function setElementHidden(el: unknown, hidden: boolean): void {
  if (el instanceof HTMLElement) el.hidden = hidden;
}

export function getCheckedValues(root: ParentNode | null | undefined): string[] {
  return Array.from((root?.querySelectorAll("input:checked") ?? []) as NodeListOf<HTMLInputElement>).map((input) => input.value);
}

export function renderCheckboxList(
  containerEl: Element,
  list: string[],
  selectedValues: string[],
  onChange: (this: GlobalEventHandlers, ev: Event) => unknown,
): void {
  containerEl.replaceChildren();
  list.forEach((val) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = val;
    input.checked = selectedValues.includes(val);
    input.onchange = onChange;
    label.replaceChildren(input, document.createTextNode(` ${val}`));
    containerEl.appendChild(label);
  });
}

export function setLoadingState(
  overlay: unknown,
  textEl: unknown,
  visible: boolean,
  message = "",
): void {
  if (textEl instanceof HTMLElement) textEl.textContent = message;
  setElementHidden(overlay, !visible);
}

export async function processInChunks<T>(
  items: T[],
  chunkSize: number,
  handler: (item: T) => Promise<unknown>,
  onProgress?: (processed: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(handler));
    onProgress?.(Math.min(i + chunkSize, items.length), items.length);
  }
}
