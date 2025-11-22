import { cacheDomElements, setElementsDisabled } from "@js/utils.js";
import { DataManager } from "@js/api.js";
import { UIManager } from "@js/components.js";
import { VisitorTracker } from "@js/visitor.js";
import {
  API_URL,
  API_BASE,
  API_PDF_URL,
  API_MONTHS_URL,
  API_DAYS_URL,
  API_DAILY_URL,
  MOBILE_MEDIA_QUERY,
  DEFAULT_PDF_LABEL,
  SELECTORS,
} from "@js/config.frontend.js";

export function initApp() {
  const visitorTracker = new VisitorTracker();

  const DOM = cacheDomElements(SELECTORS);

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
  visitorTracker.logInitialVisit({ apiBase: API_BASE, endpoint: endpointPath });
}

