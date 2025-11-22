import { formatMoney, formatPercent } from "@js/utils.js";

const PROGRESS_MAX_WIDTH = 115;
const PROGRESS_MAX_ARIA = 120;
const PROGRESS_OVERFLOW_COLOR = "#16a34a";
const PROGRESS_BASE_ACCENT = "var(--accent)";
const PROGRESS_SATURATION = 78;
const PROGRESS_LIGHT_HIGH = 43;
const PROGRESS_LIGHT_LOW = 47;

export function renderSummary({ metrics, elements }) {
  if (!metrics) {
    if (elements.sumPlanned) elements.sumPlanned.textContent = "–";
    if (elements.sumFact) elements.sumFact.textContent = "–";
    if (elements.sumDelta) {
      elements.sumDelta.textContent = "–";
      elements.sumDelta.classList.remove("positive", "negative");
    }
    return {
      dailyRevenue: [],
      averageDailyRevenue: null,
    };
  }

  const summaryDailyRevenue = Array.isArray(metrics.dailyRevenue)
    ? metrics.dailyRevenue
    : [];

  if (elements.sumPlanned) elements.sumPlanned.textContent = formatMoney(metrics.planned);
  if (elements.sumFact) elements.sumFact.textContent = formatMoney(metrics.fact);
  if (elements.sumDelta) {
    elements.sumDelta.textContent = formatMoney(metrics.delta);
    elements.sumDelta.classList.remove("positive", "negative");
    if (metrics.delta > 0) elements.sumDelta.classList.add("positive");
    if (metrics.delta < 0) elements.sumDelta.classList.add("negative");
  }

  const completionLabel =
    metrics.completion !== null && metrics.completion !== undefined
      ? formatPercent(metrics.completion)
      : "–";

  return {
    summaryDailyRevenue,
    averageDailyRevenue: metrics.averageDailyRevenue,
    completion: metrics.completion,
    completionLabel,
  };
}

export function updateSummaryProgress({ completion, label, elements }) {
  const percent =
    completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? Math.max(0, completion * 100)
      : 0;
  const progressWidth = Math.min(PROGRESS_MAX_WIDTH, percent);
  const cappedHue = Math.min(PROGRESS_MAX_ARIA, Math.max(0, percent));
  const progressColor = percent > 100
    ? PROGRESS_OVERFLOW_COLOR
    : `hsl(${cappedHue}, ${PROGRESS_SATURATION}%, ${percent >= 50 ? PROGRESS_LIGHT_HIGH : PROGRESS_LIGHT_LOW}%)`;

  if (elements.sumFactProgress) {
    elements.sumFactProgress.style.width = `${progressWidth}%`;
    elements.sumFactProgress.classList.toggle("overflow", percent > 100);
    elements.sumFactProgress.style.setProperty("--progress-color", progressColor);
  }
  if (elements.sumFactProgressLabel) {
    elements.sumFactProgressLabel.textContent = label;
  }
}

export function updateDailyAverage({ averageValue, daysWithData, isCurrentMonth, elements }) {
  const hasData = Number.isFinite(daysWithData) && daysWithData > 0;
  const isInteractive = hasData && isCurrentMonth;

  if (elements.sumDailyAverage) {
    elements.sumDailyAverage.textContent =
      averageValue !== null && averageValue !== undefined && !Number.isNaN(averageValue)
        ? formatMoney(averageValue)
        : "–";
  }

  if (elements.dailyAverageCard) {
    elements.dailyAverageCard.classList.toggle("is-disabled", !isInteractive);
    elements.dailyAverageCard.setAttribute("aria-disabled", String(!isInteractive));

    const srHint = elements.dailyAverageCard.querySelector(".sr-only");
    if (srHint) {
      srHint.hidden = !isInteractive;
    }
  }
}

export function updateContractCard({ contractMetrics, elements, formatMoneyFn = formatMoney, formatPercentFn = formatPercent }) {
  if (!elements.contractCard) {
    return;
  }

  const hasData =
    contractMetrics &&
    contractMetrics.contractAmount !== null &&
    contractMetrics.executed !== null;
  const completion = hasData ? contractMetrics.completion : null;
  const percentLabel =
    completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? formatPercentFn(completion)
      : "–";

  if (elements.contractAmount) {
    elements.contractAmount.textContent = hasData
      ? formatMoneyFn(contractMetrics.contractAmount)
      : "–";
  }
  if (elements.contractExecuted) {
    elements.contractExecuted.textContent = hasData
      ? formatMoneyFn(contractMetrics.executed)
      : "–";
  }
  if (elements.contractPercent) {
    elements.contractPercent.textContent = percentLabel;
  }

  updateContractProgress({ completion, elements });
}

export function updateContractProgress({ completion, elements }) {
  if (!elements.contractProgress) {
    return;
  }
  const percent =
    completion !== null && completion !== undefined && !Number.isNaN(completion)
      ? Math.max(0, completion * 100)
      : 0;
  const progressWidth = Math.min(PROGRESS_MAX_WIDTH, percent);
  const progressOverflow = percent > 100;
  const progressColor = progressOverflow ? PROGRESS_OVERFLOW_COLOR : PROGRESS_BASE_ACCENT;

  elements.contractProgress.style.width = `${progressWidth}%`;
  elements.contractProgress.style.setProperty("--progress-color", progressColor);
  elements.contractProgress.style.background = progressColor;
  elements.contractProgress.classList.toggle("overflow", progressOverflow);
  if (elements.contractProgress.parentElement) {
    elements.contractProgress.parentElement.setAttribute(
      "aria-valuenow",
      Math.min(PROGRESS_MAX_ARIA, percent).toFixed(1),
    );
  }
}
