(function (root, factory) {
  const api = factory(root && root.GPTBDDelete);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GPTBDLibrary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultDeleteApi) {
  const LIBRARY_NODES_PATH = "/backend-api/files/library/nodes";
  const DELETE_TIMEOUT_MS = 30 * 1000;
  const ID_MAX_LENGTH = 512;
  const FILE_NAME_MAX_LENGTH = 1024;

  class LibraryResponseError extends Error {
    constructor(message) {
      super(message);
      this.name = "LibraryResponseError";
    }
  }

  class LibraryRequestError extends Error {
    constructor(message, status = null) {
      super(message);
      this.name = "LibraryRequestError";
      this.status = status;
    }
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isSafeText(value, maxLength, allowWhitespace) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false;
    if (!allowWhitespace && value !== value.trim()) return false;
    return !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  }

  function validateLibraryFile(value) {
    if (!isPlainObject(value)) return null;
    const libraryFileId = value.library_file_id;
    const fileId = value.file_id;
    const fileName = value.file_name;
    const parentDirectoryId = value.parent_directory_id;
    if (!isSafeText(libraryFileId, ID_MAX_LENGTH, false)
      || !isSafeText(fileId, ID_MAX_LENGTH, false)
      || !isSafeText(fileName, FILE_NAME_MAX_LENGTH, true)
      || (parentDirectoryId != null && !isSafeText(parentDirectoryId, ID_MAX_LENGTH, false))) {
      return null;
    }
    return {
      id: libraryFileId,
      libraryFileId,
      fileId,
      fileName,
      title: fileName,
      createdAt: value.created_at || null,
      parentDirectoryId: parentDirectoryId || null,
      thumbnailUrl: typeof value.thumbnail_url === "string" ? value.thumbnail_url : null,
      mimeType: typeof value.mime_type === "string" ? value.mime_type : null,
      raw: {
        library_file_id: libraryFileId,
        file_id: fileId,
        file_name: fileName,
        ...(parentDirectoryId ? { parent_directory_id: parentDirectoryId } : {})
      }
    };
  }

  function normalizeLibraryFile(value) {
    return validateLibraryFile(value);
  }

  function isLibraryFile(value) {
    return Boolean(validateLibraryFile(value));
  }

  function parseLegacyNextPage(payload) {
    const hasMore = payload.has_more;
    const hasOffset = Object.prototype.hasOwnProperty.call(payload, "next_offset");
    const hasCursor = Object.prototype.hasOwnProperty.call(payload, "next_cursor");
    const unsupportedPaginationKey = Object.keys(payload).find(key => {
      if (["has_more", "next_offset", "next_cursor"].includes(key)) return false;
      return /^(?:has_|next_|cursor$|offset$|page$|pagination$)/.test(key);
    });

    if (unsupportedPaginationKey) {
      throw new LibraryResponseError("Library sync failed: unsupported pagination metadata.");
    }

    if (hasMore === undefined && !hasOffset && !hasCursor) {
      throw new LibraryResponseError("Library sync failed: missing pagination completion marker.");
    }
    if (hasMore === undefined && hasCursor && payload.next_cursor === null && !hasOffset) return null;
    if (typeof hasMore !== "boolean") {
      throw new LibraryResponseError("Library sync failed: unsupported pagination metadata.");
    }
    if (!hasMore) {
      if ((hasOffset && payload.next_offset != null) || (hasCursor && payload.next_cursor != null)) {
        throw new LibraryResponseError("Library sync failed: terminal page included a next page token.");
      }
      return null;
    }
    if (hasOffset === hasCursor) {
      throw new LibraryResponseError("Library sync failed: expected exactly one next page token.");
    }
    if (hasOffset) {
      if (!Number.isSafeInteger(payload.next_offset) || payload.next_offset < 0) {
        throw new LibraryResponseError("Library sync failed: invalid next offset.");
      }
      return { type: "offset", value: payload.next_offset };
    }
    if (!isSafeText(payload.next_cursor, ID_MAX_LENGTH, true)) {
      throw new LibraryResponseError("Library sync failed: invalid next cursor.");
    }
    return { type: "cursor", value: payload.next_cursor };
  }

  function parseItemsNextPage(payload) {
    const unsupportedPaginationKey = Object.keys(payload).find(key => {
      if (key === "cursor") return false;
      return /^(?:has_|next_|offset$|page$|pagination$)/.test(key);
    });
    if (unsupportedPaginationKey || !Object.prototype.hasOwnProperty.call(payload, "cursor")) {
      throw new LibraryResponseError("Library sync failed: missing or unsupported cursor pagination metadata.");
    }
    if (payload.cursor === null) return null;
    if (!isSafeText(payload.cursor, ID_MAX_LENGTH, true)) {
      throw new LibraryResponseError("Library sync failed: invalid cursor.");
    }
    return { type: "cursor", value: payload.cursor };
  }

  function normalizeObservedLibraryFile(value) {
    if (!isPlainObject(value) || value.kind !== "file") return null;
    const normalized = validateLibraryFile({
      library_file_id: value.id,
      file_id: value.file_id,
      file_name: value.name,
      created_at: value.record_creation_time || value.file_upload_time || null,
      parent_directory_id: value.parent_directory_id,
      thumbnail_url: value.thumbnail_url,
      mime_type: value.mime_type
    });
    return normalized;
  }

  // The observed endpoint returns `{items, cursor}`. Directories appear beside
  // files and intentionally do not participate in selection or deletion. Keep
  // the original `{nodes, has_more, next_cursor|next_offset}` support for
  // existing fixtures until that older contract is removed upstream.
  function parseLibraryPage(payload) {
    if (!isPlainObject(payload)) {
      throw new LibraryResponseError("Library sync failed: unexpected response shape.");
    }
    if (Array.isArray(payload.items)) {
      const files = [];
      for (const item of payload.items) {
        if (!isPlainObject(item) || (item.kind !== "file" && item.kind !== "directory")) {
          throw new LibraryResponseError("Library sync failed: received an unknown library item kind.");
        }
        if (item.kind === "directory") continue;
        const file = normalizeObservedLibraryFile(item);
        if (!file) {
          throw new LibraryResponseError("Library sync failed: a file item is missing a required identifier.");
        }
        files.push(file);
      }
      return { files, nextPage: parseItemsNextPage(payload) };
    }
    if (!Array.isArray(payload.nodes)) {
      throw new LibraryResponseError("Library sync failed: unexpected response shape.");
    }
    const files = payload.nodes.map(validateLibraryFile);
    if (files.some(file => !file)) {
      throw new LibraryResponseError("Library sync failed: a file node is missing a required identifier.");
    }
    return { files, nextPage: parseLegacyNextPage(payload) };
  }

  function buildLibraryNodesUrl(nextPage) {
    if (!nextPage) return LIBRARY_NODES_PATH;
    const parameter = nextPage.type === "cursor" ? "cursor" : "offset";
    return `${LIBRARY_NODES_PATH}?${parameter}=${encodeURIComponent(nextPage.value)}`;
  }

  function buildDeleteUrl(file) {
    const normalized = validateLibraryFile(file?.raw || file);
    if (!normalized) throw new TypeError("A valid library file is required");
    const query = new URLSearchParams({ file_id: normalized.fileId });
    if (normalized.parentDirectoryId) query.set("parent_directory_id", normalized.parentDirectoryId);
    query.set("file_name", normalized.fileName);
    query.set("soft_delete", "true");
    return `/backend-api/files/library/files/${encodeURIComponent(normalized.libraryFileId)}?${query}`;
  }

  function resolveDeleteApi(deleteApi) {
    const api = deleteApi || defaultDeleteApi;
    if (!api || typeof api.fetchWithTimeout !== "function"
      || typeof api.DeleteBatchPauseError !== "function"
      || typeof api.DeleteRateLimitError !== "function") {
      throw new TypeError("GPTBDDelete is required");
    }
    return api;
  }

  function authOrRateLimitError(response, deleteApi, action) {
    if (response.status === 429) {
      throw new deleteApi.DeleteRateLimitError(deleteApi.parseRetryAfterMs?.(response) || 0);
    }
    if (response.status === 401 || response.status === 403) {
      throw new deleteApi.DeleteBatchPauseError(
        "auth",
        `Your ChatGPT session changed during the library ${action}.`
      );
    }
  }

  function libraryDeletePause(deleteApi, message) {
    return new deleteApi.DeleteBatchPauseError("api", message);
  }

  function withDeleteTimeout(promise, timeoutMs, deleteApi, message) {
    if (!(timeoutMs > 0)) return promise;
    let timeoutId;
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => reject(libraryDeletePause(deleteApi, message)), timeoutMs);
      Promise.resolve(promise).then(
        value => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        error => {
          clearTimeout(timeoutId);
          reject(error);
        }
      );
    });
  }

  async function fetchLibraryPage(options) {
    const {
      accessToken,
      fetchImpl = fetch,
      deleteApi: suppliedDeleteApi,
      nextPage = null,
      requestTimeoutMs = 45 * 1000
    } = options || {};
    if (!isSafeText(accessToken, ID_MAX_LENGTH * 8, false)) throw new TypeError("accessToken is required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
    const deleteApi = resolveDeleteApi(suppliedDeleteApi);
    const response = await deleteApi.fetchWithTimeout(fetchImpl, buildLibraryNodesUrl(nextPage), {
      credentials: "include",
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` }
    }, requestTimeoutMs);
    if (!response.ok) {
      authOrRateLimitError(response, deleteApi, "sync");
      throw new LibraryRequestError(`Library sync failed: ${response.status}`, response.status);
    }
    let payload;
    try {
      payload = await withDeleteTimeout(
        response.json(),
        requestTimeoutMs,
        deleteApi,
        "Library sync response timed out."
      );
    } catch (error) {
      if (error instanceof deleteApi.DeleteBatchPauseError) throw error;
      throw new LibraryResponseError("Library sync failed: response was not JSON.");
    }
    return parseLibraryPage(payload);
  }

  async function fetchLibraryFiles(options) {
    const {
      accessToken,
      fetchImpl = fetch,
      deleteApi,
      onCheckpoint = () => {},
      onPage = () => {},
      delayImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
      pageDelayMs = 120,
      requestTimeoutMs
    } = options || {};
    const all = [];
    const seen = new Set();
    const seenPageTokens = new Set();
    let nextPage = null;

    while (true) {
      const page = await fetchLibraryPage({
        accessToken,
        fetchImpl,
        deleteApi,
        nextPage,
        requestTimeoutMs
      });
      const pageFiles = [];
      for (const file of page.files) {
        if (seen.has(file.libraryFileId)) continue;
        seen.add(file.libraryFileId);
        all.push(file);
        pageFiles.push(file);
      }
      await onPage({ files: pageFiles, syncedCount: all.length, nextPage: page.nextPage });
      await onCheckpoint({ syncedCount: all.length, nextPage: page.nextPage });
      if (!page.nextPage) return all;

      const pageToken = `${page.nextPage.type}:${page.nextPage.value}`;
      if (seenPageTokens.has(pageToken)) {
        throw new LibraryResponseError("Library sync failed: pagination repeated a page token.");
      }
      seenPageTokens.add(pageToken);
      nextPage = page.nextPage;
      if (pageDelayMs > 0) await delayImpl(pageDelayMs);
    }
  }

  async function deleteLibraryFile(options) {
    const {
      file,
      accessToken,
      fetchImpl = fetch,
      deleteApi: suppliedDeleteApi,
      requestTimeoutMs = DELETE_TIMEOUT_MS
    } = options || {};
    if (!isSafeText(accessToken, ID_MAX_LENGTH * 8, false)) throw new TypeError("accessToken is required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
    const normalized = validateLibraryFile(file?.raw || file);
    if (!normalized) throw new TypeError("A valid library file is required");
    const deleteApi = resolveDeleteApi(suppliedDeleteApi);

    let response;
    try {
      response = await deleteApi.fetchWithTimeout(fetchImpl, buildDeleteUrl(normalized), {
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: `Bearer ${accessToken}` }
      }, requestTimeoutMs);
    } catch (error) {
      if (error instanceof deleteApi.DeleteBatchPauseError) throw error;
      throw libraryDeletePause(deleteApi, "Library delete request failed.");
    }
    if (!response.ok) {
      authOrRateLimitError(response, deleteApi, "delete");
      throw libraryDeletePause(deleteApi, `Library delete API returned ${response.status}.`);
    }

    try {
      const result = await withDeleteTimeout(
        response.json(),
        requestTimeoutMs,
        deleteApi,
        "Library delete response timed out."
      );
      if (!isPlainObject(result) || result.success !== true) {
        throw libraryDeletePause(deleteApi, "Library delete API did not confirm success.");
      }
      return true;
    } catch (error) {
      if (error instanceof deleteApi.DeleteBatchPauseError) throw error;
      throw libraryDeletePause(deleteApi, "Library delete response could not be verified.");
    }
  }

  return {
    DELETE_TIMEOUT_MS,
    LIBRARY_NODES_PATH,
    LibraryRequestError,
    LibraryResponseError,
    buildDeleteUrl,
    buildLibraryNodesUrl,
    deleteLibraryFile,
    fetchLibraryFiles,
    fetchLibraryPage,
    isLibraryFile,
    normalizeLibraryFile,
    parseLibraryPage,
    withDeleteTimeout,
    validateLibraryFile
  };
});
