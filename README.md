# Qwen Video Factory

Bulk prompt automation for video generation on chat.qwen.ai. Load a list of
prompts, walk away, come back to generated (and optionally downloaded)
results. Optionally load multiple accounts to keep a batch running past a
single account's daily limit — see "Account rotation on daily-limit" below.

## Status: core flow confirmed live end-to-end

This repo's file structure mirrors [Overflow](https://github.com/s4ndm4ndev/Overflow)
(this extension's sister project for Google Flow). The generation flow
(composer, send button, "Create Video" mode toggle, daily-limit detection,
video-result extraction) and the full account-rotation logout → login flow
have all been confirmed against the live chat.qwen.ai page — see
CHANGELOG.md for what was verified and how.

## Features

- **Bulk prompt queue** — paste or upload a list of prompts, set a min/max
  delay, then Start. The queue runs unattended: types each prompt, submits,
  and waits for the result before moving on.
- **Daily-limit detection with account rotation** — when chat.qwen.ai reports
  its daily generation limit reached, and an accounts file is loaded, the
  queue logs into the next account and keeps going, retrying the prompt that
  hit the limit. With no accounts loaded (or once every loaded account is
  exhausted), it stops cleanly instead, reporting how many prompts got
  through and how many are left — see "Account rotation on daily-limit"
  below.
- **Pause / Resume / Stop / Clear queue** — pause and resume manually at any
  point. A queue stopped by the daily limit (or manually) stays in place so
  you can resume it once your quota resets, instead of losing progress.
- **Auto-pause on focus loss** — automatically pauses if the chat.qwen.ai tab
  isn't the active tab (Chrome throttles background-tab timers), and resumes
  the moment it's focused again.
- **Auto Download** — automatically saves each finished video into a chosen
  subfolder with zero-padded filenames (`001.mp4`, `002.mp4`, ...).
- **First-run download-location notice** — a one-time reminder pointing to
  `chrome://settings/downloads`, so it's clear where finished videos land.
- **About tab** — version, author, and website, read live from
  `manifest.json` so it can't drift out of sync.

## Account rotation on daily-limit

Optionally load a plaintext accounts file into the "Load accounts file"
control. When chat.qwen.ai's own on-page daily-limit message is detected
mid-queue, the extension logs the current account out, logs the next loaded
account in, and resumes the queue — retrying the prompt that hit the limit
rather than skipping it. It stops once every loaded account has hit its own
limit or failed to log in.

**Accounts file format** — blocks separated by a blank line:

    User name: xyz@xyz.com
    Password: 123456

    User name: abc@abc.com
    Password: 987654

**Security note**: loaded account credentials are kept in the side panel's
in-memory JS state only — never written to `chrome.storage.local` or
anywhere else on disk by this extension. Closing the panel clears them, same
as the prompt queue; re-upload the file to resume rotation in a new panel
session. The accounts `.txt` file itself, if you keep it in this repo's
folder, is still plaintext on your own disk — `.gitignore` prevents it from
being committed, but it isn't otherwise encrypted or protected.

**A note on this decision**: an earlier version of this README declined to
build account-switching at all, on the grounds that cycling accounts to
route around chat.qwen.ai's per-account daily cap is a ToS violation that
can get every linked account banned. That risk hasn't gone away — it's just
now the user's own informed call to make about their own accounts, not
something this extension avoids on their behalf.

## Installing (unpacked)

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this folder
4. Click the Qwen Video Factory icon in the toolbar → the side panel opens
   on a chat.qwen.ai tab

## Versioning

`manifest.json`'s `version` field is constrained by Chrome to plain
`major.minor.patch.build` integers. This repo uses the 4th segment as a
pre-release build counter, e.g. `0.1.0.0` is the first scaffold build of the
`0.1.0` line.

To bump the version:

```
node scripts/bump-version.js <major|minor|patch|build>
```

Bumping a segment resets everything to its right to `0`.

## Known limitations

- `performLogin()` has no CAPTCHA-detection logic — no CAPTCHA appeared
  during testing, but if chat.qwen.ai presents one for some account, it
  currently just times out generically rather than reporting that
  specifically.
- Not published to the Chrome Web Store.
- Prompt queue lives in the side panel's memory only — closing the panel
  loses progress on the current batch.
- Loaded accounts live in the side panel's memory only, same as the prompt
  queue — closing the panel forgets them (including which ones were already
  exhausted this run), and the accounts file needs re-uploading to resume
  rotation.
