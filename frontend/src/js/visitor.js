import { normalizeAmount } from "@js/utils.js";

function generateUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const randomPart = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return (
    randomPart() + randomPart() + "-" + randomPart() + "-" + randomPart() + "-" + randomPart() + "-" + randomPart() + randomPart() + randomPart()
  );
}

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch (error) {
    console.warn("Не удалось прочитать из хранилища", key, error);
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (error) {
    console.warn("Не удалось сохранить в хранилище", key, error);
  }
}

function persistCookie(name, value, { days = 365 } = {}) {
  try {
    const maxAge = Math.max(1, Math.floor(days * 24 * 60 * 60));
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
  } catch (error) {
    console.warn("Не удалось сохранить cookie", name, error);
  }
}

// Экспорт низкоуровневых утилит, которые могут пригодиться и в других модулях
// (например, при расширении трекинга или логике аутентификации).
export { generateUuid, safeGet, safeSet, persistCookie };

export class VisitorTracker {
  constructor({
    userKey = "mad_user_id",
    sessionKey = "mad_session_id",
    sessionStartedAtKey = "mad_session_started_at",
    visitLoggedKey = "mad_visit_logged",
  } = {}) {
    this.userKey = userKey;
    this.sessionKey = sessionKey;
    this.sessionStartedAtKey = sessionStartedAtKey;
    this.visitLoggedKey = visitLoggedKey;

    this.userId = this.restoreUserId();
    this.sessionId = this.restoreSessionId();
    this.sessionStartedAt = this.restoreSessionStart();
    this.visitLogged = this.restoreVisitLogged();
  }

  restoreUserId() {
    const fromStorage = safeGet(localStorage, this.userKey) || this.getCookieValue(this.userKey);
    const userId = (fromStorage || generateUuid()).trim();
    safeSet(localStorage, this.userKey, userId);
    persistCookie(this.userKey, userId, { days: 365 });
    return userId;
  }

  restoreSessionId() {
    const fromStorage = safeGet(sessionStorage, this.sessionKey) || this.getCookieValue(this.sessionKey);
    const sessionId = (fromStorage || generateUuid()).trim();
    safeSet(sessionStorage, this.sessionKey, sessionId);
    persistCookie(this.sessionKey, sessionId, { days: 1 });
    return sessionId;
  }

  restoreSessionStart() {
    const stored = normalizeAmount(safeGet(sessionStorage, this.sessionStartedAtKey));
    const startedAt = stored ?? Date.now();
    safeSet(sessionStorage, this.sessionStartedAtKey, String(startedAt));
    return startedAt;
  }

  restoreVisitLogged() {
    const stored = safeGet(sessionStorage, this.visitLoggedKey);
    return stored === "1";
  }

  getCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  getSessionDurationSec() {
    const diffMs = Date.now() - this.sessionStartedAt;
    return diffMs > 0 ? Math.round(diffMs / 1000) : 0;
  }

  buildHeaders() {
    const headers = {};
    if (this.userId) headers["X-User-Id"] = this.userId;
    if (this.sessionId) headers["X-Session-Id"] = this.sessionId;
    const durationSec = this.getSessionDurationSec();
    if (Number.isFinite(durationSec)) {
      headers["X-Session-Duration-Sec"] = String(durationSec);
    }
    return headers;
  }

  markVisitLogged() {
    this.visitLogged = true;
    safeSet(sessionStorage, this.visitLoggedKey, "1");
  }

  async sendVisitLog({ apiBase, endpoint }) {
    if (!apiBase || !endpoint || this.visitLogged) {
      return;
    }

    const payload = {
      endpoint,
      user_id: this.userId,
      session_id: this.sessionId,
      session_duration_sec: this.getSessionDurationSec(),
    };

    try {
      const base = (apiBase || "").replace(/\/$/, "") || "/api";
      await fetch(`${base}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      this.markVisitLogged();
    } catch (error) {
      console.warn("Не удалось отправить статистику визита", error);
    }
  }
}
