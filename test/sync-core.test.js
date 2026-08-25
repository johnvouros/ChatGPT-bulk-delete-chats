const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHECKPOINT_VERSION,
  SyncPausedError,
  fetchAllConversations,
  retryDelayMs
} = require("../sync-core.js");

function jsonResponse(status, items, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] || null },
    async json() { return { items }; }
  };
}

function page(offset, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `chat-${offset + index}`,
    title: `Chat ${offset + index}`
  }));
}

function requestOffset(url) {
  return Number(new URL(url, "https://chatgpt.com").searchParams.get("offset"));
}

test("retries the reported timeout at offset 3200 and completes the sync", async () => {
  const requests = [];
  let timedOut = false;
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-a",
    delayImpl: async () => {},
    fetchImpl: async url => {
      const offset = requestOffset(url);
      requests.push(offset);
      if (offset === 3200 && !timedOut) {
        timedOut = true;
        return jsonResponse(504, []);
      }
      return jsonResponse(200, page(offset, offset === 3300 ? 17 : 100));
    }
  });

  assert.equal(result.length, 3317);
  assert.deepEqual(requests.slice(-3), [3200, 3200, 3300]);
});

test("persists partial progress and safely re-scans after retries are exhausted", async () => {
  let savedCheckpoint = null;
  await assert.rejects(
    fetchAllConversations({
      accessToken: "token",
      scopeKey: "account-a",
      maxAttempts: 2,
      delayImpl: async () => {},
      onCheckpoint: checkpoint => { savedCheckpoint = checkpoint; },
      fetchImpl: async url => {
        const offset = requestOffset(url);
        return offset === 3200 ? jsonResponse(504, []) : jsonResponse(200, page(offset, 100));
      }
    }),
    error => {
      assert.ok(error instanceof SyncPausedError);
      assert.equal(error.checkpoint.nextOffset, 3200);
      assert.equal(error.checkpoint.syncedCount, 3200);
      return true;
    }
  );
  assert.equal(savedCheckpoint.nextOffset, 3200);

  const resumedOffsets = [];
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-a",
    checkpoint: savedCheckpoint,
    delayImpl: async () => {},
    fetchImpl: async url => {
      const offset = requestOffset(url);
      resumedOffsets.push(offset);
      return jsonResponse(200, page(offset, offset === 3100 ? 100 : 25));
    }
  });

  assert.equal(resumedOffsets[0], 0);
  assert.equal(result.length, 25);
});

test("does not merge stale records from a restored checkpoint", async () => {
  const checkpoint = {
    version: CHECKPOINT_VERSION,
    limit: 100,
    scopeKey: "account-a",
    nextOffset: 100,
    updatedAt: Date.now(),
    syncedCount: 100
  };
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-a",
    checkpoint,
    delayImpl: async () => {},
    fetchImpl: async () => jsonResponse(200, [{ id: "existing" }, { id: "new" }])
  });

  assert.deepEqual(result.map(item => item.id), ["existing", "new"]);
});

test("does not retry a non-transient authorization failure", async () => {
  let attempts = 0;
  await assert.rejects(
    fetchAllConversations({
      accessToken: "expired",
      scopeKey: "account-a",
      delayImpl: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(401, []);
      }
    }),
    error => error instanceof SyncPausedError && error.status === 401
  );
  assert.equal(attempts, 1);
});

test("re-scans when balanced list mutations leave the old boundary unchanged", async () => {
  const checkpoint = {
    version: CHECKPOINT_VERSION,
    limit: 2,
    scopeKey: "account-a",
    nextOffset: 4,
    updatedAt: Date.now(),
    syncedCount: 4
  };
  const currentIds = ["x", "b", "c", "d", "e", "f"];
  const requests = [];
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-a",
    checkpoint,
    limit: 2,
    delayImpl: async () => {},
    fetchImpl: async url => {
      const offset = requestOffset(url);
      requests.push(offset);
      return jsonResponse(200, currentIds.slice(offset, offset + 2).map(id => ({ id })));
    }
  });

  assert.deepEqual(requests, [0, 2, 4, 6]);
  assert.deepEqual(result.map(item => item.id), currentIds);
});

test("does not restore a checkpoint from another account", async () => {
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-b",
    checkpoint: {
      version: CHECKPOINT_VERSION,
      limit: 100,
      scopeKey: "account-a",
      nextOffset: 100,
      updatedAt: Date.now(),
      syncedCount: 100
    },
    delayImpl: async () => {},
    fetchImpl: async url => {
      assert.equal(requestOffset(url), 0);
      return jsonResponse(200, [{ id: "account-b-chat" }]);
    }
  });

  assert.deepEqual(result.map(item => item.id), ["account-b-chat"]);
});

test("caps Retry-After delays", () => {
  const response = jsonResponse(429, [], { "retry-after": "86400" });
  assert.equal(retryDelayMs(response, 0, 500, 30_000), 30_000);
});

test("retries a thrown network error", async () => {
  let attempts = 0;
  const result = await fetchAllConversations({
    accessToken: "token",
    scopeKey: "account-a",
    delayImpl: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network reset");
      return jsonResponse(200, [{ id: "recovered" }]);
    }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result.map(item => item.id), ["recovered"]);
});
