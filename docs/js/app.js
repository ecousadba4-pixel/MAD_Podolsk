import { cacheDomElements } from "./utils.js";
import { DataManager } from "./api.js";
import { UIManager } from "./components.js";

// Используем относительный путь, чтобы фронтенд всегда ходил на свой бекенд,
// даже если домен меняется (например, в тестовой среде или локально).
const API_URL = "/api/dashboard";
const API_BASE = API_URL.replace(/\/$/, "");
const API_PDF_URL = `${API_BASE}/pdf`;
const API_MONTHS_URL = `${API_BASE}/months`;

document.addEventListener("DOMContentLoaded", () => {
  const DOM = cacheDomElements({
    monthSelect: "#month",
    lastUpdatedText: "#last-updated-text",
    sumPlanned: "#sum-planned",
    sumFact: "#sum-fact",
    sumDelta: "#sum-delta",
    sumFactProgress: "#sum-fact-progress",
    sumFactProgressLabel: "#sum-fact-progress-label",
    sumDailyAverage: "#sum-daily-average",
    sumDailyDays: "#sum-daily-days",
    dailyAverageCard: "#daily-average-card",
    dailyModal: "#daily-modal",
    dailyModalClose: "#daily-modal-close",
    dailyModalChart: "#daily-modal-chart",
    dailyModalChartWrapper: "#daily-modal-chart-wrapper",
    dailyModalEmpty: "#daily-modal-empty",
    dailyModalTotal: "#daily-modal-total",
    dailyModalSubtitle: "#daily-modal-subtitle",
    summaryGrid: "#summary-grid",
    summarySkeleton: "#summary-skeleton",
    categoryGrid: "#category-grid",
    categorySkeleton: "#category-skeleton",
    workList: "#work-list",
    workSkeleton: "#work-skeleton",
    workEmptyState: "#work-empty-state",
    searchInput: "#search",
    workSortSelect: "#work-sort-select",
    activeCategoryTitle: "#active-category-title",
    activeCategoryTitleDesktop: "#active-category-title-desktop",
    activeCategoryTitleMobileValue: "#active-category-title-mobile-value",
    printMonth: "#print-month",
    printUpdated: "#print-updated",
    printBody: "#print-report-body",
    printTotalPlan: "#print-total-plan",
    printTotalFact: "#print-total-fact",
    printTotalDelta: "#print-total-delta",
    printSubtitle: "#print-subtitle",
    pdfButton: "#download-pdf",
    pdfButtonContainerDesktop: ".pdf-action-desktop",
    pdfButtonContainerMobile: ".pdf-action-mobile",
  });

  const pdfButtonDefaultLabel = DOM.pdfButton ? DOM.pdfButton.innerHTML : "Скачать PDF";
  if (DOM.pdfButton) {
    DOM.pdfButton.disabled = true;
  }
  if (DOM.searchInput) {
    DOM.searchInput.disabled = true;
  }
  if (DOM.workSortSelect) {
    DOM.workSortSelect.disabled = true;
  }

  const pdfMobileMediaQuery = window.matchMedia("(max-width: 767px)");
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

  const dataManager = new DataManager(API_URL, { monthsUrl: API_MONTHS_URL });
  const uiManager = new UIManager({
    dataManager,
    elements: DOM,
    apiPdfUrl: API_PDF_URL,
    pdfButtonDefaultLabel,
  });
  uiManager.init();
});
