import { notify } from './notify';

export type ErrorType = 'network' | 'auth' | 'validation' | 'system';

export interface HandleErrorOptions {
  /** Override the user-facing message. */
  userMessage?: string;
  /** Force a specific classification. */
  type?: ErrorType;
  /** Do not show a toast (still logs). */
  silent?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStatus(err: unknown): number | undefined {
  if (!isObject(err)) return undefined;
  const status = err['status'];
  return typeof status === 'number' ? status : undefined;
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message || 'Bilinmeyen hata';
  if (typeof err === 'string') return err;
  if (isObject(err) && typeof err['message'] === 'string') return err['message'];
  return 'Bilinmeyen hata';
}

function classify(err: unknown): ErrorType {
  const status = getStatus(err);
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'validation';
  // Network-ish signals
  const msg = getMessage(err).toLowerCase();
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('timeout')
  ) {
    return 'network';
  }
  // PocketBase sometimes uses status=0 for network-ish errors
  if (status === 0) return 'network';
  return 'system';
}

function defaultUserMessage(type: ErrorType): string {
  switch (type) {
    case 'network':
      return 'Sunucu bağlantısı kurulamadı. Lütfen bağlantınızı kontrol edin.';
    case 'auth':
      return 'Bu işlem için yetkiniz yok ya da oturumunuz sonlandı.';
    case 'validation':
      return 'Girilen bilgiler geçersiz. Lütfen kontrol edin.';
    default:
      return 'Beklenmeyen bir hata oluştu.';
  }
}

class ErrorService {
  init(): void {
    notify.init();
  }

  handle(err: unknown, options?: HandleErrorOptions): void {
    // Always log full details for debugging.
    console.error('[AppError]', err);

    const type = options?.type ?? classify(err);
    const userMsg = options?.userMessage ?? defaultUserMessage(type);

    if (!options?.silent) {
      notify.error(userMsg);
    }
  }

  /** Convenience helpers */
  network(err: unknown, userMessage?: string): void {
    this.handle(err, { type: 'network', userMessage });
  }

  auth(err: unknown, userMessage?: string): void {
    this.handle(err, { type: 'auth', userMessage });
  }
}

export const errorService = new ErrorService();
