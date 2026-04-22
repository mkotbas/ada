const MAX_MANUAL_AUDIT_COUNT = 20;
const MANUAL_AUDIT_KEY_PREFIX = 'manualAuditData_';

function normalizeObjectValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return {};

  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      throw new BadRequestError('Manuel denetim verisi gecersiz JSON formatinda.');
    }
  }

  return rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
}

function isValidManualAuditDateKey(key) {
  const match = String(key).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return false;

  const month = Number(match[2]);
  const day = Number(match[3]);
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(day) && day >= 1 && day <= 31;
}

function validateManualAuditPayload(rawValue) {
  const payload = normalizeObjectValue(rawValue);

  Object.entries(payload).forEach(([dateKey, countValue]) => {
    if (!isValidManualAuditDateKey(dateKey)) {
      throw new BadRequestError('Manuel denetim tarihi gecersiz.');
    }

    const numericValue = Number(countValue);
    const normalizedValue = Math.floor(numericValue);
    if (!Number.isFinite(numericValue) || normalizedValue < 0 || normalizedValue > MAX_MANUAL_AUDIT_COUNT) {
      throw new BadRequestError(`Manuel denetim adedi 0 ile ${MAX_MANUAL_AUDIT_COUNT} arasinda olmalidir.`);
    }
  });
}

function validateManualAuditSetting(e) {
  if (!e?.collection || e.collection.name !== 'ayarlar') return;

  const anahtar = String(e.record.get('anahtar') ?? '').trim();
  if (!anahtar.startsWith(MANUAL_AUDIT_KEY_PREFIX)) return;

  validateManualAuditPayload(e.record.get('deger'));
}

onRecordBeforeCreateRequest((e) => {
  validateManualAuditSetting(e);
});

onRecordBeforeUpdateRequest((e) => {
  validateManualAuditSetting(e);
});
