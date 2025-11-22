import { formatMoney, calculateDelta } from "@js/utils.js";

export function initializeWorkList({ container, onSortChange, onWorkClick }) {
  const headerEl = document.createElement("div");
  headerEl.className = "work-row work-row-header";
  headerEl.innerHTML = `
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
  headerEl.hidden = true;
  container.appendChild(headerEl);

  const scroller = document.createElement("div");
  scroller.className = "work-list-scroller";
  scroller.style.display = "none";
  container.appendChild(scroller);

  const sortButtons = Array.from(headerEl.querySelectorAll(".work-sort-button"));
  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const column = button.dataset.sort;
      if (onSortChange) onSortChange(column);
    });
  });

  return { headerEl, scroller, sortButtons };
}

export function renderWorkRows({
  scroller,
  works,
  onWorkClick,
  initializeNameToggle,
  calculateDeltaFn = calculateDelta,
}) {
  if (!scroller) return;
  scroller.innerHTML = "";
  if (!Array.isArray(works) || !works.length) return;
  const fragment = document.createDocumentFragment();
  works.forEach((item, index) => {
    const row = createWorkRow(item, index, works.length, calculateDeltaFn, onWorkClick, initializeNameToggle);
    if (row) fragment.appendChild(row);
  });
  scroller.appendChild(fragment);
}

function createWorkRow(item, index, total, calculateDeltaFn, onWorkClick, initializeNameToggle) {
  const workName = item.work_name || item.description || "Без названия";
  const delta = calculateDeltaFn(item);
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

  if (initializeNameToggle) {
    initializeNameToggle(row.querySelector(".work-row-name"));
  }

  row.addEventListener("click", (event) => {
    if (event.target.closest(".work-row-name-toggle")) return;
    if (onWorkClick) onWorkClick(item, event);
  });

  return row;
}
