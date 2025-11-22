import { formatMoney, formatPercent } from "@js/utils.js";

const PROGRESS_MAX_WIDTH = 115;
const PROGRESS_MAX_ARIA = 120;
const PROGRESS_OVERFLOW_COLOR = "#16a34a";
const PROGRESS_SATURATION = 78;
const PROGRESS_LIGHT_HIGH = 43;
const PROGRESS_LIGHT_LOW = 47;

export function renderCategories({
  groupedCategories,
  activeCategoryKey,
  elements,
  colors,
  onSelect,
}) {
  const currentData = null; // UIManager при необходимости сам решает, что показывать при пустых данных
  elements.categoryGrid.innerHTML = "";

  if (!groupedCategories.length) {
    const emptyText = currentData && !currentData.has_data
      ? "Данные за выбранный месяц отсутствуют"
      : "Нет данных для отображения";
    elements.categoryGrid.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    if (onSelect) onSelect(null);
    return;
  }

  const fragment = document.createDocumentFragment();
  groupedCategories.forEach((category, idx) => {
    const palette = colors[idx % colors.length];
    const card = document.createElement("button");
    card.type = "button";
    card.className = `card card--interactive category-card${
      category.key === activeCategoryKey ? " active" : ""
    }`;
    card.style.setProperty("--accent", palette.accent);
    card.style.setProperty("--accent-soft", palette.soft);
    const isOffPlanCategory =
      typeof category.key === "string" && category.key.toLowerCase() === "внерегламент";
    const deltaClass = category.delta > 0 ? "delta-positive" : category.delta < 0 ? "delta-negative" : "";
    const completion = category.planned ? (category.fact ?? 0) / category.planned : null;
    const hasProgress =
      completion !== null && !Number.isNaN(completion) && Number.isFinite(completion);
    const completionLabel = hasProgress ? formatPercent(completion) : "–";
    const progressPercent = hasProgress ? Math.max(0, completion * 100) : 0;
    const progressWidth = Math.min(PROGRESS_MAX_WIDTH, progressPercent);
    const progressOverflowClass = progressPercent > 100 ? " overflow" : "";
    const cappedHue = Math.min(PROGRESS_MAX_ARIA, Math.max(0, progressPercent));
    const progressColor =
      progressPercent > 100
        ? PROGRESS_OVERFLOW_COLOR
        : `hsl(${cappedHue}, ${PROGRESS_SATURATION}%, ${
            progressPercent >= 50 ? PROGRESS_LIGHT_HIGH : PROGRESS_LIGHT_LOW
          }%)`;
    const progressStyle = `width: ${progressWidth}%; --progress-color: ${progressColor};`;
    const ariaValue = hasProgress ? Math.min(PROGRESS_MAX_ARIA, progressPercent).toFixed(1) : "0";
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
    card.setAttribute("aria-pressed", category.key === activeCategoryKey ? "true" : "false");
    card.addEventListener("click", () => {
      if (onSelect) onSelect(category.key);
    });
    fragment.appendChild(card);
  });

  elements.categoryGrid.appendChild(fragment);
}
