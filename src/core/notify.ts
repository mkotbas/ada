type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface ToastOptions {
  /** Auto close delay in ms. Defaults to 3500. */
  durationMs?: number;
}

class NotifyService {
  private container: HTMLElement | null = null;

  init(): void {
    if (this.container) return;
    const el = document.createElement('div');
    el.id = 'app-toast-container';
    document.body.appendChild(el);
    this.container = el;
  }

  clear(): void {
    if (!this.container) return;
    this.container.replaceChildren();
  }

  toast(kind: ToastKind, message: string, options?: ToastOptions): void {
    if (!message) return;
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast--${kind}`;
    toast.textContent = message;

    this.container!.appendChild(toast);

    const duration = options?.durationMs ?? 3500;
    window.setTimeout(() => {
      toast.classList.add('hide');
      window.setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  info(message: string, options?: ToastOptions): void {
    this.toast('info', message, options);
  }

  success(message: string, options?: ToastOptions): void {
    this.toast('success', message, options);
  }

  warning(message: string, options?: ToastOptions): void {
    this.toast('warning', message, options);
  }

  error(message: string, options?: ToastOptions): void {
    this.toast('error', message, options);
  }
}

export const notify = new NotifyService();
