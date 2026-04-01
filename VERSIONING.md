# Versioning

Use semantic versioning for store releases.

## Format

- `MAJOR.MINOR.PATCH`

Examples:

- `1.0.0`: first public release
- `1.1.0`: new feature
- `1.0.1`: bug fix or store-safe maintenance update

## What to bump

- `PATCH`
  - bug fixes
  - diagnostics changes
  - UI polish
  - compatibility fixes
- `MINOR`
  - new user-facing features
  - new workflow steps
  - meaningful search/delete/cache additions
- `MAJOR`
  - breaking behavior changes
  - removed workflows
  - large architectural changes that affect how users operate the extension

## Release flow

1. Update the version in `manifest.json`
2. Add a short entry to `CHANGELOG.md`
3. Rebuild the submission ZIPs
4. Submit the update to Chrome Web Store / AMO

## Local bump helper

Run:

```bash
node scripts/bump-version.mjs patch
node scripts/bump-version.mjs minor
node scripts/bump-version.mjs major
node scripts/bump-version.mjs 1.0.1
```
