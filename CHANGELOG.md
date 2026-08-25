# Changelog

All notable changes to this project should be recorded here.

This project follows a simple semantic versioning approach:

- `MAJOR`: breaking behavior or workflow changes
- `MINOR`: new features that stay backward-compatible
- `PATCH`: fixes, polish, and safe maintenance updates

## [1.1.1] - 2026-08-25

Sync reliability fix.

- Retry transient conversation-page timeouts with bounded exponential backoff
- Save account-scoped partial progress and safely re-scan after an interrupted sync
- Avoid stale offsets so conversation-list changes cannot skip or leak chats
- Preserve the last complete cache when a sync pauses or cannot be persisted
- Pace bulk delete requests, reuse one session token per batch, and stop safely on ChatGPT rate limits
- Keep unprocessed rate-limited chats selected so the batch can be retried after the cooldown
- Rename the selection toggle to describe its sidebar checkboxes and explain when the sidebar is closed

## [1.1.0] - 2026-04-28

Feature update.

- Updated extension, Chrome Web Store, and Firefox Add-ons icon assets from the corrected cropped app icon design
- Updated the in-page toolbar mark to use the packaged extension icon
- Added a neutral rate-extension pill after repeated use with Chrome and Firefox review links
- Added a dev-mode popup switch to force-show or hide the rate-extension pill for testing
- Added visible ChatGPT Project chat selection with project-scoped select-all behavior
- Added a project scope selector so Project pages can switch between the current project list and synced account-wide chats
- Added a known-project dropdown to the synced chat filters, using project memberships discovered from visited Project pages
- Added a project-only list panel so users can filter, review, and select discovered project chats from the toolbar
- Clarified project delete confirmation copy so users know chats are permanently deleted, not just removed from a project
- Clarified empty project-filter results so users know to open a Project page and load its chat list before filtering by that project

## [1.0.1] - 2026-04-02

Maintenance update.

- Added safer runtime compatibility checks so broken ChatGPT changes fail safely
- Added a dev-only popup compatibility check for maintenance and troubleshooting
- Restored sidebar jump behavior when entering `Select chats`
- Clarified the sort control so it reads as an actual sort toggle
- Polished popup behavior and release versioning support

## [1.0.0] - 2026-03-30

Initial public release.

- Bulk delete for ChatGPT chats
- Local cache sync from ChatGPT conversation metadata
- Keyword and exact-word search
- Open result in a new tab before delete
- Chrome and Firefox support
- Local-only cache and no third-party server
