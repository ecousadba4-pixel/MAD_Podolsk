import { cacheDomElements } from "./utils.js";
import { DataManager } from "./api.js";
import { UIManager } from "./components.js";

const API_URL = "https://mad-podolsk-karinausadba.amvera.io/api/dashboard";
const API_BASE = API_URL.replace(/\/$/, "");
const API_PDF_URL = `${API_BASE}/pdf`;
const API_MONTHS_URL = `${API_BASE}/months`;

document.addEventListener("DOMContentLoaded", () => {
  const DOM = cacheDomElements({
    monthSelect: "#month",
    lastUpdatedText: "#last-updated-text",
    sumPlanned: "#sum-planned",
    sumFact: "#sum-fact",
    sumComplete: "#sum-complete",
    sumDelta: "#sum-delta",
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

  const dataManager = new DataManager(API_URL, { monthsUrl: API_MONTHS_URL });
  const uiManager = new UIManager({
    dataManager,
    elements: DOM,
    apiPdfUrl: API_PDF_URL,
    pdfButtonDefaultLabel,
  });
  uiManager.init();
});
