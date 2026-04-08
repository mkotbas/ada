import { appendIconText, escapeHtml, setSafeHtml } from "@core/dom";
import { notify } from "../../core/notify";
import { errorService } from "../../core/error";
import { BACKUP_COLLECTIONS } from "./veritabani-constants";
import type { DatedRecord } from "./veritabani-types";
import {
  buildCleanupListItem,
  buildCleanupOption,
  buildCleanupStageItem,
  closeCommonModal,
  errToString,
  generateSecurePassword,
  getEl,
  isCompletedReport,
  isEmptyQuestionState,
  normalizeCompletionValue,
  setHidden,
  showCommonModal,
  toDateValue,
} from "./veritabani-utils";

async function initializeVeritabaniYonetimModule(pb) {
  document.getElementById("db-manager-wrapper") &&
    (loadStats(pb), setupEventListeners(pb));
}
// Cleanup analysis
function getCleanupFindingCount(analysis) {
  return (
    analysis.orphanDeviceIds.length +
    analysis.duplicateUndoIds.length +
    analysis.oldEmptyDraftIds.length +
    analysis.incompleteReportIds.length +
    analysis.orphanReportIds.length +
    analysis.keepLatestReportIds.length
  );
}
async function analyzeCleanupTargets(pb) {
  const [users, devices, stores, reports, undoneLogs] = await Promise.all([
      pb.collection("users").getFullList({ fields: "id" }),
      pb
        .collection(
          "user_devi\
ces",
        )
        .getFullList({ fields: "id,user,updated,created" }),
      pb.collection("bayiler").getFullList({ fields: "id" }),
      pb.collection("denetim_raporlari").getFullList({
        sort: "-created",
        fields:
          "id,bayi,user,denetimTamamlanmaTarihi,created,updated,soruDurumlari",
      }),
      pb
        .collection(
          "denetim_geri_alina\
nlar",
        )
        .getFullList({
          sort: "-created",
          fields: "id,bayi,yil_ay,updated,created",
        }),
    ]),
    userIds = new Set(users.map((item) => String(item.id))),
    storeIds = new Set(stores.map((item) => String(item.id))),
    startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime(),
    orphanDeviceIds = devices
      .filter((device) => {
        const userId = String(device.user ?? "").trim();
        return userId !== "" && !userIds.has(userId);
      })
      .map((device) => ({
        id: String(device.id),
        reason:
          "\
Kullan\u0131c\u0131 kayd\u0131 art\u0131k bulunmuyor.",
      })),
    duplicateUndoIds = [],
    undoGroups = {};
  undoneLogs.forEach((log) => {
    const key = `${String(
      log.bayi ?? "",
    ).trim()}__${String(log.yil_ay ?? "").trim()}`;
    undoGroups[key] || (undoGroups[key] = []), undoGroups[key].push(log);
  }),
    (Object.values(undoGroups) as DatedRecord[][]).forEach((group) => {
      group.sort((a, b) => {
        const byUpdated =
          toDateValue(b.updated || b.created) -
          toDateValue(a.updated || a.created);
        return byUpdated !== 0
          ? byUpdated
          : toDateValue(b.created) - toDateValue(a.created);
      });
      for (let i = 1; i < group.length; i += 1)
        duplicateUndoIds.push({
          id: String(group[i].id),
          reason:
            "\
Ayn\u0131 bayi ve ay i\xE7in m\xFCkerrer geri alma kayd\u0131.",
        });
    });
  const incompleteReportIds = reports
      .filter((report) => !isCompletedReport(report))
      .map((report) => ({
        id: String(report.id),
        reason: "Denetim tamamlanma tarihi yok, bo\u015F ya da N/A.",
      })),
    oldEmptyDraftIds = reports
      .filter((report) => !isCompletedReport(report))
      .filter((report) => isEmptyQuestionState(report.soruDurumlari))
      .filter(
        (report) =>
          toDateValue(report.created) > 0 &&
          toDateValue(report.created) < startOfTodayMs,
      )
      .map((report) => ({
        id: String(report.id),
        reason: "Tamamlanmam\u0131\u015F, bo\u015F ve bug\xFCnden eski taslak.",
      })),
    orphanReportIds = reports
      .filter((report) => {
        const storeId = String(report.bayi ?? "").trim(),
          userId = String(report.user ?? "").trim(),
          missingStore = storeId === "" || !storeIds.has(storeId),
          missingUser = userId !== "" && !userIds.has(userId);
        return missingStore || missingUser;
      })
      .map((report) => {
        const storeId = String(report.bayi ?? "").trim(),
          userId = String(report.user ?? "").trim(),
          reasons = [];
        return (
          (storeId === "" || !storeIds.has(storeId)) &&
            reasons.push("bayi referans\u0131 yok"),
          userId !== "" &&
            !userIds.has(userId) &&
            reasons.push("kullan\u0131c\u0131 referans\u0131 yok"),
          { id: String(report.id), reason: reasons.join(", ") }
        );
      }),
    keepLatestReportIds = [],
    reportGroupsByStore = {};
  return (
    reports.forEach((report) => {
      const storeId = String(report.bayi ?? "").trim();
      storeId !== "" &&
        (reportGroupsByStore[storeId] || (reportGroupsByStore[storeId] = []),
        reportGroupsByStore[storeId].push(report));
    }),
    (Object.values(reportGroupsByStore) as DatedRecord[][]).forEach((group) => {
      group.sort((a, b) => {
        const byUpdated =
          toDateValue(b.updated || b.created) -
          toDateValue(a.updated || a.created);
        return byUpdated !== 0
          ? byUpdated
          : toDateValue(b.created) - toDateValue(a.created);
      });
      for (let i = 1; i < group.length; i += 1)
        keepLatestReportIds.push({
          id: String(group[i].id),
          reason:
            "Ayn\u0131 bayiye ait eski rapor\
 kayd\u0131.",
        });
    }),
    {
      orphanDeviceIds,
      duplicateUndoIds,
      oldEmptyDraftIds,
      incompleteReportIds,
      orphanReportIds,
      keepLatestReportIds,
    }
  );
}
const CLEANUP_SUMMARY_CONFIG = [
    [
      "adet yetim cihaz bulundu.",
      "orphanDeviceIds",
      "Kullan\u0131c\u0131 kayd\u0131 silinmi\u015F cihazlar.",
    ],
    [
      "adet m\xFCkerrer geri alma kayd\u0131 bul\
undu.",
      "duplicateUndoIds",
      "Ayn\u0131 bayi + ay i\xE7in ikinci kay\u0131tlar.",
    ],
    [
      "adet eski bo\u015F taslak bulundu.",
      "oldEmptyDraftIds",
      "Bug\
\xFCnden eski, tamamlanmam\u0131\u015F ve i\xE7eri\u011Fi bo\u015F kay\u0131tlar.",
    ],
    [
      "adet tamamlanmam\u0131\u015F rapor bulundu.",
      "incomple\
teReportIds",
      "Tamamlanma tarihi bo\u015F, null, undefined veya N/A olan kay\u0131tlar.",
    ],
    [
      "adet sorunlu referansl\u0131 rapor bulundu.",
      "orp\
hanReportIds",
      "Bayi veya kullan\u0131c\u0131 referans\u0131 bozulmu\u015F kay\u0131tlar.",
    ],
    [
      "adet bayi bazl\u0131 eski rapor bulundu.",
      "keep\
LatestReportIds",
      "\u0130ste\u011Fe ba\u011Fl\u0131: sadece en g\xFCncel rapor kals\u0131n.",
    ],
  ],
  CLEANUP_STAGE_CONFIG = [
    [
      "Analiz",
      "T\xFCm aday kay\u0131\
tlar koleksiyon baz\u0131nda taran\u0131r ve ili\u015Fkiler do\u011Frulan\u0131r.",
    ],
    [
      "D\xFC\u015F\xFCk riskli adaylar",
      "Yetim cihazlar ve m\xFC\
kerrer geri alma kay\u0131tlar\u0131 ayr\u0131 havuzlara al\u0131n\u0131r.",
    ],
    [
      "Kontroll\xFC adaylar",
      "Eski bo\u015F taslaklar, tamamlanmam\u0131\u015F rapo\
rlar ve sorunlu referansl\u0131 raporlar kullan\u0131c\u0131 se\xE7imine b\u0131rak\u0131l\u0131r.",
    ],
    [
      "Tekille\u015Ftirme ve s\u0131ralama",
      "Ayn\u0131 kay\u0131t birden fazla kategoriye girse bile tek kez silinir; g\xFCvenli i\u015Fler \xF6nce, riskli i\u015Fler sonra \xE7al\u0131\u015F\u0131r.",
    ],
    [
      "Sonu\xE7",
      "Ba\u015Far\u0131l\u0131 silinen kay\u0131t say\u0131s\u0131 raporlan\u0131r ve sayfa g\xFCvenli bi\xE7imde yenilenir.",
    ],
  ],
  CLEANUP_PLAN_CONFIG = [
    {
      checkboxId: "chk-clean-orphan-devices",
      label: "Yetim cihazlar",
      collection: "user_devices",
      key: "orphanDeviceIds",
      defaultChecked: !0,
      hint: "Kullan\
\u0131c\u0131s\u0131 art\u0131k bulunmayan user_devices kay\u0131tlar\u0131 silinir.",
    },
    {
      checkboxId: "chk-clean-duplicate-undo",
      label:
        "M\xFCkerre\
r geri alma kay\u0131tlar\u0131",
      collection: "denetim_geri_alinanlar",
      key: "duplicateUndoIds",
      defaultChecked: !0,
      hint: "Ayn\u0131 bayi ve ay i\xE7in sad\
ece en g\xFCncel geri alma kayd\u0131 b\u0131rak\u0131l\u0131r.",
    },
    {
      checkboxId: "chk-clean-old-empty-drafts",
      label: "Eski bo\u015F taslaklar",
      collection:
        "\
denetim_raporlari",
      key: "oldEmptyDraftIds",
      defaultChecked: !1,
      hint: "Bug\xFCnden eski, tamamlanmam\u0131\u015F ve soru verisi bo\u015F taslaklar silinir.",
    },
    {
      checkboxId: "chk-clean-incomplete-reports",
      label: "Tamamlanmam\u0131\u015F raporlar",
      collection: "denetim_raporlari",
      key: "incompleteReportIds",
      defaultChecked: !1,
      hint: "Tamamlanma tarihi bo\u015F, null, undefined veya N/A olan t\xFCm raporlar silinir.",
    },
    {
      checkboxId:
        "chk-clean-orphan-r\
eports",
      label: "Sorunlu referansl\u0131 raporlar",
      collection: "denetim_raporlari",
      key: "orphanReportIds",
      defaultChecked: !1,
      hint: "Bayi ya da kul\
lan\u0131c\u0131 referans\u0131 bozulmu\u015F raporlar silinir.",
    },
    {
      checkboxId: "chk-clean-keep-latest",
      label: "Bayi bazl\u0131 eski raporlar",
      collection: "denetim_raporlari",
      key: "keepLatestReportIds",
      defaultChecked: !1,
      hint: "\u0130leri seviye temizliktir; ayn\u0131 bayiye ait en g\xFCncel kay\u0131t d\
\u0131\u015F\u0131ndakiler silinir.",
    },
  ];
function buildCleanupBody(analysis) {
  return `
        ${
          getCleanupFindingCount(analysis) === 0
            ? `
            <div class="db-analysis-info-card">
                <p><i class="fas fa-check-circle text-green"></i> Tertemiz! Temizlenecek gereksiz kay\u0131t bulunamad\u0131.</p>
            </div>
        `
            : `
            <div class="db-analysis-info-card">
                <p><strong>Analiz Sonucu</strong></p>
                <ul class="db-clean-stats-list modal-bullets">
                    ${CLEANUP_SUMMARY_CONFIG.map(([label, key, reason]) => buildCleanupListItem(label, analysis[key].length, reason)).join("")}
                </ul>
            </div>
        `
        }
        <div class="db-analysis-info-card db-clean-stage-card">
            <p><strong>Sistem 4 i\xE7in en g\xFCvenli temizlik algoritmas\u0131</strong></p>
            <ol class="db-clean-stage-list">
                ${CLEANUP_STAGE_CONFIG.map(([title, desc], index) => buildCleanupStageItem(index + 1, title, desc)).join("")}
            </ol>
        </div>
        <div class="db-form-group db-clean-option">
            ${CLEANUP_PLAN_CONFIG.map((item) =>
              buildCleanupOption(
                item.checkboxId,
                item.defaultChecked,
                item.label
                  .replace(" kay\u0131tlar\u0131", "")
                  .replace(" raporlar", " raporlar\u0131")
                  .replace(" cihazlar", " cihazlar\u0131")
                  .replace(" taslaklar", " taslaklar\u0131"),
                item.hint,
              ),
            ).join("")}
        </div>
    `;
}
function getSelectedCleanupPlans(analysis) {
  return CLEANUP_PLAN_CONFIG.filter(
    (item) => document.getElementById(item.checkboxId)?.checked,
  ).map((item) => ({
    label: item.label,
    collection: item.collection,
    ids: analysis[item.key].map((entry) => entry.id),
  }));
}
function countSelectedCleanupIds(plans) {
  return new Set(
    plans.flatMap((plan) => plan.ids.map((id) => `${plan.collection}:${id}`)),
  ).size;
} // Cleanup actions
async function executeCleanup(pb, plans) {
  const ids = Array.from(
    new Set(
      plans.flatMap((plan) => plan.ids.map((id) => `${plan.collection}:${id}`)),
    ),
  );
  return (
    await Promise.all(
      ids.map(async (key) => {
        const [collection, id] = String(key).split(":");
        id && (await pb.collection(collection).delete(id));
      }),
    ),
    ids.length
  );
} // Statistics
async function loadStats(pb) {
  try {
    const statsConfig = [
      [
        "bayile\
r",
        "count-bayiler",
      ],
      ["users", "count-users"],
      ["denetim_raporlari", "count-raporlar"],
      ["excel_verileri", "count-excel"],
      [
        "user_devices",
        "count-c\
ihazlar",
      ],
    ];
    await Promise.all(
      statsConfig.map(async ([collection, elementId]) => {
        const result = await pb.collection(collection).getList(1, 1, {
            fields:
              "\
id",
          }),
          el = document.getElementById(elementId);
        el && (el.textContent = result.totalItems);
      }),
    );
  } catch (e) {
    console.error("\u0130statistik hatas\u0131:", e);
  }
}
function setupEventListeners(pb) {
  getEl("btn-refresh-stats").addEventListener(
    "click",
    () => void loadStats(pb),
  ),
    getEl("btn-close-modal").addEventListener("click", closeCommonModal),
    getEl("modal-footer").addEventListener("click", (ev) => {
      const btn = (ev.target as Element | null)?.closest("[data-action]");
      if (!btn) return;
      btn.getAttribute("data-action") === "close-modal" && closeCommonModal();
    }),
    getEl("btn-action-clean-maintenance").addEventListener(
      "click",
      async () => {
        showCommonModal(
          "Temizlik & Bak\u0131m Analizi",
          '<div id="cleanup-analysis"><i class="fas fa-spinner fa-spin"></i> Veritaban\u0131 taran\u0131yor, l\xFCtfen bekleyin...<\
/div>',
          '<button class="btn-secondary btn-sm" data-action="close-modal">Vazge\xE7</button>',
        );
        try {
          const analysis = await analyzeCleanupTargets(pb),
            bodyEl = getEl("modal-body"),
            footerEl = getEl("modal-footer"),
            totalFindings = getCleanupFindingCount(analysis);
          if (
            (setSafeHtml(bodyEl, buildCleanupBody(analysis)),
            setSafeHtml(
              footerEl,
              `
                <button class="btn-secondary btn-sm" data-action="close-modal">Kapat</button>
                <button class="btn-danger btn-sm" id="modal-btn-execute-cleanup" type="button" ${totalFindings === 0 ? "disabled" : ""}><i class="\
fas fa-broom"></i> Temizli\u011Fi Ba\u015Flat</button>
            `,
            ),
            totalFindings === 0)
          )
            return;
          getEl("modal-btn-execute-cleanup").addEventListener(
            "click",
            async () => {
              const execBtn = getEl(
                  "modal-btn\
-execute-cleanup",
                ),
                plans = getSelectedCleanupPlans(analysis),
                selectedCount = countSelectedCleanupIds(plans);
              if (selectedCount === 0) {
                notify.info(
                  "E\
n az bir temizlik se\xE7ene\u011Fi i\u015Faretleyin.",
                );
                return;
              }
              if (
                confirm(
                  `${selectedCount} kay\u0131t temizlenecek. Onayl\u0131yor musunuz?`,
                )
              ) {
                (execBtn.disabled = !0),
                  appendIconText(
                    execBtn,
                    "fas fa-spinner fa-spin",
                    "\u0130\u015Flem Yap\u0131l\u0131yor...",
                  );
                try {
                  const removedCount = await executeCleanup(pb, plans);
                  notify.success(
                    `Bak\u0131m i\u015Flemi tamamland\u0131. ${removedCount} kay\u0131t temizlendi.`,
                  ),
                    location.reload();
                } catch (err) {
                  errorService.handle(err, {
                    userMessage: "Hata: " + errToString(err),
                  }),
                    (execBtn.disabled = !1),
                    appendIconText(
                      execBtn,
                      "fas fa-broom",
                      "Temizli\u011Fi Ba\u015Flat",
                    );
                }
              }
            },
          );
        } catch (err) {
          errorService.handle(err, {
            userMessage: "Hata: " + errToString(err),
          }),
            closeCommonModal();
        }
      },
    ),
    getEl("btn-action-user-delete").addEventListener(
      "cli\
ck",
      async () => {
        const users = await pb
            .collection("users")
            .getFullList({ sort: "name" }),
          bodyHtml = `
            <div class="db-form-group">
                <label>\u0130\u015Flem Yap\u0131lacak Kullan\u0131c\u0131y\u0131 Se\xE7in</label>
                <select id="modal-select-user" class="db-input">
                    <option value="">-- Kullan\u0131c\u0131 Se\xE7in --</option>
                    ${users
                      .filter((u) => u.id !== pb.authStore.model.id)
                      .map(
                        (u) =>
                          `<option value="${u.id}">${u.name || u.email} (${u.role})</option>`,
                      )
                      .join("")}
                </select>
            </div>
            <div id="modal-analysis-area" class="db-stat-card-mini" hidden></div>
            <div id="modal-strategy-area" hidden>
                <label class="db-form-group-label">Bir Veri Stratejisi Se\xE7in</label>
                <div class="db-card-grid">
                    <label class="db-card-option">
                        <input type="radio" name="del-strat" value="delete" checked>
                        <div class="card-option-content"><div class="card-option-icon icon-danger"><i class="fas fa-trash-alt"></i></div><di\
v class="card-option-info"><strong>Kal\u0131c\u0131 Olarak Sil</strong><small>Her \u015Feyi temizler.</small></div></div>
                    </label>
                    <label class="db-card-option">
                        <input type="radio" name="del-strat" value="transfer">
                        <div class="card-option-content"><div class="card-option-icon icon-primary"><i class="fas fa-file-export"></i></div>\
<div class="card-option-info"><strong>Verileri Aktar</strong><small>Ba\u015Fka birine ta\u015F\u0131r.</small></div></div>
                    </label>
                </div>
                <div id="modal-transfer-select" hidden class="db-form-group">
                    <label>Hedef Kullan\u0131c\u0131</label>
                    <select id="modal-select-target" class="db-input"><option value="">-- Hedef Se\xE7in --</option>${users
                      .map(
                        (u) => `<option \
value="${u.id}">${u.name || u.email}</option>`,
                      )
                      .join("")}</select>
                </div>
            </div>
        `;
        showCommonModal(
          "Kullan\u0131c\u0131 Silme & Veri Y\xF6netimi",
          bodyHtml,
          '<button class="btn-secondary btn-sm" data-action="close-m\
odal">Vazge\xE7</button><button id="modal-btn-execute" class="btn-danger btn-sm" disabled>\u0130\u015Flemi Onayla</button>',
        );
        const selectUser = getEl("modal-select-user"),
          executeBtn = getEl("modal-btn-execute");
        selectUser.addEventListener("change", async () => {
          const userId = selectUser.value,
            analysisArea = getEl("modal-analysis-area"),
            strategyArea = getEl("modal-strategy-area");
          if (!userId) {
            setHidden(strategyArea, !0),
              setHidden(analysisArea, !0),
              (executeBtn.disabled = !0);
            return;
          }
          appendIconText(
            analysisArea,
            "fas fa-spinner fa-spin",
            "Analiz ediliyor...",
          ),
            setHidden(analysisArea, !1);
          const reports = await pb
              .collection("denetim_raporlari")
              .getFullList({ filter: `user="${userId}"` }),
            bayiler = await pb.collection("bayiler").getFullList({
              filter: `sorumlu\
_kullanici="${userId}"`,
            });
          setSafeHtml(
            analysisArea,
            `<div class="db-analysis-info-card"><p><strong>${escapeHtml(reports.length)}</strong> Rap\
or ve <strong>${escapeHtml(bayiler.length)}</strong> Bayi kayd\u0131 bulundu.</p></div>`,
          ),
            setHidden(strategyArea, !1),
            (executeBtn.disabled = !1);
        }),
          getEl("modal-body").addEventListener("click", (e) => {
            const radio = (e.target as Element | null)
              ?.closest(".db-card-option")
              ?.querySelector<HTMLInputElement>("input");
            if (radio && radio.name === "del-strat") {
              const t = getEl("modal-transfer-select");
              setHidden(t, radio.value !== "transfer");
            }
          }),
          executeBtn.addEventListener("click", async () => {
            const userId = selectUser.value,
              strategy = document.querySelector(
                'input[name="del-strat"]:checked',
              ).value,
              targetId = document.getElementById("modal-select-target").value;
            if (strategy === "transfer" && !targetId)
              return notify.info(
                "L\xFCtfen hedef kullan\u0131c\u0131y\u0131 se\xE7in.",
              );
            if (
              confirm(
                "\u0130\u015Flem geri al\u0131nam\
az. Onayl\u0131yor musunuz?",
              )
            ) {
              (executeBtn.disabled = !0),
                appendIconText(
                  executeBtn,
                  "fas fa-spinner fa-spin",
                  "\u0130\u015Fleniyor...",
                );
              try {
                const devices = await pb
                  .collection("user_devices")
                  .getFullList({ filter: `user="${userId}"` });
                for (const d of devices)
                  await pb.collection("user_devices").delete(d.id);
                if (strategy === "transfer") {
                  const reports = await pb
                    .collection("denetim_raporlari")
                    .getFullList({ filter: `user="${userId}"` });
                  for (const r of reports)
                    await pb
                      .collection("denetim_raporlari")
                      .update(r.id, { user: targetId });
                  const bayiler = await pb.collection("bayiler").getFullList({
                    filter: `soru\
mlu_kullanici="${userId}"`,
                  });
                  for (const b of bayiler)
                    await pb
                      .collection("bayiler")
                      .update(b.id, { sorumlu_kullanici: targetId });
                } else {
                  const reports = await pb
                    .collection("denetim_raporlari")
                    .getFullList({ filter: `user="${userId}"` });
                  for (const r of reports)
                    await pb.collection("denetim_raporlari").delete(r.id);
                  const bayiler = await pb
                    .collection("bayiler")
                    .getFullList({ filter: `sorumlu_kullanici="${userId}"` });
                  for (const b of bayiler)
                    await pb
                      .collection("bayiler")
                      .update(b.id, { sorumlu_kullanici: null });
                }
                await pb.collection("users").delete(userId),
                  notify.info("Ba\u015Far\u0131yla tamamland\u0131."),
                  location.reload();
              } catch (err) {
                errorService.handle(err, {
                  userMessage:
                    "Hata: " +
                    (err instanceof Error ? err.message : String(err)),
                }),
                  (executeBtn.disabled = !1);
              }
            }
          });
      },
    ),
    getEl("btn-export-settings").addEventListener("click", async () => {
      try {
        const bodyHtml = `
                <p class="db-modal-desc">Yedeklemek istedi\u011Finiz veri kategorilerini se\xE7in:</p>
                <div class="db-selection-list">
                    ${Object.entries(BACKUP_COLLECTIONS)
                      .map(
                        ([key, info]) => `
                        <label class="db-card-option-mini">
                            <input type="checkbox" name="backup-collection" value="${key}" checked>
                            <div class="mini-card-content">
                                <div class="mini-card-icon mini-card-icon-${key}"><i class="fas ${info.icon}"></i></div>
                                <div class="mini-card-info"><strong>${info.title}</strong><small>${info.desc}</small></div>
                            </div>
                        </label>
                    `,
                      )
                      .join("")}
                </div>
            `;
        showCommonModal(
          "Tam Sistem Yede\u011Fi Olu\u015Ftur",
          bodyHtml,
          `
                <button class="btn-secondary btn-sm" data-action="close-modal">Vazge\xE7</button>
                <button id="modal-btn-export-execute" class="btn-success btn-sm">Yede\u011Fi \u0130ndir</button>
            `,
        ),
          getEl("modal-btn-export-execute").addEventListener(
            "click",
            async () => {
              const selectedCols = Array.from(
                document.querySelectorAll(
                  'input[name="backup-collection"]:checked',
                ),
              ).map((cb) => cb.value);
              if (!selectedCols.length)
                return notify.info("En az bir kategori se\xE7in.");
              const btn = document.getElementById("modal-btn-export-execute");
              (btn.disabled = !0),
                appendIconText(
                  btn,
                  "fas fa-spinner fa-spin",
                  "Veriler Haz\u0131rlan\u0131yor...",
                );
              try {
                const backupPayload = {
                  type: "fide_full_backup",
                  version: "2.0",
                  date: new Date().toISOString(),
                  data: {},
                };
                for (const col of selectedCols)
                  backupPayload.data[col] = await pb
                    .collection(col)
                    .getFullList();
                const blob = new Blob(
                    [JSON.stringify(backupPayload, null, 2)],
                    { type: "application/json" },
                  ),
                  link = document.createElement("a");
                (link.href = URL.createObjectURL(blob)),
                  (link.download = `fide_tam_yedek_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}\
.json`),
                  link.click(),
                  closeCommonModal();
              } catch (err) {
                errorService.handle(err, {
                  userMessage:
                    "Yedekleme hatas\u0131: " +
                    (err instanceof Error ? err.message : String(err)),
                }),
                  (btn.disabled = !1),
                  (btn.textContent = "Yede\u011Fi \u0130ndir");
              }
            },
          );
      } catch (e) {
        errorService.handle(e, {
          userMessage: "Hata: " + (e instanceof Error ? e.message : String(e)),
        });
      }
    }),
    getEl("input-import-settings").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      (reader.onload = async (ev) => {
        try {
          const rawText =
            typeof ev.target?.result === "string" ? ev.target.result : "";
          const data = JSON.parse(rawText).data || {},
            collectionsFound = Object.keys(data).filter(
              (k) => BACKUP_COLLECTIONS[k],
            );
          if (!collectionsFound.length)
            throw new Error(
              "Ge\xE7erli bir yedek dosyas\u0131 de\u011Fil veya i\xE7erik bo\u015F.",
            );
          const bodyHtml = `
                    <p class="db-modal-desc">Geri y\xFCklenecek kategorileri se\xE7in (Mevcut verilerin \xFCzerine yaz\u0131l\u0131r):</p>
                    <div class="db-selection-list">
                        ${collectionsFound
                          .map((key) => {
                            const info = BACKUP_COLLECTIONS[key];
                            return `
                            <label class="db-card-option-mini">
                                <input type="checkbox" name="restore-collection" value="${key}" checked>
                                <div class="mini-card-content">
                                    <div class="mini-card-icon mini-card-icon-${key}"><i class="fas ${info.icon}"></i></div>
                                    <div class="mini-card-info"><strong>${info.title}</strong><small>${data[key].length} kay\u0131t.</small></div\
>
                                </div>
                            </label>`;
                          })
                          .join("")}
                    </div>
                    <div class="warning-text">
                        <i class="fas fa-exclamation-triangle"></i> Kullan\u0131c\u0131lar geri y\xFCklenirken mevcut \u015Fifreler korunur. Yeni eklenen kull\
an\u0131c\u0131lar i\xE7in \u015Fifre s\u0131f\u0131rlama gerekebilir.
                    </div>
                `;
          showCommonModal(
            "Yedekten Geri Y\xFCkle",
            bodyHtml,
            '<button class="btn-secondary btn-sm" data-action="close-modal">Vazge\xE7</\
button><button id="btn-res-exec" class="btn-primary btn-sm">Geri Y\xFCklemeyi Ba\u015Flat</button>',
          ),
            getEl("btn-res-exec").addEventListener("click", async () => {
              if (
                !confirm(
                  "D\u0130KKAT: Se\xE7ilen veriler sisteme geri y\xFCklenecek ve mevcut kay\u0131tlar g\xFCncellenecektir. Onayl\u0131yor musunuz?",
                )
              )
                return;
              const selectedCols = Array.from(
                  document.querySelectorAll(
                    'input[name="restore-collection"]:checked',
                  ),
                ).map((cb) => cb.value),
                btn = document.getElementById("btn-res-exec");
              (btn.disabled = !0),
                appendIconText(
                  btn,
                  "fas fa-spinner fa-spin",
                  "Y\xFCkleniyor...",
                );
              let errorLog = [];
              try {
                selectedCols.sort((a, b) =>
                  a === "users"
                    ? -1
                    : b === "users"
                      ? 1
                      : a === "bayiler"
                        ? -1
                        : b === "bayiler"
                          ? 1
                          : 0,
                );
                for (const col of selectedCols) {
                  const items = data[col];
                  for (const item of items) {
                    const {
                      id,
                      created,
                      updated,
                      collectionId,
                      collectionName,
                      expand,
                      ...payload
                    } = item;
                    try {
                      await pb.collection(col).update(id, payload);
                    } catch (updateErr) {
                      if ((updateErr as { status?: number }).status === 404) {
                        try {
                          payload.id = id;
                          if (col === "users") {
                            const generatedPassword = generateSecurePassword();
                            payload.password = generatedPassword;
                            payload.passwordConfirm = generatedPassword;
                          }
                          await pb.collection(col).create(payload);
                        } catch (createErr) {
                          const message = createErr instanceof Error ? createErr.message : 'Bilinmeyen hata';
                          errorLog.push(`${col} / ${id}: ${message}`);
                        }
                      } else {
                        const message = updateErr instanceof Error ? updateErr.message : 'Bilinmeyen hata';
                        errorLog.push(`${col} / ${id}: ${message}`);
                      }
                    }
                  }
                }
                errorLog.length > 0
                  ? (console.warn(
                      "Baz\u0131 kay\u0131tlar y\xFCklenemedi:",
                      errorLog,
                    ),
                    notify.info(
                      `\u0130\u015Flem tamamland\u0131 ancak ${
                        errorLog.length
                      } kay\u0131tta sorun olu\u015Ftu. Konsol loglar\u0131n\u0131 kontrol edin.`,
                    ))
                  : notify.info(
                      "T\xFCm veriler ba\u015Far\u0131yla geri y\xFCklendi!",
                    ),
                  location.reload();
              } catch (err) {
                errorService.handle(err, {
                  userMessage:
                    "Kritik Hata: " +
                    (err instanceof Error ? err.message : String(err)),
                }),
                  (btn.disabled = !1),
                  (btn.textContent = "Geri Y\xFCklemeyi Ba\u015Flat");
              }
            });
        } catch (e2) {
          notify.warning(
            "Ge\xE7ersiz yedek dosyas\u0131! " +
              (e2 instanceof Error ? e2.message : String(e2)),
          );
        }
      }),
        reader.readAsText(file),
        (e.target.value = "");
    }),
    getEl("btn-action-reset-mappings").addEventListener("click", async () => {
      const list = await pb
        .collection("ayarlar")
        .getFullList({ filter: 'anahtar ~ "excel_mapping_"' });
      if (!list.length) return notify.info("Ayar yok.");
      if (confirm(`${list.length} ayar silinecek. Onay?`)) {
        for (const i of list) await pb.collection("ayarlar").delete(i.id);
        location.reload();
      }
    }),
    getEl("btn-clear-excel").addEventListener("click", () => {
      confirm("Emin misiniz?") &&
        clearCollection(pb, "excel_verileri", "Excel");
    }),
    getEl("btn-clear-reports").addEventListener("click", () => {
      confirm("S\u0130L yaz\u0131n") &&
        prompt("Onay") === "S\u0130L" &&
        clearCollection(pb, "denetim_raporlari", "Raporlar");
    }),
    getEl(
      "btn-cl\
ear-undone",
    ).addEventListener("click", () => {
      confirm("Temizlensin mi?") &&
        clearCollection(pb, "denetim_geri_alinanlar", "Log");
    });
}
async function clearCollection(pb, col, lbl) {
  const recs = await pb.collection(col).getFullList({ fields: "id" });
  if (!recs.length) return notify.info("Bo\u015F.");
  for (const r of recs) await pb.collection(col).delete(r.id);
  notify.info(lbl + " temizlendi."), location.reload();
}

export { initializeVeritabaniYonetimModule };
