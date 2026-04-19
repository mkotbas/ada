import type PocketBase from 'pocketbase';
import { appendIconOnly, appendIconText, make, setTbodyMessage } from '@core/dom';
import { notify } from '../../core/notify';
import { errorService } from '../../core/error';
import { fetchAllRecords } from '@core/pocketbase-helpers';

type Role = 'admin' | 'client' | string;

type UserRecord = {
  id: string;
  name?: string;
  email: string;
  role: Role;
  is_banned?: boolean;
  mobile_access?: boolean;
  created: string;
  device_limit?: number;
};

type UserDeviceRecord = {
  id: string;
  device_info: string;
  last_login: string;
  is_locked?: boolean;
};

export function initializeKullaniciYoneticisiModule(pb: PocketBase): void {
  let allUsers: UserRecord[] = [];

  const listView = document.getElementById('user-list-view') as HTMLElement | null;
  const formView = document.getElementById('user-form-view') as HTMLElement | null;

  const tableBody = document.getElementById('users-table-body') as HTMLTableSectionElement | null;

  const form = document.getElementById('user-form') as HTMLFormElement | null;
  const formTitle = document.getElementById('user-form-title') as HTMLElement | null;

  const userIdInput = document.getElementById('user-id-input') as HTMLInputElement | null;
  const userNameInput = document.getElementById('user-name-input') as HTMLInputElement | null;
  const userEmailInput = document.getElementById('user-email-input') as HTMLInputElement | null;

  const passwordWrapper = document.getElementById('password-fields-wrapper') as HTMLElement | null;
  const userPasswordInput = document.getElementById('user-password-input') as HTMLInputElement | null;
  const userPasswordConfirmInput = document.getElementById('user-password-confirm-input') as HTMLInputElement | null;

  const userRoleSelect = document.getElementById('user-role-select') as HTMLSelectElement | null;
  const mobileAccessCheckbox = document.getElementById('user-mobile-access-checkbox') as HTMLInputElement | null;

  const userDeviceLimitSection = document.getElementById('user-device-limit-section') as HTMLElement | null;
  const userDeviceLimitInput = document.getElementById('user-device-limit-input') as HTMLInputElement | null;

  const userBanSection = document.getElementById('user-ban-section') as HTMLElement | null;
  const toggleBanUserBtn = document.getElementById('toggle-ban-user-btn') as HTMLButtonElement | null;

  const devicesHr = document.getElementById('devices-hr') as HTMLElement | null;
  const devicesListLoading = document.getElementById('devices-list-loading') as HTMLElement | null;
  const userDevicesTableWrapper = document.getElementById('user-devices-table-wrapper') as HTMLElement | null;
  const userDevicesTableBody = document.getElementById('user-devices-table-body') as HTMLTableSectionElement | null;

  const addNewUserBtn = document.getElementById('add-new-user-btn') as HTMLButtonElement | null;
  const saveUserBtn = document.getElementById('save-user-btn') as HTMLButtonElement | null;
  const cancelUserFormBtn = document.getElementById('cancel-user-form-btn') as HTMLButtonElement | null;

  const show = (el: HTMLElement | null): void => { if (el) el.hidden = false; };
  const hide = (el: HTMLElement | null): void => { if (el) el.hidden = true; };

  function showForm(): void { hide(listView); show(formView); }
  function showList(): void { hide(formView); show(listView); renderUsersTable(allUsers); }

  async function loadUsers(): Promise<void> {
    if (tableBody && !(listView?.hidden ?? true)) setTbodyMessage(tableBody, 7, 'Kullanıcılar yükleniyor...', { className: 'table-status' });

    try {
      const raw = await fetchAllRecords(pb.collection('users'), { sort: 'name' });
      allUsers = raw as unknown as UserRecord[];
      if (!(listView?.hidden ?? true)) renderUsersTable(allUsers);
    } catch (err) {
      console.error('Kullanıcılar yüklenemedi:', err);
      if (tableBody && !(listView?.hidden ?? true)) setTbodyMessage(tableBody, 7, 'Yüklenemedi.', { className: 'table-status table-status-error' });
    }
  }

  async function loadUserDevices(userId: string): Promise<void> {
    show(devicesListLoading);
    hide(userDevicesTableWrapper);

    try {
      const raw = await fetchAllRecords(pb.collection('user_devices'), { filter: `user = "${userId}"`, sort: '-last_login' });
      renderUserDevicesTable(raw as unknown as UserDeviceRecord[]);
    } catch (err) {
      console.error('Cihazlar yüklenemedi:', err);
      if (userDevicesTableBody) setTbodyMessage(userDevicesTableBody, 4, 'Cihazlar yüklenemedi.', { className: 'table-status table-status-error' });
    } finally {
      hide(devicesListLoading);
      show(userDevicesTableWrapper);
    }
  }

  function renderUsersTable(users: UserRecord[]): void {
    if (!tableBody) return;
    tableBody.replaceChildren();

    if (users.length === 0) {
      setTbodyMessage(tableBody, 7, 'Kayıt bulunamadı.', { className: 'table-status' });
      return;
    }

    users.forEach(user => {
      const tr = document.createElement('tr');

      const tdName = make('td');
      const strong = make('strong', { text: user.name?.trim() ? user.name : 'İsimsiz' });
      tdName.appendChild(strong);

      const tdEmail = make('td', { text: user.email });

      const roleClass = user.role === 'admin' ? 'role-admin' : 'role-client';
      const tdRole = make('td');
      const roleBadge = make('span', { className: `role-badge ${roleClass}`, text: String(user.role) });
      tdRole.appendChild(roleBadge);

      const isBanned = Boolean(user.is_banned);
      const banStatusClass = isBanned ? 'status-banned' : 'status-active';
      const tdStatus = make('td');
      const statusBadge = make('span', { className: `status-badge ${banStatusClass}`, text: isBanned ? 'BAN' : 'Aktif' });
      tdStatus.appendChild(statusBadge);

      const tdMobile = make('td', { text: user.mobile_access ? 'Evet' : 'Hayır' });
      const tdCreated = make('td', { text: new Date(user.created).toLocaleDateString('tr-TR') });

      const tdActions = make('td', { className: 'actions-cell' });

      const editBtn = make('button', { className: 'btn-warning btn-sm btn-edit', attrs: { type: 'button' } });
      appendIconText(editBtn, 'fas fa-edit', 'Düzenle');
      editBtn.addEventListener('click', () => handleEdit(user.id));
      tdActions.appendChild(editBtn);

      if (user.role === 'admin') {
        const info = make('span', { className: 'text-muted user-protected-note', text: 'Korunuyor' });
        tdActions.appendChild(info);
      } else {
        const delBtn = make('button', { className: 'btn-danger btn-sm btn-delete', attrs: { type: 'button' } });
        appendIconText(delBtn, 'fas fa-trash', 'Sıfırla');
        delBtn.addEventListener('click', () => { void handleDelete(user.id); });
        tdActions.appendChild(delBtn);
      }

      tr.append(tdName, tdEmail, tdRole, tdStatus, tdMobile, tdCreated, tdActions);
      tableBody.appendChild(tr);
    });
  }

  function renderUserDevicesTable(devices: UserDeviceRecord[]): void {
    if (!userDevicesTableBody) return;
    userDevicesTableBody.replaceChildren();

    if (devices.length === 0) {
      setTbodyMessage(userDevicesTableBody, 4, 'Cihaz yok.', { className: 'table-status' });
      return;
    }

    devices.forEach(device => {
      const tr = document.createElement('tr');

      const tdInfo = make('td', { text: device.device_info });
      const tdLast = make('td', { text: new Date(device.last_login).toLocaleString('tr-TR') });

      const locked = Boolean(device.is_locked);
      const tdStatus = make('td');
      const badge = make('span', { className: `status-badge ${locked ? 'status-banned' : 'status-active'}`, text: locked ? 'Kilitli' : 'Aktif' });
      tdStatus.appendChild(badge);

      const tdActions = make('td', { className: 'actions-cell' });

      const lockBtn = make('button', { className: `btn-sm ${locked ? 'btn-success' : 'btn-warning'} btn-lock-device`, attrs: { type: 'button' } });
      appendIconOnly(lockBtn, `fas ${locked ? 'fa-lock-open' : 'fa-lock'}`);
      lockBtn.addEventListener('click', () => { void handleToggleLockDevice(device.id, locked); });

      const delBtn = make('button', { className: 'btn-danger btn-sm btn-delete-device', attrs: { type: 'button' } });
      appendIconText(delBtn, 'fas fa-trash', 'Sıfırla');
      delBtn.addEventListener('click', () => { void handleDeleteDevice(device.id); });

      tdActions.append(lockBtn, delBtn);
      tr.append(tdInfo, tdLast, tdStatus, tdActions);
      userDevicesTableBody.appendChild(tr);
    });
  }

  function handleNew(): void {
    if (!form || !userIdInput || !formTitle || !passwordWrapper || !userEmailInput || !userDeviceLimitInput) return;

    form.reset();
    userIdInput.value = '';
    formTitle.textContent = 'Yeni Kullanıcı Ekle';

    show(passwordWrapper);
    userEmailInput.disabled = false;

    hide(userBanSection);
    hide(devicesHr);

    show(userDeviceLimitSection);
    userDeviceLimitInput.value = '1';

    showForm();
  }

  function handleEdit(userId: string): void {
    if (!form || !userIdInput || !formTitle || !userNameInput || !userEmailInput || !userRoleSelect || !mobileAccessCheckbox || !passwordWrapper || !toggleBanUserBtn || !userDeviceLimitInput) return;

    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    form.reset();
    userIdInput.value = user.id;
    formTitle.textContent = 'Kullanıcıyı Düzenle';

    userNameInput.value = user.name ?? '';
    userEmailInput.value = user.email;
    userEmailInput.disabled = true;

    userRoleSelect.value = String(user.role);
    mobileAccessCheckbox.checked = Boolean(user.mobile_access);

    hide(passwordWrapper);

    if (userBanSection) userBanSection.hidden = user.role === 'admin';
    updateBanButton(Boolean(user.is_banned));

    show(devicesHr);

    if (user.role === 'client') {
      void loadUserDevices(user.id);
      show(userDeviceLimitSection);
      userDeviceLimitInput.value = String(user.device_limit ?? 1);
    } else {
      hide(userDeviceLimitSection);
      hide(userDevicesTableWrapper);
    }

    showForm();
  }

  async function handleDelete(userId: string): Promise<void> {
    const user = allUsers.find(u => u.id === userId);
    if (user?.role === 'admin') {
      notify.warning('Güvenlik gereği yönetici hesapları silinemez!');
      return;
    }
    if (!confirm('Emin misiniz?')) return;

    try {
      const devices = await fetchAllRecords(pb.collection('user_devices'), { filter: `user = "${userId}"` });
      for (const d of devices as unknown as Array<{ id: string }>) await pb.collection('user_devices').delete(d.id);

      await pb.collection('users').delete(userId);
      allUsers = allUsers.filter(u => u.id !== userId);
      renderUsersTable(allUsers);
    } catch (err) {
      console.error('Silme hatası:', err);
      errorService.handle(err, { userMessage: 'Hata oluştu.' });
    }
  }

  async function handleFormSubmit(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    if (!saveUserBtn || !userNameInput || !userEmailInput || !userRoleSelect || !mobileAccessCheckbox || !userDeviceLimitInput) return;

    saveUserBtn.disabled = true;

    const data: Record<string, unknown> = {
      name: userNameInput.value,
      email: userEmailInput.value,
      role: userRoleSelect.value,
      mobile_access: mobileAccessCheckbox.checked,
      device_limit: Number.parseInt(userDeviceLimitInput.value, 10) || 1,
    };

    try {
      if (userIdInput?.value) {
        await pb.collection('users').update(userIdInput.value, data);
        notify.success('Kaydedildi.');
      } else {
        if (!userPasswordInput || !userPasswordConfirmInput) throw new Error('Parola alanları eksik.');
        if (userPasswordInput.value !== userPasswordConfirmInput.value) throw new Error('Parolalar uyuşmuyor.');

        data.password = userPasswordInput.value;
        data.passwordConfirm = userPasswordConfirmInput.value;

        await pb.collection('users').create(data);
        showList();
      }

      await loadUsers();
    } catch (err) {
      const e = err as { message?: string };
      errorService.handle(e, { userMessage: e.message ?? 'Hata oluştu.' });
    } finally {
      saveUserBtn.disabled = false;
    }
  }

  async function handleToggleBanUser(): Promise<void> {
    if (!toggleBanUserBtn || !userIdInput) return;

    const user = allUsers.find(u => u.id === userIdInput.value);
    if (!user) return;

    if (user.role === 'admin') {
      notify.warning('Yönetici hesapları kilitlenemez!');
      return;
    }

    if (!confirm('BAN durumu değişecek, emin misiniz?')) return;

    try {
      const newStatus = !Boolean(user.is_banned);
      await pb.collection('users').update(user.id, { is_banned: newStatus });
      user.is_banned = newStatus;
      updateBanButton(newStatus);
    } catch (err) {
      console.error('Ban güncelleme hatası:', err);
      errorService.handle(err, { userMessage: 'Hata.' });
    }
  }

  function updateBanButton(isBanned: boolean): void {
    if (!toggleBanUserBtn) return;

    if (isBanned) {
      appendIconText(toggleBanUserBtn, 'fas fa-lock-open', 'Kilidi Aç');
      toggleBanUserBtn.className = 'btn-success ky-danger-btn';
    } else {
      appendIconText(toggleBanUserBtn, 'fas fa-ban', 'Hesabı Kilitle (BAN)');
      toggleBanUserBtn.className = 'btn-danger ky-danger-btn';
    }
  }

  async function handleDeleteDevice(deviceId: string): Promise<void> {
    if (!userIdInput) return;
    if (!confirm('Bu cihaz kaydı sıfırlansın mı? Kullanıcı daha sonra yeniden eşleştirilebilir.')) return;

    await pb.collection('user_devices').delete(deviceId);
    await loadUserDevices(userIdInput.value);
  }

  async function handleToggleLockDevice(deviceId: string, isLocked: boolean): Promise<void> {
    if (!userIdInput) return;

    await pb.collection('user_devices').update(deviceId, { is_locked: !isLocked });
    await loadUserDevices(userIdInput.value);
  }

  // --- Event wiring ---
  addNewUserBtn?.addEventListener('click', handleNew);
  cancelUserFormBtn?.addEventListener('click', showList);
  toggleBanUserBtn?.addEventListener('click', () => { void handleToggleBanUser(); });
  form?.addEventListener('submit', ev => { void handleFormSubmit(ev as SubmitEvent); });

  void loadUsers();
}
