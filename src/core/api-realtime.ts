import { pb } from './db-config';
import { showLockoutOverlay } from './utils';
import { debugSilentError, type PocketBaseRecord } from './api-shared';
import {
  getDeviceDescription,
  getDeviceFingerprint,
  getLegacyDeviceFingerprint,
  resolveDeviceAccess,
  syncUserDeviceRecord,
} from './api-device';
import { dispatchMonthlyAuditDataChanged } from './monthly-audit-state';

type UnsubscribeFn = () => void;

export async function createRealtimeSubscriptionCleanup(onLogout: () => void): Promise<UnsubscribeFn | null> {
  if (!pb.authStore.isValid) return null;

  const userId = String(pb.authStore.model?.['id'] ?? '');
  if (!userId) return null;

  const browserDeviceKey = await getDeviceFingerprint();
  const browserSignature = await getLegacyDeviceFingerprint();
  const browserDeviceDescription = getDeviceDescription();
  const cleanupTasks: UnsubscribeFn[] = [];
  const guardedReload = (): void => {
    showLockoutOverlay('Hesabiniz veya cihaziniz yonetici tarafindan kilitlendi. Sistemden cikis yapiliyor...');
    onLogout();
    window.setTimeout(() => window.location.reload(), 3000);
  };

  const emitMonthlyAuditRefresh = (): void => {
    dispatchMonthlyAuditDataChanged('realtime');
  };

  try {
    const currentUser = await pb.collection('users').getOne<PocketBaseRecord>(userId);
    if (currentUser['is_banned'] === true) {
      guardedReload();
      return null;
    }

    await pb.collection('users').subscribe(userId, (event) => {
      if (event.record?.['is_banned'] === true) guardedReload();
    });
    cleanupTasks.push(() => {
      void pb.collection('users').unsubscribe(userId);
    });
  } catch (error) {
    debugSilentError('Kullanici dinleme', error);
  }

  try {
    await pb.collection('denetim_raporlari').subscribe('*', () => {
      emitMonthlyAuditRefresh();
    });
    cleanupTasks.push(() => {
      void pb.collection('denetim_raporlari').unsubscribe('*');
    });
  } catch (error) {
    debugSilentError('Denetim raporlari dinleme', error);
  }

  try {
    await pb.collection('denetim_geri_alinanlar').subscribe('*', () => {
      emitMonthlyAuditRefresh();
    });
    cleanupTasks.push(() => {
      void pb.collection('denetim_geri_alinanlar').unsubscribe('*');
    });
  } catch (error) {
    debugSilentError('Denetim geri alma dinleme', error);
  }

  try {
    await pb.collection('ayarlar').subscribe('*', (event) => {
      const anahtar = String(event.record?.['anahtar'] ?? '');
      if (anahtar === 'aylikHedef' || anahtar === 'minZiyaret' || anahtar.startsWith('leaveData_') || anahtar.startsWith('manualAuditData_')) {
        emitMonthlyAuditRefresh();
      }
    });
    cleanupTasks.push(() => {
      void pb.collection('ayarlar').unsubscribe('*');
    });
  } catch (error) {
    debugSilentError('Ayar dinleme', error);
  }

  if (pb.authStore.model?.['role'] !== 'client') {
    return () => {
      cleanupTasks.forEach((task) => task());
    };
  }

  try {
    const { userDevice, foreignDevice } = await resolveDeviceAccess(userId, browserDeviceKey, browserSignature);
    const activeDevice = userDevice ?? foreignDevice;

    if (activeDevice?.['is_locked'] === true) {
      guardedReload();
      return null;
    }

    if (userDevice) {
      await syncUserDeviceRecord(userDevice, browserDeviceKey, browserSignature, browserDeviceDescription);
    }

    const deviceId = String(activeDevice?.['id'] ?? '');
    if (deviceId) {
      await pb.collection('user_devices').subscribe(deviceId, (event) => {
        if (event.record?.['is_locked'] === true) guardedReload();
      });
      cleanupTasks.push(() => {
        void pb.collection('user_devices').unsubscribe(deviceId);
      });
    }
  } catch (error) {
    debugSilentError('Cihaz dinleme', error);
  }

  return () => {
    cleanupTasks.forEach((task) => task());
  };
}
