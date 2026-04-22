// Merkezi DOM yardımcıları (Talimat: inline script yok, innerHTML yok)

const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'formaction']);
const REMOVABLE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'meta',
  'link',
  'base',
]);
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

const FORM_FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
let formFieldIdentityCounter = 0;

function slugifyFormFieldIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function getFormFieldIdentityBase(el: Element): string {
  const dataCandidates = [
    el.getAttribute('data-column'),
    el.getAttribute('data-field'),
    el.getAttribute('data-question-id'),
    el.getAttribute('data-name'),
    el.getAttribute('placeholder'),
    (el as HTMLInputElement).type && el.tagName === 'INPUT' ? (el as HTMLInputElement).type : '',
    ...Array.from(el.classList),
  ]
    .map((item) => slugifyFormFieldIdentity(String(item ?? '')))
    .filter(Boolean);

  return dataCandidates[0] || el.tagName.toLowerCase();
}

export function ensureFormFieldIdentity(el: Element): void {
  if (!FORM_FIELD_TAGS.has(el.tagName)) return;

  const field = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const base = getFormFieldIdentityBase(field);

  if (!field.id) field.id = `${base}-${++formFieldIdentityCounter}`;
  if (!field.getAttribute('name')) field.setAttribute('name', field.id);
}

export function ensureFormFieldIdentities(root: ParentNode): void {
  if (root instanceof Element) ensureFormFieldIdentity(root);

  const fields = root.querySelectorAll?.('input, select, textarea');
  fields?.forEach((field) => ensureFormFieldIdentity(field));
}

export function installFormFieldIdentityObserver(root: Document | HTMLElement = document): () => void {
  const target = root instanceof Document ? root.documentElement : root;
  if (!target) return () => undefined;

  ensureFormFieldIdentities(target);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        ensureFormFieldIdentity(node);
        ensureFormFieldIdentities(node);
      });
    });
  });

  observer.observe(target, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el as T;
}

export function qsa<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}

export function clear(el: Element): void {
  (el as HTMLElement).replaceChildren();
}

export function setText(el: Element, text: string): void {
  (el as HTMLElement).textContent = text;
}

export function escapeHtml(value: unknown): string {
  const text = String(value ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHtmlAttribute(value: unknown): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function sanitizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const baseHref = typeof window !== 'undefined' && window.location?.href ? window.location.href : 'https://fide.local/';
    const parsed = new URL(trimmed, baseHref);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

export function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
  }
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts?.className) node.className = opts.className;
  if (opts?.text !== undefined) node.textContent = opts.text;
  if (opts?.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  ensureFormFieldIdentity(node);
  return node;
}

export function appendIconText(
  target: HTMLElement,
  iconClass: string,
  text: string,
  opts?: { iconAriaHidden?: boolean }
): void {
  target.replaceChildren();
  const i = make('i');
  i.className = iconClass;
  if (opts?.iconAriaHidden ?? true) i.setAttribute('aria-hidden', 'true');
  target.append(i, document.createTextNode(` ${text}`));
}

export function appendIconOnly(target: HTMLElement, iconClass: string): void {
  target.replaceChildren();
  const i = make('i');
  i.className = iconClass;
  i.setAttribute('aria-hidden', 'true');
  target.append(i);
}

export function setSelectPlaceholder(select: HTMLSelectElement, label: string): void {
  select.replaceChildren();
  const opt = make('option', { text: label });
  opt.value = '';
  select.append(opt);
}

export function setTbodyMessage(
  tbody: HTMLTableSectionElement,
  colspan: number,
  message: string,
  opts?: { className?: string }
): void {
  tbody.replaceChildren();
  const tr = make('tr');
  const td = make('td', { text: message, className: opts?.className });
  td.colSpan = colspan;
  tr.append(td);
  tbody.append(tr);
}

export function parseHtmlFragment(html: string): DocumentFragment {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  for (const node of Array.from(doc.body.childNodes)) frag.append(node);
  return frag;
}

function sanitizeElementAttributes(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith('on') || name === 'srcdoc') {
      el.removeAttribute(attr.name);
      continue;
    }

    if (!URL_ATTRIBUTES.has(name)) {
      continue;
    }

    const safeUrl = sanitizeUrl(value);
    if (!safeUrl) {
      el.removeAttribute(attr.name);
      continue;
    }

    el.setAttribute(attr.name, safeUrl);

    if (name === 'href' && el instanceof HTMLAnchorElement && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/**
 * Güvenli HTML fragment üretimi.
 * - Çalıştırılabilir / gömülebilir riskli etiketler temizlenir
 * - on* event handler ve srcdoc kaldırılır
 * - href/src benzeri URL alanları protokol allowlist ile doğrulanır
 * Talimat: innerHTML direkt kullanılmaz.
 */
export function safeHtmlFragment(html: string): DocumentFragment {
  const frag = parseHtmlFragment(html);
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const tag = el.tagName.toLowerCase();
    if (REMOVABLE_TAGS.has(tag)) {
      toRemove.push(el);
      continue;
    }
    sanitizeElementAttributes(el);
  }

  for (const el of toRemove) el.remove();
  return frag;
}

export function setSafeHtml(target: Element, html: string): void {
  (target as HTMLElement).replaceChildren();
  (target as HTMLElement).appendChild(safeHtmlFragment(html));
}

export function appendSafeHtml(target: Element, html: string): void {
  (target as HTMLElement).appendChild(safeHtmlFragment(html));
}



type ModalCleanup = () => void;

export type ModalController = {
  open: () => void;
  close: () => void;
  toggle: (forceOpen?: boolean) => void;
  isOpen: () => boolean;
  onCloseCleanup: (cleanup: ModalCleanup) => () => void;
  destroy: () => void;
};

export function createModalController(
  modalEl: HTMLElement,
  opts?: {
    closeSelectors?: string[];
    closeButtons?: Array<HTMLElement | null | undefined>;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
  }
): ModalController {
  const removeListeners: ModalCleanup[] = [];
  const sessionCleanups = new Set<ModalCleanup>();
  let lastFocused: HTMLElement | null = null;
  let destroyed = false;

  const isOpen = () => !modalEl.hidden;

  const flushSessionCleanups = () => {
    for (const cleanup of Array.from(sessionCleanups)) {
      sessionCleanups.delete(cleanup);
      try {
        cleanup();
      } catch (error) {
        console.error('Modal cleanup failed:', error);
      }
    }
  };

  const close = () => {
    if (destroyed || !isOpen()) return;
    modalEl.hidden = true;
    modalEl.setAttribute('aria-hidden', 'true');
    flushSessionCleanups();
    opts?.onClose?.();
    if (lastFocused?.isConnected) lastFocused.focus();
  };

  const open = () => {
    if (destroyed) return;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalEl.hidden = false;
    modalEl.setAttribute('aria-hidden', 'false');
    opts?.onOpen?.();
    const focusTarget = modalEl.querySelector<HTMLElement>(
      '[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusTarget?.focus();
  };

  const toggle = (forceOpen?: boolean) => {
    if (forceOpen === true) {
      open();
      return;
    }
    if (forceOpen === false) {
      close();
      return;
    }
    if (isOpen()) close();
    else open();
  };

  const bind = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    eventName: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => {
    target.addEventListener(eventName, listener as EventListener);
    removeListeners.push(() => target.removeEventListener(eventName, listener as EventListener));
  };

  if (opts?.closeOnBackdrop ?? true) {
    bind(modalEl, 'click', (event) => {
      if (event.target === modalEl) close();
    });
  }

  if (opts?.closeOnEscape ?? true) {
    bind(document, 'keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        close();
      }
    });
  }

  const closeTargets = [
    ...(opts?.closeButtons ?? []),
    ...((opts?.closeSelectors ?? []).map((selector) => modalEl.querySelector<HTMLElement>(selector))),
  ].filter(Boolean) as HTMLElement[];

  closeTargets.forEach((button) => {
    bind(button, 'click', () => close());
  });

  modalEl.setAttribute('aria-hidden', String(modalEl.hidden));

  return {
    open,
    close,
    toggle,
    isOpen,
    onCloseCleanup(cleanup: ModalCleanup) {
      sessionCleanups.add(cleanup);
      return () => {
        sessionCleanups.delete(cleanup);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      while (removeListeners.length) {
        removeListeners.pop()?.();
      }
      flushSessionCleanups();
    },
  };
}
// TOTAL_LINES: 175
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
