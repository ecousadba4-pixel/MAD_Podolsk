import {
  formatMoney,
  formatPercent,
  formatMoneyRub,
  formatDateTime,
  showToast,
  calculateDelta,
  getWorkSortValue,
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
  constructor({ dataManager, elements, apiPdfUrl, pdfButtonDefaultLabel }) {
    this.dataManager = dataManager;
    this.elements = elements;
    this.apiPdfUrl = apiPdfUrl;
    this.pdfButtonDefaultLabel = pdfButtonDefaultLabel;
    this.groupedCategories = [];
    this.activeCategoryKey = null;
    this.workHeaderEl = null;
    this.liveRegion = null;
    this.currentSearchTerm = "";
    this.debouncedSearch = debounce((value) => {
      this.currentSearchTerm = (value || "").toLowerCase().trim();
      this.renderWorkList();
    }, 300);
  }

  init() {
    this.prepareWorkList();
    this.liveRegion = this.createLiveRegion();
    this.bindEvents();
    this.initMonthSelect();
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
      <div>План, ₽</div>
      <div>Факт, ₽</div>
      <div>Отклонение</div>
    `;
    this.workHeaderEl.hidden = true;
    this.elements.workList.appendChild(this.workHeaderEl);

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
  }

  bindEvents() {
    this.elements.searchInput.addEventListener("input", (event) => {
      this.debouncedSearch(event.target.value || "");
    });
    this.elements.pdfButton.addEventListener("click", (event) => this.downloadPdfReport(event));
  }

  initMonthSelect() {
    const now = new Date();
    const months = [];
    const formatMonthIso = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      return `${year}-${month}-01`;
    };

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        iso: formatMonthIso(d),
        label: d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }),
      });
    }

    months.forEach((monthInfo, index) => {
      const option = document.createElement("option");
      option.value = monthInfo.iso;
      option.textContent = monthInfo.label;
      if (index === 0) {
        option.selected = true;
      }
      this.elements.monthSelect.appendChild(option);
    });

    this.elements.monthSelect.addEventListener("change", () => {
      this.loadMonthData(this.elements.monthSelect.value);
    });

    if (months.length) {
      this.loadMonthData(months[0].iso);
    }
  }

  async loadMonthData(monthIso) {
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
    this.toggleSkeletons(true);
    this.elements.categoryGrid.innerHTML = "";
    this.elements.lastUpdatedText.textContent = "Загрузка данных…";
    this.elements.sumPlanned.textContent = "…";
    this.elements.sumFact.textContent = "…";
    this.elements.sumComplete.textContent = "…";
    this.elements.sumDelta.textContent = "…";
    this.elements.activeCategoryTitle.textContent = "Загрузка...";
    this.elements.workEmptyState.style.display = "none";
    this.elements.workList.classList.remove("has-data");
    this.workHeaderEl.hidden = true;
    this.elements.workListScroller.style.display = "none";
    this.clearWorkRows();
    this.elements.searchInput.disabled = true;
    this.elements.pdfButton.disabled = true;
  }

  handleLoadError() {
    this.toggleSkeletons(false);
    this.elements.workEmptyState.style.display = "block";
    this.elements.workEmptyState.textContent = "Ошибка загрузки данных";
    this.elements.lastUpdatedText.textContent = "Ошибка загрузки данных";
    this.elements.sumPlanned.textContent = "–";
    this.elements.sumFact.textContent = "–";
    this.elements.sumComplete.textContent = "–";
    this.elements.sumDelta.textContent = "–";
    this.elements.sumDelta.classList.remove("positive", "negative");
    this.elements.activeCategoryTitle.textContent = "Смета не выбрана";
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
    this.elements.lastUpdatedText.textContent = data.has_data
      ? formatDateTime(data.last_updated)
      : "Нет данных";
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
    const metrics = this.dataManager.calculateMetrics(this.dataManager.getCurrentData());
    if (!metrics) {
      this.elements.sumPlanned.textContent = "–";
      this.elements.sumFact.textContent = "–";
      this.elements.sumComplete.textContent = "–";
      this.elements.sumDelta.textContent = "–";
      this.elements.sumDelta.classList.remove("positive", "negative");
      return;
    }
    this.elements.sumPlanned.textContent = formatMoney(metrics.planned);
    this.elements.sumFact.textContent = formatMoney(metrics.fact);
    this.elements.sumComplete.textContent = formatPercent(metrics.completion);
    this.elements.sumDelta.textContent = formatMoney(metrics.delta);
    this.elements.sumDelta.classList.remove("positive", "negative");
    if (metrics.delta > 0) this.elements.sumDelta.classList.add("positive");
    if (metrics.delta < 0) this.elements.sumDelta.classList.add("negative");
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
      const deltaClass = category.delta > 0 ? "delta-positive" : category.delta < 0 ? "delta-negative" : "";
      card.innerHTML = `
        <div class="category-title">
          <span>${category.title}</span>
          <span class="category-pill">${category.works.length} работ</span>
        </div>
        <div class="category-values">
          <span><span class="label">План</span><strong>${formatMoney(category.planned)}</strong></span>
          <span><span class="label">Факт</span><strong>${formatMoney(category.fact)}</strong></span>
          <span><span class="label">Отклонение</span><strong class="category-delta ${deltaClass}">${formatMoney(category.delta)}</strong></span>
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

    if (!activeCategory) {
      this.elements.workEmptyState.style.display = "block";
      this.elements.workEmptyState.textContent = currentData && !currentData.has_data
        ? "Данные за выбранный месяц отсутствуют"
        : "Здесь появится список работ выбранной сметы.";
      this.elements.activeCategoryTitle.textContent = "Смета не выбрана";
      this.elements.workList.classList.remove("has-data");
      this.workHeaderEl.hidden = true;
      this.elements.workListScroller.style.display = "none";
      this.clearWorkRows();
      return;
    }

    const works = (filter
      ? activeCategory.works.filter((item) => {
          const name = (item.work_name || item.description || "").toLowerCase();
          return name.includes(filter);
        })
      : [...activeCategory.works]
    ).sort((a, b) => getWorkSortValue(b) - getWorkSortValue(a));

    this.elements.activeCategoryTitle.textContent = `Расшифровка работ по смете «${activeCategory.title}»`;

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

  createWorkRow(item, index, total) {
    const workName = item.work_name || item.description || "Без названия";
    const delta = calculateDelta(item);
    const deltaClass = delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : "";
    const arrow = delta < 0 ? "▼" : delta > 0 ? "▲" : "●";
    const row = document.createElement("div");
    row.className = "work-row";
    if (index === total - 1) {
      row.classList.add("work-row-last");
    }
    row.innerHTML = `
      <div class="work-row-name">${workName}</div>
      <div class="work-row-money work-row-plan">
        <span class="work-row-label">План</span>
        <span>${formatMoneyRub(item.planned_amount)}</span>
      </div>
      <div class="work-row-money work-row-fact">
        <span class="work-row-label">Факт</span>
        <span>${formatMoneyRub(item.fact_amount)}</span>
      </div>
      <div class="work-row-delta ${deltaClass}">
        <span class="work-row-label">Отклонение</span>
        <span class="work-row-delta-value">${arrow} ${formatMoneyRub(delta)}</span>
      </div>
    `;
    return row;
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
        headers: { Accept: "application/pdf" },
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
