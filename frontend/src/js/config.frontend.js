export const DEFAULT_API_BASE = "/api/dashboard";
export const API_PDF_SUFFIX = "/pdf";
export const API_MONTHS_SUFFIX = "/months";
export const API_DAYS_SUFFIX = "/days";
export const API_DAILY_SUFFIX = "/daily";

// Адрес API может переопределяться через meta-тег `mad-api-url`
// или глобальную переменную `window.MAD_API_URL`, чтобы фронтенд
// можно было разворачивать на статическом хостинге с бэкендом
// на другом домене.
export const API_URL = (() => {
  const metaApiUrl = document.querySelector('meta[name="mad-api-url"]');
  const explicitUrl = (metaApiUrl?.content || window.MAD_API_URL || "").trim();
  return explicitUrl || DEFAULT_API_BASE;
})();

export const API_BASE = API_URL.replace(/\/$/, "");
export const API_PDF_URL = `${API_BASE}${API_PDF_SUFFIX}`;
export const API_MONTHS_URL = `${API_BASE}${API_MONTHS_SUFFIX}`;
export const API_DAYS_URL = `${API_BASE}${API_DAYS_SUFFIX}`;
export const API_DAILY_URL = `${API_BASE}${API_DAILY_SUFFIX}`;

export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
export const DEFAULT_PDF_LABEL = "Скачать PDF";

export const SELECTORS = {
  page: ".page",
  monthSelect: "#month",
  daySelect: "#day",
  monthControls: "#month-controls",
  dayControls: "#day-controls",
  lastUpdatedText: "#last-updated-text",
  lastUpdatedTextDaily: "#last-updated-text-daily",
  sumPlanned: "#sum-planned",
  sumFact: "#sum-fact",
  sumDelta: "#sum-delta",
  sumFactProgress: "#sum-fact-progress",
  sumFactProgressLabel: "#sum-fact-progress-label",
  sumDailyAverage: "#sum-daily-average",
  dailyAverageNote: "#daily-average-note",
  dailyAverageHint: "#daily-average-hint",
  dailyAverageCard: "#daily-average-card",
  dailyModal: "#daily-modal",
  dailyModalClose: "#daily-modal-close",
  dailyModalList: "#daily-modal-list",
  dailyModalEmpty: "#daily-modal-empty",
  dailyModalSubtitle: "#daily-modal-subtitle",
  summaryGrid: "#summary-grid",
  summarySkeleton: "#summary-skeleton",
  categoryGrid: "#category-grid",
  categorySkeleton: "#category-skeleton",
  workList: "#work-list",
  workSkeleton: "#work-skeleton",
  workEmptyState: "#work-empty-state",
  workSortSelect: "#work-sort-select",
  activeCategoryTitle: "#active-category-title",
  activeCategoryTitleDesktop: "#active-category-title-desktop",
  activeCategoryTitleMobileValue: "#active-category-title-mobile-value",
  workDetailHint: "#work-detail-hint",
  pdfButton: "#download-pdf",
  pdfButtonContainerDesktop: ".pdf-action-desktop",
  pdfButtonContainerMobile: ".pdf-action-mobile",
  contractCard: "#contract-card",
  contractAmount: "#contract-amount",
  contractExecuted: "#contract-executed",
  contractPercent: "#contract-percent",
  contractProgress: "#contract-progress",
  contractTitleDate: "#contract-title-date",
  viewModeMonthly: "#tab-monthly",
  viewModeDaily: "#tab-daily",
  dailyPanel: "#daily-panel",
  dailySkeleton: "#daily-skeleton",
  dailyEmptyState: "#daily-empty-state",
  dailyTable: "#daily-table",
  dailyPanelTitle: "#daily-panel-title",
  dailyPanelSubtitle: "#daily-panel-subtitle",
};
