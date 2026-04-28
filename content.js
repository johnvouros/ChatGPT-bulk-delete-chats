(function () {
  /* ─────────────────────────────── STATE ────────────────────────────────── */
  const STATE = {
    enabled: false,
    selectedIds: new Set(),
    lastSelectedId: null,
    searchTerm: "",
    exactSearch: false,
    selectedYear: "all",
    selectedProjectKey: "all",
    resultScope: "auto",
    cachedSortOrder: "newest",
    resultsCollapsed: true,
    syncingAll: false,
    deleting: false,
    deleteProgress: { current: 0, total: 0 },
    cachedConversations: [],
    projectIndex: { projects: [], memberships: {} },
    cacheLoadedAt: null,
    skipDeleteWarning: false,
    uiHidden: false,
    reviewSessionCount: 0,
    reviewPromptHidden: false,
    health: {
      checkedAt: 0,
      running: false,
      syncAvailable: true,
      deleteApiAvailable: true,
      deleteUiAvailable: true,
      safeMode: false,
      note: "",
      issues: []
    },
    failureCounts: {
      sync: 0,
      deleteApi: 0,
      deleteUi: 0
    },
    observer: null,
    refreshTimer: null,
    healthTimer: null
  };

  const CACHE_KEY = "gptbd-conversation-cache-v1";
  const PROJECT_CACHE_KEY = "gptbd-project-cache-v1";
  const UI_HIDDEN_KEY = "gptbd-ui-hidden";
  const SKIP_DELETE_WARNING_KEY = "gptbd-skip-delete-warning";
  const REVIEW_SESSION_COUNT_KEY = "gptbd-review-session-count";
  const REVIEW_PROMPT_HIDDEN_KEY = "gptbd-review-prompt-hidden";
  const REVIEW_SESSION_MARK_KEY = "gptbd-review-session-marked";
  const REVIEW_PROMPT_THRESHOLD = 3;
  const APP_VERSION = chrome?.runtime?.getManifest?.().version || "1.0.0";
  const MARK_ICON_URL = chrome?.runtime?.getURL?.("icons/icon-48.png") || "";
  const REPO_BASE_URL = "https://github.com/johnvouros/ChatGPT-bulk-delete-chats";
  const CHROME_REVIEW_URL = "https://chromewebstore.google.com/detail/chatgpt-bulk-delete/nbecbefmhjidfmmfbpealakgpnnldcce/reviews";
  const FIREFOX_REVIEW_URL = "https://addons.mozilla.org/en-GB/firefox/addon/chatgpt-chat-bulk-delete/reviews/";
  const DOC_LINKS = {
    privacy: `${REPO_BASE_URL}/blob/main/PRIVACY.md`,
    license: `${REPO_BASE_URL}/blob/main/LICENSE`,
    terms: `${REPO_BASE_URL}/blob/main/TERMS.md`,
    bugs: `${REPO_BASE_URL}/issues/new`
  };
  const DEFAULT_DELETE_MODAL_SUBTITLE = "Permanent. ChatGPT does not support undo.";
  const DEFAULT_DELETE_MODAL_WARNING = "Delete is permanent and cannot be recovered.";
  const CAPABILITY_REFRESH_MS = 10 * 60 * 1000;
  const CAPABILITY_RETRY_MS = 90 * 1000;
  const CAPABILITY_FAILURE_THRESHOLD = 2;

  /* ───────────────────────────── SELECTORS ──────────────────────────────── */
  const SELECTORS = {
    conversationLinks: [
      'a[href^="/c/"]',
      'a[href*="/c/"]',
      'a[href*="://chatgpt.com/c/"]',
      'a[href*="://chat.openai.com/c/"]',
      '[role="link"][href*="/c/"]',
      '[data-href*="/c/"]'
    ].join(", "),
    sidebarRoots: ["nav", "aside", '[data-testid="history"]'].join(", "),
    projectSignals: [
      '[data-testid*="project" i]',
      '[aria-label*="project" i]',
      '[href*="/project"]',
      '[href*="/projects"]'
    ].join(", "),
    projectLinks: [
      'a[href*="/project" i]',
      'a[href*="/projects" i]',
      'a[href*="/g/g-p-" i]'
    ].join(", "),
    messageRoots: [
      "article",
      '[data-testid*="conversation-turn" i]',
      '[data-message-author-role]',
      '[data-message-id]',
      ".markdown"
    ].join(", "),
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
  let runtimeBridgeReady = false;

  /* ─────────────────────────────── BOOT ─────────────────────────────────── */
  function boot() {
    if (window.top !== window.self) return;
    injectShell();
    refreshConversationRows();
    observeDom();
    observePreferenceChanges();
    setupRuntimeBridge();
    render();
    window.addEventListener("focus", () => {
      void ensureCapabilityHealth({ force: isCapabilityHealthStale(), silent: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void ensureCapabilityHealth({ force: isCapabilityHealthStale(), silent: true });
      }
    });
    void ensureCapabilityHealth({ force: true, silent: true });
  }

  /* ───────────────────────────── SHELL HTML ─────────────────────────────── */
  function injectShell() {
    if (document.getElementById("gpt-bulk-delete-root")) return;

    const root = document.createElement("div");
    root.id = "gpt-bulk-delete-root";
    const shell = `
      <div class="gptbd-toolbar">

        <!-- ── Main horizontal bar ── -->
        <div class="gptbd-bar">

          <!-- Identity + mode toggle -->
          <div class="gptbd-section gptbd-section--id">
            <div class="gptbd-mark" aria-hidden="true">
              <img class="gptbd-mark-img" src="${MARK_ICON_URL}" alt="" decoding="async" />
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
            <span class="gptbd-meta-dot" data-role="review-dot" hidden>·</span>
            <span class="gptbd-review-pill" data-role="review-pill" hidden>
              <button type="button" class="gptbd-review-link" data-action="rate-extension">Rate extension</button>
              <button type="button" class="gptbd-review-dismiss" data-action="dismiss-review-prompt"
                      aria-label="Hide rating prompt" title="Hide rating prompt">&times;</button>
            </span>
            <span class="gptbd-meta-dot" data-role="match-meta-dot" hidden>·</span>
            <span class="gptbd-meta-text" data-role="match-count" hidden></span>
            <span class="gptbd-meta-dot" data-role="health-note-dot" hidden>·</span>
            <span class="gptbd-meta-text gptbd-meta-text--warning" data-role="health-note" hidden></span>
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
    root.append(createTemplateFragment(shell));

    document.documentElement.appendChild(root);

    /* ── Event delegation ── */
    root.addEventListener("click", async (event) => {
      const el = event.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;

      if (action === "toggle") {
        const wasEnabled = STATE.enabled;
        STATE.enabled = !STATE.enabled;
        if (!STATE.enabled) {
          STATE.selectedIds.clear();
          STATE.lastSelectedId = null;
        } else if (getPageContext().mode === "project") {
          STATE.resultsCollapsed = false;
        }
        refreshConversationRows();
        render();
        if (!wasEnabled && STATE.enabled && getPageContext().mode !== "project") {
          window.setTimeout(() => {
            jumpToFirstConversationRow();
          }, 80);
        }
        return;
      }

      if (action === "select-scope") {
        return;
      }

      if (action === "select-project-filter") {
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

      if (action === "rate-extension") {
        window.open(getReviewUrl(), "_blank", "noopener,noreferrer");
        void hideReviewPrompt();
        return;
      }

      if (action === "dismiss-review-prompt") {
        await hideReviewPrompt();
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

    root.addEventListener("change", event => {
      const scopeSelect = event.target.closest('[data-action="select-scope"]');
      if (!scopeSelect) return;
      STATE.resultScope = scopeSelect.value === "account" ? "account" : "project";
      STATE.selectedProjectKey = "all";
      STATE.selectedIds.clear();
      STATE.lastSelectedId = null;
      STATE.resultsCollapsed = false;
      refreshConversationRows();
      render();
    });

    root.addEventListener("change", event => {
      const projectSelect = event.target.closest('[data-action="select-project-filter"]');
      if (!projectSelect) return;
      STATE.selectedProjectKey = projectSelect.value || "all";
      STATE.selectedIds.clear();
      STATE.lastSelectedId = null;
      STATE.resultsCollapsed = false;
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
        void ensureCapabilityHealth({ force: false, silent: true });
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

    const pageContext = getPageContext();
    const activeScope = getEffectiveResultScope(pageContext);
    const projectMode = activeScope === "project";
    const selectedCount = STATE.selectedIds.size;
    const matchCount = getSearchResults().length;
    const hasCache = STATE.cachedConversations.length > 0;
    const busy = STATE.deleting || STATE.syncingAll;
    const health = STATE.health;

    /* Toggle button */
    const toggleLabel = toolbar.querySelector('[data-role="toggle-label"]');
    const toggleBtn = toolbar.querySelector('[data-action="toggle"]');
    if (toggleLabel) {
      if (STATE.enabled) {
        toggleLabel.textContent = "Exit";
      } else {
        toggleLabel.textContent = projectMode ? "Select project chats" : "Select chats";
      }
    }
    if (toggleBtn) {
      toggleBtn.disabled = busy;
      toggleBtn.dataset.active = String(STATE.enabled);
      toggleBtn.title = projectMode
        ? "Toggle project chat selection mode (Esc to exit)"
        : "Toggle bulk-select mode (Esc to exit)";
    }

    /* Sync button */
    const syncBtn = toolbar.querySelector('[data-action="sync-all"]');
    const syncLabel = toolbar.querySelector('[data-role="sync-label"]');
    if (syncLabel) {
      syncLabel.textContent = STATE.syncingAll
        ? "Syncing…"
        : health.syncAvailable ? (hasCache ? "Resync" : "Sync all") : "Sync unavailable";
    }
    if (syncBtn) {
      syncBtn.disabled = busy || !health.syncAvailable;
      syncBtn.dataset.spinning = String(STATE.syncingAll);
      syncBtn.title = health.syncAvailable
        ? "Download full conversation list from ChatGPT API"
        : "Sync is temporarily unavailable until compatibility checks pass";
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

    const reviewDotEl = toolbar.querySelector('[data-role="review-dot"]');
    const reviewPillEl = toolbar.querySelector('[data-role="review-pill"]');
    const shouldShowReview = shouldShowReviewPrompt();
    if (reviewDotEl) reviewDotEl.hidden = !shouldShowReview;
    if (reviewPillEl) reviewPillEl.hidden = !shouldShowReview;

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
    if (searchInput) {
      searchInput.disabled = busy;
      searchInput.placeholder = projectMode ? "Filter project chats…" : "Filter chats…";
    }
    if (clearSearchBtn) clearSearchBtn.hidden = !STATE.searchTerm;
    if (exactBtn) {
      exactBtn.disabled = busy;
      exactBtn.dataset.active = String(STATE.exactSearch);
    }
    if (matchCountEl) {
      const hasSearch = Boolean(STATE.searchTerm);
      const hasYearFilter = STATE.selectedYear !== "all";
      const hasProjectFilter = !projectMode && STATE.selectedProjectKey !== "all";
      if (projectMode) {
        matchCountEl.textContent = hasSearch
          ? `${matchCount} project match${matchCount === 1 ? "" : "es"}`
          : `${matchCount} project chat${matchCount === 1 ? "" : "s"} shown`;
      } else if (hasSearch || hasYearFilter || hasProjectFilter) {
        const parts = [`${matchCount} match${matchCount === 1 ? "" : "es"}`];
        if (hasYearFilter) parts.push(`year ${STATE.selectedYear}`);
        if (hasProjectFilter) parts.push(getProjectFilterLabel(STATE.selectedProjectKey));
        matchCountEl.textContent = parts.join(" in ");
      } else {
        matchCountEl.textContent = "";
      }
      matchCountEl.hidden = !(projectMode || hasSearch || hasYearFilter || hasProjectFilter);
    }
    if (matchMetaDotEl) {
      matchMetaDotEl.hidden = !(projectMode || STATE.searchTerm || STATE.selectedYear !== "all" || STATE.selectedProjectKey !== "all");
    }

    const healthNoteEl = toolbar.querySelector('[data-role="health-note"]');
    const healthNoteDotEl = toolbar.querySelector('[data-role="health-note-dot"]');
    if (healthNoteEl) {
      healthNoteEl.textContent = health.note || "";
      healthNoteEl.hidden = !health.note;
    }
    if (healthNoteDotEl) healthNoteDotEl.hidden = !health.note;

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
    const showingCachedResults = !projectMode && STATE.cachedConversations.length > 0;
    const showingProjectActions = projectMode;
    if (selectAllBtn) selectAllBtn.disabled = busy || selectableCount === 0 || !canDeleteSelection(getSelectableConversationIds());
    if (selectAllBtn) {
      selectAllBtn.textContent = projectMode ? (STATE.searchTerm ? "All matches" : "All shown") : "All";
      selectAllBtn.title = projectMode
        ? STATE.searchTerm
          ? "Select all matching project chats"
          : "Select all currently shown project chats"
        : "Select all current results, or all cached chats if no filter is active";
    }
    if (clearBtn) clearBtn.disabled = selectedCount === 0 || busy;
    if (sortBtn) {
      sortBtn.hidden = projectMode;
      sortBtn.disabled = busy || !showingCachedResults;
      sortBtn.textContent = STATE.cachedSortOrder === "newest" ? "Sort: Newest ↓" : "Sort: Oldest ↑";
      sortBtn.title = STATE.cachedSortOrder === "newest"
        ? "Sorting by newest first. Click to switch to oldest first."
        : "Sorting by oldest first. Click to switch to newest first.";
    }
    if (toggleResultsBtn) {
      toggleResultsBtn.hidden = false;
      toggleResultsBtn.disabled = busy || (projectMode ? selectableCount === 0 : !showingCachedResults);
      toggleResultsBtn.textContent = projectMode
        ? STATE.resultsCollapsed ? "Show project list" : "Hide project list"
        : STATE.resultsCollapsed ? "Show list" : "Hide list";
      toggleResultsBtn.title = projectMode
        ? "Show or hide the discovered project chat list"
        : "Show or hide the cached results list";
    }
    if (resultsActions) {
      resultsActions.dataset.visible = String(showingCachedResults || showingProjectActions);
    }
    if (yearFiltersHost) {
      replaceChildren(yearFiltersHost, buildFilterControls({
        pageContext,
        activeScope,
        hasCache,
        showingCachedResults
      }));
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
    if (deleteBtn) {
      deleteBtn.disabled = selectedCount === 0 || busy || !canDeleteSelection();
      deleteBtn.title = canDeleteSelection()
        ? projectMode
          ? "Delete selected project conversations permanently (you will be asked to confirm)"
          : "Delete selected conversations (you will be asked to confirm)"
        : "Delete is temporarily unavailable until compatibility checks pass";
    }
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
    const pageContext = getPageContext();
    const activeScope = getEffectiveResultScope(pageContext);
    const projectRows = activeScope === "project"
      ? buildConversationRowItems(getProjectConversationLinks(), "project")
      : [];
    const sidebarRows = buildConversationRowItems(getSidebarConversationLinks(), "sidebar");

    return uniqueConversationRows(activeScope === "project" ? projectRows : sidebarRows);
  }

  function getFirstConversationRow() {
    return getConversationRows()[0] || null;
  }

  function getSidebarConversationLinks() {
    const sidebarRoots = Array.from(document.querySelectorAll(SELECTORS.sidebarRoots));
    const scopedLinks = sidebarRoots.flatMap(r => Array.from(r.querySelectorAll(SELECTORS.conversationLinks)));
    return scopedLinks.length > 0 ? scopedLinks : Array.from(document.querySelectorAll(SELECTORS.conversationLinks));
  }

  function getProjectConversationLinks() {
    return Array.from(document.querySelectorAll(SELECTORS.conversationLinks))
      .filter(link => isProjectConversationLink(link));
  }

  function buildConversationRowItems(links, source) {
    return links
      .map(link => {
        if (!(link instanceof HTMLElement)) return null;
        const href = getConversationHref(link);
        const match = href.match(/\/c\/([a-zA-Z0-9-]+)/);
        if (!match) return null;
        const row = findConversationRow(link, source);
        if (!row || row.dataset.gptbdIgnore === "true" || row.dataset.gptbdDeleted === "true") return null;
        return { id: match[1], link, row, source };
      })
      .filter(Boolean);
  }

  function getConversationHref(element) {
    return element.getAttribute("href")
      || element.getAttribute("data-href")
      || element.dataset?.href
      || "";
  }

  function uniqueConversationRows(rows) {
    return rows.filter((item, index, arr) => arr.findIndex(other => other.id === item.id) === index);
  }

  function findConversationRow(link, source = "sidebar") {
    const preferred = link.closest("li, [role='listitem']");
    if (preferred) return preferred;

    let node = link;
    let depth = 0;
    while (node && node !== document.body) {
      if (source === "project" && (node.matches("main") || depth > 5)) break;
      if (node.querySelectorAll("button").length > 0) return node;
      node = node.parentElement;
      depth += 1;
    }
    return link.parentElement;
  }

  function isProjectConversationLink(link) {
    if (!(link instanceof HTMLElement)) return false;
    if (link.closest("#gpt-bulk-delete-root")) return false;
    if (link.closest(SELECTORS.sidebarRoots)) return false;
    if (link.closest(SELECTORS.messageRoots)) return false;
    if (!link.closest("main")) return false;

    const row = findConversationRow(link, "project");
    if (!row || row === document.body || row.matches("main")) return false;
    if (!isElementVisible(link) && !isElementVisible(row)) return false;
    if (row.querySelectorAll(SELECTORS.conversationLinks).length > 3) return false;

    const title = getConversationTitle(link, row);
    return title.length > 0;
  }

  function getPageContext() {
    const path = window.location.pathname.toLowerCase();
    const main = document.querySelector("main");
    const isProjectUrl =
      /^\/projects?(\/|$)/.test(path) ||
      /\/projects?(\/|$)/.test(path) ||
      /\/g\/g-p-[^/]+/.test(path);
    const hasProjectDomSignal = Array.from(main?.querySelectorAll(SELECTORS.projectSignals) || [])
      .some(el => !el.closest(SELECTORS.messageRoots));
    const projectName = getProjectName();
    const projectKey = getProjectKey(path, projectName);

    return {
      mode: isProjectUrl || hasProjectDomSignal ? "project" : "default",
      projectName,
      projectKey
    };
  }

  function getEffectiveResultScope(pageContext = getPageContext()) {
    if (pageContext.mode !== "project") return "account";
    return STATE.resultScope === "account" && STATE.cachedConversations.length > 0 ? "account" : "project";
  }

  function getProjectName() {
    const heading = Array.from(document.querySelectorAll("main h1, main [role='heading']"))
      .map(el => normalizeText(el.textContent))
      .find(Boolean);
    return heading || "";
  }

  function getSelectionContext(ids = Array.from(STATE.selectedIds)) {
    const projectIds = new Set(
      getConversationRows()
        .filter(item => item.source === "project")
        .map(item => item.id)
    );
    const isProjectOnlySelection = ids.length > 0 && ids.every(id => projectIds.has(id));
    return {
      mode: isProjectOnlySelection ? "project" : "default"
    };
  }

  function getProjectKey(path = window.location.pathname.toLowerCase(), projectName = "") {
    const normalizedPath = normalizeText(path).toLowerCase();
    const slugMatch = normalizedPath.match(/\/projects?\/([^/?#]+)/)
      || normalizedPath.match(/\/g\/(g-p-[^/?#]+)/);
    if (slugMatch?.[1]) return `path:${decodeURIComponent(slugMatch[1])}`;
    const name = normalizeText(projectName).toLowerCase();
    if (name) return `name:${name}`;
    return "";
  }

  function rememberProjectMembership(pageContext, rows) {
    if (pageContext.mode !== "project" || !pageContext.projectKey || rows.length === 0) return;
    const ids = rows.filter(item => item.source === "project").map(item => item.id);
    if (ids.length === 0) return;

    const existing = STATE.projectIndex.memberships[pageContext.projectKey] || {};
    const mergedIds = Array.from(new Set([...(existing.ids || []), ...ids]));
    const name = pageContext.projectName || existing.name || "Untitled project";
    const updatedAt = Date.now();
    const sameIds = Array.isArray(existing.ids)
      && existing.ids.length === mergedIds.length
      && existing.ids.every(id => mergedIds.includes(id));
    const sameName = existing.name === name;
    if (sameIds && sameName) return;

    STATE.projectIndex.memberships[pageContext.projectKey] = {
      name,
      ids: mergedIds,
      updatedAt
    };
    STATE.projectIndex.projects = upsertProjectSummary(STATE.projectIndex.projects, {
      key: pageContext.projectKey,
      name,
      updatedAt
    });
    persistProjectIndex();
  }

  function upsertProjectSummary(projects, project) {
    const next = projects.filter(item => item.key !== project.key);
    next.push(project);
    return next
      .filter(item => item?.key && item?.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function getKnownProjects() {
    return STATE.projectIndex.projects
      .filter(project => project?.key && project?.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function getProjectFilterLabel(projectKey) {
    if (!projectKey || projectKey === "all") return "";
    const project = STATE.projectIndex.projects.find(item => item.key === projectKey);
    return project?.name ? `project ${project.name}` : "selected project";
  }

  function rememberSidebarProjects() {
    const projects = getSidebarProjects();
    if (projects.length === 0) return;

    let changed = false;
    projects.forEach(project => {
      const existing = STATE.projectIndex.projects.find(item => item.key === project.key);
      if (!existing) {
        STATE.projectIndex.projects = upsertProjectSummary(STATE.projectIndex.projects, project);
        changed = true;
        return;
      }
      if (existing.name !== project.name) {
        STATE.projectIndex.projects = upsertProjectSummary(STATE.projectIndex.projects, {
          ...existing,
          name: project.name
        });
        const membership = STATE.projectIndex.memberships[project.key];
        if (membership) {
          STATE.projectIndex.memberships[project.key] = { ...membership, name: project.name };
        }
        changed = true;
      }
    });

    if (changed) persistProjectIndex();
  }

  function getSidebarProjects() {
    const sidebarRoots = Array.from(document.querySelectorAll(SELECTORS.sidebarRoots));
    const links = sidebarRoots.flatMap(root => Array.from(root.querySelectorAll(SELECTORS.projectLinks)));
    return links
      .map(link => {
        if (!(link instanceof HTMLElement) || !isElementVisible(link)) return null;
        const href = link.getAttribute("href") || "";
        const name = normalizeText(link.textContent);
        if (!href || !name) return null;
        const path = toPathname(href);
        const key = getProjectKey(path, name);
        if (!key) return null;
        return { key, name, updatedAt: Date.now() };
      })
      .filter(Boolean)
      .filter((project, index, arr) => arr.findIndex(other => other.key === project.key) === index);
  }

  function toPathname(href) {
    try {
      return new URL(href, window.location.origin).pathname;
    } catch (_) {
      return href;
    }
  }

  function refreshConversationRows() {
    rememberSidebarProjects();

    const rows = getConversationRows();
    const liveIds = new Set(rows.map(r => r.id));
    const activeScope = getEffectiveResultScope();
    const pageContext = getPageContext();
    const cachedIds = activeScope === "project" ? new Set() : new Set(STATE.cachedConversations.map(c => c.id));

    if (activeScope === "project") {
      rememberProjectMembership(pageContext, rows);
    }

    for (const id of Array.from(STATE.selectedIds)) {
      if (!liveIds.has(id) && !cachedIds.has(id)) STATE.selectedIds.delete(id);
    }

    rows.forEach(({ id, row, link, source }) => {
      const title = getConversationTitle(link, row);
      row.dataset.gptbdConversationId = id;
      row.dataset.gptbdConversationTitle = title;
      row.dataset.gptbdConversationSource = source;
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
    if (getEffectiveResultScope() === "project") return (STATE.searchTerm ? getMatchingRows() : getVisibleRows()).map(item => item.id);
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
      const title = row.dataset.gptbdConversationTitle || getConversationTitle(link, row);
      return matchesSearch(title, STATE.searchTerm);
    });
  }

  function getSearchResults() {
    if (getEffectiveResultScope() === "project") {
      return getMatchingRows().map(({ id, link, row }) => ({
        id,
        title: getConversationTitle(link, row) || "Untitled chat"
      }));
    }
    if (STATE.cachedConversations.length > 0) {
      return sortCachedResults(filterCachedResults(STATE.cachedConversations));
    }
    return getMatchingRows().map(({ id, link, row }) => ({
      id,
      title: getConversationTitle(link, row) || "Untitled chat"
    }));
  }

  function getConversationTitle(link, row) {
    const linkText = normalizeText(link?.textContent);
    if (linkText) return linkText;
    const rowText = normalizeText(row?.textContent);
    if (!rowText) return "";
    return rowText;
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

    await ensureCapabilityHealth({ force: isCapabilityHealthStale(), silent: true });
    if (!STATE.health.deleteApiAvailable && !STATE.health.deleteUiAvailable) {
      showToast(STATE.health.note || "Delete is temporarily unavailable. Refresh ChatGPT and try again.");
      return;
    }
    if (!canDeleteSelection(ids)) {
      showToast("Delete is limited to chats currently visible in the sidebar until ChatGPT compatibility checks pass again.");
      return;
    }

    /* Resolve display titles for the preview list */
    const titles = ids.map(id => {
      const cached = STATE.cachedConversations.find(c => c.id === id);
      if (cached) return cached.title;
      const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
      return row?.dataset.gptbdConversationTitle || "Untitled chat";
    });

    const selectionContext = getSelectionContext(ids);
    const confirmed = await showDeleteModal(ids, titles, selectionContext);
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
  function showDeleteModal(ids, titles, selectionContext = { mode: "default" }) {
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

      resetModalToDeleteDefaults(modal);

      const isProjectDelete = selectionContext.mode === "project";
      const noun = isProjectDelete ? "project conversation" : "conversation";
      if (titleEl) {
        titleEl.textContent = `Delete ${count}\u00a0${noun}${count === 1 ? "" : "s"}?`;
      }
      if (isProjectDelete) {
        const subtitleEl = modal.querySelector(".gptbd-modal__subtitle");
        const warningText = modal.querySelector(".gptbd-modal__warning-text");
        if (subtitleEl) {
          subtitleEl.textContent = "Permanent. This deletes the chat, not just removes it from the project.";
        }
        if (warningText) {
          warningText.textContent = "These project chats will be permanently deleted from ChatGPT, not just removed from this project.";
        }
      }
      if (confirmLabel) {
        confirmLabel.textContent = `Delete\u00a0${count}\u00a0${isProjectDelete ? "project chat" : "conversation"}${count === 1 ? "" : "s"}`;
      }
      if (warningCheck) warningCheck.checked = false;
      if (skipWarningCheck) skipWarningCheck.checked = false;
      if (confirmBtn) confirmBtn.disabled = true;

      if (previewEl) {
        const maxShow = 8;
        const shown = titles.slice(0, maxShow);
        const remaining = titles.length - shown.length;
        replaceChildren(previewEl, buildDeletePreviewItems(shown, remaining));
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

      resetModalToDeleteDefaults(modal);

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
        replaceChildren(previewEl, buildClearCachePreviewItems());
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
        resetModalToDeleteDefaults(modal);
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
    if (!row) {
      registerCapabilityFailure("deleteUi", "Chat row was not available for UI fallback.");
      return false;
    }

    row.scrollIntoView({ block: "center" });
    revealRowActions(row);
    await delay(220);

    const menuButton = findMenuButton(row);
    if (!menuButton) {
      registerCapabilityFailure("deleteUi", "Could not find the conversation menu button.");
      return false;
    }

    const menuSurfacesBefore = getVisibleMenuSurfaces();
    openConversationMenu(menuButton);
    const menuSurface = await waitForMenuSurface(menuSurfacesBefore);
    const deleteControl = await waitForDeleteMenuItem(menuSurface);
    if (!deleteControl) {
      dismissOpenMenus();
      registerCapabilityFailure("deleteUi", "Could not find the delete action in the conversation menu.");
      return false;
    }

    const dialogsBefore = getVisibleDialogs();
    deleteControl.click();

    const confirmButton = await waitForDeleteConfirmButton(dialogsBefore);
    if (!confirmButton) {
      dismissOpenMenus();
      registerCapabilityFailure("deleteUi", "Could not find the delete confirmation dialog.");
      return false;
    }

    confirmButton.click();
    const removed = await waitForConversationRemoval(id, 5000);
    if (removed) {
      registerCapabilitySuccess("deleteUi");
      return true;
    }
    registerCapabilityFailure("deleteUi", "UI delete did not remove the conversation.");
    return false;
  }

  async function deleteConversationByApi(id) {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        registerCapabilityFailure("deleteApi", "Could not read the ChatGPT session token.");
        return false;
      }

      const response = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ is_visible: false })
      });

      if (!response.ok) {
        registerCapabilityFailure("deleteApi", `Delete API returned ${response.status}.`);
        return false;
      }
      const removed = await waitForConversationRemoval(id, 3000);
      if (removed) {
        registerCapabilitySuccess("deleteApi");
        return true;
      }
      const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
      if (row?.dataset.gptbdConversationSource === "project") {
        registerCapabilitySuccess("deleteApi");
        return true;
      }
      registerCapabilityFailure("deleteApi", "Delete API returned success but the conversation stayed visible.");
      return false;
    } catch (_) {
      registerCapabilityFailure("deleteApi", "Delete API request failed.");
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
    await ensureCapabilityHealth({ force: isCapabilityHealthStale(), silent: true });
    if (!STATE.health.syncAvailable) {
      showToast(STATE.health.note || "Sync is temporarily unavailable. Refresh ChatGPT and try again.");
      return;
    }

    STATE.syncingAll = true;
    render();

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        registerCapabilityFailure("sync", "Could not read your ChatGPT session.");
        showToast("Could not read your ChatGPT session. Refresh the page and try again.");
        return;
      }
      const conversations = await fetchAllConversations(accessToken);
      registerCapabilitySuccess("sync");
      STATE.cachedConversations = conversations;
      STATE.cacheLoadedAt = Date.now();
      persistCache();
      await ensureCapabilityHealth({ force: true, silent: true });
      render();
      showToast(`Synced ${conversations.length.toLocaleString()} chats to cache.`);
    } catch (error) {
      registerCapabilityFailure("sync", error instanceof Error ? error.message : "Sync failed.");
      await ensureCapabilityHealth({ force: true, silent: true });
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
    const projectMemberships = new Map();

    while (true) {
      const response = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) throw new Error(`Conversation sync failed: ${response.status}`);

      const data = await response.json();
      if (!Array.isArray(data?.items)) {
        throw new Error("Conversation sync failed: unexpected response shape.");
      }
      const items = data.items;

      items.forEach(item => {
        if (!item?.id || seen.has(item.id)) return;
        seen.add(item.id);
        const projectMeta = extractConversationProjectMeta(item);
        if (projectMeta) {
          const project = projectMemberships.get(projectMeta.key) || {
            key: projectMeta.key,
            name: projectMeta.name,
            ids: []
          };
          project.ids.push(item.id);
          projectMemberships.set(projectMeta.key, project);
        }
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

    rememberSyncedProjectMemberships(projectMemberships);

    return all.sort((a, b) => {
      const at = a.updateTime ? Date.parse(a.updateTime) : 0;
      const bt = b.updateTime ? Date.parse(b.updateTime) : 0;
      return bt - at;
    });
  }

  function extractConversationProjectMeta(item) {
    const projectObject = [item?.project, item?.project_info, item?.current_project]
      .find(value => value && typeof value === "object");
    const id = firstString(
      item?.project_id,
      item?.project_uuid,
      item?.current_project_id,
      projectObject?.id,
      projectObject?.project_id,
      projectObject?.uuid
    );
    const name = firstString(
      item?.project_name,
      item?.project_title,
      projectObject?.name,
      projectObject?.title
    );
    if (!id && !name) return null;
    const key = id ? `api:${id}` : `name:${normalizeText(name).toLowerCase()}`;
    return {
      key,
      name: normalizeText(name) || `Project ${String(id).slice(0, 8)}`
    };
  }

  function firstString(...values) {
    const value = values.find(item => typeof item === "string" && normalizeText(item));
    return value ? normalizeText(value) : "";
  }

  function rememberSyncedProjectMemberships(projectMemberships) {
    if (!(projectMemberships instanceof Map) || projectMemberships.size === 0) return;
    let changed = false;
    projectMemberships.forEach(project => {
      const existing = STATE.projectIndex.memberships[project.key] || {};
      const mergedIds = Array.from(new Set([...(existing.ids || []), ...project.ids]));
      const sameIds = Array.isArray(existing.ids)
        && existing.ids.length === mergedIds.length
        && existing.ids.every(id => mergedIds.includes(id));
      const sameName = existing.name === project.name;
      if (!sameIds || !sameName) {
        STATE.projectIndex.memberships[project.key] = {
          name: project.name,
          ids: mergedIds,
          updatedAt: Date.now()
        };
        changed = true;
      }
      const existingSummary = STATE.projectIndex.projects.find(item => item.key === project.key);
      if (!existingSummary || existingSummary.name !== project.name) {
        STATE.projectIndex.projects = upsertProjectSummary(STATE.projectIndex.projects, {
          key: project.key,
          name: project.name,
          updatedAt: Date.now()
        });
        changed = true;
      }
    });
    if (changed) persistProjectIndex();
  }

  /* ──────────────────────────── RESULTS PANEL ────────────────────────────── */
  function renderResultsPanel(panel) {
    if (!panel) return;
    if (getEffectiveResultScope() === "project") {
      const shouldShowProjectList = !STATE.resultsCollapsed && (STATE.enabled || Boolean(STATE.searchTerm));
      panel.dataset.visible = String(shouldShowProjectList);
      if (!shouldShowProjectList) {
        replaceChildren(panel, []);
        return;
      }

      const results = getSearchResults();
      if (results.length === 0) {
        replaceChildren(panel, [buildEmptyState(
          STATE.searchTerm
            ? "No visible project chats match this filter."
            : "No project chats were found in this view. Open the project's chat list or scroll it to load more chats.",
          true
        )]);
        return;
      }

      replaceChildren(panel, buildResultsPanelNodes(results, { mode: "project" }));
      bindResultsPanelCheckboxes(panel);
      return;
    }
    const hasSearch = Boolean(STATE.searchTerm);
    const hasCache = STATE.cachedConversations.length > 0;
    const shouldShow = (hasSearch && !hasCache) || (hasCache && !STATE.resultsCollapsed);
    panel.dataset.visible = String(shouldShow);

    if (!shouldShow) { replaceChildren(panel, []); return; }
    if (!hasCache) {
      replaceChildren(panel, [buildEmptyState(
        "Search history is not synced yet. Click Sync all to load your full chat history first.",
        true
      )]);
      return;
    }

    const results = getSearchResults().slice(0, 250);
    if (results.length === 0) {
      replaceChildren(panel, [buildEmptyState(
        getCachedEmptyMessage(),
        STATE.selectedProjectKey !== "all" ? "warning" : "default"
      )]);
      return;
    }
    replaceChildren(panel, buildResultsPanelNodes(results));
    bindResultsPanelCheckboxes(panel);
  }

  function getCachedEmptyMessage() {
    if (STATE.selectedProjectKey === "all") return "No cached chats match this filter.";
    const project = STATE.projectIndex.projects.find(item => item.key === STATE.selectedProjectKey);
    const membership = STATE.projectIndex.memberships[STATE.selectedProjectKey];
    const projectName = project?.name || "this project";
    if (!Array.isArray(membership?.ids) || membership.ids.length === 0) {
      return `Open ${projectName} and scroll its chat list first.`;
    }
    return `No matches. Open ${projectName} in the sidebar and scroll to load more.`;
  }

  function bindResultsPanelCheckboxes(panel) {
    panel.querySelectorAll(".gptbd-result-checkbox").forEach(checkbox => {
      checkbox.addEventListener("change", event => {
        const scrollTop = panel.scrollTop;
        const id = event.target.getAttribute("data-id");
        if (!id) return;
        if (event.target.checked) STATE.selectedIds.add(id);
        else STATE.selectedIds.delete(id);
        syncCheckboxes();
        render();
        restoreResultsPanelScroll(scrollTop);
      });
    });
  }

  function restoreResultsPanelScroll(scrollTop) {
    const panel = document.querySelector("#gpt-bulk-delete-root .gptbd-results");
    if (!panel) return;
    panel.scrollTop = scrollTop;
    window.requestAnimationFrame(() => {
      panel.scrollTop = scrollTop;
    });
  }

  function shouldAutoCollapseResults(target) {
    if (STATE.resultsCollapsed || STATE.uiHidden || activeModalResolve) return false;
    const root = document.getElementById("gpt-bulk-delete-root");
    const panel = root?.querySelector(".gptbd-results");
    if (!root || !panel || panel.dataset.visible !== "true") return false;
    return !root.contains(target);
  }

  function buildYearFilters(years) {
    if (years.length === 0) return [];
    const wrap = document.createElement("div");
    wrap.className = "gptbd-year-filters";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Filter cached chats by year");

    ["all", ...years].forEach(year => {
      const isAll = year === "all";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gptbd-year-chip";
      button.dataset.action = "filter-year";
      button.dataset.year = String(year);
      button.dataset.active = String(String(STATE.selectedYear) === String(year));
      button.textContent = isAll ? "All" : String(year);
      wrap.appendChild(button);
    });

    return [wrap];
  }

  function buildFilterControls({ pageContext, activeScope, hasCache, showingCachedResults }) {
    const nodes = [];
    if (pageContext.mode === "project") {
      nodes.push(buildScopeSelect(pageContext, activeScope, hasCache));
    }
    if (showingCachedResults) {
      nodes.push(...buildYearFilters(getAvailableYears()));
      const knownProjects = getKnownProjects();
      if (knownProjects.length > 0) {
        nodes.push(buildProjectFilterSelect(knownProjects));
      }
    }
    return nodes;
  }

  function buildScopeSelect(pageContext, activeScope, hasCache) {
    const select = document.createElement("select");
    select.className = "gptbd-filter-select gptbd-scope-select";
    select.dataset.action = "select-scope";
    select.title = "Choose which chat list to show";
    select.setAttribute("aria-label", "Choose chat scope");

    const projectOption = document.createElement("option");
    projectOption.value = "project";
    projectOption.textContent = pageContext.projectName
      ? `This project: ${pageContext.projectName}`
      : "This project";
    select.appendChild(projectOption);

    const accountOption = document.createElement("option");
    accountOption.value = "account";
    accountOption.textContent = hasCache ? "All synced chats" : "All synced chats (sync first)";
    accountOption.disabled = !hasCache;
    select.appendChild(accountOption);

    select.value = activeScope;
    return select;
  }

  function buildProjectFilterSelect(projects) {
    if (!projects.some(project => project.key === STATE.selectedProjectKey)) {
      STATE.selectedProjectKey = "all";
    }

    const select = document.createElement("select");
    select.className = "gptbd-filter-select gptbd-project-select";
    select.dataset.action = "select-project-filter";
    select.dataset.active = String(STATE.selectedProjectKey !== "all");
    select.title = "Filter synced chats by known project";
    select.setAttribute("aria-label", "Filter by project");

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Chats";
    select.appendChild(allOption);

    projects.forEach(project => {
      const option = document.createElement("option");
      option.value = project.key;
      option.textContent = project.name;
      select.appendChild(option);
    });

    select.value = STATE.selectedProjectKey;
    return select;
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

  async function ensureCapabilityHealth(options = {}) {
    const force = Boolean(options.force);
    if (!force && !isCapabilityHealthStale()) return STATE.health;
    if (STATE.health.running) return STATE.health;

    STATE.health.running = true;
    try {
      const [api, ui] = await Promise.all([
        probeApiHealth(),
        Promise.resolve(probeUiHealth())
      ]);
      STATE.health = buildCapabilityHealth(api, ui);
      scheduleCapabilityHealthRefresh(STATE.health.safeMode ? CAPABILITY_RETRY_MS : CAPABILITY_REFRESH_MS);
    } finally {
      STATE.health.running = false;
      render();
    }

    if (!options.silent && STATE.health.note) showToast(STATE.health.note);
    return STATE.health;
  }

  function setupRuntimeBridge() {
    if (runtimeBridgeReady || !chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;

      if (message.type === "gptbd:get-compatibility-status") {
        sendResponse({
          ok: true,
          report: createCompatibilityReport(false)
        });
        return false;
      }

      if (message.type === "gptbd:run-compatibility-check") {
        void (async () => {
          try {
            await ensureCapabilityHealth({ force: true, silent: true });
            refreshConversationRows();
            render();
            sendResponse({
              ok: true,
              report: createCompatibilityReport(true)
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : "Compatibility check failed."
            });
          }
        })();
        return true;
      }

      return false;
    });
    runtimeBridgeReady = true;
  }

  function isCapabilityHealthStale() {
    return !STATE.health.checkedAt || (Date.now() - STATE.health.checkedAt) > CAPABILITY_REFRESH_MS;
  }

  async function probeApiHealth() {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return {
        syncAvailable: false,
        deleteApiAvailable: false,
        issues: ["ChatGPT session unavailable."]
      };
    }

    try {
      const response = await fetch("/backend-api/conversations?offset=0&limit=1", {
        credentials: "include",
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        return {
          syncAvailable: false,
          deleteApiAvailable: false,
          issues: [`ChatGPT API returned ${response.status}.`]
        };
      }

      const data = await response.json();
      if (!Array.isArray(data?.items)) {
        return {
          syncAvailable: false,
          deleteApiAvailable: false,
          issues: ["ChatGPT API response shape changed."]
        };
      }

      return {
        syncAvailable: true,
        deleteApiAvailable: true,
        issues: []
      };
    } catch (_) {
      return {
        syncAvailable: false,
        deleteApiAvailable: false,
        issues: ["ChatGPT API could not be reached."]
      };
    }
  }

  function probeUiHealth() {
    const rows = getConversationRows();
    if (rows.length === 0) {
      return {
        deleteUiAvailable: true,
        issues: []
      };
    }

    const hasMenuButton = rows.some(({ row }) => Boolean(findMenuButton(row)));
    return {
      deleteUiAvailable: hasMenuButton,
      issues: hasMenuButton ? [] : ["Sidebar action menu is unavailable."]
    };
  }

  function buildCapabilityHealth(api, ui) {
    const syncAvailable = Boolean(api.syncAvailable);
    const deleteApiAvailable = Boolean(api.deleteApiAvailable);
    const deleteUiAvailable = Boolean(ui.deleteUiAvailable);
    const issues = [...api.issues, ...ui.issues];
    let note = "";
    let safeMode = false;

    if (!syncAvailable && !deleteApiAvailable && !deleteUiAvailable) {
      safeMode = true;
      note = "Bulk actions paused. ChatGPT changed something.";
    } else if (!syncAvailable && deleteUiAvailable) {
      note = "Sync unavailable. Delete limited to visible chats.";
    } else if (!deleteApiAvailable && deleteUiAvailable) {
      note = "Delete fallback active. Only visible chats are safe to remove.";
    }

    return {
      checkedAt: Date.now(),
      running: false,
      syncAvailable,
      deleteApiAvailable,
      deleteUiAvailable,
      safeMode,
      note,
      issues
    };
  }

  function createCompatibilityReport(ranNow = false) {
    const health = STATE.health;
    const mode = health.safeMode
      ? "paused"
      : health.syncAvailable && health.deleteApiAvailable
        ? "healthy"
        : health.deleteUiAvailable
          ? "fallback"
          : "degraded";

    const summary = {
      healthy: "ChatGPT compatibility looks healthy.",
      fallback: "ChatGPT changed slightly. Sync or API delete is limited, but the UI fallback is still available.",
      degraded: "ChatGPT compatibility is degraded. Some actions may be unavailable.",
      paused: "Bulk actions are paused until ChatGPT compatibility recovers."
    }[mode];

    return {
      mode,
      summary,
      note: health.note || "",
      checkedAt: health.checkedAt || 0,
      ranNow,
      issues: [...health.issues],
      capabilities: {
        sync: Boolean(health.syncAvailable),
        deleteApi: Boolean(health.deleteApiAvailable),
        deleteUi: Boolean(health.deleteUiAvailable)
      }
    };
  }

  function canDeleteSelection(ids = Array.from(STATE.selectedIds)) {
    if (ids.length === 0) return false;
    if (STATE.health.deleteApiAvailable) return true;
    if (!STATE.health.deleteUiAvailable) return false;
    return ids.every(id => {
      const row = document.querySelector(`[data-gptbd-conversation-id="${CSS.escape(id)}"]`);
      if (!row) return false;
      if (row.dataset.gptbdConversationSource === "project") return Boolean(findMenuButton(row));
      return true;
    });
  }

  function registerCapabilitySuccess(kind) {
    if (!(kind in STATE.failureCounts)) return;
    STATE.failureCounts[kind] = 0;

    if (kind === "sync") STATE.health.syncAvailable = true;
    if (kind === "deleteApi") STATE.health.deleteApiAvailable = true;
    if (kind === "deleteUi") STATE.health.deleteUiAvailable = true;

    STATE.health.safeMode = !STATE.health.syncAvailable && !STATE.health.deleteApiAvailable && !STATE.health.deleteUiAvailable;
    STATE.health.note = buildCapabilityHealth(
      { syncAvailable: STATE.health.syncAvailable, deleteApiAvailable: STATE.health.deleteApiAvailable, issues: [] },
      { deleteUiAvailable: STATE.health.deleteUiAvailable, issues: [] }
    ).note;
    STATE.health.checkedAt = Date.now();
  }

  function registerCapabilityFailure(kind, issue) {
    if (!(kind in STATE.failureCounts)) return;
    STATE.failureCounts[kind] += 1;
    if (issue && !STATE.health.issues.includes(issue)) {
      STATE.health.issues = [...STATE.health.issues, issue];
    }
    if (STATE.failureCounts[kind] < CAPABILITY_FAILURE_THRESHOLD) return;

    if (kind === "sync") STATE.health.syncAvailable = false;
    if (kind === "deleteApi") STATE.health.deleteApiAvailable = false;
    if (kind === "deleteUi") STATE.health.deleteUiAvailable = false;

    const recomputed = buildCapabilityHealth(
      {
        syncAvailable: STATE.health.syncAvailable,
        deleteApiAvailable: STATE.health.deleteApiAvailable,
        issues: STATE.health.issues
      },
      {
        deleteUiAvailable: STATE.health.deleteUiAvailable,
        issues: []
      }
    );
    STATE.health = { ...STATE.health, ...recomputed, running: false };
    STATE.health.checkedAt = Date.now();
    scheduleCapabilityHealthRefresh(CAPABILITY_RETRY_MS);
    render();
  }

  async function refreshSidebarAfterDelete() {
    const beforeIds = getConversationRows().map(({ id }) => id).join(",");
    const beforeCount = getConversationRows().length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    if (getPageContext().mode !== "project") {
      const newChatLink = Array.from(
        document.querySelectorAll('a[href="/"], a[href="/?model=auto"]')
      ).find(n => n instanceof HTMLElement);
      if (newChatLink) {
        newChatLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
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
    const cacheChanged = next.length !== STATE.cachedConversations.length;
    if (cacheChanged) {
      STATE.cachedConversations = next;
      persistCache();
    }
    removeConversationFromProjectIndex(id);
  }

  function clearLocalCache() {
    STATE.cachedConversations = [];
    STATE.cacheLoadedAt = null;
    STATE.selectedYear = "all";
    STATE.selectedProjectKey = "all";
    persistCache();
  }

  function buildDeleteSummary(deleted, failedCount, sidebarRefreshed) {
    const deletedPart = `Deleted ${deleted} conversation${deleted === 1 ? "" : "s"}.`;
    if (failedCount > 0) {
      const refreshNote = sidebarRefreshed ? "" : " Refresh the page if the list looks stale.";
      return `${deletedPart} ${failedCount} failed — try those again from the current list.${refreshNote}`;
    }
    if (!sidebarRefreshed) return `${deletedPart} Refresh the page if the list looks stale.`;
    return deletedPart;
  }

  function scheduleCapabilityHealthRefresh(delayMs = CAPABILITY_REFRESH_MS) {
    window.clearTimeout(STATE.healthTimer);
    STATE.healthTimer = window.setTimeout(() => {
      void ensureCapabilityHealth({ force: true, silent: true });
    }, delayMs);
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

  function persistProjectIndex() {
    try {
      window.localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify(STATE.projectIndex));
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

  function loadProjectIndex() {
    try {
      const raw = window.localStorage.getItem(PROJECT_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      const memberships = parsed?.memberships && typeof parsed.memberships === "object"
        ? parsed.memberships
        : {};

      const cleanMemberships = {};
      Object.entries(memberships).forEach(([key, value]) => {
        const ids = Array.isArray(value?.ids) ? value.ids.filter(Boolean) : [];
        if (!key || ids.length === 0) return;
        cleanMemberships[key] = {
          name: normalizeText(value?.name) || "Untitled project",
          ids: Array.from(new Set(ids)),
          updatedAt: Number(value?.updatedAt) || 0
        };
      });

      STATE.projectIndex = {
        projects: projects
          .filter(item => item?.key && item?.name && cleanMemberships[item.key])
          .map(item => ({
            key: item.key,
            name: normalizeText(item.name) || cleanMemberships[item.key].name,
            updatedAt: Number(item.updatedAt) || cleanMemberships[item.key].updatedAt || 0
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        memberships: cleanMemberships
      };
    } catch (_) {
      STATE.projectIndex = { projects: [], memberships: {} };
    }
  }

  function removeConversationFromProjectIndex(id) {
    let changed = false;
    Object.entries(STATE.projectIndex.memberships).forEach(([key, membership]) => {
      const ids = Array.isArray(membership?.ids) ? membership.ids : [];
      const nextIds = ids.filter(existingId => existingId !== id);
      if (nextIds.length === ids.length) return;
      changed = true;
      if (nextIds.length === 0) {
        delete STATE.projectIndex.memberships[key];
        STATE.projectIndex.projects = STATE.projectIndex.projects.filter(project => project.key !== key);
      } else {
        STATE.projectIndex.memberships[key] = { ...membership, ids: nextIds, updatedAt: Date.now() };
      }
    });
    if (!changed) return;
    if (STATE.selectedProjectKey !== "all" && !STATE.projectIndex.memberships[STATE.selectedProjectKey]) {
      STATE.selectedProjectKey = "all";
    }
    persistProjectIndex();
  }

  async function loadPreferences() {
    if (!chrome?.storage?.local) return;
    try {
      const stored = await chrome.storage.local.get([
        UI_HIDDEN_KEY,
        SKIP_DELETE_WARNING_KEY,
        REVIEW_SESSION_COUNT_KEY,
        REVIEW_PROMPT_HIDDEN_KEY
      ]);
      STATE.uiHidden = Boolean(stored?.[UI_HIDDEN_KEY]);
      STATE.skipDeleteWarning = Boolean(stored?.[SKIP_DELETE_WARNING_KEY]);
      STATE.reviewSessionCount = normalizeStoredCount(stored?.[REVIEW_SESSION_COUNT_KEY]);
      STATE.reviewPromptHidden = Boolean(stored?.[REVIEW_PROMPT_HIDDEN_KEY]);
      await countReviewSession();
    } catch (_) {
      STATE.uiHidden = false;
      STATE.skipDeleteWarning = false;
      STATE.reviewSessionCount = 0;
      STATE.reviewPromptHidden = false;
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

  async function hideReviewPrompt() {
    STATE.reviewPromptHidden = true;
    render();
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({ [REVIEW_PROMPT_HIDDEN_KEY]: true });
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
      if (changes?.[REVIEW_SESSION_COUNT_KEY]) {
        STATE.reviewSessionCount = normalizeStoredCount(changes[REVIEW_SESSION_COUNT_KEY].newValue);
        shouldRender = true;
      }
      if (changes?.[REVIEW_PROMPT_HIDDEN_KEY]) {
        STATE.reviewPromptHidden = Boolean(changes[REVIEW_PROMPT_HIDDEN_KEY].newValue);
        shouldRender = true;
      }
      if (shouldRender) render();
    });
    observePreferenceChanges.bound = true;
  }

  async function countReviewSession() {
    if (STATE.reviewPromptHidden || !chrome?.storage?.local || isReviewSessionMarked()) return;
    if (!markReviewSession()) return;
    STATE.reviewSessionCount += 1;
    try {
      await chrome.storage.local.set({ [REVIEW_SESSION_COUNT_KEY]: STATE.reviewSessionCount });
    } catch (_) {}
  }

  function shouldShowReviewPrompt() {
    return !STATE.reviewPromptHidden && STATE.reviewSessionCount >= REVIEW_PROMPT_THRESHOLD;
  }

  function getReviewUrl() {
    return isFirefox() ? FIREFOX_REVIEW_URL : CHROME_REVIEW_URL;
  }

  function isFirefox() {
    return /firefox/i.test(window.navigator?.userAgent || "");
  }

  function normalizeStoredCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }

  function isReviewSessionMarked() {
    try {
      return window.sessionStorage.getItem(REVIEW_SESSION_MARK_KEY) === "true";
    } catch (_) {
      return true;
    }
  }

  function markReviewSession() {
    try {
      window.sessionStorage.setItem(REVIEW_SESSION_MARK_KEY, "true");
      return true;
    } catch (_) {}
    return false;
  }

  /* ──────────────────────────── UTILITIES ───────────────────────────────── */
  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function resetModalToDeleteDefaults(modal) {
    if (!(modal instanceof HTMLElement)) return;
    const subtitleEl = modal.querySelector(".gptbd-modal__subtitle");
    const warningWrap = modal.querySelector(".gptbd-modal__warning");
    const warningText = modal.querySelector(".gptbd-modal__warning-text");
    const warningCheckWrap = modal.querySelector('[data-role="modal-warning-check"]')?.closest(".gptbd-modal__check");
    const skipWarningCheckWrap = modal.querySelector('[data-role="modal-skip-warning-check"]')?.closest(".gptbd-modal__check");

    if (subtitleEl) subtitleEl.textContent = DEFAULT_DELETE_MODAL_SUBTITLE;
    if (warningWrap) warningWrap.hidden = false;
    if (warningText) warningText.textContent = DEFAULT_DELETE_MODAL_WARNING;
    if (warningCheckWrap) warningCheckWrap.hidden = false;
    if (skipWarningCheckWrap) skipWarningCheckWrap.hidden = false;
  }

  function createTemplateFragment(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
    const fragment = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(node => {
      fragment.appendChild(document.importNode(node, true));
    });
    return fragment;
  }

  function replaceChildren(parent, children) {
    if (!(parent instanceof Element)) return;
    parent.replaceChildren(...children);
  }

  function buildDeletePreviewItems(shownTitles, remaining) {
    const nodes = shownTitles.map(title => buildPreviewItem(title));
    if (remaining > 0) {
      const more = document.createElement("div");
      more.className = "gptbd-modal__preview-more";
      more.textContent = `+\u202f${remaining}\u00a0more\u2026`;
      nodes.push(more);
    }
    return nodes;
  }

  function buildClearCachePreviewItems() {
    return [
      buildPreviewItem("Your chats in ChatGPT will not be deleted."),
      buildPreviewItem("You will need to click Sync all again to restore the cached list.")
    ];
  }

  function buildPreviewItem(text) {
    const item = document.createElement("div");
    item.className = "gptbd-modal__preview-item";

    const bullet = document.createElement("span");
    bullet.className = "gptbd-modal__preview-bullet";
    bullet.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "gptbd-modal__preview-text";
    label.textContent = text;

    item.append(bullet, label);
    return item;
  }

  function buildEmptyState(message, variant = "default") {
    const empty = document.createElement("div");
    const normalizedVariant = variant === true ? "notice" : variant;
    empty.className = `gptbd-empty${normalizedVariant && normalizedVariant !== "default" ? ` gptbd-empty--${normalizedVariant}` : ""}`;
    empty.textContent = message;
    return empty;
  }

  function buildResultsPanelNodes(results, options = {}) {
    const nodes = [buildResultsHeader(options)];
    results.forEach(conversation => nodes.push(buildResultRow(conversation, options)));
    return nodes;
  }

  function buildResultsHeader(options = {}) {
    const projectMode = options.mode === "project";
    const header = document.createElement("div");
    header.className = `gptbd-results-header${projectMode ? " gptbd-results-header--project" : ""}`;
    header.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "gptbd-results-header__title";
    title.textContent = projectMode ? "Project chat" : "Chat";

    const open = document.createElement("span");
    open.className = "gptbd-results-header__open";
    open.textContent = "Open";

    if (projectMode) {
      header.append(title, open);
      return header;
    }

    const date = document.createElement("span");
    date.className = "gptbd-results-header__date";
    date.textContent = "Date";

    header.append(title, date, open);
    return header;
  }

  function buildResultRow(conversation, options = {}) {
    const projectMode = options.mode === "project";
    const row = document.createElement("div");
    row.className = `gptbd-result${projectMode ? " gptbd-result--project" : ""}`;

    const label = document.createElement("label");
    label.className = "gptbd-result-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "gptbd-result-checkbox";
    checkbox.dataset.id = conversation.id;
    checkbox.checked = STATE.selectedIds.has(conversation.id);

    const title = document.createElement("span");
    title.className = "gptbd-result-title";
    title.textContent = conversation.title || "Untitled chat";

    label.append(checkbox, title);

    const open = document.createElement("a");
    open.className = "gptbd-result-open";
    open.href = `/c/${encodeURIComponent(conversation.id)}`;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open ↗";

    if (projectMode) {
      row.append(label, open);
      return row;
    }

    const date = document.createElement("span");
    const dateText = formatConversationDate(conversation.updateTime);
    date.className = "gptbd-result-date";
    date.title = dateText;
    date.textContent = dateText;

    row.append(label, date, open);
    return row;
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
    const projectMembership = getSelectedProjectMembership();
    return results.filter(conversation => {
      if (projectMembership && !projectMembership.has(conversation.id)) {
        return false;
      }
      if (STATE.selectedYear !== "all" && getConversationYear(conversation) !== String(STATE.selectedYear)) {
        return false;
      }
      if (STATE.searchTerm && !matchesSearch(conversation.title, STATE.searchTerm)) {
        return false;
      }
      return true;
    });
  }

  function getSelectedProjectMembership() {
    if (STATE.selectedProjectKey === "all") return null;
    const membership = STATE.projectIndex.memberships[STATE.selectedProjectKey];
    if (!Array.isArray(membership?.ids)) return new Set();
    return new Set(membership.ids);
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
    loadProjectIndex();
    await loadPreferences();
    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void init(); }, { once: true });
  } else {
    void init();
  }
})();
