import { pb } from './db-config';
import { clearExcelFromCloud, loadExcelDataFromCloud, loadInitialData, loadReportForStore, saveFormState } from './api-data';
import { loginWithDeviceChecks } from './api-device';
import { createRealtimeSubscriptionCleanup } from './api-realtime';
import type { LoginResult } from './api-shared';

type UnsubscribeFn = () => void;

let realtimeCleanup: UnsubscribeFn | null = null;

function replaceRealtimeCleanup(nextCleanup: UnsubscribeFn | null): void {
  realtimeCleanup?.();
  realtimeCleanup = nextCleanup;
}

export function cleanupRealtimeSubscriptions(): void {
  replaceRealtimeCleanup(null);
}

export async function subscribeToRealtimeChanges(): Promise<void> {
  replaceRealtimeCleanup(null);
  const cleanup = await createRealtimeSubscriptionCleanup(logoutUser);
  replaceRealtimeCleanup(cleanup);
}

export { clearExcelFromCloud, loadExcelDataFromCloud, loadInitialData, loadReportForStore, saveFormState };

export async function loginUser(email: string, password: string): Promise<LoginResult> {
  return loginWithDeviceChecks(email, password, logoutUser);
}

export function logoutUser(): void {
  pb.authStore.clear();
}

// TOTAL_LINES: 30
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
