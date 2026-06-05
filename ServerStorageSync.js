/* ServerStorageSync.js
 * Sync allowed POS data keys between localStorage and the SwiftTill server.
 * Copied from SwiftTill/resources/app to enable website demo to sync with
 * the local Express server at http://localhost:3000.
 */
(function () {
  const SYNC_KEYS = new Set([
    "products",
    "orders",
    "customers",
    "purchases",
    "suppliers",
    "returns",
    "sales",
    "heldSales",
    "creditSales",
    "settings",
    "pos_users",
    "dailySummaries",
  ]);

  const SERVER_API_BASE = (() => {
    const DEFAULT_SERVER_URL = "http://localhost:3000";
    if (typeof process !== "undefined" && process.env.SERVER_URL) {
      return process.env.SERVER_URL.replace(/\/$/, "");
    }
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.origin
    ) {
      const origin = window.location.origin.replace(/\/$/, "");
      if (origin && origin !== "null") {
        if (
          origin.startsWith("http://localhost:5500") ||
          origin.startsWith("http://127.0.0.1:5500") ||
          origin.startsWith("file://")
        ) {
          return DEFAULT_SERVER_URL;
        }
        return origin;
      }
    }
    return DEFAULT_SERVER_URL;
  })();

  const defaultFetchOptions = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  function createAbortSignal(timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timer),
    };
  }

  function parseValue(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  function serializeValue(value) {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  async function safeFetch(url, options = {}) {
    const { signal, clear } = createAbortSignal(options.timeout || 20000);
    try {
      const response = await fetch(url, { ...options, signal });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server responded ${response.status}: ${text}`);
      }
      return response.json();
    } finally {
      clear();
    }
  }

  async function fetchServerData() {
    try {
      return await safeFetch(`${SERVER_API_BASE}/api/data`, {
        method: "GET",
        ...defaultFetchOptions,
      });
    } catch (error) {
      console.warn(
        "[ServerStorageSync] Failed to fetch server data:",
        error.message,
      );
      return null;
    }
  }

  async function saveKeyToServer(key, value) {
    if (!SYNC_KEYS.has(key)) return null;
    const body = { value };
    try {
      return await safeFetch(
        `${SERVER_API_BASE}/api/data/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
          ...defaultFetchOptions,
        },
      );
    } catch (error) {
      console.warn(
        `[ServerStorageSync] Failed to save ${key} to server:`,
        error.message,
      );
      return null;
    }
  }

  let suppressLocalStorageSync = false;

  async function initLocalStorageSync() {
    const serverData = await fetchServerData();
    if (!serverData) return;

    suppressLocalStorageSync = true;
    try {
      Object.keys(serverData).forEach((key) => {
        if (!SYNC_KEYS.has(key)) return;
        const record = serverData[key];
        if (!record || record.value === null || record.value === undefined)
          return;

        const currentValue = localStorage.getItem(key);
        const serverValue =
          typeof record.value === "string"
            ? record.value
            : JSON.stringify(record.value);
        if (
          currentValue === null ||
          currentValue === "" ||
          currentValue !== serverValue
        ) {
          localStorage.setItem(key, serverValue);
        }
      });
    } finally {
      suppressLocalStorageSync = false;
    }
  }

  function patchLocalStorage() {
    if (!window.localStorage) return;

    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const originalRemoveItem = window.localStorage.removeItem.bind(
      window.localStorage,
    );
    const originalClear = window.localStorage.clear.bind(window.localStorage);

    window.localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (suppressLocalStorageSync) return;
      if (SYNC_KEYS.has(key)) {
        const parsedValue = parseValue(value);
        saveKeyToServer(key, parsedValue).catch(() => {
          // ignore server sync failures to avoid breaking UI.
        });
      }
    };

    window.localStorage.removeItem = function (key) {
      originalRemoveItem(key);
      if (suppressLocalStorageSync) return;
      if (SYNC_KEYS.has(key)) {
        saveKeyToServer(key, null).catch(() => {
          // ignore server sync failures.
        });
      }
    };

    window.localStorage.clear = function () {
      const keysToSync = [];
      SYNC_KEYS.forEach((key) => {
        if (localStorage.getItem(key) !== null) {
          keysToSync.push(key);
        }
      });
      originalClear();
      if (suppressLocalStorageSync) return;
      keysToSync.forEach((key) => {
        saveKeyToServer(key, null).catch(() => {
          // ignore server sync failures.
        });
      });
    };
  }

  function syncKeyFromServer(key) {
    if (!SYNC_KEYS.has(key)) return Promise.resolve(null);
    return safeFetch(`${SERVER_API_BASE}/api/data/${encodeURIComponent(key)}`, {
      method: "GET",
      ...defaultFetchOptions,
    })
      .then((data) => {
        if (!data || data.value === null || data.value === undefined)
          return null;
        suppressLocalStorageSync = true;
        try {
          localStorage.setItem(key, serializeValue(data.value));
        } finally {
          suppressLocalStorageSync = false;
        }
        return data.value;
      })
      .catch((error) => {
        console.warn(
          `[ServerStorageSync] Failed to sync key ${key}:`,
          error.message,
        );
        return null;
      });
  }

  function syncAllLocalStorageToServer() {
    const promises = [];
    SYNC_KEYS.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const value = parseValue(raw);
      promises.push(saveKeyToServer(key, value));
    });
    return Promise.all(promises);
  }

  window.ServerStorageSync = {
    syncKeys: SYNC_KEYS,
    baseUrl: SERVER_API_BASE,
    init: async function () {
      patchLocalStorage();
      await initLocalStorageSync();
      this.ready = true;
      return true;
    },
    syncKey: syncKeyFromServer,
    saveKey: saveKeyToServer,
    syncAll: syncAllLocalStorageToServer,
    fetchServerData,
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      window.ServerStorageSync.init().catch(() => {});
    });
  } else {
    window.ServerStorageSync.init().catch(() => {});
  }
})();
