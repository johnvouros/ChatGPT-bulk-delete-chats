(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GPTBDLibraryUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CACHE_PREFIX = "gptbd-library-cache-v1";

  function createState() {
    return {
      files: [],
      selectedIds: new Set(),
      searchTerm: "",
      syncing: false,
      cacheLoadedAt: null,
      accountKey: null,
      syncApiAvailable: null,
      deleteApiAvailable: null,
      visibleLimit: 50,
      lastError: "",
      renderRevision: 0,
      syncProgress: 0,
      isComplete: false,
      syncRunId: 0,
      deletePending: false
    };
  }

  function cacheKey(accountKey) {
    return accountKey ? `${CACHE_PREFIX}:${encodeURIComponent(accountKey)}` : null;
  }

  function normalizeFiles(files) {
    const seen = new Set();
    return (Array.isArray(files) ? files : []).filter(file => {
      if (!file || typeof file.id !== "string" || !file.id || seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    });
  }

  function filterFiles(files, searchTerm) {
    const query = String(searchTerm || "").trim().toLowerCase();
    const normalized = normalizeFiles(files);
    if (!query) return normalized;
    return normalized.filter(file => String(file.title || file.fileName || "").toLowerCase().includes(query));
  }

  function isLibraryPath(pathname) {
    const path = String(pathname || "").split(/[?#]/, 1)[0];
    return /^\/(?:library|space\/files)(?:\/|$)/i.test(path);
  }

  function loadCache(state, storage, accountKey) {
    state.accountKey = accountKey || null;
    state.syncing = false;
    state.deletePending = false;
    state.selectedIds.clear();
    state.files = [];
    state.cacheLoadedAt = null;
    state.syncApiAvailable = null;
    state.deleteApiAvailable = null;
    state.visibleLimit = 50;
    state.lastError = "";
    state.renderRevision += 1;
    state.syncProgress = 0;
    state.isComplete = false;
    state.syncRunId += 1;
    purgeLegacyCaches(storage);
    return state;
  }

  function persistCache(state, storage) {
    // Library metadata is deliberately session-only. Keep this no-op for
    // existing callers while removing caches written by prior versions.
    void state;
    purgeLegacyCaches(storage);
    return true;
  }

  function clearCache(state, storage) {
    state.files = [];
    state.selectedIds.clear();
    state.cacheLoadedAt = null;
    state.visibleLimit = 50;
    state.lastError = "";
    state.renderRevision += 1;
    state.syncProgress = 0;
    state.isComplete = false;
    state.syncRunId += 1;
    purgeLegacyCaches(storage);
  }

  function purgeLegacyCaches(storage) {
    if (!storage || typeof storage.removeItem !== "function") return;
    try {
      const keys = [];
      if (typeof storage.length === "number" && typeof storage.key === "function") {
        for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
      } else if (typeof storage.keys === "function") {
        keys.push(...storage.keys());
      }
      keys.filter(key => typeof key === "string" && key.startsWith(CACHE_PREFIX)).forEach(key => storage.removeItem(key));
    } catch (_) {}
  }

  return { CACHE_PREFIX, cacheKey, createState, filterFiles, isLibraryPath, loadCache, persistCache, clearCache, purgeLegacyCaches, normalizeFiles };
});
