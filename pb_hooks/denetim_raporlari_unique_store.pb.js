/**
 * PocketBase Hook
 *
 * Amaç: denetim_raporlari koleksiyonunda "1 bayi / 1 rapor" kuralını
 *       sunucu tarafında %100 garanti altına almak.
 *
 * Davranış:
 * - Yeni kayıt (create) sırasında, aynı bayi için başka bir rapor varsa isteği reddeder.
 * - Güncelleme (update) sırasında, aynı bayi için başka bir rapor varsa isteği reddeder.
 *
 * Notlar:
 * - Bu hook, koleksiyon adı: "denetim_raporlari" ve alan adı: "bayi" varsayımıyla çalışır.
 * - PocketBase JS hooks klasörüne (pb_hooks) konulmalıdır.
 */

function ensureSingleReportPerStore(collectionName, storeFieldName, e) {
  if (!e?.collection || e.collection.name !== collectionName) return;

  const storeId = String(e.record.get(storeFieldName) ?? '').trim();
  if (!storeId) return;

  const dao = $app.dao();

  // Create sırasında id yoktur; Update sırasında vardır.
  const currentId = String(e.record.id ?? '').trim();

  const filter = currentId
    ? `${storeFieldName} = {:storeId} && id != {:currentId}`
    : `${storeFieldName} = {:storeId}`;

  const existing = dao.findFirstRecordByFilter(
    collectionName,
    filter,
    { storeId, currentId },
  );

  if (existing) {
    throw new BadRequestError(
      'Bu bayiye ait bir denetim raporu zaten mevcut. Lütfen mevcut rapor üzerinden devam edin.',
    );
  }
}

onRecordBeforeCreateRequest((e) => {
  ensureSingleReportPerStore('denetim_raporlari', 'bayi', e);
});

onRecordBeforeUpdateRequest((e) => {
  ensureSingleReportPerStore('denetim_raporlari', 'bayi', e);
});
