(function () {
  /* ─────────────────────────────── STATE ────────────────────────────────── */
  const STATE = {
    enabled: false,
    selectedIds: new Set(),
    lastSelectedId: null,
    searchTerm: "",
    exactSearch: false,
    selectedYear: "all",
    cachedSortOrder: "newest",
    resultsCollapsed: true,
    syncingAll: false,
    deleting: false,
    deleteProgress: { current: 0, total: 0 },
    cachedConversations: [],
    cacheLoadedAt: null,
    skipDeleteWarning: false,
    uiHidden: false,
    observer: null,
    refreshTimer: null
  };

  const CACHE_KEY = "gptbd-conversation-cache-v1";
  const UI_HIDDEN_KEY = "gptbd-ui-hidden";
  const SKIP_DELETE_WARNING_KEY = "gptbd-skip-delete-warning";
  const APP_VERSION = chrome?.runtime?.getManifest?.().version || "1.0.0";
  const REPO_BASE_URL = "https://github.com/johnvouros/ChatGPT-bulk-delete-chats";
  const DOC_LINKS = {
    privacy: `${REPO_BASE_URL}/blob/main/PRIVACY.md`,
    license: `${REPO_BASE_URL}/blob/main/LICENSE`,
    terms: `${REPO_BASE_URL}/blob/main/TERMS.md`,
    bugs: `${REPO_BASE_URL}/issues/new`
  };

  /* ───────────────────────────── SELECTORS ──────────────────────────────── */
  const SELECTORS = {
    conversationLinks: [
      'a[href^="/c/"]',
      'a[href*="://chatgpt.com/c/"]',
      'a[href*="://chat.openai.com/c/"]'
    ].join(", "),
    sidebarRoots: ["nav", "aside", '[data-testid="history"]'].join(", "),
    menuButtons: [
      'button[aria-haspopup="menu"]',
      'button[aria-expanded]',
      'button[aria-label*="More"]',
      'button[aria-label*="more"]',
      '[id^="radix-"]',
      'button[data-testid*="history-item"]',
      'button[data-testid*="conversation"]'
    ].join(", "),
    menuItems: [
      '[role="menuitem"]',
      'button',
      '[data-radix-collection-item]'
    ].join(", "),
    dialogs: ['[role="dialog"]', '[aria-modal="true"]'].join(", ")
  };

  /* modal resolve handle — set by showDeleteModal, cleared on resolution */
  let activeModalResolve = null;

  /* ─────────────────────────────── BOOT ─────────────────────────────────── */
  function boot() {
    if (window.top !== window.self) return;
    injectShell();
    refreshConversationRows();
    observeDom();
    observePreferenceChanges();
    render();
  }

  /* ───────────────────────────── SHELL HTML ─────────────────────────────── */
  function injectShell() {
    if (document.getElementById("gpt-bulk-delete-root")) return;

    const root = document.createElement("div");
    root.id = "gpt-bulk-delete-root";
    root.innerHTML = `
      <div class="gptbd-toolbar">

        <!-- ── Main horizontal bar ── -->
        <div class="gptbd-bar">

          <!-- Identity + mode toggle -->
          <div class="gptbd-section gptbd-section--id">
            <div class="gptbd-mark" aria-hidden="true">
              <svg class="gptbd-mark-svg" viewBox="0 0 64 64" focusable="false">
                <defs>
                  <linearGradient id="gptbdG" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stop-color="#0f172a"/>
                    <stop offset="1" stop-color="#7f1d1d"/>
                  </linearGradient>
                </defs>
                <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#gptbdG)"/>
                <rect x="16" y="16" width="24" height="15" rx="6" fill="#fff" opacity="0.96"/>
                <rect x="21" y="24" width="24" height="15" rx="6" fill="#e5e7eb" opacity="0.98"/>
                <rect x="26" y="32" width="24" height="15" rx="6" fill="#cbd5e1"/>
                <rect x="19" y="20" width="14" height="2.8" rx="1.4" fill="#0f172a" opacity="0.78"/>
                <rect x="24" y="28" width="14" height="2.8" rx="1.4" fill="#0f172a" opacity="0.68"/>
                <rect x="29" y="36" width="14" height="2.8" rx="1.4" fill="#0f172a" opacity="0.58"/>
                <circle cx="47" cy="47" r="9" fill="#ef4444"/>
                <rect x="42" y="45.6" width="10" height="2.8" rx="1.4" fill="#fff"/>
              </svg>
            </div>
            <button type="button" class="gptbd-btn gptbd-btn--toggle" data-action="toggle" title="Toggle bulk-select mode (Esc to exit)">
              <svg class="gptbd-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="10" height="2" rx="1" fill="currentColor"/>
                <rect x="2" y="7" width="10" height="2" rx="1" fill="currentColor"/>
                <rect x="2" y="11" width="6" height="2" rx="1" fill="currentColor"/>
                <rect x="13" y="2" width="2" height="12" rx="1" fill="currentColor" opacity="0.35"/>
              </svg>
              <span data-role="toggle-label">Select chats</span>
            </button>
          </div>

          <div class="gptbd-sep" aria-hidden="true"></div>

          <!-- Search + exact toggle -->
          <div class="gptbd-section gptbd-section--search">
            <div class="gptbd-search-wrap">
              <svg class="gptbd-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
                <path d="M10 10L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <input type="text" class="gptbd-search" data-role="search"
                     placeholder="Filter chats…" spellcheck="false" autocomplete="off" />
              <button type="button" class="gptbd-search-clear" data-action="clear-search"
                      aria-label="Clear search" hidden title="Clear filter">
                <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
              <button type="button" class="gptbd-search-exact" data-action="toggle-exact"
                      title="Match whole words only" aria-label="Match whole words only">Exact</button>
            </div>
          </div>

          <div class="gptbd-sep" aria-hidden="true"></div>

          <!-- Sync -->
          <div class="gptbd-section gptbd-section--sync">
            <button type="button" class="gptbd-btn gptbd-btn--chip" data-action="sync-all"
                    title="Download full conversation list from ChatGPT API">
              <svg class="gptbd-icon gptbd-icon--sync" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M13.5 8A5.5 5.5 0 0 1 3 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M2.5 8A5.5 5.5 0 0 1 13 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M11 3l2 2.5L10.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 13L3 10.5 5.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span data-role="sync-label">Sync all</span>
            </button>
            <div class="gptbd-sync-meta">
              <span class="gptbd-meta-pill" data-role="cache-count" hidden></span>
              <button type="button" class="gptbd-cache-clear" data-action="clear-cache"
                      title="Clear local cache" aria-label="Clear local cache" hidden></button>
              <span class="gptbd-meta-dot" data-role="sync-dot" aria-hidden="true" hidden>·</span>
              <span class="gptbd-meta-text" data-role="last-sync" hidden></span>
            </div>
          </div>

          <div class="gptbd-sep" aria-hidden="true"></div>

          <!-- Count + destructive action -->
          <div class="gptbd-section gptbd-section--act">
            <span class="gptbd-count" data-role="count" aria-live="polite">0 selected</span>
            <button type="button" class="gptbd-btn gptbd-btn--delete" data-action="delete" disabled
                    title="Delete selected conversations (you will be asked to confirm)">
              <svg class="gptbd-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 4h10M6 4V3h4v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4.5 4l.8 8.5a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9L11.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <span data-role="delete-label">Delete</span>
            </button>
          </div>
        </div><!-- /.gptbd-bar -->

        <div class="gptbd-submeta">
          <div class="gptbd-submeta-left">
            <span class="gptbd-meta-text">local-only</span>
            <span class="gptbd-meta-dot">·</span>
            <span class="gptbd-meta-text">delete is permanent</span>
            <span class="gptbd-meta-dot" data-role="match-meta-dot" hidden>·</span>
            <span class="gptbd-meta-text" data-role="match-count" hidden></span>
            <span class="gptbd-meta-dot" data-role="jump-hint-dot" hidden>·</span>
            <span class="gptbd-meta-text gptbd-meta-text--hint" data-role="jump-hint" hidden>
              Scroll the sidebar to select chats
            </span>
            <button type="button" class="gptbd-submeta-link gptbd-submeta-link--hint" data-action="jump-to-chats" hidden>
              Jump to chats
            </button>
          </div>
          <div class="gptbd-submeta-right">
            <span class="gptbd-meta-text" data-role="version-info"></span>
            <span class="gptbd-meta-dot" aria-hidden="true">·</span>
            <a class="gptbd-submeta-link" href="${DOC_LINKS.privacy}" target="_blank" rel="noopener noreferrer">Privacy</a>
            <span class="gptbd-meta-dot" aria-hidden="true">·</span>
            <a class="gptbd-submeta-link" href="${DOC_LINKS.license}" target="_blank" rel="noopener noreferrer">License</a>
            <span class="gptbd-meta-dot" aria-hidden="true">·</span>
            <a class="gptbd-submeta-link" href="${DOC_LINKS.terms}" target="_blank" rel="noopener noreferrer">Terms</a>
            <span class="gptbd-meta-dot" aria-hidden="true">·</span>
            <a class="gptbd-submeta-link" href="${DOC_LINKS.bugs}" target="_blank" rel="noopener noreferrer">Report bug</a>
            <span class="gptbd-meta-dot" aria-hidden="true">·</span>
            <button type="button" class="gptbd-submeta-toggle" data-action="toggle-ui-visibility"
                    title="Hide this toolbar"
                    aria-label="Hide this toolbar">Hide</button>
          </div>
        </div>

        <!-- Progress strip (delete / sync) -->
        <div class="gptbd-progress" data-visible="false" aria-hidden="true">
          <div class="gptbd-progress__track">
            <div class="gptbd-progress__bar" data-role="progress-bar"></div>
          </div>
          <span class="gptbd-progress__label" data-role="progress-label"></span>
        </div>

        <div class="gptbd-results-actions" data-visible="false">
          <div class="gptbd-results-actions__left" data-role="year-filters"></div>
          <div class="gptbd-results-actions__right">
            <button type="button" class="gptbd-results-action" data-action="toggle-results">
              Hide list
            </button>
            <button type="button" class="gptbd-results-action" data-action="toggle-sort"
                    title="Sort cached results by chat date">Newest first</button>
            <button type="button" class="gptbd-results-action" data-action="select-all"
                    disabled title="Select all current results, or all cached chats if no filter is active">All</button>
            <button type="button" class="gptbd-results-action" data-action="clear"
                    disabled title="Clear selection">Clear</button>
          </div>
        </div>

        <!-- Search-results panel (cached conversations) -->
        <div class="gptbd-results" data-visible="false"></div>

      </div><!-- /.gptbd-toolbar -->

      <!-- ── Confirmation modal ── -->
      <div class="gptbd-modal" id="gptbd-modal" data-visible="false"
           role="dialog" aria-modal="true" aria-labelledby="gptbd-modal-title">
        <button type="button" class="gptbd-modal__backdrop" data-action="modal-cancel"
                aria-label="Cancel and close dialog" tabindex="-1"></button>
        <div class="gptbd-modal__panel">
          <div class="gptbd-modal__header">
            <div class="gptbd-modal__icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" class="gptbd-modal__icon">
                <path d="M10 3L17.66 17H2.34L10 3Z" stroke="#ef4444" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M10 8v4" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="10" cy="14.5" r=".75" fill="#ef4444"/>
              </svg>
            </div>
            <div>
              <h2 class="gptbd-modal__title" id="gptbd-modal-title" data-role="modal-title">
                Delete conversations?
              </h2>
              <p class="gptbd-modal__subtitle">
                Permanent. ChatGPT does not support undo.
              </p>
            </div>
          </div>
          <div class="gptbd-modal__preview" data-role="modal-preview"></div>
          <div class="gptbd-modal__warning">
            <p class="gptbd-modal__warning-text">
              Delete is permanent and cannot be recovered.
            </p>
            <label class="gptbd-modal__check">
              <input type="checkbox" class="gptbd-modal__check-input" data-role="modal-warning-check" />
              <span class="gptbd-modal__check-label">I understand this delete is permanent and cannot be recovered.</span>
            </label>
            <label class="gptbd-modal__check">
              <input type="checkbox" class="gptbd-modal__check-input" data-role="modal-skip-warning-check" />
              <span class="gptbd-modal__check-label">Don't show me this warning again.</span>
            </label>
          </div>
          <div class="gptbd-modal__footer">
            <button type="button" class="gptbd-btn gptbd-btn--cancel" data-action="modal-cancel">
              Cancel
            </button>
            <button type="button" class="gptbd-btn gptbd-btn--delete-confirm" data-action="modal-confirm">
              <span data-role="modal-confirm-label">Delete</span>
            </button>
          </div>
        </div>
      </div><!-- /.gptbd-modal -->

      <!-- Toast -->
      <div class="gptbd-toast" aria-live="polite" aria-atomic="true"></div>
    `;

    document.documentElement.appendChild(root);

    /* ── Event delegation ── */
    root.addEventListener("click", async (event) => {
      const el = event.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;

      if (action === "toggle") {
        STATE.enabled = !STATE.enabled;
        if (!STATE.enabled) {
          STATE.selectedIds.clear();
          STATE.lastSelectedId = null;
        }
        refreshConversationRows();
        render();
        return;
      }

      if (action === "sync-all") {
        await syncAllChats();
        return;
      }

      if (action === "toggle-exact") {
        STATE.exactSearch = !STATE.exactSearch;
        refreshConversationRows();
        render();
        return;
      }

      if (action === "clear-search") {
        STATE.searchTerm = "";
        const searchInput = root.querySelector('[data-role="search"]');
        if (searchInput) searchInput.value = "";
        refreshConversationRows();
        render();
        return;
      }

      if (action === "select-all") {
        selectAllRows();
        render();
        return;
      }

      if (action === "jump-to-chats") {
        jumpToFirstConversationRow();
        render();
        return;
      }

      if (action === "clear") {
        STATE.selectedIds.clear();
        STATE.lastSelectedId = null;
        syncCheckboxes();
        render();
        return;
      }

      if (action === "toggle-sort") {
        STATE.cachedSortOrder = STATE.cachedSortOrder === "newest" ? "oldest" : "newest";
        render();
        return;
      }

      if (action === "toggle-results") {
        STATE.resultsCollapsed = !STATE.resultsCollapsed;
        render();
        return;
      }

      if (action === "filter-year") {
        STATE.selectedYear = el.dataset.year || "all";
        render();
        return;
      }

      if (action === "clear-cache") {
        const confirmed = await showClearCacheModal();
        if (!confirmed) return;
        clearLocalCache();
        refreshConversationRows();
        render();
        showToast("Local cache cleared.");
        return;
      }

      if (action === "delete") {
        await deleteSelectedConversations();
        return;
      }

      if (action === "toggle-ui-visibility") {
        await setUiHiddenPreference(!STATE.uiHidden);
        return;
      }

      if (action === "modal-cancel") {
        if (activeModalResolve) activeModalResolve(false);
        return;
      }

      if (action === "modal-confirm") {
        if (activeModalResolve) activeModalResolve(true);
        return;
      }
    });

    /* ── Search input ── */
    const searchInput = root.querySelector('[data-role="search"]');
    searchInput.addEventListener("input", (event) => {
      STATE.searchTerm = normalizeSearchTerm(event.target.value);
      if (STATE.searchTerm) STATE.resultsCollapsed = false;
      refreshConversationRows();
      render();
    });

    /* ── Keyboard: Escape exits select mode / closes modal ── */
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (activeModalResolve) return; // modal handles its own Escape
      if (STATE.enabled && !STATE.deleting && !STATE.syncingAll) {
        STATE.enabled = false;
        STATE.selectedIds.clear();
        STATE.lastSelectedId = null;
        refreshConversationRows();
        render();
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Node)) return;
      if (shouldAutoCollapseResults(event.target)) {
        STATE.resultsCollapsed = true;
        render();
      }
    }, true);

    render();
  }

  /* ───────────────────────────── DOM OBSERVER ───────────────────────────── */
  function observeDom() {
    if (STATE.observer) return;
    STATE.observer = new MutationObserver(() => {
      window.clearTimeout(STATE.refreshTimer);
      STATE.refreshTimer = window.setTimeout(() => {
        refreshConversationRows();
        render();
      }, 150);
    });
    STATE.observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ──────────────────────────────── RENDER ──────────────────────────────── */
  function render() {
    const toolbar = document.querySelector(".gptbd-toolbar");
    const root = document.getElementById("gpt-bulk-delete-root");
    if (!toolbar || !root) return;

    toolbar.hidden = STATE.uiHidden;
    if (STATE.uiHidden) return;

    const selectedCount = STATE.selectedIds.size;
    const matchCount = getSearchResults().length;
    const hasCache = STATE.cachedConversations.length > 0;
    const busy = STATE.deleting || STATE.syncingAll;

    /* Toggle button */
    const toggleLabel = toolbar.querySelector('[data-role="toggle-label"]');
    const toggleBtn = toolbar.querySelector('[data-action="toggle"]');
    if (toggleLabel) toggleLabel.textContent = STATE.enabled ? "Exit" : "Select chats";
    if (toggleBtn) {
      toggleBtn.disabled = busy;
      toggleBtn.dataset.active = String(STATE.enabled);
    }

    /* Sync button */
    const syncBtn = toolbar.querySelector('[data-action="sync-all"]');
    const syncLabel = toolbar.querySelector('[data-role="sync-label"]');
    if (syncLabel) syncLabel.textContent = STATE.syncingAll ? "Syncing…" : hasCache ? "Resync" : "Sync all";
    if (syncBtn) {
      syncBtn.disabled = busy;
      syncBtn.dataset.spinning = String(STATE.syncingAll);
    }

    /* Sync meta */
    const cacheCountEl = toolbar.querySelector('[data-role="cache-count"]');
    const clearCacheBtn = toolbar.querySelector('[data-action="clear-cache"]');
    const syncDotEl = toolbar.querySelector('[data-role="sync-dot"]');
    const lastSyncEl = toolbar.querySelector('[data-role="last-sync"]');
    if (cacheCountEl) {
      cacheCountEl.textContent = hasCache ? `${STATE.cachedConversations.length.toLocaleString()} cached` : "";
      cacheCountEl.hidden = !hasCache;
    }
    if (clearCacheBtn) {
      clearCacheBtn.hidden = !hasCache;
      clearCacheBtn.disabled = busy;
    }
    if (lastSyncEl) {
      const syncedText = STATE.cacheLoadedAt ? formatLastSync(STATE.cacheLoadedAt) : "";
      lastSyncEl.textContent = syncedText;
      lastSyncEl.hidden = !syncedText;
    }
    if (syncDotEl) syncDotEl.hidden = !(hasCache && STATE.cacheLoadedAt);

    const versionInfoEl = toolbar.querySelector('[data-role="version-info"]');
    if (versionInfoEl) versionInfoEl.textContent = `v${APP_VERSION}`;

    const uiToggleBtn = toolbar.querySelector('[data-action="toggle-ui-visibility"]');
    if (uiToggleBtn) {
      uiToggleBtn.textContent = STATE.uiHidden ? "Show" : "Hide";
      uiToggleBtn.title = STATE.uiHidden ? "Show this toolbar" : "Hide this toolbar";
      uiToggleBtn.setAttribute("aria-label", uiToggleBtn.title);
      uiToggleBtn.disabled = busy;
    }

    /* Search */
    const searchInput = toolbar.querySelector('[data-role="search"]');
    const clearSearchBtn = toolbar.querySelector('[data-action="clear-search"]');
    const exactBtn = toolbar.querySelector('[data-action="toggle-exact"]');
    const matchCountEl = toolbar.querySelector('[data-role="match-count"]');
    const matchMetaDotEl = toolbar.querySelector('[data-role="match-meta-dot"]');
    const jumpHintDotEl = toolbar.querySelector('[data-role="jump-hint-dot"]');
    const jumpHintEl = toolbar.querySelector('[data-role="jump-hint"]');
    const jumpHintBtn = toolbar.querySelector('[data-action="jump-to-chats"]');
    if (searchInput) searchInput.disabled = busy;
    if (clearSearchBtn) clearSearchBtn.hidden = !STATE.searchTerm;
    if (exactBtn) {
      exactBtn.disabled = busy;
      exactBtn.dataset.active = String(STATE.exactSearch);
    }
    if (matchCountEl) {
      const hasSearch = Boolean(STATE.searchTerm);
      const hasYearFilter = STATE.selectedYear !== "all";
      if (hasSearch || hasYearFilter) {
        const parts = [`${matchCount} match${matchCount === 1 ? "" : "es"}`];
        if (hasYearFilter) parts.push(`year ${STATE.selectedYear}`);
        matchCountEl.textContent = parts.join(" in ");
      } else {
        matchCountEl.textContent = "";
      }
      matchCountEl.hidden = !(hasSearch || hasYearFilter);
    }
    if (matchMetaDotEl) matchMetaDotEl.hidden = !(STATE.searchTerm || STATE.selectedYear !== "all");

    const shouldShowJumpHint = STATE.enabled && !busy && needsJumpToChatsHint();
    if (jumpHintDotEl) jumpHintDotEl.hidden = !shouldShowJumpHint;
    if (jumpHintEl) jumpHintEl.hidden = !shouldShowJumpHint;
    if (jumpHintBtn) jumpHintBtn.hidden = !shouldShowJumpHint;

    /* Selection buttons */
    const selectAllBtn = toolbar.querySelector('[data-action="select-all"]');
    const clearBtn = toolbar.querySelector('[data-action="clear"]');
    const sortBtn = toolbar.querySelector('[data-action="toggle-sort"]');
    const toggleResultsBtn = toolbar.querySelector('[data-action="toggle-results"]');
    const resultsActions = toolbar.querySelector(".gptbd-results-actions");
    const yearFiltersHost = toolbar.querySelector('[data-role="year-filters"]');
    const selectableCount = getSelectableConversationIds().length;
    const showingCachedResults = STATE.cachedConversations.length > 0;
    if (selectAllBtn) selectAllBtn.disabled = busy || selectableCount === 0;
    if (clearBtn) clearBtn.disabled = selectedCount === 0 || busy;
    if (sortBtn) {
      sortBtn.disabled = busy || !showingCachedResults;
      sortBtn.textContent = STATE.cachedSortOrder === "newest" ? "Newest first" : "Oldest first";
    }
    if (toggleResultsBtn) {
      toggleResultsBtn.disabled = busy || !showingCachedResults;
      toggleResultsBtn.textContent = STATE.resultsCollapsed ? "Show list" : "Hide list";
    }
    if (resultsActions) {
      resultsActions.dataset.visible = String(showingCachedResults);
    }
    if (yearFiltersHost) {
      yearFiltersHost.innerHTML = showingCachedResults ? renderYearFilters(getAvailableYears()) : "";
    }

    /* Count */
    const countEl = toolbar.querySelector('[data-role="count"]');
    if (countEl) {
      countEl.textContent = `${selectedCount} selected`;
      countEl.dataset.hasSelection = String(selectedCount > 0);
    }

    /* Delete button */
    const deleteBtn = toolbar.querySelector('[data-action="delete"]');
    const deleteLabelEl = toolbar.querySelector('[data-role="delete-label"]');
    if (deleteBtn) deleteBtn.disabled = selectedCount === 0 || busy;
    if (deleteLabelEl) {
      if (STATE.deleting) {
        deleteLabelEl.textContent = `Deleting ${STATE.deleteProgress.current}\u2009/\u2009${STATE.deleteProgress.total}`;
      } else {
        deleteLabelEl.textContent = selectedCount > 0 ? `Delete\u00a0${selectedCount}` : "Delete";
      }
    }

    /* Progress strip */
    const progressWrap = toolbar.querySelector(".gptbd-progress");
    const progressBar = toolbar.querySelector('[data-role="progress-bar"]');
    const progressLabel = toolbar.querySelector('[data-role="progress-label"]');
    if (progressWrap && progressBar) {
      if (STATE.deleting) {
        progressWrap.dataset.visible = "true";
        progressWrap.dataset.indeterminate = "false";
        const pct = STATE.deleteProgress.total > 0
          ? (STATE.deleteProgress.current / STATE.deleteProgress.total) * 100
          : 0;
        progressBar.style.width = `${pct}%`;
        if (progressLabel) progressLabel.textContent =
          `${STATE.deleteProgress.current} of ${STATE.deleteProgress.total} deleted`;
      } else if (STATE.syncingAll) {
        progressWrap.dataset.visible = "true";
        progressWrap.dataset.indeterminate = "true";
        progressBar.style.width = "0%";
        if (progressLabel) progressLabel.textContent = "Fetching conversation list…";
      } else {
        progressWrap.dataset.visible = "false";
        progressWrap.dataset.indeterminate = "false";
        progressBar.style.width = "0%";
        if (progressLabel) progressLabel.textContent = "";
      }
    }

    renderResultsPanel(toolbar.querySelector(".gptbd-results"));
  }

  /* ─────────────────────── CONVERSATION ROW HELPERS ─────────────────────── */
  function getConversationRows() {
    const sidebarRoots = Array.from(document.querySelectorAll(SELECTORS.sidebarRoots));
    const scopedLinks = sidebarRoots.flatMap(r => Array.from(r.querySelectorAll(SELECTORS.conversationLinks)));
    const links = scopedLinks.length > 0 ? scopedLinks : Array.from(document.querySelectorAll(SELECTORS.conversationLinks));

    return links
      .map(link => {
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/c\/([a-zA-Z0-9-]+)/);
        if (!match) return null;
        const row = findConversationRow(link);
        if (!row || row.dataset.gptbdIgnore === "true" || row.dataset.gptbdDeleted === "true") return null;
        return { id: match[1], link, row };
      })
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex(other => other.id === item.id) === index);
  }

  function getFirstConversationRow() {
    return getConversationRows()[0] || null;
  }

  function findConversationRow(link) {
    const preferred = link.closest("li, [role='listitem']");
    if (preferred) return preferred;

    let node = link;
    while (node && node !== document.body) {
      if (node.querySelectorAll("button").length > 0) return node;
      node = node.parentElement;
    }
    return link.parentElement;
  }

  function refreshConversationRows() {
    const rows = getConversationRows();
    const liveIds = new Set(rows.map(r => r.id));
    const cachedIds = new Set(STATE.cachedConversations.map(c => c.id));

    for (const id of Array.from(STATE.selectedIds)) {
      if (!liveIds.has(id) && !cachedIds.has(id)) STATE.selectedIds.delete(id);
    }

    rows.forEach(({ id, row, link }) => {
      const title = normalizeText(link.textContent);
      row.dataset.gptbdConversationId = id;
      row.dataset.gptbdConversationTitle = title;
      row.classList.toggle("gptbd-row-enabled", STATE.enabled);
      row.classList.toggle("gptbd-row-selected", STATE.selectedIds.has(id));
      applySearchState(row, title);

      /* Inject checkbox */
      let checkbox = row.querySelector(".gptbd-checkbox");
      if (!checkbox) {
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "gptbd-checkbox";
        checkbox.setAttribute("aria-label", "Select conversation for deletion");

        checkbox.addEventListener("click", event => event.stopPropagation());

        checkbox.addEventListener("change", event => {
          const currentRow = event.target.closest("[data-gptbd-conversation-id]");
          const currentId = currentRow?.dataset.gptbdConversationId;
          if (!currentId) return;

          const checked = event.target.checked;

          /* Shift-range select */
          if (event.shiftKey && STATE.lastSelectedId && STATE.lastSelectedId !== currentId) {
            const allRows = getRangeSelectableRows();
            const allIds = allRows.map(r => r.id);
            const cIdx = allIds.indexOf(currentId);
            const lIdx = allIds.indexOf(STATE.lastSelectedId);
            if (cIdx !== -1 && lIdx !== -1) {
              const lo = Math.min(cIdx, lIdx);
              const hi = Math.max(cIdx, lIdx);
              for (let i = lo; i <= hi; i++) {
                if (checked) STATE.selectedIds.add(allIds[i]);
                else STATE.selectedIds.delete(allIds[i]);
              }
              syncCheckboxes();
              STATE.lastSelectedId = currentId;
              render();
              return;
            }
          }

          if (checked) STATE.selectedIds.add(currentId);
          else STATE.selectedIds.delete(currentId);
          currentRow.classList.toggle("gptbd-row-selected", checked);
          STATE.lastSelectedId = currentId;
          render();
        });
      }

      checkbox.checked = STATE.selectedIds.has(id);
      checkbox.hidden = !STATE.enabled;
      if (!checkbox.parentElement) row.insertBefore(checkbox, row.firstChild);

      /* Row-click handler (toggling via click anywhere on the row) */
      if (!row.dataset.gptbdBound) {
        row.dataset.gptbdBound = "true";
        row.addEventListener("click", event => {
          if (!STATE.enabled) return;
          if (event.target.closest(".gptbd-checkbox")) return;
          if (event.target.closest("button")) return;

          event.preventDefault();
          event.stopPropagation();

          const currentCheckbox = row.querySelector(".gptbd-checkbox");
          if (!currentCheckbox) return;

          const currentId = row.dataset.gptbdConversationId;
          const newChecked = !currentCheckbox.checked;

          /* Shift-range select from row click */
          if (event.shiftKey && STATE.lastSelectedId && STATE.lastSelectedId !== currentId) {
            const allRows = getRangeSelectableRows();
            const allIds = allRows.map(r => r.id);
            const cIdx = allIds.indexOf(currentId);
            const lIdx = allIds.indexOf(STATE.lastSelectedId);
            if (cIdx !== -1 && lIdx !== -1) {
              const lo = Math.min(cIdx, lIdx);
              const hi = Math.max(cIdx, lIdx);
              for (let i = lo; i <= hi; i++) {
                if (newChecked) STATE.selectedIds.add(allIds[i]);
                else STATE.selectedIds.delete(allIds[i]);
              }
              syncCheckboxes();
              STATE.lastSelectedId = currentId;
              render();
              return;
            }
          }

          currentCheckbox.checked = newChecked;
          currentCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        }, true);
      }

      link.dataset.gptbdConversationLink = id;
    });
  }

  function syncCheckboxes() {
    Array.from(document.querySelectorAll(".gptbd-checkbox")).forEach(checkbox => {
      const row = checkbox.closest("[data-gptbd-conversation-id]");
      if (!row) return;
      const id = row.dataset.gptbdConversationId;
      const checked = STATE.selectedIds.has(id);
      checkbox.checked = checked;
      row.classList.toggle("gptbd-row-selected", checked);
      checkbox.hidden = !STATE.enabled;
    });
  }

  function selectVisibleRows() {
    getVisibleRows().forEach(({ id }) => STATE.selectedIds.add(id));
    syncCheckboxes();
  }

  function selectAllRows() {
    getSelectableConversationIds().forEach(id => STATE.selectedIds.add(id));
    syncCheckboxes();
  }

  function selectMatchingRows() {
    getSearchResults().forEach(({ id }) => STATE.selectedIds.add(id));
    syncCheckboxes();
  }

  function getSelectableConversationIds() {
    if (STATE.cachedConversations.length > 0) return getSearchResults().map(item => item.id);
    return (STATE.searchTerm ? getMatchingRows() : getVisibleRows()).map(item => item.id);
  }

  function getVisibleRows() {
    return getConversationRows().filter(({ row }) => !row.classList.contains("gptbd-row-hidden"));
  }

  function needsJumpToChatsHint() {
    const firstRow = getFirstConversationRow();
    if (!firstRow?.row) return false;

    const scrollContainer = getConversationScrollContainer(firstRow.row);
    if (!scrollContainer) return false;

    const rowRect = firstRow.row.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const isAbove = rowRect.top < containerRect.top;
    const isBelow = rowRect.bottom > containerRect.bottom;
    return isAbove || isBelow;
  }

  function jumpToFirstConversationRow() {
    const firstRow = getFirstConversationRow();
    if (!firstRow?.row) return;

    firstRow.row.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });

    const link = firstRow.row.querySelector("a");
    if (link instanceof HTMLElement) {
      window.setTimeout(() => {
        link.focus({ preventScroll: true });
      }, 250);
    }
  }

  function getConversationScrollContainer(row) {
    const sidebarRoot = row.closest("nav, aside, [data-testid='history']");
    if (!(sidebarRoot instanceof HTMLElement)) return null;

    let node = row.parentElement;
    while (node && node !== sidebarRoot) {
      if (isScrollable(node)) return node;
      node = node.parentElement;
    }

    return isScrollable(sidebarRoot) ? sidebarRoot : sidebarRoot;
  }

  function getRangeSelectableRows() {
    return STATE.searchTerm ? getMatchingRows() : getConversationRows();
  }

  function getMatchingRows() {
    if (!STATE.searchTerm) return getConversationRows();
    return getConversationRows().filter(({ row, link }) => {
      const title = row.dataset.gptbdConversationTitle || normalizeText(link.textContent);
      return matchesSearch(title, STATE.searchTerm);
    });
  }

  function getSearchResults() {
    if (STATE.cachedConversations.length > 0) {
      return sortCachedResults(filterCachedResults(STATE.cachedConversations));
    }
    return getMatchingRows().map(({ id, link }) => ({
      id,
      title: normalizeText(link.textContent) || "Untitled chat"
    }));
  }

  function applySearchState(row, title) {
    const hasSearch = Boolean(STATE.searchTerm);
    const isMatch = !hasSearch || matchesSearch(title, STATE.searchTerm);
    row.classList.toggle("gptbd-row-match", hasSearch && isMatch);
    row.classList.remove("gptbd-row-hidden");
  }

  /* ─────────────────────────── DELETE FLOW ──────────────────────────────── */
  async function deleteSelectedConversations() {
    const ids = Array.from(STATE.selectedIds);
    if (ids.length === 0 || STATE.deleting) return;

    /* Resolve display titles for the preview list */
    const titles = ids.map(id => {
      const cached = STATE.cachedConversations.find(c => c.id === id);
      if (cached) return cached.title;
      const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
      return row?.dataset.gptbdConversationTitle || "Untitled chat";
    });

    const confirmed = await showDeleteModal(ids, titles);
    if (!confirmed) return;

    STATE.deleting = true;
    STATE.deleteProgress = { current: 0, total: ids.length };
    render();

    let deleted = 0;
    const failed = [];
    let sidebarRefreshed = false;

    for (const id of ids) {
      try {
        const success = await deleteConversationById(id);
        if (success) {
          STATE.selectedIds.delete(id);
          removeConversationRow(id);
          removeConversationFromCache(id);
          deleted += 1;
        } else {
          failed.push(id);
        }
      } catch (_) {
        failed.push(id);
      }

      STATE.deleteProgress.current += 1;
      refreshConversationRows();
      render();
    }

    if (deleted > 0) {
      sidebarRefreshed = await refreshSidebarAfterDelete();
      refreshConversationRows();
    }

    STATE.deleting = false;
    render();

    showToast(buildDeleteSummary(deleted, failed.length, sidebarRefreshed));
  }

  /* Show the in-DOM confirmation modal; returns Promise<boolean> */
  function showDeleteModal(ids, titles) {
    if (STATE.skipDeleteWarning) return Promise.resolve(true);

    return new Promise(resolve => {
      const modal = document.getElementById("gptbd-modal");
      if (!modal) { resolve(false); return; }

      const count = ids.length;
      const titleEl = modal.querySelector('[data-role="modal-title"]');
      const previewEl = modal.querySelector('[data-role="modal-preview"]');
      const confirmLabel = modal.querySelector('[data-role="modal-confirm-label"]');
      const warningCheck = modal.querySelector('[data-role="modal-warning-check"]');
      const skipWarningCheck = modal.querySelector('[data-role="modal-skip-warning-check"]');
      const confirmBtn = modal.querySelector('[data-action="modal-confirm"]');

      if (titleEl) {
        titleEl.textContent = `Delete ${count}\u00a0conversation${count === 1 ? "" : "s"}?`;
      }
      if (confirmLabel) {
        confirmLabel.textContent = `Delete\u00a0${count}\u00a0conversation${count === 1 ? "" : "s"}`;
      }
      if (warningCheck) warningCheck.checked = false;
      if (skipWarningCheck) skipWarningCheck.checked = false;
      if (confirmBtn) confirmBtn.disabled = true;

      if (previewEl) {
        const maxShow = 8;
        const shown = titles.slice(0, maxShow);
        const remaining = titles.length - shown.length;
        previewEl.innerHTML =
          shown.map(t =>
            `<div class="gptbd-modal__preview-item">
               <span class="gptbd-modal__preview-bullet" aria-hidden="true"></span>
               <span class="gptbd-modal__preview-text">${escapeHtml(t)}</span>
             </div>`
          ).join("") +
          (remaining > 0
            ? `<div class="gptbd-modal__preview-more">+\u202f${remaining}\u00a0more\u2026</div>`
            : "");
      }

      modal.dataset.visible = "true";

      function syncConfirmState() {
        if (confirmBtn && warningCheck) {
          confirmBtn.disabled = !warningCheck.checked;
        }
      }

      syncConfirmState();
      if (warningCheck) warningCheck.addEventListener("change", syncConfirmState);

      /* Focus warning checkbox first so the required action is obvious */
      window.setTimeout(() => { if (warningCheck) warningCheck.focus(); }, 60);

      async function done(result) {
        if (result && skipWarningCheck?.checked) {
          await setSkipDeleteWarningPreference(true);
        }
        if (warningCheck) warningCheck.removeEventListener("change", syncConfirmState);
        modal.dataset.visible = "false";
        document.removeEventListener("keydown", onKeydown);
        activeModalResolve = null;
        resolve(result);
      }

      function onKeydown(e) {
        if (e.key === "Escape") done(false);
      }

      document.addEventListener("keydown", onKeydown);
      activeModalResolve = done;
    });
  }

  function showClearCacheModal() {
    return new Promise(resolve => {
      const modal = document.getElementById("gptbd-modal");
      if (!modal) { resolve(false); return; }

      const titleEl = modal.querySelector('[data-role="modal-title"]');
      const subtitleEl = modal.querySelector(".gptbd-modal__subtitle");
      const previewEl = modal.querySelector('[data-role="modal-preview"]');
      const warningWrap = modal.querySelector(".gptbd-modal__warning");
      const warningText = modal.querySelector(".gptbd-modal__warning-text");
      const warningCheckWrap = modal.querySelector('[data-role="modal-warning-check"]')?.closest(".gptbd-modal__check");
      const skipWarningCheckWrap = modal.querySelector('[data-role="modal-skip-warning-check"]')?.closest(".gptbd-modal__check");
      const confirmLabel = modal.querySelector('[data-role="modal-confirm-label"]');
      const confirmBtn = modal.querySelector('[data-action="modal-confirm"]');

      if (titleEl) titleEl.textContent = "Clear local cache?";
      if (subtitleEl) subtitleEl.textContent = "This removes the synced chat list stored in the extension on this browser only.";
      if (previewEl) {
        previewEl.innerHTML = `
          <div class="gptbd-modal__preview-item">
            <span class="gptbd-modal__preview-bullet" aria-hidden="true"></span>
            <span class="gptbd-modal__preview-text">Your chats in ChatGPT will not be deleted.</span>
          </div>
          <div class="gptbd-modal__preview-item">
            <span class="gptbd-modal__preview-bullet" aria-hidden="true"></span>
            <span class="gptbd-modal__preview-text">You will need to click Sync all again to restore the cached list.</span>
          </div>`;
      }
      if (warningWrap) warningWrap.hidden = false;
      if (warningText) warningText.textContent = "Clearing local cache removes the saved chat list from this browser.";
      if (warningCheckWrap) warningCheckWrap.hidden = true;
      if (skipWarningCheckWrap) skipWarningCheckWrap.hidden = true;
      if (confirmLabel) confirmLabel.textContent = "Clear cache";
      if (confirmBtn) confirmBtn.disabled = false;

      modal.dataset.visible = "true";
      window.setTimeout(() => { if (confirmBtn) confirmBtn.focus(); }, 60);

      function resetModal() {
        if (warningWrap) warningWrap.hidden = false;
        if (warningCheckWrap) warningCheckWrap.hidden = false;
        if (skipWarningCheckWrap) skipWarningCheckWrap.hidden = false;
      }

      function done(result) {
        resetModal();
        modal.dataset.visible = "false";
        document.removeEventListener("keydown", onKeydown);
        activeModalResolve = null;
        resolve(result);
      }

      function onKeydown(e) {
        if (e.key === "Escape") done(false);
      }

      document.addEventListener("keydown", onKeydown);
      activeModalResolve = done;
    });
  }

  /* ───────────────────────── INDIVIDUAL DELETION ─────────────────────────── */
  async function deleteConversationById(id) {
    const apiDeleted = await deleteConversationByApi(id);
    if (apiDeleted) return true;

    const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
    if (!row) return false;

    row.scrollIntoView({ block: "center" });
    revealRowActions(row);
    await delay(220);

    const menuButton = findMenuButton(row);
    if (!menuButton) return false;

    const menuSurfacesBefore = getVisibleMenuSurfaces();
    openConversationMenu(menuButton);
    const menuSurface = await waitForMenuSurface(menuSurfacesBefore);
    const deleteControl = await waitForDeleteMenuItem(menuSurface);
    if (!deleteControl) { dismissOpenMenus(); return false; }

    const dialogsBefore = getVisibleDialogs();
    deleteControl.click();

    const confirmButton = await waitForDeleteConfirmButton(dialogsBefore);
    if (!confirmButton) { dismissOpenMenus(); return false; }

    confirmButton.click();
    return waitForConversationRemoval(id, 5000);
  }

  async function deleteConversationByApi(id) {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return false;

      const response = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ is_visible: false })
      });

      if (!response.ok) return false;
      return await waitForConversationRemoval(id, 3000);
    } catch (_) {
      return false;
    }
  }

  function findMenuButton(row) {
    const buttons = Array.from(row.querySelectorAll(SELECTORS.menuButtons));
    return buttons
      .filter(b => b instanceof HTMLElement)
      .map(b => ({ button: b, score: scoreMenuButton(b) }))
      .sort((a, b) => b.score - a.score)[0]?.button || null;
  }

  async function waitForDeleteMenuItem(menuSurface) {
    return waitFor(() => {
      if (!(menuSurface instanceof HTMLElement) || !isElementVisible(menuSurface)) return null;
      const items = Array.from(menuSurface.querySelectorAll(SELECTORS.menuItems)).filter(item => {
        return isElementVisible(item) && !item.closest("#gpt-bulk-delete-root");
      });
      const exact = items.find(item => /delete|trash/i.test(normalizeText(item.textContent)));
      if (exact) return exact;

      const danger = items.find(item => {
        const text = normalizeText(item.textContent);
        const cls = typeof item.className === "string" ? item.className : "";
        return /delete|remove/i.test(text) || /danger|error|destructive/i.test(cls);
      });
      if (danger) return danger;

      const menuItems = items.filter(item => item.getAttribute("role") === "menuitem");
      return menuItems.at(-1) || null;
    }, 2500);
  }

  async function waitForDeleteConfirmButton(dialogsBefore = []) {
    return waitFor(() => {
      const beforeSet = new Set(dialogsBefore);
      const dialogs = getVisibleDialogs();
      const preferredDialogs = dialogs.filter(dialog => !beforeSet.has(dialog));
      for (const dialog of preferredDialogs.length > 0 ? preferredDialogs : dialogs) {
        const match = Array.from(dialog.querySelectorAll("button"))
          .find(b => /^delete$/i.test(normalizeText(b.textContent)));
        if (match) return match;
      }
      return null;
    }, 4000);
  }

  async function waitForConversationRemoval(id, timeoutMs) {
    const removed = await waitFor(() => {
      return !document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
    }, timeoutMs);
    return Boolean(removed);
  }

  async function waitFor(checkFn, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = checkFn();
      if (result) return result;
      await delay(120);
    }
    return null;
  }

  function dismissOpenMenus() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  /* ───────────────────────────── TOAST ─────────────────────────────────── */
  function showToast(message) {
    const toast = document.querySelector(".gptbd-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.visible = "true";
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.dataset.visible = "false"; }, 4000);
  }

  /* ──────────────────────────── SYNC ALL ────────────────────────────────── */
  async function syncAllChats() {
    if (STATE.syncingAll || STATE.deleting) return;
    STATE.syncingAll = true;
    render();

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        showToast("Could not read your ChatGPT session. Refresh the page and try again.");
        return;
      }
      const conversations = await fetchAllConversations(accessToken);
      STATE.cachedConversations = conversations;
      STATE.cacheLoadedAt = Date.now();
      persistCache();
      render();
      showToast(`Synced ${conversations.length.toLocaleString()} chats to cache.`);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Sync failed. Refresh ChatGPT and try again.";
      showToast(message);
    } finally {
      STATE.syncingAll = false;
      render();
    }
  }

  async function fetchAllConversations(accessToken) {
    const limit = 100;
    let offset = 0;
    const all = [];
    const seen = new Set();

    while (true) {
      const response = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) throw new Error(`Conversation sync failed: ${response.status}`);

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : [];

      items.forEach(item => {
        if (!item?.id || seen.has(item.id)) return;
        seen.add(item.id);
        all.push({
          id: item.id,
          title: normalizeText(item.title) || "Untitled chat",
          updateTime: item.update_time || item.create_time || null
        });
      });

      if (items.length < limit) break;
      offset += items.length;
      await delay(120);
    }

    return all.sort((a, b) => {
      const at = a.updateTime ? Date.parse(a.updateTime) : 0;
      const bt = b.updateTime ? Date.parse(b.updateTime) : 0;
      return bt - at;
    });
  }

  /* ──────────────────────────── RESULTS PANEL ────────────────────────────── */
  function renderResultsPanel(panel) {
    if (!panel) return;
    const hasSearch = Boolean(STATE.searchTerm);
    const hasCache = STATE.cachedConversations.length > 0;
    const shouldShow = (hasSearch && !hasCache) || (hasCache && !STATE.resultsCollapsed);
    panel.dataset.visible = String(shouldShow);

    if (!shouldShow) { panel.innerHTML = ""; return; }
    if (!hasCache) {
      panel.innerHTML = `
        <div class="gptbd-empty gptbd-empty--notice">
          Search history is not synced yet. Click Sync all to load your full chat history first.
        </div>`;
      return;
    }

    const results = getSearchResults().slice(0, 250);
    if (results.length === 0) {
      panel.innerHTML = `
        <div class="gptbd-empty">No cached chats match this filter.</div>`;
      return;
    }

    panel.innerHTML = `
      <div class="gptbd-results-header" aria-hidden="true">
        <span class="gptbd-results-header__title">Chat</span>
        <span class="gptbd-results-header__date">Date</span>
        <span class="gptbd-results-header__open">Open</span>
      </div>
      ${results.map(c => {
      const checked = STATE.selectedIds.has(c.id) ? "checked" : "";
      const href = `/c/${encodeURIComponent(c.id)}`;
      const dateText = formatConversationDate(c.updateTime);
      return `
        <div class="gptbd-result">
          <label class="gptbd-result-main">
            <input type="checkbox" class="gptbd-result-checkbox" data-id="${escapeHtml(c.id)}" ${checked} />
            <span class="gptbd-result-title">${escapeHtml(c.title || "Untitled chat")}</span>
          </label>
          <span class="gptbd-result-date" title="${escapeHtml(dateText)}">${escapeHtml(dateText)}</span>
          <a class="gptbd-result-open" href="${href}" target="_blank" rel="noopener noreferrer">Open ↗</a>
        </div>`;
    }).join("")}
    `;

    panel.querySelectorAll(".gptbd-result-checkbox").forEach(checkbox => {
      checkbox.addEventListener("change", event => {
        const id = event.target.getAttribute("data-id");
        if (!id) return;
        if (event.target.checked) STATE.selectedIds.add(id);
        else STATE.selectedIds.delete(id);
        syncCheckboxes();
        render();
      });
    });
  }

  function shouldAutoCollapseResults(target) {
    if (STATE.resultsCollapsed || STATE.uiHidden || activeModalResolve) return false;
    const root = document.getElementById("gpt-bulk-delete-root");
    const panel = root?.querySelector(".gptbd-results");
    if (!root || !panel || panel.dataset.visible !== "true") return false;
    return !root.contains(target);
  }

  function renderYearFilters(years) {
    if (years.length === 0) return "";
    return `
      <div class="gptbd-year-filters" role="group" aria-label="Filter cached chats by year">
        ${["all", ...years].map(year => {
          const isAll = year === "all";
          const label = isAll ? "All" : String(year);
          const active = String(STATE.selectedYear) === String(year);
          return `
            <button type="button"
                    class="gptbd-year-chip"
                    data-action="filter-year"
                    data-year="${escapeHtml(String(year))}"
                    data-active="${String(active)}">
              ${escapeHtml(label)}
            </button>`;
        }).join("")}
      </div>`;
  }

  /* ─────────────────────────── SIDEBAR HELPERS ──────────────────────────── */
  function revealRowActions(row) {
    [row, row.querySelector("a"), row.firstElementChild].forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      ["mouseenter", "mouseover", "mousemove", "pointerenter", "pointerover"].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    });
  }

  function openConversationMenu(button) {
    button.scrollIntoView({ block: "center", inline: "center" });
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(type => {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  function scoreMenuButton(button) {
    let score = 0;
    const ariaLabel = `${button.getAttribute("aria-label") || ""} ${button.title || ""}`.toLowerCase();
    const testId = (button.getAttribute("data-testid") || "").toLowerCase();
    const id = (button.id || "").toLowerCase();
    if (button.getAttribute("aria-haspopup") === "menu") score += 10;
    if (button.hasAttribute("aria-expanded")) score += 4;
    if (ariaLabel.includes("more")) score += 6;
    if (testId.includes("history") || testId.includes("conversation")) score += 5;
    if (id.startsWith("radix-")) score += 3;
    if (button.offsetParent !== null) score += 2;
    return score;
  }

  /* ─────────────────────────── API HELPERS ──────────────────────────────── */
  async function getAccessToken() {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.accessToken || null;
    } catch (_) {
      return null;
    }
  }

  async function refreshSidebarAfterDelete() {
    const beforeIds = getConversationRows().map(({ id }) => id).join(",");
    const beforeCount = getConversationRows().length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    const newChatLink = Array.from(
      document.querySelectorAll('a[href="/"], a[href="/?model=auto"]')
    ).find(n => n instanceof HTMLElement);
    if (newChatLink) {
      newChatLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await delay(600);
    refreshConversationRows();

    const afterIds = getConversationRows().map(({ id }) => id).join(",");
    const afterCount = getConversationRows().length;
    return afterCount < beforeCount || afterIds !== beforeIds;
  }

  function removeConversationRow(id) {
    const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.dataset.gptbdDeleted = "true";
    row.classList.add("gptbd-row-hidden");
    row.remove();
  }

  function removeConversationFromCache(id) {
    const next = STATE.cachedConversations.filter(c => c.id !== id);
    if (next.length === STATE.cachedConversations.length) return;
    STATE.cachedConversations = next;
    persistCache();
  }

  function clearLocalCache() {
    STATE.cachedConversations = [];
    STATE.cacheLoadedAt = null;
    STATE.selectedYear = "all";
    persistCache();
  }

  function buildDeleteSummary(deleted, failedCount, sidebarRefreshed) {
    const deletedPart = `Deleted ${deleted} conversation${deleted === 1 ? "" : "s"}.`;
    if (failedCount > 0) {
      const refreshNote = sidebarRefreshed ? "" : " Refresh the page if the sidebar looks stale.";
      return `${deletedPart} ${failedCount} failed — try those again from the sidebar.${refreshNote}`;
    }
    if (!sidebarRefreshed) return `${deletedPart} Refresh the page if the sidebar looks stale.`;
    return deletedPart;
  }

  /* ───────────────────────────── CACHE ─────────────────────────────────── */
  function persistCache() {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        conversations: STATE.cachedConversations,
        loadedAt: STATE.cacheLoadedAt || Date.now()
      }));
    } catch (_) {}
  }

  function loadCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const conversations = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
      STATE.cachedConversations = conversations.filter(item => item?.id && typeof item.title === "string");
      STATE.cacheLoadedAt = parsed?.loadedAt || null;
    } catch (_) {
      STATE.cachedConversations = [];
      STATE.cacheLoadedAt = null;
    }
  }

  async function loadPreferences() {
    if (!chrome?.storage?.local) return;
    try {
      const stored = await chrome.storage.local.get([UI_HIDDEN_KEY, SKIP_DELETE_WARNING_KEY]);
      STATE.uiHidden = Boolean(stored?.[UI_HIDDEN_KEY]);
      STATE.skipDeleteWarning = Boolean(stored?.[SKIP_DELETE_WARNING_KEY]);
    } catch (_) {
      STATE.uiHidden = false;
      STATE.skipDeleteWarning = false;
    }
  }

  async function setUiHiddenPreference(hidden) {
    STATE.uiHidden = hidden;
    render();
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({ [UI_HIDDEN_KEY]: hidden });
    } catch (_) {}
  }

  async function setSkipDeleteWarningPreference(skip) {
    STATE.skipDeleteWarning = skip;
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({ [SKIP_DELETE_WARNING_KEY]: skip });
    } catch (_) {}
  }

  function observePreferenceChanges() {
    if (!chrome?.storage?.onChanged || observePreferenceChanges.bound) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      let shouldRender = false;
      if (changes?.[UI_HIDDEN_KEY]) {
        STATE.uiHidden = Boolean(changes[UI_HIDDEN_KEY].newValue);
        shouldRender = true;
      }
      if (changes?.[SKIP_DELETE_WARNING_KEY]) {
        STATE.skipDeleteWarning = Boolean(changes[SKIP_DELETE_WARNING_KEY].newValue);
      }
      if (shouldRender) render();
    });
    observePreferenceChanges.bound = true;
  }

  /* ──────────────────────────── UTILITIES ───────────────────────────────── */
  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.pointerEvents === "none") return false;
    return element.getClientRects().length > 0;
  }

  function isScrollable(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 4;
  }

  function getVisibleMenuSurfaces() {
    return Array.from(document.querySelectorAll([
      '[role="menu"]',
      '[data-radix-menu-content]',
      '[data-radix-popper-content-wrapper]'
    ].join(", "))).filter(element => {
      return isElementVisible(element) && !element.closest("#gpt-bulk-delete-root");
    });
  }

  async function waitForMenuSurface(menuSurfacesBefore = []) {
    return waitFor(() => {
      const beforeSet = new Set(menuSurfacesBefore);
      const surfaces = getVisibleMenuSurfaces();
      const newSurface = surfaces.find(surface => !beforeSet.has(surface));
      if (newSurface) return newSurface;
      return surfaces.find(surface => surface.querySelector(SELECTORS.menuItems)) || null;
    }, 2500);
  }

  function getVisibleDialogs() {
    return Array.from(document.querySelectorAll(SELECTORS.dialogs)).filter(dialog => {
      return isElementVisible(dialog) && !dialog.closest("#gpt-bulk-delete-root");
    });
  }

  function normalizeSearchTerm(value) {
    return normalizeText(value).toLowerCase();
  }

  function filterCachedResults(results) {
    return results.filter(conversation => {
      if (STATE.selectedYear !== "all" && getConversationYear(conversation) !== String(STATE.selectedYear)) {
        return false;
      }
      if (STATE.searchTerm && !matchesSearch(conversation.title, STATE.searchTerm)) {
        return false;
      }
      return true;
    });
  }

  function getAvailableYears() {
    const years = new Set();
    STATE.cachedConversations.forEach(conversation => {
      const year = getConversationYear(conversation);
      if (year) years.add(year);
    });
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }

  function getConversationYear(conversation) {
    const timestamp = getConversationTimestamp(conversation);
    if (!timestamp) return null;
    return String(new Date(timestamp).getFullYear());
  }

  function matchesSearch(title, searchTerm) {
    const normalized = normalizeText(title).toLowerCase();
    if (!STATE.exactSearch) return normalized.includes(searchTerm);
    const keywords = searchTerm.split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return true;
    return keywords.every(kw => new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}([^a-z0-9]|$)`, "i").test(normalized));
  }

  function sortCachedResults(results) {
    return results.slice().sort((a, b) => {
      const aTime = getConversationTimestamp(a);
      const bTime = getConversationTimestamp(b);
      if (aTime !== bTime) {
        return STATE.cachedSortOrder === "oldest" ? aTime - bTime : bTime - aTime;
      }
      return a.title.localeCompare(b.title);
    });
  }

  function getConversationTimestamp(conversation) {
    const timestamp = conversation?.updateTime ? Date.parse(conversation.updateTime) : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatLastSync(timestamp) {
    if (!timestamp) return "never";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "unknown";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function formatConversationDate(timestamp) {
    if (!timestamp) return "Unknown";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  /* ─────────────────────────── INIT ─────────────────────────────────────── */
  async function init() {
    loadCache();
    await loadPreferences();
    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void init(); }, { once: true });
  } else {
    void init();
  }
})();
