import { calculateDelta, normalizeAmount } from "./utils.js";

const MERGED_SMETA_OVERRIDES = {
  "внерегл_ч_1": { key: "внерегламент", title: "внерегламент" },
  "внерегл_ч_2": { key: "внерегламент", title: "внерегламент" },
};

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAY_MS = 700;

function hasMeaningfulAmount(value) {
  const normalized = normalizeAmount(value);
  return normalized !== null && normalized !== 0;
}

function shouldIncludeItem(item) {
  if (!item) {
    return false;
  }
  return hasMeaningfulAmount(item.planned_amount) || hasMeaningfulAmount(item.fact_amount);
}

function resolveCategoryMeta(rawKey, smetaValue) {
  const keyCandidate = (rawKey || "").trim();
  const override = MERGED_SMETA_OVERRIDES[keyCandidate.toLowerCase()];
  if (override) {
    return { ...override };
  }
  const fallbackTitle = (smetaValue || "").trim();
  const resolvedKey = keyCandidate || fallbackTitle || "Прочее";
  const resolvedTitle = fallbackTitle || resolvedKey;
  return { key: resolvedKey, title: resolvedTitle };
}

async function wait(delayMs = DEFAULT_RETRY_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildHttpError(response) {
  const error = new Error("HTTP " + response.status);
  error.retryable = RETRYABLE_STATUS_CODES.has(response.status);
  return error;
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.retryable === false) return false;
  const message = (error.message || "").toLowerCase();
  return (
    error.name === "TypeError" ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection")
  );
}

async function withRetry(requestFn, { retries = 1, delayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableError(error)) {
        break;
      }
      await wait(delayMs);
    }
  }
  throw lastError;
}

export class DataManager {
  constructor(apiUrl, { monthsUrl, visitorTracker } = {}) {
    this.apiUrl = apiUrl;
    this.monthsUrl = monthsUrl || `${apiUrl.replace(/\/$/, "")}/months`;
    this.cache = new Map();
    this.currentData = null;
    this.visitorTracker = visitorTracker || null;
  }

  getCached(monthIso) {
    return this.cache.get(monthIso) || null;
  }

  async fetchData(monthIso, { force = false } = {}) {
    if (!monthIso) {
      throw new Error("Не указан месяц для загрузки данных дашборда");
    }
    if (!force && this.cache.has(monthIso)) {
      return { data: this.cache.get(monthIso), fromCache: true };
    }
    const url = new URL(this.apiUrl, window.location.origin);
    url.searchParams.set("month", monthIso);
    // Добавляем технический параметр, чтобы обойти агрессивные HTTP-кэши
    // (например, на стороне браузера или CDN) и гарантировать получение
    // свежих данных сразу после обновления в источнике.
    url.searchParams.set("_", Date.now().toString());
    const headers = {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(this.visitorTracker ? this.visitorTracker.buildHeaders() : {}),
    };

    const response = await withRetry(
      () =>
        fetch(url.toString(), {
          cache: "no-store",
          headers,
        }).then((res) => {
          if (!res.ok) {
            throw buildHttpError(res);
          }
          return res;
        }),
      { delayMs: DEFAULT_RETRY_DELAY_MS }
    );
    const data = await response.json();
    this.cache.set(monthIso, data);
    return { data, fromCache: false };
  }

  async fetchAvailableMonths() {
    const response = await withRetry(
      () =>
        fetch(this.monthsUrl, {
          cache: "no-store",
          headers: this.visitorTracker ? this.visitorTracker.buildHeaders() : undefined,
        }).then((res) => {
          if (!res.ok) {
            throw buildHttpError(res);
          }
          return res;
        }),
      { delayMs: DEFAULT_RETRY_DELAY_MS }
    );
    const payload = await response.json();
    return Array.isArray(payload?.months) ? payload.months : [];
  }

  setCurrentData(data) {
    this.currentData = data;
  }

  getCurrentData() {
    return this.currentData;
  }

  summarizeItems(items = []) {
    return items.reduce(
      (acc, item) => {
        if (item.planned_amount !== null && item.planned_amount !== undefined) {
          acc.planned += item.planned_amount;
          acc.hasPlanned = true;
        }
        if (item.fact_amount !== null && item.fact_amount !== undefined) {
          acc.fact += item.fact_amount;
          acc.hasFact = true;
        }
        return acc;
      },
      { planned: 0, fact: 0, hasPlanned: false, hasFact: false }
    );
  }

  calculateMetrics(data) {
    if (!data) {
      return null;
    }
    const items = data.items || [];
    const totals = this.summarizeItems(items);
    const summary = data.summary || {};
    const planned = summary.planned_amount ?? (totals.hasPlanned ? totals.planned : null);
    const fact = summary.fact_amount ?? (totals.hasFact ? totals.fact : null);
    const completion = summary.completion_pct ?? (planned ? (fact ?? 0) / planned : null);
    const hasDelta = summary.delta_amount !== null && summary.delta_amount !== undefined;
    const delta = hasDelta
      ? summary.delta_amount
      : planned !== null || fact !== null
        ? (fact ?? 0) - (planned ?? 0)
        : null;
    const dailyRevenue = Array.isArray(summary.daily_revenue)
      ? summary.daily_revenue
          .map((item) => {
            const amount = normalizeAmount(item?.amount ?? item?.fact_total ?? item?.value);
            const date = item?.date || item?.work_date || item?.day;
            if (!date || amount === null) return null;
            return { date, amount };
          })
          .filter(Boolean)
      : [];
    const averageDailyRevenue = normalizeAmount(summary.average_daily_revenue)
      ?? (dailyRevenue.length ? dailyRevenue.reduce((acc, item) => acc + item.amount, 0) / dailyRevenue.length : null);
    return { planned, fact, completion, delta, dailyRevenue, averageDailyRevenue };
  }

  calculateContractMetrics(data) {
    if (!data || !data.summary) {
      return null;
    }
    const summary = data.summary;
    const contractAmount = normalizeAmount(summary.contract_amount);
    const executed = normalizeAmount(summary.contract_executed);
    const completion = summary.contract_completion_pct ?? (contractAmount ? (executed ?? 0) / contractAmount : null);
    return {
      contractAmount,
      executed,
      completion,
    };
  }

  buildCategories(items = []) {
    const map = new Map();
    items.forEach((item) => {
      if (!shouldIncludeItem(item)) {
        return;
      }
      const rawKey = item.category || item.smeta || "";
      const trimmedKey = rawKey ? rawKey.trim() : "";
      if (!trimmedKey) return;
      if (trimmedKey.toLowerCase() === "без категории") return;
      const { key, title } = resolveCategoryMeta(trimmedKey, item.smeta);
      if (!map.has(key)) {
        map.set(key, {
          key,
          title,
          works: [],
          planned: 0,
          fact: 0,
          delta: 0,
        });
      }
      const group = map.get(key);
      if (!group.title && title) {
        group.title = title;
      }
      const isPlanOnly = item.category_plan_only === true;
      if (!isPlanOnly) {
        group.works.push(item);
      }
      const planned = item.planned_amount ?? 0;
      const fact = item.fact_amount ?? 0;
      const delta = calculateDelta(item);
      if (!isNaN(planned)) group.planned += planned;
      if (!isNaN(fact)) group.fact += fact;
      if (!isNaN(delta)) group.delta += delta;
    });
    return Array.from(map.values()).sort((a, b) => {
      const planA = !isNaN(a.planned) ? a.planned : 0;
      const planB = !isNaN(b.planned) ? b.planned : 0;
      if (planA === planB) {
        const titleA = (a.title || "").toLowerCase();
        const titleB = (b.title || "").toLowerCase();
        return titleA.localeCompare(titleB, "ru");
      }
      return planB - planA;
    });
  }
}
