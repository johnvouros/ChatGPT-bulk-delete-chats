const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeleteBatchPauseError,
  DeleteRateLimitError,
  fetchWithTimeout,
  isCooldownActive,
  parseRetryAfterMs,
  resolveCooldownScope,
  runDeleteBatch
} = require("../delete-core.js");

test("paces bulk deletes and reports confirmed successes", async () => {
  const delays = [];
  const deletedIds = [];
  const result = await runDeleteBatch({
    ids: ["a", "b", "c"],
    nowImpl: () => 0,
    deleteOne: async () => true,
    delayImpl: async ms => { delays.push(ms); },
    onDeleted: async id => { deletedIds.push(id); }
  });

  assert.deepEqual(delays, [1200, 1200]);
  assert.deepEqual(deletedIds, ["a", "b", "c"]);
  assert.equal(result.deleted, 3);
  assert.deepEqual(result.failedIds, []);
});

test("stops immediately on a 429 and leaves the remaining IDs retryable", async () => {
  const attempted = [];
  const deletedIds = [];
  const result = await runDeleteBatch({
    ids: ["a", "b", "c", "d"],
    minIntervalMs: 10,
    delayImpl: async () => {},
    deleteOne: async id => {
      attempted.push(id);
      if (id === "b") throw new DeleteRateLimitError(60_000);
      return true;
    },
    onDeleted: async id => { deletedIds.push(id); }
  });

  assert.deepEqual(attempted, ["a", "b"]);
  assert.deepEqual(deletedIds, ["a"]);
  assert.deepEqual(result.failedIds, ["b", "c", "d"]);
  assert.equal(result.processed, 1);
  assert.equal(result.rateLimitError.retryAfterMs, 60_000);
});

test("continues after an ordinary failed delete", async () => {
  const result = await runDeleteBatch({
    ids: ["a", "b", "c"],
    minIntervalMs: 0,
    deleteOne: async id => id !== "b"
  });

  assert.equal(result.deleted, 2);
  assert.equal(result.processed, 3);
  assert.deepEqual(result.failedIds, ["b"]);
});

test("parses and caps Retry-After", () => {
  const response = { headers: { get: () => "600" } };
  assert.equal(parseRetryAfterMs(response), 5 * 60 * 1000);
});

test("enforces account-scoped delete cooldowns", () => {
  const cooldown = { scopeKey: "account-a", until: 20_000 };
  assert.equal(isCooldownActive(cooldown, "account-a", 10_000), true);
  assert.equal(isCooldownActive(cooldown, "account-b", 10_000), false);
  assert.equal(isCooldownActive(cooldown, "account-a", 20_000), false);
});

test("uses the known account scope when API delete is unavailable", () => {
  assert.equal(resolveCooldownScope(null, "account-a"), "account-a");
  assert.equal(resolveCooldownScope({ accountKey: "account-b" }, "account-a"), "account-b");
});

test("pauses all remaining IDs when authentication cannot recover", async () => {
  const result = await runDeleteBatch({
    ids: ["a", "b", "c"],
    minIntervalMs: 0,
    deleteOne: async () => {
      throw new DeleteBatchPauseError("auth", "session expired");
    }
  });

  assert.equal(result.pauseError.reason, "auth");
  assert.deepEqual(result.failedIds, ["a", "b", "c"]);
  assert.equal(result.processed, 0);
});

test("aborts a hanging delete request", async () => {
  const hangingFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

  await assert.rejects(
    fetchWithTimeout(hangingFetch, "/delete", {}, 5),
    error => error instanceof DeleteBatchPauseError && error.reason === "timeout"
  );
});

for (const duration of [800, 1600]) {
  test(`counts ${duration}ms request time toward pacing without overlapping deletes`, async () => {
    let clock = 0;
    let active = 0;
    const starts = [];
    const delays = [];
    const result = await runDeleteBatch({
      ids: ['a', 'b', 'c'],
      nowImpl: () => clock,
      delayImpl: async ms => { delays.push(ms); clock += ms; },
      deleteOne: async () => {
        assert.equal(active++, 0);
        starts.push(clock);
        await Promise.resolve();
        clock += duration;
        active--;
        return true;
      }
    });
    assert.deepEqual(starts, duration === 800 ? [0, 1200, 2400] : [0, 1600, 3200]);
    assert.deepEqual(delays, duration === 800 ? [400, 400] : []);
    assert.equal(result.deleted, 3);
  });
}
