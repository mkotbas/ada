function getAuthRole(e) {
  return String(e?.auth?.get?.('role') ?? e?.auth?.role ?? '').trim();
}

function requireAuth(e, message) {
  if (e?.hasSuperuserAuth?.()) return;
  if (!e?.auth) {
    throw new UnauthorizedError(message || 'Bu islem icin giris yapilmasi gerekiyor.');
  }
}

function requireAdmin(e, message) {
  requireAuth(e, message);
  if (e?.hasSuperuserAuth?.()) return;
  if (getAuthRole(e) !== 'admin') {
    throw new ForbiddenError(message || 'Bu islem yalnizca yoneticiler tarafindan yapilabilir.');
  }
}

function requireSameUserOrAdmin(e, record, userFieldName) {
  requireAuth(e);
  if (e?.hasSuperuserAuth?.() || getAuthRole(e) === 'admin') return;

  const authId = String(e.auth?.id ?? e.auth?.get?.('id') ?? '').trim();
  const recordUserId = String(record?.get?.(userFieldName) ?? record?.[userFieldName] ?? '').trim();
  if (!authId || !recordUserId || authId !== recordUserId) {
    throw new ForbiddenError('Bu kayit icin yetkiniz bulunmuyor.');
  }
}

['bayiler', 'denetim_raporlari', 'denetim_geri_alinanlar', 'denetim_gecmisi', 'ayarlar'].forEach((collectionName) => {
  onRecordsListRequest((e) => {
    requireAuth(e);
    e.next();
  }, collectionName);

  onRecordViewRequest((e) => {
    requireAuth(e);
    e.next();
  }, collectionName);
});

['excel_verileri', 'users'].forEach((collectionName) => {
  onRecordsListRequest((e) => {
    requireAdmin(e);
    e.next();
  }, collectionName);

  onRecordViewRequest((e) => {
    if (collectionName === 'users') {
      requireAuth(e);
      const authId = String(e.auth?.id ?? e.auth?.get?.('id') ?? '').trim();
      const recordId = String(e.record?.id ?? e.record?.get?.('id') ?? '').trim();
      if (getAuthRole(e) !== 'admin' && authId !== recordId) {
        throw new ForbiddenError('Bu kullanici kaydini goruntuleme yetkiniz yok.');
      }
      return e.next();
    }

    requireAdmin(e);
    e.next();
  }, collectionName);

  onRecordCreateRequest((e) => {
    requireAdmin(e);
    e.next();
  }, collectionName);

  onRecordUpdateRequest((e) => {
    if (collectionName === 'users') {
      requireAuth(e);
      const authId = String(e.auth?.id ?? e.auth?.get?.('id') ?? '').trim();
      const recordId = String(e.record?.id ?? e.record?.get?.('id') ?? '').trim();
      if (getAuthRole(e) !== 'admin' && authId !== recordId) {
        throw new ForbiddenError('Bu kullanici kaydini guncelleme yetkiniz yok.');
      }
      return e.next();
    }

    requireAdmin(e);
    e.next();
  }, collectionName);

  onRecordDeleteRequest((e) => {
    requireAdmin(e);
    e.next();
  }, collectionName);
});

onRecordsListRequest((e) => {
  requireAuth(e);
  e.next();
}, 'user_devices');

onRecordViewRequest((e) => {
  requireSameUserOrAdmin(e, e.record, 'user');
  e.next();
}, 'user_devices');

onRecordCreateRequest((e) => {
  requireAuth(e);
  if (getAuthRole(e) !== 'admin') {
    const authId = String(e.auth?.id ?? e.auth?.get?.('id') ?? '').trim();
    const targetUserId = String(e.record?.get?.('user') ?? '').trim();
    if (!authId || !targetUserId || authId !== targetUserId) {
      throw new ForbiddenError('Yalnizca kendi cihaz kaydinizi olusturabilirsiniz.');
    }
  }
  e.next();
}, 'user_devices');

onRecordUpdateRequest((e) => {
  requireSameUserOrAdmin(e, e.record, 'user');
  e.next();
}, 'user_devices');

onRecordDeleteRequest((e) => {
  requireSameUserOrAdmin(e, e.record, 'user');
  e.next();
}, 'user_devices');

onRecordCreateRequest((e) => {
  requireAuth(e);
  e.next();
}, 'denetim_gecmisi');

onRecordUpdateRequest((e) => {
  requireAdmin(e);
  e.next();
}, 'denetim_gecmisi');

onRecordDeleteRequest((e) => {
  requireAdmin(e);
  e.next();
}, 'denetim_gecmisi');
