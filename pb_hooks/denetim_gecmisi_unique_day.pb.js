/**
 * PocketBase Hook
 *
 * Amaç: denetim_gecmisi koleksiyonunda ayni bayi icin ayni gun sadece tek kayit olusmasini
 *       sunucu tarafinda garanti altina almak.
 *
 * Not:
 * - DB tarafinda uniqueKeyGun unique index'i zaten ana kilittir.
 * - Bu hook, create/update isteklerinde daha temiz ve belirgin bir dogrulama saglar.
 */

function ensureSingleAuditHistoryPerDay(collectionName, uniqueFieldName, e) {
  if (!e?.collection || e.collection.name !== collectionName) return;

  const uniqueKeyGun = String(e.record.get(uniqueFieldName) ?? '').trim();
  if (!uniqueKeyGun) {
    throw new BadRequestError('Denetim gecmisi icin gunluk benzersiz anahtar zorunludur.');
  }

  const dao = $app.dao();
  const currentId = String(e.record.id ?? '').trim();
  const filter = currentId
    ? `${uniqueFieldName} = {:uniqueKeyGun} && id != {:currentId}`
    : `${uniqueFieldName} = {:uniqueKeyGun}`;

  const existing = dao.findFirstRecordByFilter(
    collectionName,
    filter,
    { uniqueKeyGun, currentId },
  );

  if (existing) {
    throw new BadRequestError('Bu bayi icin ayni gun denetim gecmisi zaten mevcut.', {
      [uniqueFieldName]: {
        code: 'validation_not_unique',
        message: 'Bu bayi icin ayni gun denetim gecmisi zaten mevcut.',
      },
    });
  }
}

onRecordBeforeCreateRequest((e) => {
  ensureSingleAuditHistoryPerDay('denetim_gecmisi', 'uniqueKeyGun', e);
});

onRecordBeforeUpdateRequest((e) => {
  ensureSingleAuditHistoryPerDay('denetim_gecmisi', 'uniqueKeyGun', e);
});
