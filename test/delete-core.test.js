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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(check, message = "condition was not reached") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

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

test("runs at most two concurrent deletes and waits for every in-flight delete", async () => {
  const gates = new Map(["a", "b", "c"].map(id => [id, deferred()]));
  const started = [];
  const deleted = [];
  let active = 0;
  let peakActive = 0;

  const batch = runDeleteBatch({
    ids: ["a", "b", "c"],
    concurrency: 2,
    minIntervalMs: 0,
    deleteOne: async id => {
      started.push(id);
      active += 1;
      peakActive = Math.max(peakActive, active);
      const value = await gates.get(id).promise;
      active -= 1;
      return value;
    },
    onDeleted: async id => { deleted.push(id); }
  });

  await waitFor(() => started.length === 2, "the first two deletes should start together");
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(peakActive, 2);

  gates.get("a").resolve(true);
  await waitFor(() => started.length === 3, "the next delete should start after a slot opens");
  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(peakActive, 2);

  gates.get("c").resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  let settled = false;
  void batch.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "the batch must wait for b, which is still in flight");

  gates.get("b").resolve(true);
  const result = await batch;
  assert.equal(result.deleted, 3);
  assert.deepEqual(deleted.sort(), ["a", "b", "c"]);
});

test("spaces concurrent request starts globally", async () => {
  const gates = new Map(["a", "b"].map(id => [id, deferred()]));
  const starts = [];
  const delays = [];
  let clock = 0;
  const pacingGate = deferred();

  const batch = runDeleteBatch({
    ids: ["a", "b"],
    concurrency: 2,
    minIntervalMs: 1200,
    nowImpl: () => clock,
    delayImpl: async ms => {
      delays.push(ms);
      await pacingGate.promise;
      clock += ms;
    },
    deleteOne: async id => {
      starts.push({ id, at: clock });
      return gates.get(id).promise;
    }
  });

  await waitFor(() => starts.length === 1, "the first request should start immediately");
  await waitFor(() => delays.length === 1, "the second request should wait for the shared pace");
  assert.deepEqual(starts, [{ id: "a", at: 0 }]);
  assert.deepEqual(delays, [1200]);

  pacingGate.resolve();
  await waitFor(() => starts.length === 2, "the second request should start after the pace delay");
  assert.deepEqual(starts, [{ id: "a", at: 0 }, { id: "b", at: 1200 }]);

  gates.get("a").resolve(true);
  gates.get("b").resolve(true);
  const result = await batch;
  assert.equal(result.deleted, 2);
});

test("a concurrent rate limit stops new starts but keeps already-started deletes", async () => {
  const firstGate = deferred();
  const started = [];
  const deleted = [];
  const batch = runDeleteBatch({
    ids: ["a", "b", "c", "d"],
    concurrency: 2,
    minIntervalMs: 0,
    deleteOne: async id => {
      started.push(id);
      if (id === "a") return firstGate.promise;
      if (id === "b") throw new DeleteRateLimitError(60_000);
      return true;
    },
    onDeleted: async id => { deleted.push(id); }
  });

  await waitFor(() => started.length === 2, "two requests should be in flight before the limit response");
  assert.deepEqual(started, ["a", "b"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"], "a rate limit must prevent c and d from starting");

  firstGate.resolve(true);
  const result = await batch;
  assert.deepEqual(deleted, ["a"]);
  assert.equal(result.deleted, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.rateLimitError.retryAfterMs, 60_000);
  assert.deepEqual(result.failedIds, ["b", "c", "d"]);
});

for (const [label, pauseError] of [
  ["rate limit", new DeleteRateLimitError(60_000)],
  ["authentication failure", new DeleteBatchPauseError("auth", "session expired")]
]) {
  test(`does not start a second request when ${label} arrives during pacing`, async () => {
    const firstGate = deferred();
    const pacingGate = deferred();
    const started = [];
    const delays = [];
    let clock = 0;
    const batch = runDeleteBatch({
      ids: ["a", "b"],
      concurrency: 2,
      minIntervalMs: 1200,
      nowImpl: () => clock,
      delayImpl: async ms => {
        delays.push(ms);
        await pacingGate.promise;
        clock += ms;
      },
      deleteOne: async id => {
        started.push(id);
        if (id === "a") return firstGate.promise;
        return true;
      }
    });

    await waitFor(() => delays.length === 1, "the dispatcher should be pacing before it starts b");
    firstGate.reject(pauseError);
    await new Promise(resolve => setImmediate(resolve));
    pacingGate.resolve();

    const result = await batch;
    assert.deepEqual(started, ["a"]);
    assert.deepEqual(result.failedIds, ["a", "b"]);
    assert.equal(result.processed, 0);
    assert.equal(result.pauseError, pauseError);
  });
}

test("serializes UI callbacks when concurrent delete responses finish out of order", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const callbackGate = deferred();
  const callbacks = [];
  let activeCallbacks = 0;
  let peakCallbacks = 0;
  const batch = runDeleteBatch({
    ids: ["a", "b"],
    concurrency: 2,
    minIntervalMs: 0,
    deleteOne: async id => (id === "a" ? firstGate.promise : secondGate.promise),
    onDeleted: async id => {
      callbacks.push(`start:${id}`);
      activeCallbacks += 1;
      peakCallbacks = Math.max(peakCallbacks, activeCallbacks);
      if (id === "b") await callbackGate.promise;
      activeCallbacks -= 1;
      callbacks.push(`end:${id}`);
    }
  });

  secondGate.resolve(true);
  await waitFor(() => callbacks.includes("start:b"), "b should reach its UI callback first");
  firstGate.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peakCallbacks, 1, "completion callbacks must not overlap");
  assert.deepEqual(callbacks, ["start:b"]);

  callbackGate.resolve();
  const result = await batch;
  assert.equal(peakCallbacks, 1);
  assert.deepEqual(callbacks, ["start:b", "end:b", "start:a", "end:a"]);
  assert.equal(result.deleted, 2);
});
