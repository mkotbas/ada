import { getAllStores, getAuditedThisMonth, setSelectedStore, setCurrentReportId, type Store } from './state';
import { loadReportForStore } from './api';
import { clear } from './dom';

// ─── Bayi Listesi Görünümü ────────────────────────────────────────────────────

/** Filtrelenmiş bayi listesini DOM'a yazar. */
export function displayStores(stores: Store[]): void {
  const listEl = document.getElementById('store-list');
  if (!listEl) return;

  if (stores.length === 0) {
    clear(listEl);
    return;
  }

  const fragment = document.createDocumentFragment();

  stores.forEach(store => {
    const item = document.createElement('div');
    item.className = 'store-list-item';
    item.dataset['bayiKodu'] = String(store.bayiKodu);

    const name = document.createElement('strong');
    name.textContent = store.bayiAdi;

    const meta = document.createElement('span');
    meta.textContent = ` (${store.bayiKodu}) — ${store.sehir}/${store.ilce}`;
    meta.className = 'store-list-item__meta';

    // Bu ay denetlenmiş ise işaret ekle
    const audited = getAuditedThisMonth();
    if (audited.includes(String(store.bayiKodu))) {
      const badge = document.createElement('span');
      badge.className = 'store-list-item__badge store-list-item__badge--audited';
      badge.textContent = '✓ Denetlendi';
      item.appendChild(badge);
    }

    item.appendChild(name);
    item.appendChild(meta);

    item.addEventListener('click', () => { void handleStoreSelect(store); });

    fragment.appendChild(item);
  });

  clear(listEl);
  listEl.appendChild(fragment);
}

/**
 * Kullanıcı bir bayi seçtiğinde çağrılır.
 * Seçili bayiyi state'e yazar ve raporu yükler.
 */
async function handleStoreSelect(store: Store): Promise<void> {
  // Orijinal: Bu ay denetlenmiş bayiyi seçince uyarı ver
  const audited = getAuditedThisMonth();
  if (audited.includes(String(store.bayiKodu))) {
    const proceed = confirm(
      `UYARI: Bu bayi (${store.bayiAdi} - ${store.bayiKodu}) bu ay içinde zaten denetlenmiş.\n\n` +
      `Rapora devam edebilirsiniz ancak bu işlem aylık denetim sayınızı ARTTIRMAYACAKTIR.\n\n` +
      `Yine de devam etmek istiyor musunuz?`
    );
    if (!proceed) return;
  }

  // Seçimi görsel olarak işaretle
  document.querySelectorAll('.store-item, .store-list-item').forEach(i => i.classList.remove('selected'));
  const storeItem = document.querySelector(`.store-list-item[data-bayi-kodu="${store.bayiKodu}"]`);
  if (storeItem) storeItem.classList.add('selected');

  setSelectedStore(store);

  // Arama kutusunu güncelle
  const searchInput = document.getElementById('store-search-input') as HTMLInputElement | null;
  const shortName = store.bayiAdi.length > 20 ? store.bayiAdi.substring(0, 20) + '...' : store.bayiAdi;
  if (searchInput) searchInput.value = `${store.bayiKodu} - ${shortName}`;

  // Listeyi gizle
  const listEl = document.getElementById('store-list');
  if (listEl) {
    clear(listEl);
  }

  // Rapor varsa yükle, sonra event gönder
  const savedState = await loadReportForStore(store.bayiKodu);

  window.dispatchEvent(new CustomEvent('storeSelected', {
    detail: { store, savedState },
  }));
}

/**
 * Arama kutusundaki metin değiştiğinde çağrılır.
 * Büyük/küçük harf ve Türkçe karakter duyarsız filtreleme yapar.
 */
export function filterAndDisplayStores(query: string): void {
  // Seçim temizle
  setSelectedStore(null);
  setCurrentReportId(null);

  const formLockedEvent = new CustomEvent('storeClearred');
  window.dispatchEvent(formLockedEvent);

  const listEl = document.getElementById('store-list');
  if (!listEl) return;

  const trimmed = query.trim();

  if (trimmed === '') {
    clear(listEl);
    return;
  }

  const filter = normalizeTurkish(trimmed.toLowerCase());
  const allStores = getAllStores();

  const filtered = allStores.filter(s => {
    const name = normalizeTurkish((s.bayiAdi ?? '').toLowerCase());
    const code = String(s.bayiKodu ?? '').toLowerCase();
    return name.includes(filter) || code.includes(filter);
  });

  if (filtered.length > 0) {
    displayStores(filtered);
  } else {
    clear(listEl);
  }
}

/**
 * Türkçe karakterleri normalize eder — arama karşılaştırması için.
 * "şehir" → "sehir", "İstanbul" → "istanbul"
 */
function normalizeTurkish(str: string): string {
  return str
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');
}


