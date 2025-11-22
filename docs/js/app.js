import { cacheDomElements, setElementsDisabled } from "./utils.js";
import { DataManager } from "./api.js";
import { UIManager } from "./components.js";
import { VisitorTracker } from "./visitor.js";

// Разрешаем переопределять адрес API через meta-тег `mad-api-url` или
// глобальную переменную `MAD_API_URL`, чтобы фронтенд можно было разворачивать
// на статическом хостинге с бекендом на другом домене.

const DEFAULT_API_BASE = "/api/dashboard";
const API_PDF_SUFFIX = "/pdf";
const API_MONTHS_SUFFIX = "/months";
const API_DAYS_SUFFIX = "/days";
const API_DAILY_SUFFIX = "/daily";
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

const API_URL = (() => {
  const metaApiUrl = document.querySelector('meta[name="mad-api-url"]');
  const explicitUrl = (metaApiUrl?.content || window.MAD_API_URL || "").trim();
  return explicitUrl || DEFAULT_API_BASE; // значение по умолчанию — тот же домен
})();
const API_BASE = API_URL.replace(/\/$/, "");
const API_PDF_URL = `${API_BASE}${API_PDF_SUFFIX}`;
const API_MONTHS_URL = `${API_BASE}${API_MONTHS_SUFFIX}`;
const API_DAYS_URL = `${API_BASE}${API_DAYS_SUFFIX}`;
const API_DAILY_URL = `${API_BASE}${API_DAILY_SUFFIX}`;

export function initApp() {
  const visitorTracker = new VisitorTracker();

  const DOM = cacheDomElements({
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
  });

  const DEFAULT_PDF_LABEL = "Скачать PDF";
  const pdfButtonDefaultLabel = DOM.pdfButton ? DOM.pdfButton.innerHTML : DEFAULT_PDF_LABEL;
  setElementsDisabled({
    pdfButton: DOM.pdfButton,
    workSortSelect: DOM.workSortSelect,
  }, true);

  const pdfMobileMediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  const movePdfButton = (isMobile) => {
    if (!DOM.pdfButton || !DOM.pdfButtonContainerDesktop || !DOM.pdfButtonContainerMobile) {
      return;
    }

    const target = isMobile ? DOM.pdfButtonContainerMobile : DOM.pdfButtonContainerDesktop;
    if (DOM.pdfButton.parentElement !== target) {
      target.appendChild(DOM.pdfButton);
    }
  };

  movePdfButton(pdfMobileMediaQuery.matches);
  pdfMobileMediaQuery.addEventListener("change", (event) => movePdfButton(event.matches));

  const dataManager = new DataManager(API_URL, {
    monthsUrl: API_MONTHS_URL,
    daysUrl: API_DAYS_URL,
    dailyUrl: API_DAILY_URL,
    visitorTracker,
  });
  const uiManager = new UIManager({
    dataManager,
    elements: DOM,
    apiPdfUrl: API_PDF_URL,
    pdfButtonDefaultLabel,
    visitorTracker,
  });
  uiManager.init();

  const endpointPath = new URL(API_URL, window.location.origin).pathname;
  visitorTracker.sendVisitLog({ apiBase: API_BASE, endpoint: endpointPath });
}

