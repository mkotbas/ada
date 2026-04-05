import { pb } from './db-config';
import { debugSilentError, isPocketBaseNotFoundError, type LoginResult, type PocketBaseRecord } from './api-shared';

export interface UserDeviceRecord extends PocketBaseRecord {
  user?: string;
  device_key?: string;
  device_info?: string;
  browser_signature?: string;
  is_locked?: boolean;
  last_login?: string;
}

interface DeviceAccessResolution {
  userDevice: UserDeviceRecord | null;
  foreignDevice: UserDeviceRecord | null;
  userDevices: UserDeviceRecord[];
}

const DEVICE_INSTALLATION_KEY = 'fide_device_installation_id';

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function getDeviceDescription(): string {
  const ua = navigator.userAgent;

  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh/.test(ua)) os = 'MacOS';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Unknown Browser';
  if (/Edg/.test(ua)) browser = 'Edge';
  else if (/Chrome/.test(ua)) browser = 'Chrome';
  else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Firefox/.test(ua)) browser = 'Firefox';

  return `${browser} on ${os}`;
}

function readStoredDeviceInstallationId(): string | null {
  try {
    const value = window.localStorage.getItem(DEVICE_INSTALLATION_KEY)?.trim() ?? '';
    return value || null;
  } catch (error) {
    debugSilentError('Cihaz kimligi okuma', error);
    return null;
  }
}

function createRandomDeviceInstallationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().toUpperCase();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, part => part.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function getDeviceInstallationId(): string {
  const existing = readStoredDeviceInstallationId();
  if (existing) return existing;

  const created = createRandomDeviceInstallationId();

  try {
    window.localStorage.setItem(DEVICE_INSTALLATION_KEY, created);
  } catch (error) {
    debugSilentError('Cihaz kimligi saklama', error);
  }

  return created;
}

async function hashDeviceKey(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function getDeviceFingerprint(): Promise<string> {
  const installId = getDeviceInstallationId();
  const components = [
    'FIDESTABLEDEVICE',
    installId,
    navigator.platform || 'unknown-platform',
    navigator.language || 'unknown-language',
  ];

  return hashDeviceKey(components.join('###'));
}

export async function getLegacyDeviceFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    `${screen.width}x${screen.height}`,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency ?? 'unknown',
    navigator.platform,
  ];

  return hashDeviceKey(components.join('###'));
}

function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function getUserDevices(userId: string): Promise<UserDeviceRecord[]> {
  try {
    return await pb.collection('user_devices').getFullList<UserDeviceRecord>({
      filter: `user="${escapeFilterValue(userId)}"`,
      sort: '-last_login',
    });
  } catch (error) {
    debugSilentError('Kullanici cihazlarini yukleme', error);
    return [];
  }
}

function getDeviceIdentifierCandidates(deviceKey: string, browserSignature: string): string[] {
  return [...new Set([deviceKey.trim(), browserSignature.trim()].filter(Boolean))];
}

function findMatchingDeviceRecord(devices: UserDeviceRecord[], identifiers: string[]): UserDeviceRecord | null {
  for (const identifier of identifiers) {
    const found = devices.find(device => {
      const key = String(device['device_key'] ?? '').trim();
      const signature = String(device['browser_signature'] ?? '').trim();
      return key === identifier || signature === identifier;
    });
    if (found) return found;
  }
  return null;
}

async function findForeignDeviceRecord(userId: string, identifiers: string[]): Promise<UserDeviceRecord | null> {
  for (const identifier of identifiers) {
    try {
      return await pb.collection('user_devices').getFirstListItem<UserDeviceRecord>(
        `(device_key="${escapeFilterValue(identifier)}" || browser_signature="${escapeFilterValue(identifier)}") && user!="${escapeFilterValue(userId)}"`,
      );
    } catch (error) {
      if (!isPocketBaseNotFoundError(error)) debugSilentError('Yabanci cihaz kaydi arama', error);
    }
  }

  return null;
}

export async function resolveDeviceAccess(
  userId: string,
  deviceKey: string,
  browserSignature: string,
): Promise<DeviceAccessResolution> {
  const identifiers = getDeviceIdentifierCandidates(deviceKey, browserSignature);
  const userDevices = await getUserDevices(userId);
  const userDevice = findMatchingDeviceRecord(userDevices, identifiers);
  const foreignDevice = await findForeignDeviceRecord(userId, identifiers);
  return { userDevice, foreignDevice, userDevices };
}

export async function syncUserDeviceRecord(
  deviceRecord: UserDeviceRecord,
  deviceKey: string,
  browserSignature: string,
  deviceDesc: string,
): Promise<UserDeviceRecord> {
  const recordId = String(deviceRecord['id'] ?? '');
  const currentKey = String(deviceRecord['device_key'] ?? '');
  const currentSignature = String(deviceRecord['browser_signature'] ?? '');
  const currentInfo = String(deviceRecord['device_info'] ?? '');

  if (!recordId || (currentKey === deviceKey && currentSignature === browserSignature && currentInfo === deviceDesc)) {
    return deviceRecord;
  }

  try {
    return await pb.collection('user_devices').update<UserDeviceRecord>(recordId, {
      device_key: deviceKey,
      browser_signature: browserSignature,
      device_info: deviceDesc,
      last_login: new Date().toISOString(),
    });
  } catch (error) {
    debugSilentError('Cihaz kaydi guncelleme', error);
    return deviceRecord;
  }
}

export async function loginWithDeviceChecks(
  email: string,
  password: string,
  onLogout: () => void,
): Promise<LoginResult> {
  if (!pb) return { success: false, message: 'Baglanti hatasi.' };

  let user: Record<string, unknown>;
  try {
    const authData = await pb.collection('users').authWithPassword(email, password);
    user = await pb.collection('users').getOne(authData.record['id'] as string);
  } catch (error) {
    debugSilentError('Giris dogrulama', error);
    return { success: false, message: 'E-posta veya sifre hatali.' };
  }

  try {
    if (user['is_banned'] === true) {
      onLogout();
      return { success: false, message: 'Bu hesap kilitlenmistir.' };
    }

    if (user['role'] === 'admin') {
      return { success: true, message: 'Yonetici girisi basarili.' };
    }

    if (user['mobile_access'] === false && isMobileDevice()) {
      onLogout();
      return { success: false, message: 'Mobil cihaz girisi yasaktir.' };
    }

    const fingerprint = await getDeviceFingerprint();
    const browserSignature = await getLegacyDeviceFingerprint();
    const deviceDesc = getDeviceDescription();
    const userId = String(user['id'] ?? '');

    const { userDevice, foreignDevice, userDevices } = await resolveDeviceAccess(userId, fingerprint, browserSignature);

    if (foreignDevice) {
      onLogout();
      return {
        success: false,
        message: 'Bu cihaz baska bir kullaniciya kayitlidir. Yonetici sifirlamadan giris yapilamaz.',
      };
    }

    if (userDevice) {
      if (userDevice['is_locked'] === true) {
        onLogout();
        return { success: false, message: 'Bu cihaz kilitlenmistir.' };
      }

      await syncUserDeviceRecord(userDevice, fingerprint, browserSignature, deviceDesc);
      return { success: true, message: 'Giris basarili.' };
    }

    if (userDevices.length > 0) {
      onLogout();
      return {
        success: false,
        message: 'Bu hesap yalnizca yonetici tarafindan sifirlanan kayitli cihaz ile kullanilabilir.',
      };
    }

    await pb.collection('user_devices').create({
      user: userId,
      device_key: fingerprint,
      browser_signature: browserSignature,
      device_info: deviceDesc,
      last_login: new Date().toISOString(),
      is_locked: false,
    });

    return { success: true, message: 'Cihaz kaydi olusturuldu.' };
  } catch (error) {
    debugSilentError('Guvenlik kontrolu', error);
    onLogout();
    return { success: false, message: 'Guvenlik hatasi olustu.' };
  }
}
