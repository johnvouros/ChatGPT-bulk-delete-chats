# Changelog

All notable changes to this project should be recorded here.

This project follows a simple semantic versioning approach:

- `MAJOR`: breaking behavior or workflow changes
- `MINOR`: new features that stay backward-compatible
- `PATCH`: fixes, polish, and safe maintenance updates

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
