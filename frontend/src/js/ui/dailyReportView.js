import { formatDate, formatNumber, formatMoneyRub } from "@js/utils.js";

export function applyDailyDataView({ data, elements, onAfterRender }) {
  if (elements.dailySkeleton) {
    elements.dailySkeleton.style.display = "none";
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    if (elements.dailyEmptyState) {
      elements.dailyEmptyState.style.display = "block";
      elements.dailyEmptyState.textContent = "Нет данных по выбранному дню";
    }
    if (elements.dailyTable) {
      elements.dailyTable.style.display = "none";
    }
  } else if (elements.dailyEmptyState) {
    elements.dailyEmptyState.style.display = "none";
  }

  if (elements.dailyPanelTitle) {
    const selectedDayLabel = formatDate(data?.date, { day: "2-digit", month: "long" });
    elements.dailyPanelTitle.textContent = selectedDayLabel
      ? `Данные за ${selectedDayLabel}`
      : "Данные за выбранный день";
  }

  if (elements.dailyPanelSubtitle) {
    const selectedDayLabel = formatDate(data?.date, { day: "2-digit", month: "long" });
    const subtitleText = selectedDayLabel
      ? "Данные доступны только для текущего месяца"
      : "Выберите день, чтобы увидеть данные";
    elements.dailyPanelSubtitle.textContent = subtitleText;
    elements.dailyPanelSubtitle.hidden = false;
  }

  renderDailyTableView(items, elements);

  if (onAfterRender) onAfterRender();
}

export function renderDailyTableView(items, elements) {
  if (!elements.dailyTable) return;
  const { dailyTable, dailyEmptyState } = elements;
  dailyTable.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    if (dailyEmptyState) {
      dailyEmptyState.textContent = "Нет данных по выбранному дню";
      dailyEmptyState.style.display = "block";
    }
    dailyTable.style.display = "none";
    return;
  }

  const sortedItems = [...items].sort((a, b) => {
    const amountA = Number.isFinite(Number(a?.total_amount)) ? Number(a.total_amount) : 0;
    const amountB = Number.isFinite(Number(b?.total_amount)) ? Number(b.total_amount) : 0;
    return amountB - amountA;
  });

  dailyTable.style.display = "block";
  dailyTable.classList.add("has-data");

  const header = document.createElement("div");
  header.className = "work-row work-row-header";
  header.innerHTML = `
      <div>Смета</div>
      <div>Работы</div>
      <div>Ед. изм.</div>
      <div>Объём</div>
      <div>Сумма, ₽</div>
    `;

  const fragment = document.createDocumentFragment();
  fragment.appendChild(header);

  sortedItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "work-row daily-row";
    if (index === sortedItems.length - 1) {
      row.classList.add("work-row-last");
    }
    row.innerHTML = `
        <div class="daily-cell daily-cell-smeta">${item.smeta || "—"}</div>
        <div class="daily-cell daily-cell-name">
          <div class="work-row-name work-row-name--collapsed" data-expanded="false">
            <span class="work-row-name-text">${item.description || "Без названия"}</span>
            <button
              type="button"
              class="work-row-name-toggle"
              aria-expanded="false"
              aria-label="Развернуть полное название"
            >
              <span class="work-row-name-toggle-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="daily-cell daily-cell-unit">
          <span class="daily-cell-label">Ед. изм.</span>
          <span class="daily-cell-value">${item.unit || "—"}</span>
        </div>
        <div class="daily-cell daily-cell-volume">
          <span class="daily-cell-label">Объём</span>
          <span class="daily-cell-value"><strong>${formatNumber(item.total_volume, { maximumFractionDigits: 3 })}</strong></span>
        </div>
        <div class="daily-cell daily-cell-amount">
          <span class="daily-cell-label">Сумма</span>
          <span class="daily-cell-value"><strong>${formatMoneyRub(item.total_amount)}</strong></span>
        </div>
      `;
    fragment.appendChild(row);
  });

  const totalAmount = sortedItems.reduce((sum, item) => {
    const amount = Number(item.total_amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const totalRow = document.createElement("div");
  totalRow.className = "work-row work-row-total daily-total-row";
  totalRow.innerHTML = `
      <div class="daily-cell daily-cell-total-label">Итого по сумме</div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-amount"><strong>${formatMoneyRub(totalAmount)}</strong></div>
    `;
  fragment.appendChild(totalRow);

  dailyTable.appendChild(fragment);
}
