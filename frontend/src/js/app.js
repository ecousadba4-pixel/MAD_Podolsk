import { cacheDomElements, setElementsDisabled } from "@js/utils.js";
import { DataManager } from "@js/api.js";
import { UIManager } from "@js/components.js";
import { VisitorTracker } from "@js/visitor.js";
import {
  DEFAULT_API_BASE,
  API_PDF_SUFFIX,
  API_MONTHS_SUFFIX,
  API_DAYS_SUFFIX,
  API_DAILY_SUFFIX,
  MOBILE_MEDIA_QUERY,
  DEFAULT_PDF_LABEL,
  SELECTORS,
} from "@js/config.frontend.js";

// Разрешаем переопределять адрес API через meta-тег `mad-api-url` или
// глобальную переменную `MAD_API_URL`, чтобы фронтенд можно было разворачивать
// на статическом хостинге с бекендом на другом домене.

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
  visitorTracker.sendVisitLog({ apiBase: API_BASE, endpoint: endpointPath });
}

