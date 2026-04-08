export type DatedRecord = { id?: string; created?: string; updated?: string };

export type BackupCollectionKey =
  | "ayarlar"
  | "users"
  | "bayiler"
  | "denetim_raporlari"
  | "excel_verileri"
  | "denetim_geri_alinanlar"
  | "user_devices";

export type BackupCollectionInfo = {
  title: string;
  desc: string;
  icon: string;
  color: string;
};
