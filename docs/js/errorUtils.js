// docs/js/errorUtils.js
/**
 * Универсальная функция ретрая для асинхронных операций
 * @param {Function} fn - асинхронная функция, возвращающая Promise
 * @param {Object} options - настройки: retries, delay, backoff
 * @returns {Promise}
 */
export async function retryAsync(fn, options = {}) {
  const {
    retries = 2,
    delay = 700,
    backoff = 1.0,
    onError = null,
  } = options;
  let attempt = 0;
  let currentDelay = delay;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      attempt++;
      if (typeof onError === 'function') onError(err, attempt);
      await new Promise(res => setTimeout(res, currentDelay));
      currentDelay *= backoff > 1.0 ? backoff : 1;
    }
  }
}

/**
 * Универсальная обработка ошибок
 * @param {Error} error
 * @param {string} context
 */
export function handleError(error, context = '') {
  console.error(context || 'Ошибка', error);
  if (window.showToast) {
    window.showToast(`${context ? context + ': ' : ''}Произошла ошибка`, 'error');
  }
}
