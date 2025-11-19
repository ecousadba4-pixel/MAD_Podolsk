export function cacheDomElements(selectorMap) {
  return Object.fromEntries(
    Object.entries(selectorMap).map(([key, selector]) => [
      key,
      document.querySelector(selector),
    ])
  );
}

export function formatMoney(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export function formatMoneyRub(value) {
  const base = formatMoney(value);
  return base === "–" ? base : `${base}\u00a0₽`;
}

export function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return (value * 100).toFixed(1) + " %";
}

export function formatVolume(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU");
}

export function formatDate(value, options = { day: "2-digit", month: "long" }) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", options);
}

export function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function calculateDelta(item) {
  if (item.delta_amount !== null && item.delta_amount !== undefined) {
    return item.delta_amount;
  }
  const planned = item.planned_amount ?? 0;
  const fact = item.fact_amount ?? 0;
  return fact - planned;
}

export function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function normalizeAmount(value) {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function setElementsDisabled(elements, disabled = true) {
  Object.values(elements).forEach(el => {
    if (el && typeof el.disabled === "boolean") {
      el.disabled = disabled;
    }
  });
}
