(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GPTBDSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CHECKPOINT_VERSION = 1;
  const RETRYABLE_STATUSES = new Set([408, 425, 429]);

  class SyncPausedError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "SyncPausedError";
      this.checkpoint = options.checkpoint || null;
      this.status = options.status || null;
      if (options.cause) this.cause = options.cause;
    }
  }

  function isRetryableStatus(status) {
    return RETRYABLE_STATUSES.has(status) || status >= 500;
  }

  function normalizeCheckpoint(value, limit, scopeKey) {
    if (!value || value.version !== CHECKPOINT_VERSION || value.limit !== limit) return null;
    if (!scopeKey || value.scopeKey !== scopeKey) return null;
    if (!Number.isSafeInteger(value.nextOffset) || value.nextOffset < 0) return null;

    return {
      version: CHECKPOINT_VERSION,
      limit,
      scopeKey,
      nextOffset: value.nextOffset,
      syncedCount: Number(value.syncedCount) || 0,
      updatedAt: Number(value.updatedAt) || Date.now()
    };
  }

  function retryDelayMs(response, attempt, baseDelayMs, maxDelayMs, now = Date.now()) {
    const retryAfter = response?.headers?.get?.("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs);
      const timestamp = Date.parse(retryAfter);
      if (Number.isFinite(timestamp)) return Math.min(Math.max(0, timestamp - now), maxDelayMs);
    }
    return Math.min(baseDelayMs * (2 ** attempt), maxDelayMs);
  }

  async function fetchConversationPage(options) {
    const {
      accessToken,
      fetchImpl,
      offset,
      limit,
      maxAttempts,
      retryBaseMs,
      maxRetryDelayMs,
      requestTimeoutMs,
      delayImpl
    } = options;
    let lastError = null;
    let lastStatus = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = controller && requestTimeoutMs > 0
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : null;
      try {
        response = await fetchImpl(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
          ...(controller ? { signal: controller.signal } : {})
        });
        lastStatus = response.status;
        if (!response.ok) {
          const error = new Error(`Conversation sync failed: ${response.status}`);
          if (!isRetryableStatus(response.status) || attempt === maxAttempts - 1) throw error;
          await delayImpl(retryDelayMs(response, attempt, retryBaseMs, maxRetryDelayMs));
          continue;
        }

        const data = await response.json();
        if (!Array.isArray(data?.items)) {
          throw new Error("Conversation sync failed: unexpected response shape.");
        }
        return data.items;
      } catch (error) {
        lastError = error;
        const retryable = !response || isRetryableStatus(response.status);
        if (!retryable || attempt === maxAttempts - 1) break;
        await delayImpl(retryDelayMs(response, attempt, retryBaseMs, maxRetryDelayMs));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    throw new SyncPausedError(lastError?.message || "Conversation sync failed.", {
      status: lastStatus,
      cause: lastError
    });
  }

  async function fetchAllConversations(options) {
    const {
      accessToken,
      scopeKey,
      fetchImpl = fetch,
      checkpoint,
      mapItem = item => item,
      onCheckpoint = () => {},
      delayImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
      limit = 100,
      maxAttempts = 4,
      retryBaseMs = 500,
      maxRetryDelayMs = 30 * 1000,
      requestTimeoutMs = 45 * 1000,
      pageDelayMs = 120
    } = options || {};
    if (!accessToken) throw new TypeError("accessToken is required");

    // Offset pagination has no stable snapshot. A saved checkpoint is useful for
    // progress/recovery messaging, but its numeric offset cannot be reused safely
    // after the list may have changed. Re-scan from zero and keep the old complete
    // cache untouched until this run reaches the terminal page.
    void normalizeCheckpoint(checkpoint, limit, scopeKey);
    let offset = 0;
    const all = [];
    const seen = new Set(all.map(item => item.id));

    while (true) {
      let items;
      try {
        items = await fetchConversationPage({
          accessToken,
          fetchImpl,
          offset,
          limit,
          maxAttempts,
          retryBaseMs,
          maxRetryDelayMs,
          requestTimeoutMs,
          delayImpl
        });
      } catch (error) {
        if (error instanceof SyncPausedError) {
          error.checkpoint = buildCheckpoint(limit, scopeKey, offset, all.length);
        }
        throw error;
      }

      items.forEach(item => {
        const mapped = mapItem(item);
        if (!mapped?.id || seen.has(mapped.id)) return;
        seen.add(mapped.id);
        all.push(mapped);
      });

      offset += items.length;
      const nextCheckpoint = buildCheckpoint(limit, scopeKey, offset, all.length);
      await onCheckpoint(nextCheckpoint);

      if (items.length < limit) return all;
      await delayImpl(pageDelayMs);
    }
  }

  function buildCheckpoint(limit, scopeKey, nextOffset, syncedCount) {
    return {
      version: CHECKPOINT_VERSION,
      limit,
      scopeKey,
      nextOffset,
      syncedCount,
      updatedAt: Date.now()
    };
  }

  return {
    CHECKPOINT_VERSION,
    SyncPausedError,
    fetchAllConversations,
    isRetryableStatus,
    normalizeCheckpoint,
    retryDelayMs
  };
});
