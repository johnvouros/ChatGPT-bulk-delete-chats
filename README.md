# ChatGPT Bulk Delete

Chrome extension that adds cached search and multi-select controls to ChatGPT so you can find and delete conversations in one pass.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `/home/desktopc/bulkdeletechrome`.

## Use

1. Open `https://chatgpt.com/`.
2. Click `Sync all chats` once to cache your conversation list locally.
3. Use `Resync chats` any time you want to refresh stale cache data.
4. Type a keyword into `Search loaded chat titles`.
5. Use `Exact words` if you want whole-word keyword matching instead of partial substring matching.
6. Click `Select chats`.
7. Tick the chats you want to remove from the cached results list, or click `Select matches`.
8. Use `Open` on any result if you want to inspect that chat in a new tab first.
9. Click `Delete selected`.

## Notes

- It works by using the existing ChatGPT delete menu and confirm dialog.
- Deletion tries ChatGPT's own conversation API first and falls back to the visible menu flow if needed.
- `Sync all chats` uses ChatGPT's conversations API and stores a local cache in browser storage on `chatgpt.com`.
- The panel shows the last sync time so you can tell when the cache may be stale.
- Cached search works even if the sidebar has not rendered older conversations.
- `Exact words` makes each typed keyword match whole words only, so `car` will not match `care`.
- SVG source art for the panel badge and store exports is in `icon-source.svg`.
- PNG exports are in `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`, `icons/icon-256.png`, and `icons/icon-512.png`.
- If ChatGPT changes its sidebar or menu markup, selectors in `content.js` may need to be updated.
- This only targets conversations with URLs matching `/c/<id>`.
