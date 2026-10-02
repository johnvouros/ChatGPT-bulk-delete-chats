# Privacy Policy

ChatGPT Bulk Delete keeps your data local.

## What it accesses

- Your ChatGPT conversation list and conversation IDs on `chatgpt.com`
- Library file metadata, including file names and Library/file IDs, when you sync Library files
- Your ChatGPT session context when needed for compatibility checks, syncing, or deleting selected chats or Library files

## What it stores

- A local cache of chat titles, chat IDs, and last sync time in your browser storage on `chatgpt.com`
- Library metadata and thumbnail previews are held only in tab memory, isolated by account; they are not saved to persistent extension or site storage
- The selected toolbar mode (Chats or Library) is saved as a UI preference; no Library files or previews are included
- Legacy Library metadata caches are removed automatically when this version loads
- Preview requests use `cache: "no-store"`, and temporary preview URLs are revoked on removal, reset, or page exit
- This does not clear data previously cached by ChatGPT, browser history, downloads, or operating-system artifacts

## What it does not do

- No third-party servers
- No analytics
- No trackers
- No ads
- No selling or sharing of your data

## Network use

The extension only talks to ChatGPT/OpenAI endpoints already used by the ChatGPT website in order to:

- sync your chat list
- open chats you choose
- delete chats you select
- sync Library metadata, load visible thumbnail previews, and delete Library files you select and confirm

## Your control

- Library sync starts automatically when you open Library mode or refresh with Library mode selected
- You can clear the current Library session or manually resync
- You choose what to delete
- You can resync at any time
