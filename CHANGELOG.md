# Changelog

All notable changes to this project should be recorded here.

This project follows a simple semantic versioning approach:

- `MAJOR`: breaking behavior or workflow changes
- `MINOR`: new features that stay backward-compatible
- `PATCH`: fixes, polish, and safe maintenance updates

## [1.2.2] - 2026-10-09

- Increase chat, Library, and confirmation checkboxes to 18 px
- Add brighter borders and solid backgrounds to make unchecked boxes easier to see
- Improve hover and keyboard-focus indicators
- Use native checkbox rendering in system high-contrast mode
- Retain all 1.2.1 compatibility, deletion-speed, and confirmation safeguards

## [1.2.1] - 2026-10-02

- Support ChatGPT's new `/space/files` page, including navigation without a page refresh; retain the older `/library` route
- Fix Library module detection in Firefox
- Restore thumbnail previews using ChatGPT's new thumbnail route and same-origin redirects without persistent preview caching
- Speed up chat and Library deletion by counting request time toward the existing 1.2-second interval; retain rate-limit pauses
- Show a prominent plain-English explanation of deletion pacing
- Add a select-all checkbox beside the Chat heading, including partial-selection state and filter-aware selection
- Remove API-confirmed chat deletions from the list immediately instead of waiting for ChatGPT's sidebar to refresh
- Preserve manual tab selection and explain when an operation temporarily blocks switching
- Clarify that the extension's file selection is independent of ChatGPT's Images/Uploads filters

## [1.2.0] - 2026-09-30

- Automatically sync when opening/restoring Library mode and show tiles progressively without persistent file or thumbnail caching

- Add separate Library file sync, filename search, selection, and bulk deletion for issue #7
- Keep Library metadata and previews in tab memory only; purge legacy Library caches
- Add a responsive five-column thumbnail grid with filtered select-all and on-demand no-store previews
- Use the current native Library DELETE endpoint and explicit JSON success response
- Require explicit Library deletion confirmation and reuse paced batches and rate-limit cooldowns
- Report Library compatibility separately and pause on unrecognized API responses
- Add regression coverage for progressive sync, account switching, cache cleanup, and deletion safeguards
- Maintainer verified Library syncing and deletion in live testing

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
