export function cacheDomElements(selectorMap) {
  const result = {};
  Object.entries(selectorMap).forEach(([key, selector]) => {
    result[key] = document.querySelector(selector);
  });
  return result;
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

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU");
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
  return function debounced(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
