const test = require("node:test");
const assert = require("node:assert/strict");
const deleteApi = require("../delete-core.js");
const { runDeleteBatch } = deleteApi;
const {
  LibraryResponseError,
  buildDeleteUrl,
  deleteLibraryFile,
  fetchLibraryFiles,
  parseLibraryPage
} = require("../library-core.js");

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] || null },
    async json() { return payload; }
  };
}

function libraryFile(index = "a") {
  return {
    library_file_id: `library-${index}`,
    file_id: `file-${index}`,
    file_name: `report ${index}.csv`,
    created_at: "2026-09-01T00:00:00Z"
  };
}

function observedLibraryFile(index = "a") {
  return {
    kind: "file",
    id: `libfile_${index}`,
    file_id: `file_${index}`,
    name: `observed ${index}.csv`,
    record_creation_time: "2026-09-01T00:00:00Z",
    parent_directory_id: "directory_uploads",
    thumbnail_url: "/backend-api/estuary/content/thumbnail-a",
    mime_type: "text/csv",
    unneeded_server_metadata: "must not be cached"
  };
}

test("rejects library nodes that do not carry all delete identifiers", () => {
  assert.throws(
    () => parseLibraryPage({ nodes: [{ library_file_id: "library-a", file_id: "file-a" }] }),
    error => error instanceof LibraryResponseError
  );
  assert.throws(
    () => parseLibraryPage({ items: [libraryFile()] }),
    error => error instanceof LibraryResponseError
  );
});

test("uses only explicit pagination metadata and rejects ambiguous pages", async () => {
  assert.throws(
    () => parseLibraryPage({ nodes: [libraryFile()] }),
    /missing pagination completion marker/
  );
  const requests = [];
  const result = await fetchLibraryFiles({
    accessToken: "token",
    deleteApi,
    delayImpl: async () => {},
    fetchImpl: async url => {
      requests.push(url);
      if (url === "/backend-api/files/library/nodes") {
        return jsonResponse(200, { nodes: [libraryFile("a")], has_more: true, next_cursor: "cursor-1" });
      }
      return jsonResponse(200, { nodes: [libraryFile("b")], has_more: false });
    }
  });

  assert.deepEqual(requests, [
    "/backend-api/files/library/nodes",
    "/backend-api/files/library/nodes?cursor=cursor-1"
  ]);
  assert.deepEqual(result.map(file => file.libraryFileId), ["library-a", "library-b"]);

  await assert.rejects(
    fetchLibraryFiles({
      accessToken: "token",
      deleteApi,
      fetchImpl: async () => jsonResponse(200, {
        nodes: [libraryFile()],
        has_more: true,
        next_cursor: "cursor",
        next_offset: 1
      })
    }),
    error => error instanceof LibraryResponseError
  );

  assert.deepEqual(
    parseLibraryPage({ nodes: [libraryFile()], has_more: false, next_cursor: null }).nextPage,
    null
  );
  assert.throws(
    () => parseLibraryPage({ nodes: [libraryFile()], has_next_page: false }),
    error => error instanceof LibraryResponseError
  );
});

test("parses observed items pages, skips directories, and follows the opaque cursor", async () => {
  const requests = [];
  const result = await fetchLibraryFiles({
    accessToken: "token",
    deleteApi,
    delayImpl: async () => {},
    fetchImpl: async (url, options) => {
      assert.equal(options.cache, "no-store", "Library metadata must bypass persistent HTTP caching");
      requests.push(url);
      if (url === "/backend-api/files/library/nodes") {
        return jsonResponse(200, {
          items: [
            { kind: "directory", id: "directory_1", name: "Uploads" },
            observedLibraryFile("a")
          ],
          cursor: "opaque cursor 1"
        });
      }
      return jsonResponse(200, { items: [observedLibraryFile("b")], cursor: null });
    }
  });

  assert.deepEqual(requests, [
    "/backend-api/files/library/nodes",
    "/backend-api/files/library/nodes?cursor=opaque%20cursor%201"
  ]);
  assert.deepEqual(result.map(file => file.libraryFileId), ["libfile_a", "libfile_b"]);
  assert.deepEqual(result[0].raw, {
    library_file_id: "libfile_a",
    file_id: "file_a",
    file_name: "observed a.csv",
    parent_directory_id: "directory_uploads"
  });
  assert.equal(result[0].thumbnailUrl, "/backend-api/estuary/content/thumbnail-a");
  assert.equal(result[0].mimeType, "text/csv");
});

test("rejects unknown observed item kinds and a missing terminal cursor", () => {
  assert.throws(
    () => parseLibraryPage({ items: [{ kind: "collection", id: "x" }], cursor: null }),
    error => error instanceof LibraryResponseError
  );
  assert.throws(
    () => parseLibraryPage({ items: [observedLibraryFile()] }),
    error => error instanceof LibraryResponseError
  );
});

test("rejects a repeated page token instead of looping or presenting a partial list", async () => {
  let requests = 0;
  await assert.rejects(
    fetchLibraryFiles({
      accessToken: "token",
      deleteApi,
      delayImpl: async () => {},
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse(200, {
          nodes: [libraryFile(String(requests))],
          has_more: true,
          next_offset: 20
        });
      }
    }),
    error => error instanceof LibraryResponseError
  );
  assert.equal(requests, 2);
});

test("pauses a library sync when its JSON body does not finish before the deadline", async () => {
  await assert.rejects(
    fetchLibraryFiles({
      accessToken: "token",
      deleteApi,
      requestTimeoutMs: 5,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => new Promise(() => {})
      })
    }),
    error => error instanceof deleteApi.DeleteBatchPauseError && error.reason === "api"
  );
});

test("builds the native DELETE URL from strict library identifiers", () => {
  const url = buildDeleteUrl({
    library_file_id: "library-a",
    file_id: "file-a",
    parent_directory_id: "directory-a",
    file_name: "my report & notes.csv"
  });
  assert.equal(
    url,
    "/backend-api/files/library/files/library-a?file_id=file-a&parent_directory_id=directory-a&file_name=my+report+%26+notes.csv&soft_delete=true"
  );
  assert.throws(
    () => buildDeleteUrl({ library_file_id: " library-a", file_id: "file-a", file_name: "x" }),
    /valid library file/
  );
});

test("uses native DELETE and accepts only its JSON success confirmation", async () => {
  let request;
  const deleted = await deleteLibraryFile({
    file: libraryFile(),
    accessToken: "token",
    deleteApi,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(200, { success: true });
    }
  });
  assert.equal(deleted, true);
  assert.equal(request.options.method, "DELETE");
  assert.equal(request.url, "/backend-api/files/library/files/library-a?file_id=file-a&file_name=report+a.csv&soft_delete=true");
});

test("pauses deletion when JSON success is false or malformed", async () => {
  for (const payload of [{ success: false }, {}, null]) {
    await assert.rejects(
      deleteLibraryFile({
        file: libraryFile(),
        accessToken: "token",
        deleteApi,
        fetchImpl: async () => jsonResponse(200, payload)
      }),
      error => error instanceof deleteApi.DeleteBatchPauseError && error.reason === "api"
    );
  }
});

test("turns a library delete 429 into the shared batch pause error", async () => {
  await assert.rejects(
    deleteLibraryFile({
      file: libraryFile(),
      accessToken: "token",
      deleteApi,
      fetchImpl: async () => jsonResponse(429, {}, { "retry-after": "45" })
    }),
    error => error instanceof deleteApi.DeleteRateLimitError && error.retryAfterMs === 45_000
  );
});

test("pauses a library delete when the authenticated session is rejected", async () => {
  await assert.rejects(
    deleteLibraryFile({
      file: libraryFile(),
      accessToken: "token",
      deleteApi,
      fetchImpl: async () => jsonResponse(403, {})
    }),
    error => error instanceof deleteApi.DeleteBatchPauseError && error.reason === "auth"
  );
});

test("pauses the batch when native delete JSON exceeds its deadline", async () => {
  await assert.rejects(
    deleteLibraryFile({
      file: libraryFile(),
      accessToken: "token",
      deleteApi,
      requestTimeoutMs: 5,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => new Promise(() => {})
      })
    }),
    error => error instanceof deleteApi.DeleteBatchPauseError && error.reason === "api"
  );
});

test("stops the shared batch after an uncertain library delete and retains every remaining file", async () => {
  const files = [libraryFile("a"), libraryFile("b")];
  let posts = 0;
  const result = await runDeleteBatch({
    ids: files,
    minIntervalMs: 0,
    deleteOne: file => deleteLibraryFile({
      file,
      accessToken: "token",
      deleteApi,
      fetchImpl: async () => {
        posts += 1;
        return jsonResponse(500, {});
      }
    })
  });

  assert.equal(posts, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.pauseError.reason, "api");
  assert.deepEqual(result.failedIds, files);
});

test("publishes deduplicated file pages before fetching the next page", async () => {
  const order = [];
  const result = await fetchLibraryFiles({
    accessToken: "token", deleteApi, pageDelayMs: 0,
    fetchImpl: async url => {
      order.push(url.includes("cursor=") ? "fetch-second" : "fetch-first");
      return jsonResponse(200, url.includes("cursor=")
        ? { items: [observedLibraryFile("a"), observedLibraryFile("b")], cursor: null }
        : { items: [observedLibraryFile("a")], cursor: "next" });
    },
    onPage: async page => {
      await Promise.resolve();
      order.push(`page-${page.syncedCount}`);
      assert.equal(page.files.length, 1);
    }
  });
  assert.deepEqual(order, ["fetch-first", "page-1", "fetch-second", "page-2"]);
  assert.equal(result.length, 2);
});

test("stops pagination if the page consumer rejects a stale account", async () => {
  let requests = 0;
  await assert.rejects(fetchLibraryFiles({
    accessToken: "token", deleteApi, pageDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse(200, { items: [observedLibraryFile("a")], cursor: "next" });
    },
    onPage: () => { throw new Error("Account changed"); }
  }), /Account changed/);
  assert.equal(requests, 1);
});
