# ChatGPT Bulk Delete

Find old chats fast. Check what you want gone. Delete them in bulk.

## What It Does

- Syncs your ChatGPT chat list into a local cache
- Lets you search by keyword or exact words
- Opens any result in a new tab before you delete it
- Bulk deletes selected chats

## Privacy

Yes, it is privacy-safe in the normal sense for a Chrome extension:

- No data is sent to any third-party server
- No analytics, trackers, or ads
- Cache is stored locally in your browser on `chatgpt.com`
- It only talks to ChatGPT/OpenAI endpoints already used by the site
- No extra extension permissions are requested

## License

Source-available, non-commercial.

- Personal and non-commercial use is allowed
- Commercial or corporate use is not allowed without permission
- If someone wants to use it commercially, they need a separate paid license

See `LICENSE`.

## Use

1. Load the folder in `chrome://extensions` with Developer mode on.
2. Open ChatGPT.
3. Click `Sync all chats`.
4. Search.
5. Open a result in a new tab if you want to check it first.
6. Select the chats you want.
7. Click `Delete selected`.

## Notes

- `Resync chats` refreshes the cache if it gets stale.
- `Exact words` stops partial matches like `car` matching `care`.
- Icons are in `icons/` and the source SVG is `icon-source.svg`.
