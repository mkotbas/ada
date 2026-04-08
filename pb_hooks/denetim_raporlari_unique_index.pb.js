/**
 * PocketBase Bootstrap Hook
 *
 * Amaç: "denetim_raporlari" tablosunda bayi alanını DB seviyesinde UNIQUE hale getirerek
 *       "1 bayi / 1 rapor" kuralını çift kilit (hook + DB constraint) ile korumak.
 *
 * Önemli:
 * - DB UNIQUE index, tabloda halihazırda mükerrer kayıt varken oluşturulamaz.
 * - Bu hook, mükerrerleri "guvenli" sekilde otomatik temizler:
 *   - bayi bazinda tekrar eden kayitlari bulur.
 *   - Her grup icin EN YENI kaydi birakir, digerlerini siler.
 *   - Silmeden once tum silinecek satirlari SQLite icinde bir yedek tabloya yazar.
 *   - Temizlikten sonra UNIQUE index'i olusturur.
 *
 * Not:
 * - Bu davranis, kullanici istegiyle aktif edilmistir. Sistem bozulmasin diye tum adimlar try/catch ile korunur.
 */

function nowStamp() {
  // YYYYMMDD-HHMMSS (ASCII, dosya/anahtar dostu)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function ensureBackupTable(db) {
  db
    .newQuery(
      'CREATE TABLE IF NOT EXISTS denetim_raporlari_dedup_backup (' +
        'id TEXT PRIMARY KEY,' +
        'bayi TEXT,' +
        'user TEXT,' +
        'created TEXT,' +
        'updated TEXT,' +
        'snapshot_json TEXT,' +
        'dedup_batch TEXT' +
      ')',
    )
    .execute();
}

function backupRow(db, row, batch) {
  try {
    db
      .newQuery(
        'INSERT OR REPLACE INTO denetim_raporlari_dedup_backup (id, bayi, user, created, updated, snapshot_json, dedup_batch) ' +
          'VALUES ({:id}, {:bayi}, {:user}, {:created}, {:updated}, {:json}, {:batch})',
      )
      .bind({
        id: String(row.id),
        bayi: String(row.bayi ?? ''),
        user: String(row.user ?? ''),
        created: String(row.created ?? ''),
        updated: String(row.updated ?? ''),
        json: JSON.stringify(row),
        batch,
      })
      .execute();
  } catch (err) {
    console.warn('[PB] Dedup backup yazilamadi (sistem devam eder). Detay: ' + String(err));
  }
}

function dedupDenetimRaporlariByStore(db) {
  const batch = 'dedup-' + nowStamp();
  ensureBackupTable(db);

  // bayi bazinda tekrar eden gruplari bul
  const groups = db
    .newQuery(
      'SELECT bayi AS bayi, COUNT(*) AS c ' +
        'FROM denetim_raporlari ' +
        'WHERE bayi IS NOT NULL AND bayi != "" ' +
        'GROUP BY bayi ' +
        'HAVING c > 1',
    )
    .all();

  if (!groups || groups.length === 0) return { deleted: 0, groups: 0, batch };

  let totalDeleted = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const bayi = String(g.bayi ?? '').trim();
    if (!bayi) continue;

    // En yeni kaydi birakmak icin: updated DESC, created DESC
    const rows = db
      .newQuery(
        'SELECT * FROM denetim_raporlari ' +
          'WHERE bayi = {:bayi} ' +
          'ORDER BY updated DESC, created DESC',
      )
      .bind({ bayi })
      .all();

    if (!rows || rows.length <= 1) continue;

    // 0: kalacak. 1..: silinecek
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.id) continue;

      backupRow(db, row, batch);

      db
        .newQuery('DELETE FROM denetim_raporlari WHERE id = {:id}')
        .bind({ id: String(row.id) })
        .execute();

      totalDeleted += 1;
    }
  }

  return { deleted: totalDeleted, groups: groups.length, batch };
}

function tryCreateUniqueIndexForDenetimRaporlari() {
  const dao = $app.dao();
  const db = dao.db();

  // Tablo adı PocketBase'te koleksiyon adıyla aynıdır.
  const table = 'denetim_raporlari';
  const indexName = 'idx_den_raporlari_unique_bayi';

  try {
    // 1) Mükerrerleri guvenli sekilde temizle (yedekle + sil)
    const result = dedupDenetimRaporlariByStore(db);
    if (result && result.deleted > 0) {
      console.log(
        `[PB] Dedup tamamlandi: ${result.groups} grup icinde ${result.deleted} eski rapor silindi. ` +
          `Yedek batch: ${result.batch} (denetim_raporlari_dedup_backup tablosu).`,
      );
    }

    // 2) UNIQUE index oluştur (bayi)
    db
      .newQuery(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (bayi)`,
      )
      .execute();

    console.log(`[PB] UNIQUE index hazir: ${indexName} (${table}.bayi)`);
  } catch (err) {
    // Tablo henüz yoksa (ilk kurulum) veya farklı bir hata olursa sistemi durdurmayalım.
    console.warn(
      `[PB] UNIQUE index kontrolu/olusturma adimi atlandi (sistemi etkilemez). Detay: ${String(err)}`,
    );
  }
}

// PocketBase JS hooks API: uygulama bootstrap sonrası tek sefer çalıştır.
onAfterBootstrap(() => {
  tryCreateUniqueIndexForDenetimRaporlari();
});
