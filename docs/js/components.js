import {
  formatMoney,
  formatPercent,
  formatMoneyRub,
  formatDateTime,
  formatDate,
  showToast,
  calculateDelta,
  debounce,
} from "./utils.js";

const CATEGORY_COLORS = [
  { accent: "#22c55e", soft: "rgba(34, 197, 94, 0.25)" },
  { accent: "#2563eb", soft: "rgba(37, 99, 235, 0.25)" },
  { accent: "#f97316", soft: "rgba(249, 115, 22, 0.25)" },
  { accent: "#dc2626", soft: "rgba(220, 38, 38, 0.25)" },
  { accent: "#a855f7", soft: "rgba(168, 85, 247, 0.25)" },
  { accent: "#0f766e", soft: "rgba(15, 118, 110, 0.25)" },
];

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
    this.dailyRevenue = [];
    this.currentSearchTerm = "";
    this.workSort = { column: "planned" };
    this.selectedMonthIso = null;
    this.initialMonth = new URLSearchParams(window.location.search).get("month");
    if (this.elements.workSortSelect) {
      this.elements.workSortSelect.value = this.workSort.column;
    }
    this.debouncedSearch = debounce((value) => {
      this.currentSearchTerm = (value || "").toLowerCase().trim();
      this.renderWorkList();
    }, 300);
    this.handleResize = debounce(() => this.updateWorkNameCollapsers(), 150);
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

  prepareWorkList() {
    this.workHeaderEl = document.createElement("div");
    this.workHeaderEl.className = "work-row work-row-header";
    this.workHeaderEl.innerHTML = `
      <div>Работа</div>
      <div>
        <button type="button" class="work-sort-button" data-sort="planned">
          <span>План, ₽</span>
          <span class="sort-indicator" aria-hidden="true"></span>
          <span class="sr-only">Сортировка по плану (по убыванию)</span>
        </button>
      </div>
      <div>
        <button type="button" class="work-sort-button" data-sort="fact">
          <span>Факт, ₽</span>
          <span class="sort-indicator" aria-hidden="true"></span>
          <span class="sr-only">Сортировка по факту (по убыванию)</span>
        </button>
      </div>
      <div>
        <button type="button" class="work-sort-button" data-sort="delta">
          <span>Отклонение</span>
          <span class="sort-indicator" aria-hidden="true"></span>
          <span class="sr-only">Сортировка по отклонению (по убыванию)</span>
        </button>
      </div>
    `;
    this.workHeaderEl.hidden = true;
    this.elements.workList.appendChild(this.workHeaderEl);

    this.workSortButtons = Array.from(this.workHeaderEl.querySelectorAll(".work-sort-button"));
    this.workSortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const column = button.dataset.sort;
        this.handleWorkSortChange(column);
      });
    });
    this.updateWorkSortButtons();

    this.elements.workListScroller = document.createElement("div");
    this.elements.workListScroller.className = "work-list-scroller";
    this.elements.workList.appendChild(this.elements.workListScroller);
    this.elements.workListScroller.style.display = "none";
  }

  clearWorkRows() {
    if (this.elements.workListScroller) {
      this.elements.workListScroller.innerHTML = "";
    }
  }

  renderWorkRows(works) {
    this.clearWorkRows();
    if (!Array.isArray(works) || !works.length) {
      return;
    }
    const fragment = document.createDocumentFragment();
    works.forEach((item, index) => {
      const row = this.createWorkRow(item, index, works.length);
      if (row) {
        fragment.appendChild(row);
      }
    });
    this.elements.workListScroller.appendChild(fragment);
    requestAnimationFrame(() => this.updateWorkNameCollapsers());
  }

  bindEvents() {
    this.elements.searchInput.addEventListener("input", (event) => {
      this.debouncedSearch(event.target.value || "");
    });
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

  getCurrentMonthIso() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
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

  updateDailyAverageVisibility(monthIso = this.selectedMonthIso) {
    const isCurrentMonth = this.isCurrentMonth(monthIso);
    if (this.elements.dailyAverageNote) {
      this.elements.dailyAverageNote.hidden = !isCurrentMonth;
    }
    if (this.elements.dailyAverageHint) {
      this.elements.dailyAverageHint.hidden = !isCurrentMonth;
    }
    // Показываем иконку (i) только когда выбран текущий календарный месяц
    if (this.elements.workDetailHint) {
      if (isCurrentMonth) {
        this.elements.workDetailHint.style.display = "inline-block";
        this.elements.workDetailHint.setAttribute("aria-hidden", "false");
      } else {
        this.elements.workDetailHint.style.display = "none";
        this.elements.workDetailHint.setAttribute("aria-hidden", "true");
      }
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
    this.dailyRevenue = [];
    this.toggleSkeletons(true);
    this.elements.categoryGrid.innerHTML = "";
    this.elements.lastUpdatedText.textContent = "Загрузка данных…";
    this.updateContractTitleDate("Загрузка данных…");
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
    this.elements.searchInput.disabled = true;
    this.elements.pdfButton.disabled = true;
    this.updateContractCard(null);
  }

  handleLoadError() {
    this.toggleSkeletons(false);
    this.elements.workEmptyState.style.display = "block";
    this.elements.workEmptyState.textContent = "Ошибка загрузки данных";
    this.elements.lastUpdatedText.textContent = "Ошибка загрузки данных";
    this.updateContractTitleDate("Ошибка загрузки данных");
    this.elements.sumPlanned.textContent = "–";
    this.elements.sumFact.textContent = "–";
    this.elements.sumDelta.textContent = "–";
    this.elements.sumDelta.classList.remove("positive", "negative");
    this.dailyRevenue = [];
    this.updateSummaryProgress(null, "–");
    this.updateDailyAverage(null, 0);
    this.updateContractCard(null);
    this.setActiveCategoryTitle("Смета не выбрана");
    this.elements.searchInput.disabled = true;
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
    this.elements.lastUpdatedText.textContent = lastUpdatedLabel;
    this.updateContractTitleDate(lastUpdatedDateLabel);
    const hasAnyData = data.has_data && items.length > 0;
    this.elements.pdfButton.disabled = !hasAnyData;
    this.renderSummary();
    this.renderCategories();
    this.renderWorkList();
    this.renderPrintReport();
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

    if (!metrics) {
      this.elements.sumPlanned.textContent = "–";
      this.elements.sumFact.textContent = "–";
      this.elements.sumDelta.textContent = "–";
      this.elements.sumDelta.classList.remove("positive", "negative");
      this.dailyRevenue = [];
      this.updateSummaryProgress(null, "–");
      this.updateDailyAverage(null, 0);
      return;
    }

    this.dailyRevenue = Array.isArray(metrics.dailyRevenue) ? metrics.dailyRevenue : [];
    this.elements.sumPlanned.textContent = formatMoney(metrics.planned);
    this.elements.sumFact.textContent = formatMoney(metrics.fact);
    this.elements.sumDelta.textContent = formatMoney(metrics.delta);
    this.elements.sumDelta.classList.remove("positive", "negative");
    if (metrics.delta > 0) this.elements.sumDelta.classList.add("positive");
    if (metrics.delta < 0) this.elements.sumDelta.classList.add("negative");

    const completionLabel = metrics.completion !== null && metrics.completion !== undefined
      ? formatPercent(metrics.completion)
      : "–";
    this.updateSummaryProgress(metrics.completion, completionLabel);
    this.updateDailyAverage(metrics.averageDailyRevenue, this.dailyRevenue.length);
  }

  updateSummaryProgress(completion, label) {
    const percent = completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? Math.max(0, completion * 100)
      : 0;
    const progressWidth = Math.min(115, percent);
    const cappedHue = Math.min(120, Math.max(0, percent));
    const progressColor = percent > 100
      ? "#16a34a"
      : `hsl(${cappedHue}, 78%, ${percent >= 50 ? 43 : 47}%)`;

    if (this.elements.sumFactProgress) {
      this.elements.sumFactProgress.style.width = `${progressWidth}%`;
      this.elements.sumFactProgress.classList.toggle("overflow", percent > 100);
      this.elements.sumFactProgress.style.setProperty("--progress-color", progressColor);
    }
    if (this.elements.sumFactProgressLabel) {
      this.elements.sumFactProgressLabel.textContent = label;
    }
  }

  updateContractTitleDate(label) {
    if (!this.elements.contractTitleDate) {
      return;
    }
    this.elements.contractTitleDate.textContent = label ? `на ${label}` : "";
  }

  updateContractCard(contractMetrics) {
    if (!this.elements.contractCard) {
      return;
    }

    const hasData = contractMetrics && contractMetrics.contractAmount !== null && contractMetrics.executed !== null;
    const completion = hasData ? contractMetrics.completion : null;
    const percentLabel = completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? formatPercent(completion)
      : "–";

    if (this.elements.contractAmount) {
      this.elements.contractAmount.textContent = hasData
        ? formatMoney(contractMetrics.contractAmount)
        : "–";
    }
    if (this.elements.contractExecuted) {
      this.elements.contractExecuted.textContent = hasData
        ? formatMoney(contractMetrics.executed)
        : "–";
    }
    if (this.elements.contractPercent) {
      this.elements.contractPercent.textContent = percentLabel;
    }

    this.updateContractProgress(completion);
  }

  updateContractProgress(completion) {
    if (!this.elements.contractProgress) {
      return;
    }
    const percent = completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? Math.max(0, completion * 100)
      : 0;
    const progressWidth = Math.min(115, percent);
    const progressOverflow = percent > 100;
    const progressColor = progressOverflow ? "#16a34a" : "var(--accent)";

    this.elements.contractProgress.style.width = `${progressWidth}%`;
    this.elements.contractProgress.style.setProperty("--progress-color", progressColor);
    this.elements.contractProgress.style.background = progressColor;
    this.elements.contractProgress.classList.toggle("overflow", progressOverflow);
    if (this.elements.contractProgress.parentElement) {
      this.elements.contractProgress.parentElement.setAttribute("aria-valuenow", Math.min(120, percent).toFixed(1));
    }
  }

  updateDailyAverage(averageValue, daysWithData) {
    const hasData = Number.isFinite(daysWithData) && daysWithData > 0;
    const isCurrentMonth = this.isCurrentMonth(this.selectedMonthIso);
    const isInteractive = hasData && isCurrentMonth;

    if (this.elements.sumDailyAverage) {
      this.elements.sumDailyAverage.textContent = averageValue !== null
        && averageValue !== undefined
        && !Number.isNaN(averageValue)
        ? formatMoney(averageValue)
        : "–";
    }

    if (this.elements.dailyAverageCard) {
      this.elements.dailyAverageCard.classList.toggle("is-disabled", !isInteractive);
      this.elements.dailyAverageCard.setAttribute("aria-disabled", String(!isInteractive));

      const srHint = this.elements.dailyAverageCard.querySelector(".sr-only");
      if (srHint) {
        srHint.hidden = !isInteractive;
      }
    }
  }

  openDailyModal() {
    if (
      !this.dailyRevenue.length
      || !this.elements.dailyModal
      || !this.isCurrentMonth(this.selectedMonthIso)
    ) {
      return;
    }
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

    // Добавляем заголовки
    const header = document.createElement("div");
    header.className = "modal-row modal-row-header";
    header.innerHTML = `
      <div class="modal-col-date">Дата</div>
      <div class="modal-col-amount">Объем</div>
      <div class="modal-col-sum">Сумма,₽</div>
    `;
    this.elements.dailyModalList.appendChild(header);

    const fragment = document.createDocumentFragment();
    sorted.forEach((item) => {
      const row = document.createElement("div");
      row.className = "modal-row";
      const dateLabel = formatDate(item.date);
      const amount = Number(item.amount);
      const formattedAmount = Number.isFinite(amount) ? amount.toFixed(1) : "–";
      const unit = item.unit || "";
      const valueText = unit ? `${formattedAmount} (${unit})` : formattedAmount;
      const totalAmount = Number(item.total_amount);
      const formattedTotal = Number.isFinite(totalAmount) ? totalAmount.toLocaleString("ru-RU", {minimumFractionDigits: 0, maximumFractionDigits: 0}) : "–";
      row.innerHTML = `
        <div class="modal-col-date">${dateLabel}</div>
        <div class="modal-col-amount">${valueText}</div>
        <div class="modal-col-sum">${formattedTotal}</div>
      `;
      fragment.appendChild(row);
    });

    this.elements.dailyModalList.appendChild(fragment);
  }

  renderCategories() {
    const currentData = this.dataManager.getCurrentData();
    this.elements.categoryGrid.innerHTML = "";
    if (!this.groupedCategories.length) {
      const emptyText = currentData && !currentData.has_data
        ? "Данные за выбранный месяц отсутствуют"
        : "Нет данных для отображения";
      this.elements.categoryGrid.innerHTML = `<div class="empty-state">${emptyText}</div>`;
      this.activeCategoryKey = null;
      this.renderWorkList();
      return;
    }

    const fragment = document.createDocumentFragment();
    this.groupedCategories.forEach((category, idx) => {
      const palette = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
      const card = document.createElement("button");
      card.type = "button";
      card.className = `category-card${category.key === this.activeCategoryKey ? " active" : ""}`;
      card.style.setProperty("--accent", palette.accent);
      card.style.setProperty("--accent-soft", palette.soft);
      const isOffPlanCategory = typeof category.key === "string" && category.key.toLowerCase() === "внерегламент";
      const deltaClass = category.delta > 0 ? "delta-positive" : category.delta < 0 ? "delta-negative" : "";
      const completion = category.planned ? (category.fact ?? 0) / category.planned : null;
      const hasProgress = completion !== null && !Number.isNaN(completion) && Number.isFinite(completion);
      const completionLabel = hasProgress ? formatPercent(completion) : "–";
      const progressPercent = hasProgress ? Math.max(0, completion * 100) : 0;
      const progressWidth = Math.min(115, progressPercent);
      const progressOverflowClass = progressPercent > 100 ? " overflow" : "";
      const cappedHue = Math.min(120, Math.max(0, progressPercent));
      const progressColor = progressPercent > 100
        ? "#16a34a"
        : `hsl(${cappedHue}, 78%, ${progressPercent >= 50 ? 43 : 47}%)`;
      const progressStyle = `width: ${progressWidth}%; --progress-color: ${progressColor};`;
      const ariaValue = hasProgress ? Math.min(120, progressPercent).toFixed(1) : "0";
      const categoryTitleNote = isOffPlanCategory
        ? '<span class="category-offplan-note"><span>30% от</span><span>общего плана</span></span>'
        : `<span class="category-pill">${category.works.length} работ</span>`;
      card.innerHTML = `
        <div class="category-title">
          <span>${category.title}</span>
          ${categoryTitleNote}
        </div>
        <div class="category-values">
          <span><span class="label">План</span><strong>${formatMoney(category.planned)}</strong></span>
          <span><span class="label">Факт</span><strong>${formatMoney(category.fact)}</strong></span>
          <span><span class="label">Отклонение</span><strong class="category-delta ${deltaClass}">${formatMoney(category.delta)}</strong></span>
        </div>
        <div class="category-progress">
          <div class="category-progress-labels">
            <span>Исполнение плана</span>
            <strong>${completionLabel}</strong>
          </div>
          <div class="category-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="120" aria-valuenow="${ariaValue}">
            <div class="category-progress-fill${progressOverflowClass}" style="${progressStyle}"></div>
          </div>
        </div>
      `;
      card.setAttribute("aria-pressed", category.key === this.activeCategoryKey ? "true" : "false");
      card.addEventListener("click", () => {
        this.activeCategoryKey = category.key;
        this.renderCategories();
        this.renderWorkList();
      });
      fragment.appendChild(card);
    });

    this.elements.categoryGrid.appendChild(fragment);

    this.enhanceAccessibility();
  }

  renderWorkList() {
    const currentData = this.dataManager.getCurrentData();
    const activeCategory = this.groupedCategories.find((cat) => cat.key === this.activeCategoryKey) || null;
    const filter = this.currentSearchTerm ?? "";
    this.elements.searchInput.disabled = !activeCategory;
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

    const works = filter
      ? activeCategory.works.filter((item) => {
          const name = (item.work_name || item.description || "").toLowerCase();
          return name.includes(filter);
        })
      : [...activeCategory.works];

    this.sortWorks(works);

    this.setActiveCategoryTitle(
      `Расшифровка работ по смете «${activeCategory.title}»`,
      activeCategory.title
    );

    if (!works.length) {
      this.elements.workEmptyState.style.display = "block";
      this.elements.workEmptyState.textContent = filter
        ? "Нет работ, подходящих под фильтр"
        : "В этой смете нет строк для отображения";
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
    const nameWrapper = row.querySelector(".work-row-name");
    const toggleBtn = row.querySelector(".work-row-name-toggle");
    if (nameWrapper && toggleBtn) {
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
    if (!this.elements.workListScroller) {
      return;
    }
    const nameWrappers = this.elements.workListScroller.querySelectorAll(".work-row-name");
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

  renderPrintReport() {
    const currentData = this.dataManager.getCurrentData();
    const monthLabel = this.getSelectedMonthLabel() || "–";
    this.elements.printMonth.textContent = monthLabel;
    this.elements.printUpdated.textContent = currentData && currentData.has_data
      ? formatDateTime(currentData.last_updated)
      : "нет данных";
    this.elements.printSubtitle.textContent = currentData && currentData.has_data
      ? "Выгружены все строки со статусом «Рассмотрено»"
      : "Данные по выбранному месяцу отсутствуют";

    this.elements.printBody.innerHTML = "";

    const fragment = document.createDocumentFragment();

    if (!currentData || !this.groupedCategories.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5" style="text-align:center; font-style: italic;">Нет данных для печати</td>';
      fragment.appendChild(row);
      this.elements.printBody.appendChild(fragment);
      this.elements.printTotalPlan.textContent = "–";
      this.elements.printTotalFact.textContent = "–";
      this.elements.printTotalDelta.textContent = "–";
      this.elements.printTotalDelta.classList.remove("delta-positive", "delta-negative");
      return;
    }

    let totalPlan = 0;
    let totalFact = 0;
    let totalDelta = 0;

    this.groupedCategories.forEach((category) => {
      const catDelta = category.delta ?? (category.fact - category.planned);
      const catRow = document.createElement("tr");
      const deltaClass = catDelta > 0 ? "delta-positive" : catDelta < 0 ? "delta-negative" : "";
      catRow.className = "print-smeta-summary";
      catRow.innerHTML = `
        <td>${category.title}</td>
        <td>Итого по смете</td>
        <td class="num">${formatMoneyRub(category.planned)}</td>
        <td class="num">${formatMoneyRub(category.fact)}</td>
        <td class="num ${deltaClass}">${formatMoneyRub(catDelta)}</td>
      `;
      fragment.appendChild(catRow);

      category.works.forEach((item) => {
        const delta = calculateDelta(item);
        const deltaClassWork = delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : "";
        const workRow = document.createElement("tr");
        workRow.innerHTML = `
          <td></td>
          <td>${item.work_name || item.description || "Без названия"}</td>
          <td class="num">${formatMoneyRub(item.planned_amount)}</td>
          <td class="num">${formatMoneyRub(item.fact_amount)}</td>
          <td class="num ${deltaClassWork}">${formatMoneyRub(delta)}</td>
        `;
        fragment.appendChild(workRow);
      });

      totalPlan += category.planned ?? 0;
      totalFact += category.fact ?? 0;
      totalDelta += catDelta ?? 0;
    });

    this.elements.printBody.appendChild(fragment);

    this.elements.printTotalPlan.textContent = formatMoneyRub(totalPlan);
    this.elements.printTotalFact.textContent = formatMoneyRub(totalFact);
    this.elements.printTotalDelta.textContent = formatMoneyRub(totalDelta);
    this.elements.printTotalDelta.classList.remove("delta-positive", "delta-negative");
    if (totalDelta > 0) this.elements.printTotalDelta.classList.add("delta-positive");
    if (totalDelta < 0) this.elements.printTotalDelta.classList.add("delta-negative");
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
