import { normalizeAmount } from "@shared/utils.js";
import { domainStore } from "@js/services/domain-service.js";
import {
  API_URL,
  API_PDF_URL,
  API_MONTHS_URL,
  API_DAYS_URL,
  API_DAILY_URL,
} from "@config/config.frontend.js";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAY_MS = 700;

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

// Экспортируем утилиты, чтобы их можно было переиспользовать в других модулях
// и в будущем в Vite-проекте без дублирования кода.
export { wait, buildHttpError, isRetryableError, withRetry };

export class DataManager {
  constructor(apiUrl = API_URL, { monthsUrl = API_MONTHS_URL, daysUrl = API_DAYS_URL, dailyUrl = API_DAILY_URL, visitorTracker } = {}) {
    this.apiUrl = apiUrl;
    this.monthsUrl = monthsUrl;
    this.daysUrl = daysUrl;
    this.dailyUrl = dailyUrl;
    this.cache = new Map();
    this.dailyCache = new Map();
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

  async fetchAvailableDays() {
    const response = await withRetry(
      () =>
        fetch(this.daysUrl, {
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
    return Array.isArray(payload?.days) ? payload.days : [];
  }

  getCachedDaily(dayIso) {
    return this.dailyCache.get(dayIso) || null;
  }

  async fetchDailyReport(dayIso, { force = false } = {}) {
    if (!dayIso) {
      throw new Error("Не указана дата для загрузки дневного отчёта");
    }
    if (!force && this.dailyCache.has(dayIso)) {
      return { data: this.dailyCache.get(dayIso), fromCache: true };
    }

    const url = new URL(this.dailyUrl, window.location.origin);
    url.searchParams.set("day", dayIso);
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
    this.dailyCache.set(dayIso, data);
    return { data, fromCache: false };
  }

  setCurrentData(data) {
    this.currentData = data;
  }

  getCurrentData() {
    return this.currentData;
  }

  summarizeItems(items = []) {
    return domainStore.summarizeItems(items);
  }

  calculateMetrics(data) {
    return domainStore.calculateMetrics(data);
  }

  calculateContractMetrics(data) {
    return domainStore.calculateContractMetrics(data);
  }

  buildCategories(items = []) {
    return domainStore.buildCategories(items);
  }
}
