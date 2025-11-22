import {
  formatMoney,
  formatPercent,
  formatMoneyRub,
  formatDateTime,
  formatDate,
  formatNumber,
  showToast,
  calculateDelta,
  debounce,
} from "@js/utils.js";
import { initializeWorkList, renderWorkRows as renderWorkRowsExternal } from "@js/work-list.js";
import { applyDailyData as applyDailyDataExternal } from "@js/daily-report.js";
import {
  renderSummary as renderSummaryExternal,
  updateSummaryProgress as updateSummaryProgressExternal,
  updateDailyAverage as updateDailyAverageExternal,
  updateContractCard as updateContractCardExternal,
} from "@js/summary.js";
import { renderCategories as renderCategoriesExternal } from "@js/categories.js";

// Цветовые палитры категорий вынесены в константу верхнего уровня,
// чтобы `UIManager` концентрировался на логике, а не на данных оформления.
const CATEGORY_COLORS = [
  { accent: "#22c55e", soft: "rgba(34, 197, 94, 0.25)" },
  { accent: "#2563eb", soft: "rgba(37, 99, 235, 0.25)" },
  { accent: "#f97316", soft: "rgba(249, 115, 22, 0.25)" },
  { accent: "#dc2626", soft: "rgba(220, 38, 38, 0.25)" },
  { accent: "#a855f7", soft: "rgba(168, 85, 247, 0.25)" },
  { accent: "#0f766e", soft: "rgba(15, 118, 110, 0.25)" },
];

// Вспомогательные pure-функции, не завязанные на состояние UIManager.

function isValidPercent(value) {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

function normalizePercent(value) {
  if (!isValidPercent(value)) return 0;
  return Math.max(0, value * 100);
}

function buildProgressColor(percent) {
  const progressPercent = Math.max(0, percent);
  const cappedHue = Math.min(120, Math.max(0, progressPercent));
  if (progressPercent > 100) {
    return "#16a34a";
  }
  const lightness = progressPercent >= 50 ? 43 : 47;
  return `hsl(${cappedHue}, 78%, ${lightness}%)`;
}

export class UIManager {
  constructor({ dataManager, elements, apiPdfUrl, pdfButtonDefaultLabel, visitorTracker }) {
    this.dataManager = dataManager;
    this.elements = elements;
    this.apiPdfUrl = apiPdfUrl;
    this.pdfButtonDefaultLabel = pdfButtonDefaultLabel;
    this.visitorTracker = visitorTracker || null;
    this.groupedCategories = [];
    this.activeCategoryKey = null;
    this.workHeaderEl = null;
    this.liveRegion = null;
    this.metrics = null;
    this.lastUpdatedMonthlyLabel = null;
    this.lastUpdatedMonthlyDateLabel = null;
    this.lastUpdatedDailyLabel = null;
    this.lastUpdatedDailyDateLabel = null;
    this.summaryDailyRevenue = [];
    this.dailyRevenue = [];
    this.workSort = { column: "planned" };
    this.selectedMonthIso = null;
    this.selectedDayIso = null;
    this.availableDays = [];
    this.initialMonth = new URLSearchParams(window.location.search).get("month");
    this.viewMode = "monthly";
    this.dayOptionsLoaded = false;
    this.currentDailyData = null;
    if (this.elements.workSortSelect) {
      this.elements.workSortSelect.value = this.workSort.column;
    }
    this.handleResize = debounce(() => {
      this.updateWorkNameCollapsers();
      this.updateDailyNameCollapsers();
    }, 150);
    this.monthOptionsLoaded = false;
  }

  setActiveCategoryTitle(desktopText, mobileValueText = desktopText) {
    if (this.elements.activeCategoryTitleDesktop) {
      this.elements.activeCategoryTitleDesktop.textContent = desktopText;
    } else if (this.elements.activeCategoryTitle) {
      this.elements.activeCategoryTitle.textContent = desktopText;
    }

    if (this.elements.activeCategoryTitleMobileValue) {
      this.elements.activeCategoryTitleMobileValue.textContent = mobileValueText;
    }
  }

  init() {
    this.prepareWorkList();
    this.liveRegion = this.createLiveRegion();
    this.bindEvents();
    // По умолчанию скрываем подсказку о ежедневных данных до выбора месяца
    if (this.elements.workDetailHint) {
      this.elements.workDetailHint.hidden = true;
    }
    this.updateViewModeLayout();
    this.initMonthSelect();
    window.addEventListener("resize", this.handleResize);
  }

  toggleSkeletons(isLoading) {
    if (this.elements.summarySkeleton) {
      this.elements.summarySkeleton.style.display = isLoading ? "grid" : "none";
    }
    if (this.elements.categorySkeleton) {
      this.elements.categorySkeleton.style.display = isLoading ? "grid" : "none";
    }
    if (this.elements.workSkeleton) {
      this.elements.workSkeleton.style.display = isLoading ? "block" : "none";
    }
    if (this.elements.summaryGrid) {
      this.elements.summaryGrid.hidden = isLoading;
    }
    if (this.elements.categoryGrid) {
      this.elements.categoryGrid.style.display = isLoading ? "none" : "";
    }
    if (this.elements.workList) {
      this.elements.workList.style.display = isLoading ? "none" : "";
    }
  }

  updateViewModeLayout() {
    if (this.elements.page) {
      this.elements.page.dataset.viewMode = this.viewMode;
    }
    if (this.elements.viewModeMonthly) {
      this.elements.viewModeMonthly.classList.toggle("is-active", this.viewMode === "monthly");
      this.elements.viewModeMonthly.setAttribute("aria-selected", this.viewMode === "monthly" ? "true" : "false");
    }
    if (this.elements.viewModeDaily) {
      this.elements.viewModeDaily.classList.toggle("is-active", this.viewMode === "daily");
      this.elements.viewModeDaily.setAttribute("aria-selected", this.viewMode === "daily" ? "true" : "false");
    }

    const shouldDisablePdf = this.viewMode === "daily";
    if (this.elements.pdfButton) {
      this.elements.pdfButton.disabled = shouldDisablePdf || !this.groupedCategories.length;
    }

    this.updateLastUpdatedPills();
  }

  prepareWorkList() {
    const { headerEl, scroller, sortButtons } = initializeWorkList({
      container: this.elements.workList,
      onSortChange: (column) => this.handleWorkSortChange(column),
      onWorkClick: (item, event) => {
        if (event && event.target.closest(".work-row-name-toggle")) return;
        this.openWorkModal(item);
      },
    });

    this.workHeaderEl = headerEl;
    this.elements.workListScroller = scroller;
    this.workSortButtons = sortButtons;
    this.updateWorkSortButtons();
  }

  clearWorkRows() {
    if (this.elements.workListScroller) {
      this.elements.workListScroller.innerHTML = "";
    }
  }

  renderWorkRows(works) {
    renderWorkRowsExternal({
      scroller: this.elements.workListScroller,
      works,
      onWorkClick: (item, event) => {
        if (event && event.target.closest(".work-row-name-toggle")) return;
        this.openWorkModal(item);
      },
      initializeNameToggle: (nameWrapper) => this.initializeNameToggle(nameWrapper),
      calculateDeltaFn: (item) => calculateDelta(item),
    });
    requestAnimationFrame(() => this.updateWorkNameCollapsers());
  }

  bindEvents() {
    if (this.elements.workSortSelect) {
      this.elements.workSortSelect.addEventListener("change", (event) => {
        const column = event.target.value;
        this.handleWorkSortChange(column);
      });
    }
    this.elements.pdfButton.addEventListener("click", (event) => this.downloadPdfReport(event));
    if (this.elements.dailyAverageCard) {
      this.elements.dailyAverageCard.addEventListener("click", () => this.openDailyModal());
    }
    if (this.elements.dailyModalClose) {
      this.elements.dailyModalClose.addEventListener("click", () => this.closeDailyModal());
    }
    if (this.elements.dailyModal) {
      this.elements.dailyModal.addEventListener("click", (event) => {
        if (event.target === this.elements.dailyModal) {
          this.closeDailyModal();
        }
      });
    }
    if (this.elements.viewModeMonthly) {
      this.elements.viewModeMonthly.addEventListener("click", () => this.switchViewMode("monthly"));
    }
    if (this.elements.viewModeDaily) {
      this.elements.viewModeDaily.addEventListener("click", () => this.switchViewMode("daily"));
    }
    if (this.elements.daySelect) {
      this.elements.daySelect.addEventListener("change", () => {
        this.loadDailyData(this.elements.daySelect.value);
      });
    }
  }

  async initMonthSelect() {
    if (!this.elements.monthSelect) {
      return;
    }

    const selectEl = this.elements.monthSelect;
    selectEl.innerHTML = "";
    selectEl.disabled = true;

    try {
      const availableMonths = await this.dataManager.fetchAvailableMonths();
      const months = (availableMonths || [])
        .map((iso) => {
          if (!iso) return null;
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return null;
          return {
            iso,
            label: date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }),
          };
        })
        .filter(Boolean);

      if (!months.length) {
        const fallbackMonth = this.initialMonth || this.getCurrentMonthIso();
        this.setMonthSelectPlaceholder("Нет данных");
        if (fallbackMonth) {
          await this.loadMonthData(fallbackMonth);
        } else {
          this.handleLoadError();
        }
        return;
      }

      const hasInitialMonth = this.initialMonth && months.some((item) => item.iso === this.initialMonth);
      months.forEach((monthInfo, index) => {
        const option = document.createElement("option");
        option.value = monthInfo.iso;
        option.textContent = monthInfo.label;
        if ((hasInitialMonth && monthInfo.iso === this.initialMonth) || (!hasInitialMonth && index === 0)) {
          option.selected = true;
        }
        selectEl.appendChild(option);
      });

      if (!this.monthOptionsLoaded) {
        selectEl.addEventListener("change", () => {
          this.loadMonthData(selectEl.value);
        });
        this.monthOptionsLoaded = true;
      }

      selectEl.disabled = false;
      this.loadMonthData(selectEl.value || months[0].iso);
    } catch (error) {
      console.error("Не удалось загрузить список месяцев", error);
      this.setMonthSelectPlaceholder("Ошибка загрузки");
      this.handleLoadError();
    }
  }

  async initDaySelect() {
    if (!this.elements.daySelect) {
      return;
    }

    const inputEl = this.elements.daySelect;
    inputEl.value = "";
    inputEl.disabled = true;
    inputEl.min = "";
    inputEl.max = "";
    this.selectedDayIso = null;

    try {
      const availableDays = await this.dataManager.fetchAvailableDays();
      this.availableDays = (availableDays || [])
        .map((iso) => {
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return null;
          return {
            iso: date.toISOString().slice(0, 10),
            label: formatDate(date, { day: "2-digit", month: "long" }),
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.iso < b.iso ? 1 : -1));

      if (!this.availableDays.length) {
        const todayIso = this.getCurrentDayIso();
        this.availableDays = todayIso ? [{ iso: todayIso, label: formatDate(todayIso, { day: "2-digit", month: "long" }) }] : [];
      }

      const minDayIso = this.availableDays.reduce(
        (min, item) => (!min || item.iso < min ? item.iso : min),
        null,
      );
      const maxDayIso = this.availableDays.reduce(
        (max, item) => (!max || item.iso > max ? item.iso : max),
        null,
      );

      if (minDayIso) {
        inputEl.min = minDayIso;
      }
      if (maxDayIso) {
        inputEl.max = maxDayIso;
      }

      const initialDayIso = (this.selectedDayIso && this.availableDays.some((item) => item.iso === this.selectedDayIso))
        ? this.selectedDayIso
        : this.availableDays[0]?.iso;

      if (initialDayIso) {
        inputEl.value = initialDayIso;
        this.selectedDayIso = initialDayIso;
      }

      this.dayOptionsLoaded = true;
      inputEl.disabled = false;
    } catch (error) {
      console.error("Не удалось загрузить список дней", error);
      inputEl.value = "";
      inputEl.placeholder = "Ошибка загрузки";
      inputEl.setAttribute("aria-invalid", "true");
      this.dayOptionsLoaded = false;
    }
  }

  getCurrentMonthIso() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
  }

  getCurrentDayIso() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getMonthKey(monthIso) {
    if (!monthIso) {
      return null;
    }

    // Пытаемся распарсить строку в формате YYYY-MM или YYYY-MM-DD
    const match = /^(\d{4})-(\d{1,2})/.exec(monthIso);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (!Number.isNaN(year) && month >= 1 && month <= 12) {
        // Возвращаем ключ с индексом месяца (0-based), как это делает getMonth()
        return `${year}-${month - 1}`;
      }
    }

    return null;
  }

  isCurrentMonth(monthIso) {
    const targetKey = this.getMonthKey(monthIso);
    if (!targetKey) {
      return false;
    }

    const today = new Date();
    const currentKey = `${today.getFullYear()}-${today.getMonth()}`;
    return targetKey === currentKey;
  }

  async switchViewMode(mode) {
    const normalized = mode === "daily" ? "daily" : "monthly";
    if (this.viewMode === normalized) {
      return;
    }
    this.viewMode = normalized;
    this.updateViewModeLayout();

    if (normalized === "daily") {
      if (!this.dayOptionsLoaded) {
        await this.initDaySelect();
      }
      const targetDay = this.elements.daySelect?.value
        || this.selectedDayIso
        || (this.availableDays[0] ? this.availableDays[0].iso : null)
        || this.getCurrentDayIso();
      if (targetDay) {
        this.setDaySelectValue(targetDay);
        await this.loadDailyData(targetDay);
      } else {
        this.showDailyEmptyState("Нет данных за текущий месяц");
      }
    } else {
      this.updateLastUpdatedPills();
    }
  }

  updateDailyAverageVisibility(monthIso = this.selectedMonthIso) {
    const isCurrentMonth = this.isCurrentMonth(monthIso);
    if (this.elements.dailyAverageNote) {
      this.elements.dailyAverageNote.hidden = !isCurrentMonth;
    }
    if (this.elements.dailyAverageHint) {
      this.elements.dailyAverageHint.hidden = !isCurrentMonth;
    }
    // Подзаголовок в разделе «Расшифровка работ по смете» показываем только для текущего месяца
    if (this.elements.workDetailHint) {
      this.elements.workDetailHint.hidden = !isCurrentMonth;
    }
  }

  setMonthSelectPlaceholder(message) {
    if (!this.elements.monthSelect) {
      return;
    }
    const option = document.createElement("option");
    option.value = "";
    option.textContent = message;
    option.disabled = true;
    option.selected = true;
    this.elements.monthSelect.appendChild(option);
    this.elements.monthSelect.disabled = true;
  }

  async loadMonthData(monthIso) {
    this.selectedMonthIso = monthIso;
    this.updateDailyAverageVisibility(monthIso);
    const cached = this.dataManager.getCached(monthIso);
    if (cached) {
      this.applyData(cached);
    } else {
      this.showLoadingState();
    }
    try {
      const { data } = await this.dataManager.fetchData(monthIso, { force: Boolean(cached) });
      this.applyData(data);
      this.announce(`Данные за ${this.getSelectedMonthLabel() || "выбранный месяц"} обновлены.`);
    } catch (error) {
      console.error(error);
      if (!cached) {
        this.handleLoadError();
      } else {
        this.announce("Не удалось обновить данные");
      }
    }
  }

  showLoadingState() {
    this.groupedCategories = [];
    this.activeCategoryKey = null;
    this.summaryDailyRevenue = [];
    this.dailyRevenue = [];
    this.toggleSkeletons(true);
    this.elements.categoryGrid.innerHTML = "";
    this.lastUpdatedMonthlyLabel = "Загрузка данных…";
    this.lastUpdatedMonthlyDateLabel = "Загрузка данных…";
    this.updateLastUpdatedPills();
    this.elements.sumPlanned.textContent = "…";
    this.elements.sumFact.textContent = "…";
    this.elements.sumDelta.textContent = "…";
    this.updateSummaryProgress(null, "…");
    this.updateDailyAverage(null, 0);
    this.setActiveCategoryTitle("Загрузка...");
    this.elements.workEmptyState.style.display = "none";
    this.elements.workList.classList.remove("has-data");
    this.workHeaderEl.hidden = true;
    this.elements.workListScroller.style.display = "none";
    this.clearWorkRows();
    this.elements.pdfButton.disabled = true;
    this.updateContractCard(null);
  }

  handleLoadError() {
    this.toggleSkeletons(false);
    this.elements.workEmptyState.style.display = "block";
    this.elements.workEmptyState.textContent = "Ошибка загрузки данных";
    this.lastUpdatedMonthlyLabel = "Ошибка загрузки данных";
    this.lastUpdatedMonthlyDateLabel = "";
    this.updateLastUpdatedPills();
    this.elements.sumPlanned.textContent = "–";
    this.elements.sumFact.textContent = "–";
    this.elements.sumDelta.textContent = "–";
    this.elements.sumDelta.classList.remove("positive", "negative");
    this.summaryDailyRevenue = [];
    this.dailyRevenue = [];
    this.updateSummaryProgress(null, "–");
    this.updateDailyAverage(null, 0);
    this.updateContractCard(null);
    this.setActiveCategoryTitle("Смета не выбрана");
    this.elements.workList.classList.remove("has-data");
    this.workHeaderEl.hidden = true;
    this.elements.workListScroller.style.display = "none";
    this.clearWorkRows();
    this.elements.pdfButton.disabled = true;
    this.elements.categoryGrid.innerHTML = '<div class="empty-state">Ошибка загрузки данных</div>';
  }

  applyData(data) {
    this.dataManager.setCurrentData(data);
    this.toggleSkeletons(false);
    const items = Array.isArray(data.items) ? data.items : [];
    this.groupedCategories = this.dataManager.buildCategories(items);
    this.ensureActiveCategory();
    const lastUpdatedLabel = data.has_data
      ? formatDateTime(data.last_updated)
      : "Нет данных";
    const lastUpdatedDateLabel = data.has_data
      ? formatDate(data.last_updated, { day: "2-digit", month: "2-digit", year: "numeric" })
      : "Нет данных";
    this.lastUpdatedMonthlyLabel = lastUpdatedLabel;
    this.lastUpdatedMonthlyDateLabel = lastUpdatedDateLabel;
    this.updateLastUpdatedPills();
    const hasAnyData = data.has_data && items.length > 0;
    this.elements.pdfButton.disabled = !hasAnyData;
    this.renderSummary();
    this.renderCategories();
    this.renderWorkList();
  }

  ensureActiveCategory() {
    if (this.activeCategoryKey && this.groupedCategories.some((cat) => cat.key === this.activeCategoryKey)) {
      return;
    }
    this.activeCategoryKey = this.groupedCategories.length ? this.groupedCategories[0].key : null;
  }

  renderSummary() {
    const currentData = this.dataManager.getCurrentData();
    const metrics = currentData && currentData.has_data
      ? this.dataManager.calculateMetrics(currentData)
      : null;
    const contractMetrics = this.dataManager.calculateContractMetrics(currentData || {});
    this.updateContractCard(contractMetrics);
    this.metrics = metrics;

    const {
      summaryDailyRevenue,
      averageDailyRevenue,
      completion,
      completionLabel,
    } = renderSummaryExternal({ metrics, elements: this.elements });

    this.summaryDailyRevenue = summaryDailyRevenue || [];
    this.dailyRevenue = [...this.summaryDailyRevenue];
    this.updateSummaryProgress(completion, completionLabel);
    this.updateDailyAverage(averageDailyRevenue, this.summaryDailyRevenue.length);
  }

  updateSummaryProgress(completion, label) {
    updateSummaryProgressExternal({ completion, label, elements: this.elements });
  }

  updateLastUpdatedPills() {
    const monthlyLabel = this.lastUpdatedMonthlyLabel || "Нет данных";
    const monthlyDateLabel = this.lastUpdatedMonthlyDateLabel || monthlyLabel;
    const dailyLabel = this.lastUpdatedDailyLabel || monthlyLabel;
    const dailyDateLabel = this.lastUpdatedDailyDateLabel || dailyLabel;

    if (this.elements.lastUpdatedText) {
      this.elements.lastUpdatedText.textContent = monthlyLabel;
    }
    if (this.elements.lastUpdatedTextDaily) {
      this.elements.lastUpdatedTextDaily.textContent = dailyLabel;
    }

    if (this.viewMode === "daily") {
      this.updateContractTitleDate(dailyDateLabel);
    } else {
      this.updateContractTitleDate(monthlyDateLabel);
    }
  }

  updateContractTitleDate(label) {
    if (!this.elements.contractTitleDate) {
      return;
    }
    this.elements.contractTitleDate.textContent = label ? `на ${label}` : "";
  }

  updateContractCard(contractMetrics) {
    updateContractCardExternal({
      contractMetrics,
      elements: this.elements,
      formatMoneyFn: (value) => formatMoney(value),
      formatPercentFn: (value) => formatPercent(value),
    });
  }

  updateContractProgress(completion) {
    // Сохраняем метод для обратной совместимости, делегируя реализацию в summary.js
    updateContractProgress({ completion, elements: this.elements });
  }

  updateDailyAverage(averageValue, daysWithData) {
    const isCurrentMonth = this.isCurrentMonth(this.selectedMonthIso);
    updateDailyAverageExternal({
      averageValue,
      daysWithData,
      isCurrentMonth,
      elements: this.elements,
    });
  }

  setDaySelectValue(dayIso) {
    if (!this.elements.daySelect || !dayIso) {
      return;
    }
    this.elements.daySelect.value = dayIso;
    this.selectedDayIso = this.elements.daySelect.value || dayIso;
  }

  showDailyLoadingState() {
    if (!this.elements.dailySkeleton || !this.elements.dailyTable || !this.elements.dailyEmptyState) {
      return;
    }
    this.elements.dailySkeleton.style.display = "block";
    this.elements.dailyTable.style.display = "none";
    this.elements.dailyEmptyState.style.display = "none";
    this.lastUpdatedDailyLabel = "Загрузка данных…";
    this.lastUpdatedDailyDateLabel = "";
    this.updateLastUpdatedPills();
  }

  handleDailyLoadError(message = "Ошибка загрузки данных") {
    if (this.elements.dailySkeleton) this.elements.dailySkeleton.style.display = "none";
    this.showDailyEmptyState(message);
    this.lastUpdatedDailyLabel = message;
    this.lastUpdatedDailyDateLabel = "";
    this.updateLastUpdatedPills();
  }

  showDailyEmptyState(message) {
    if (!this.elements.dailyEmptyState || !this.elements.dailyTable) return;
    this.elements.dailyEmptyState.textContent = message;
    this.elements.dailyEmptyState.style.display = "block";
    this.elements.dailyTable.style.display = "none";
  }

  applyDailyData(data) {
    this.currentDailyData = data;

    applyDailyDataExternal({
      data,
      elements: this.elements,
      onAfterRender: () => {
        this.lastUpdatedDailyLabel = data?.has_data ? formatDateTime(data.last_updated) : "Нет данных";
        this.lastUpdatedDailyDateLabel = data?.has_data
          ? formatDate(data.last_updated, { day: "2-digit", month: "2-digit", year: "numeric" })
          : this.lastUpdatedDailyLabel;
        this.updateLastUpdatedPills();
        requestAnimationFrame(() => this.updateDailyNameCollapsers());
      },
    });
  }

  async loadDailyData(dayIso) {
    if (!dayIso) {
      this.handleDailyLoadError("Выберите день, чтобы загрузить данные");
      return;
    }
    this.selectedDayIso = dayIso;
    this.setDaySelectValue(dayIso);
    const cached = this.dataManager.getCachedDaily(dayIso);
    if (cached) {
      this.applyDailyData(cached);
    } else {
      this.showDailyLoadingState();
    }

    try {
      const { data } = await this.dataManager.fetchDailyReport(dayIso, { force: Boolean(cached) });
      this.applyDailyData(data);
      this.announce(`Данные за ${formatDate(dayIso, { day: "2-digit", month: "long" })} обновлены.`);
    } catch (error) {
      console.error(error);
      if (!cached) {
        this.handleDailyLoadError();
      } else {
        this.announce("Не удалось обновить данные дня");
      }
    }
  }

  openDailyModal() {
    if (
      !this.summaryDailyRevenue.length
      || !this.elements.dailyModal
      || !this.isCurrentMonth(this.selectedMonthIso)
    ) {
      return;
    }
    // Устанавливаем заголовок модального окна для среднедневной выручки
    const titleEl = this.elements.dailyModal.querySelector("#daily-modal-title") || document.getElementById("daily-modal-title");
    if (titleEl) titleEl.textContent = "Среднедневная выручка";
    
    // Устанавливаем подзаголовок
    const monthLabel = this.getSelectedMonthLabel() || "выбранный месяц";
    if (this.elements.dailyModalSubtitle) {
      this.elements.dailyModalSubtitle.textContent = `По дням за ${monthLabel.toLowerCase()}`;
    }
    
    this.dailyRevenue = [...this.summaryDailyRevenue];
    this.dailyModalMode = "average";
    this.renderDailyModalList();
    this.elements.dailyModal.classList.add("visible");
    this.elements.dailyModal.setAttribute("aria-hidden", "false");
  }

  async openWorkModal(item) {
    if (!item || !this.elements.dailyModal || !this.isCurrentMonth(this.selectedMonthIso)) {
      return;
    }
    const workName = (item.work_name || item.description || "").toString();
    const monthIso = this.selectedMonthIso;
    const apiBase = (this.dataManager && this.dataManager.apiUrl)
      ? this.dataManager.apiUrl.replace(/\/$/, "")
      : "/api/dashboard";

    const url = new URL(`${apiBase}/work-breakdown`, window.location.origin);
    url.searchParams.set("month", monthIso);
    url.searchParams.set("work", workName);

    try {
      // Установим заголовок модального окна
      const titleEl = this.elements.dailyModal.querySelector("#daily-modal-title") || document.getElementById("daily-modal-title");
      if (titleEl) titleEl.textContent = `Расшифровка: ${workName}`;
      if (this.elements.dailyModalSubtitle) {
        this.elements.dailyModalSubtitle.textContent = "";
      }

      const response = await fetch(url.toString(), {
        headers: this.visitorTracker ? this.visitorTracker.buildHeaders() : {},
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : (payload?.daily || []);

      // Преобразуем в формат для отрисовки с единицей измерения
      this.dailyModalMode = "work";
      this.dailyRevenue = (items || []).map((it) => {
        const date = it.date || it.work_date || it.day;
        const raw = it.amount ?? it.total_volume ?? it.value;
        const amount = raw === null || raw === undefined ? null : Number(raw);
        const unit = it.unit || "";
        const total_amount = it.total_amount ?? null;
        if (!date || amount === null || !Number.isFinite(amount)) return null;
        return { date, amount, unit, total_amount };
      }).filter(Boolean);

      this.renderDailyModalList();
      this.elements.dailyModal.classList.add("visible");
      this.elements.dailyModal.setAttribute("aria-hidden", "false");
    } catch (err) {
      console.error("Ошибка загрузки расшифровки по работе:", err);
      showToast("Не удалось загрузить расшифровку по работе.", "error");
    }
  }

  closeDailyModal() {
    if (!this.elements.dailyModal) return;
    this.elements.dailyModal.classList.remove("visible");
    this.elements.dailyModal.setAttribute("aria-hidden", "true");
  }

  renderDailyModalList() {
    if (!this.elements.dailyModalList || !this.elements.dailyModalEmpty) return;

    const monthLabel = this.getSelectedMonthLabel() || "выбранный месяц";
    if (this.elements.dailyModalSubtitle) {
      this.elements.dailyModalSubtitle.textContent = `По дням за ${monthLabel.toLowerCase()}`;
    }

    this.elements.dailyModalList.innerHTML = "";
    const sorted = [...this.dailyRevenue].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!sorted.length) {
      this.elements.dailyModalEmpty.style.display = "block";
      this.elements.dailyModalList.style.display = "none";
      return;
    }

    this.elements.dailyModalEmpty.style.display = "none";
    this.elements.dailyModalList.style.display = "grid";

    // Определяем режим отображения: по-умолчанию — если у элементов есть unit или total_amount,
    // показываем колонки "Объем" + "Сумма" (работы). Иначе — показываем только "Сумма" (среднедневная выручка).
    const isWorkMode = this.dailyModalMode === "work" || sorted.some((it) => it.unit || (it.total_amount !== null && it.total_amount !== undefined));

    // Добавляем заголовки
      const header = document.createElement("div");
      header.className = "modal-row modal-row-header";
      if (isWorkMode) {
        header.innerHTML = `
          <div class="modal-row-date">Дата</div>
          <div class="modal-row-value"><span class="modal-value-number">Объем</span></div>
          <div class="modal-row-sum">Сумма,₽</div>
        `;
      } else {
        header.innerHTML = `
          <div class="modal-row-date">Дата</div>
          <div class="modal-row-sum">Сумма, ₽</div>
        `;
      }
    this.elements.dailyModalList.appendChild(header);

    const fragment = document.createDocumentFragment();
    sorted.forEach((item) => {
      const row = document.createElement("div");
      row.className = "modal-row";
      // Для мобильной версии используем компактный формат даты DD.MM
      const isMobile = typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(max-width: 767px)").matches
        : false;
      const dateLabel = isMobile
        ? formatDate(item.date, { day: "2-digit", month: "2-digit" })
        : formatDate(item.date);
      if (isWorkMode) {
        const amount = Number(item.amount);
        const formattedAmount = Number.isFinite(amount) ? amount.toFixed(1) : "–";
        const unit = item.unit || "";
        const totalAmount = Number(item.total_amount);
        const formattedTotal = Number.isFinite(totalAmount)
          ? totalAmount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
          : "–";
        row.innerHTML = `
          <div class="modal-row-date">${dateLabel}</div>
          <div class="modal-row-value">
            <span class="modal-value-number">${Number.isFinite(amount) ? formattedAmount : formattedAmount}</span>
            ${unit ? `<span class="modal-value-unit">(${unit})</span>` : ""}
          </div>
          <div class="modal-row-sum">${formattedTotal}</div>
        `;
      } else {
        // Режим среднедневной выручки: item.amount — это денежная величина
        const sumAmount = Number(item.amount);
        const formattedSum = Number.isFinite(sumAmount)
          ? sumAmount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
          : "–";
        row.innerHTML = `
          <div class="modal-row-date">${dateLabel}</div>
          <div class="modal-row-sum">${formattedSum}</div>
        `;
      }
      fragment.appendChild(row);
    });

    this.elements.dailyModalList.appendChild(fragment);
  }

  renderCategories() {
    renderCategoriesExternal({
      groupedCategories: this.groupedCategories,
      activeCategoryKey: this.activeCategoryKey,
      elements: this.elements,
      colors: CATEGORY_COLORS,
      onSelect: (key) => {
        this.activeCategoryKey = key;
        this.renderCategories();
        this.renderWorkList();
      },
    });

    this.enhanceAccessibility();
  }

  renderWorkList() {
    const currentData = this.dataManager.getCurrentData();
    const activeCategory = this.groupedCategories.find((cat) => cat.key === this.activeCategoryKey) || null;
    if (this.elements.workSortSelect) {
      this.elements.workSortSelect.disabled = !activeCategory;
    }

    if (!activeCategory) {
      this.elements.workEmptyState.style.display = "block";
      this.elements.workEmptyState.textContent = currentData && !currentData.has_data
        ? "Данные за выбранный месяц отсутствуют"
        : "Здесь появится список работ выбранной сметы.";
      this.setActiveCategoryTitle("Смета не выбрана");
      this.elements.workList.classList.remove("has-data");
      this.workHeaderEl.hidden = true;
      this.elements.workListScroller.style.display = "none";
      this.clearWorkRows();
      return;
    }

    const works = [...activeCategory.works];

    this.sortWorks(works);

    this.setActiveCategoryTitle(
      `Расшифровка работ по смете «${activeCategory.title}»`,
      activeCategory.title
    );

    if (!works.length) {
      this.elements.workEmptyState.style.display = "block";
      this.elements.workEmptyState.textContent = "В этой смете нет строк для отображения";
      this.elements.workList.classList.remove("has-data");
      this.workHeaderEl.hidden = true;
      this.elements.workListScroller.style.display = "none";
      this.clearWorkRows();
      return;
    }

    this.elements.workEmptyState.style.display = "none";
    this.elements.workList.classList.add("has-data");
    this.workHeaderEl.hidden = false;
    this.elements.workListScroller.style.display = "block";
    this.renderWorkRows(works);
  }

  handleWorkSortChange(column) {
    if (!column || this.workSort.column === column) {
      return;
    }
    this.workSort.column = column;
    this.updateWorkSortButtons();
    this.renderWorkList();
  }

  updateWorkSortButtons() {
    if (this.workSortButtons) {
      this.workSortButtons.forEach((button) => {
        const isActive = button.dataset.sort === this.workSort.column;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }
    if (this.elements.workSortSelect && this.elements.workSortSelect.value !== this.workSort.column) {
      this.elements.workSortSelect.value = this.workSort.column;
    }
  }

  getSortValueForWork(item) {
    if (!item) {
      return Number.NEGATIVE_INFINITY;
    }
    let value;
    switch (this.workSort.column) {
      case "fact":
        value = item.fact_amount;
        break;
      case "delta":
        value = calculateDelta(item);
        break;
      case "planned":
      default:
        value = item.planned_amount ?? item.fact_amount;
        break;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
  }

  sortWorks(works) {
    if (!Array.isArray(works)) {
      return works;
    }
    if (this.workSort.column === "delta") {
      works.sort((a, b) => {
        const deltaA = calculateDelta(a);
        const deltaB = calculateDelta(b);
        const isNegativeA = deltaA < 0;
        const isNegativeB = deltaB < 0;

        if (isNegativeA !== isNegativeB) {
          return isNegativeA ? -1 : 1;
        }

        if (isNegativeA && isNegativeB) {
          const diff = deltaA - deltaB;
          if (diff !== 0) {
            return diff;
          }
        } else {
          const diff = deltaB - deltaA;
          if (diff !== 0) {
            return diff;
          }
        }

        const nameA = (a?.work_name || a?.description || "").toLowerCase();
        const nameB = (b?.work_name || b?.description || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return works;
    }

    works.sort((a, b) => {
      const valueA = this.getSortValueForWork(a);
      const valueB = this.getSortValueForWork(b);
      const diff = valueB - valueA;
      if (diff !== 0) {
        return diff;
      }
      const nameA = (a?.work_name || a?.description || "").toLowerCase();
      const nameB = (b?.work_name || b?.description || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return works;
  }

  initializeNameToggle(nameWrapper) {
    if (!nameWrapper) {
      return;
    }
    const toggleBtn = nameWrapper.querySelector(".work-row-name-toggle");
    if (!toggleBtn) {
      return;
    }
    nameWrapper.dataset.expanded = "false";
    toggleBtn.addEventListener("click", () => {
      const isExpanded = nameWrapper.classList.toggle("work-row-name--expanded");
      if (isExpanded) {
        nameWrapper.classList.remove("work-row-name--collapsed");
      } else {
        nameWrapper.classList.add("work-row-name--collapsed");
      }
      nameWrapper.dataset.expanded = String(isExpanded);
      toggleBtn.setAttribute("aria-expanded", String(isExpanded));
      toggleBtn.setAttribute(
        "aria-label",
        isExpanded ? "Свернуть название" : "Развернуть полное название"
      );
    });
  }

  updateNameCollapsers(container) {
    if (!container) {
      return;
    }
    const nameWrappers = container.querySelectorAll(".work-row-name");
    nameWrappers.forEach((wrapper) => {
      const textEl = wrapper.querySelector(".work-row-name-text");
      const toggleBtn = wrapper.querySelector(".work-row-name-toggle");
      if (!textEl || !toggleBtn) {
        return;
      }

      const isExpanded = wrapper.dataset.expanded === "true";
      wrapper.classList.toggle("work-row-name--expanded", isExpanded);
      if (isExpanded) {
        wrapper.classList.remove("work-row-name--collapsed");
      } else {
        wrapper.classList.add("work-row-name--collapsed");
      }
      toggleBtn.setAttribute("aria-expanded", String(isExpanded));
      toggleBtn.setAttribute(
        "aria-label",
        isExpanded ? "Свернуть название" : "Развернуть полное название"
      );
      wrapper.classList.remove("work-row-name--collapsible");
      toggleBtn.hidden = true;

      const lineHeight = parseFloat(window.getComputedStyle(textEl).lineHeight || "0");
      const maxHeight = lineHeight && !Number.isNaN(lineHeight) ? lineHeight * 2 : null;
      const isOverflowing = maxHeight
        ? textEl.scrollHeight > maxHeight + 1
        : textEl.scrollHeight > textEl.offsetHeight + 1;
      if (isOverflowing) {
        wrapper.classList.add("work-row-name--collapsible");
        toggleBtn.hidden = false;
      } else if (!isExpanded) {
        wrapper.classList.remove("work-row-name--collapsed");
      }
    });
  }

  updateDailyNameCollapsers() {
    this.updateNameCollapsers(this.elements.dailyTable);
  }

  createWorkRow(item, index, total) {
    const workName = item.work_name || item.description || "Без названия";
    const delta = calculateDelta(item);
    const deltaClass = delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : "";
    const plannedFormatted = formatMoney(item.planned_amount);
    const factFormatted = formatMoney(item.fact_amount);
    const deltaFormatted = formatMoney(delta);
    const row = document.createElement("div");
    row.className = "work-row";
    if (index === total - 1) {
      row.classList.add("work-row-last");
    }
    row.innerHTML = `
      <div class="work-row-name work-row-name--collapsed" data-expanded="false">
        <span class="work-row-name-text">${workName}</span>
        <button
          type="button"
          class="work-row-name-toggle"
          aria-expanded="false"
          aria-label="Развернуть полное название"
        >
          <span class="work-row-name-toggle-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="work-row-money work-row-plan">
        <span class="work-row-label">План</span>
        <span>${plannedFormatted}</span>
      </div>
      <div class="work-row-money work-row-fact">
        <span class="work-row-label">Факт</span>
        <span>${factFormatted}</span>
      </div>
      <div class="work-row-delta ${deltaClass}">
        <span class="work-row-label">Отклонение</span>
        <span class="work-row-delta-value">${deltaFormatted}</span>
      </div>
    `;
    this.initializeNameToggle(row.querySelector(".work-row-name"));
    // Клик по строке работы открывает подневную расшифровку (только для текущего месяца).
    row.addEventListener("click", (event) => {
      // не обрабатываем клик по кнопке разворачивания названия
      if (event.target.closest(".work-row-name-toggle")) return;
      try {
        this.openWorkModal(item);
      } catch (err) {
        // Ошибка обработки — логируем и показываем тост
        console.error(err);
      }
    });
    return row;
  }

  updateWorkNameCollapsers() {
    this.updateNameCollapsers(this.elements.workListScroller);
  }

  getSelectedMonthLabel() {
    const option = this.elements.monthSelect.options[this.elements.monthSelect.selectedIndex];
    return option ? option.textContent.trim() : "";
  }

  async downloadPdfReport(event) {
    event.preventDefault();
    if (this.elements.pdfButton.disabled) {
      return;
    }
    const selectedMonth = this.getSelectedMonthLabel() || this.elements.monthSelect.value || "period";
    const fileNameSlug = selectedMonth
      .toString()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^0-9A-Za-zА-Яа-я\-]+/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = fileNameSlug ? `mad-podolsk-otchet-${fileNameSlug}.pdf` : "mad-podolsk-otchet.pdf";
    this.elements.pdfButton.disabled = true;
    this.elements.pdfButton.innerHTML = "Формируем PDF…";
    try {
      const pdfUrl = new URL(this.apiPdfUrl, window.location.origin);
      pdfUrl.searchParams.set("month", this.elements.monthSelect.value);
      const response = await fetch(pdfUrl.toString(), {
        headers: {
          Accept: "application/pdf",
          ...(this.visitorTracker ? this.visitorTracker.buildHeaders() : {}),
        },
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      this.announce("PDF-отчёт сформирован.");
    } catch (error) {
      console.error("PDF export error", error);
      showToast("Не удалось сформировать PDF. Попробуйте ещё раз позже.", "error");
      this.announce("Ошибка формирования PDF");
    } finally {
      this.elements.pdfButton.innerHTML = this.pdfButtonDefaultLabel;
      this.elements.pdfButton.disabled = !this.groupedCategories.length;
    }
  }

  enhanceAccessibility() {
    const cards = this.elements.categoryGrid.querySelectorAll(".category-card");
    cards.forEach((card, index) => {
      const title = card.querySelector(".category-title span")?.textContent?.trim() || `Смета ${index + 1}`;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `Смета ${title}`);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          card.click();
        }
      });
    });
  }

  createLiveRegion() {
    const liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.className = "sr-only";
    document.body.appendChild(liveRegion);
    return liveRegion;
  }

  announce(message) {
    if (!this.liveRegion) return;
    this.liveRegion.textContent = "";
    requestAnimationFrame(() => {
      this.liveRegion.textContent = message;
    });
  }
}
