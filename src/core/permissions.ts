export type AppRole = 'admin' | 'client' | null;

export type AdminModuleId =
  | 'denetim-takip'
  | 'calisma-takvimi'
  | 'eposta-taslagi'
  | 'bayi-yoneticisi'
  | 'soru-yoneticisi'
  | 'veritabani-yonetim'
  | 'kullanici-yoneticisi';

const CLIENT_MODULES: ReadonlySet<AdminModuleId> = new Set(['denetim-takip']);
const ADMIN_MODULES: ReadonlySet<AdminModuleId> = new Set([
  'denetim-takip',
  'calisma-takvimi',
  'eposta-taslagi',
  'bayi-yoneticisi',
  'soru-yoneticisi',
  'veritabani-yonetim',
  'kullanici-yoneticisi',
]);

export function getCurrentUserRole(authModel: Record<string, unknown> | null | undefined): AppRole {
  const role = authModel?.['role'];
  return role === 'admin' || role === 'client' ? role : null;
}

export function canAccessAdminShell(role: AppRole): boolean {
  return role === 'admin' || role === 'client';
}

export function canAccessAdminModule(role: AppRole, moduleId: string): moduleId is AdminModuleId {
  if (role === 'admin') return ADMIN_MODULES.has(moduleId as AdminModuleId);
  if (role === 'client') return CLIENT_MODULES.has(moduleId as AdminModuleId);
  return false;
}

export function getAccessibleAdminModuleIds(role: AppRole): AdminModuleId[] {
  if (role === 'admin') return Array.from(ADMIN_MODULES);
  if (role === 'client') return Array.from(CLIENT_MODULES);
  return [];
}

export function getAdminPanelButtonLabel(role: AppRole): string {
  return role === 'admin' ? 'Yönetim Paneli' : 'Denetim Takip';
}

export function shouldShowAdminPanelButton(role: AppRole): boolean {
  return canAccessAdminShell(role);
}
