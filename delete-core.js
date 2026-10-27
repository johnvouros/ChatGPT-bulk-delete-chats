(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GPTBDDelete = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class DeleteBatchPauseError extends Error {
    constructor(reason, message, retryAfterMs = 0) {
      super(message);
      this.name = "DeleteBatchPauseError";
      this.reason = reason;
      this.retryAfterMs = retryAfterMs;
    }
  }

  class DeleteRateLimitError extends DeleteBatchPauseError {
    constructor(retryAfterMs = 0) {
      super("rate-limit", "ChatGPT rate-limited delete requests.", retryAfterMs);
      this.name = "DeleteRateLimitError";
    }
  }

  function parseRetryAfterMs(response, maxDelayMs = 5 * 60 * 1000, now = Date.now()) {
    const value = response?.headers?.get?.("retry-after");
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs);
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.min(Math.max(0, timestamp - now), maxDelayMs);
  }

  function isCooldownActive(cooldown, scopeKey, now = Date.now()) {
    return Boolean(
      cooldown
      && scopeKey
      && cooldown.scopeKey === scopeKey
      && Number(cooldown.until) > now
    );
  }

  function resolveCooldownScope(session, knownScopeKey) {
    return session?.accountKey || knownScopeKey || null;
  }

  async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 30 * 1000) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    if (!controller || timeoutMs <= 0) return fetchImpl(url, options);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DeleteBatchPauseError("timeout", "A delete request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function runDeleteBatch(options) {
    const {
      ids = [],
      deleteOne,
      onDeleted = () => {},
      onProgress = () => {},
      delayImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
      nowImpl = () => performance.now(),
      minIntervalMs = 1200,
      concurrency = 1
    } = options || {};
    if (typeof deleteOne !== "function") throw new TypeError("deleteOne is required");

    const confirmed = new Set();
    const active = new Set();
    const maxConcurrent = concurrency === 2 ? 2 : 1;
    let deleted = 0;
    let processed = 0;
    let pauseError = null;
    let lastStartedAt = null;
    let callbackError = null;
    let updates = Promise.resolve();

    async function attempt(id) {
      let success = false;
      let paused = false;
      try {
        success = await deleteOne(id);
      } catch (error) {
        if (error instanceof DeleteBatchPauseError) {
          // Stop dispatch immediately, before waiting for UI updates. Requests
          // already sent must settle so confirmed deletions are not lost.
          if (!pauseError || error instanceof DeleteRateLimitError) pauseError = error;
          paused = true;
        }
      }
      const update = updates.then(async () => {
        if (!paused) processed += 1;
        if (success) {
          await onDeleted(id);
          confirmed.add(id);
          deleted += 1;
        }
        await onProgress({ processed, total: ids.length, deleted, rateLimited: Boolean(pauseError) });
      });
      updates = update.catch(error => { callbackError = error; });
      await updates;
    }

    for (let index = 0; index < ids.length; index += 1) {
      while (active.size >= maxConcurrent) await Promise.race(active);
      if (pauseError || callbackError) break;
      if (lastStartedAt !== null && minIntervalMs > 0) {
        const remainingMs = minIntervalMs - (nowImpl() - lastStartedAt);
        if (remainingMs > 0) await delayImpl(remainingMs);
      }
      // A request may have paused the batch while this dispatcher was asleep.
      if (pauseError || callbackError) break;
      // Space starts globally, even when up to two requests are in flight.
      lastStartedAt = nowImpl();
      const id = ids[index];
      const task = attempt(id).finally(() => active.delete(task));
      active.add(task);
    }
    await Promise.all(active);
    if (callbackError) throw callbackError;

    return {
      deleted,
      failedIds: ids.filter(id => !confirmed.has(id)),
      processed,
      pauseError,
      rateLimitError: pauseError instanceof DeleteRateLimitError ? pauseError : null
    };
  }

  return {
    DeleteBatchPauseError,
    DeleteRateLimitError,
    fetchWithTimeout,
    isCooldownActive,
    parseRetryAfterMs,
    resolveCooldownScope,
    runDeleteBatch
  };
});
