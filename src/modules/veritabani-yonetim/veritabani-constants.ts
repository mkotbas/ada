import type {
  BackupCollectionInfo,
  BackupCollectionKey,
} from "./veritabani-types";

export const BACKUP_COLLECTIONS: Record<
  BackupCollectionKey,
  BackupCollectionInfo
> = {
  ayarlar: {
    title: "Sistem Ayarları",
    desc: "Soru listesi, e-posta şablonu, hedefler, takvim verileri.",
    icon: "fa-cogs",
    color: "#6366f1",
  },
  users: {
    title: "Kullanıcı Hesapları",
    desc: "Sistemdeki tüm kullanıcılar ve rol tanımları.",
    icon: "fa-users",
    color: "#3b82f6",
  },
  bayiler: {
    title: "Bayi Listesi",
    desc: "Tüm bayi bilgileri, yönetmen ve uzman atamaları.",
    icon: "fa-store",
    color: "#10b981",
  },
  denetim_raporlari: {
    title: "Denetim Raporları",
    desc: "Tamamlanmış ve taslak halindeki tüm denetim formları.",
    icon: "fa-file-invoice",
    color: "#f59e0b",
  },
  excel_verileri: {
    title: "Excel Puan Verileri",
    desc: "Buluta yüklenmiş DiDe ve FiDe puan tabloları.",
    icon: "fa-table",
    color: "#8b5cf6",
  },
  denetim_geri_alinanlar: {
    title: "Geri Alma Kayıtları",
    desc: "Denetimi geri alınan bayilerin log kayıtları.",
    icon: "fa-history",
    color: "#ef4444",
  },
  user_devices: {
    title: "Cihaz Kayıtları",
    desc: "Kullanıcıların giriş yaptığı cihazlar ve kilit durumları.",
    icon: "fa-mobile-alt",
    color: "#ec4899",
  },
};
