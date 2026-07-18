# Qwen Video Factory

Bulk prompt automation for video generation on chat.qwen.ai. Load a list of
prompts, tag the ones meant for video generation, walk away, come back to
generated (and optionally downloaded) results — within a single account's own
daily limit, not around it.

## Status: scaffold

This repo's file structure mirrors [Overflow](https://github.com/s4ndm4ndev/Overflow)
(this extension's sister project for Google Flow), but the DOM selectors in
`content-scripts/qwen.js` are placeholders — they need to be replaced with the
real ones from live inspection of chat.qwen.ai before this actually works.
See "Before this can generate a single video" below.

## Features (once selectors are filled in)

- **Bulk prompt queue** — paste or upload a list of prompts, set a min/max
  delay, then Start. The queue runs unattended: types each prompt, submits,
  and waits for the result before moving on.
- **`[video]` tag filtering** — only lines prefixed with `[video]` are
  submitted; everything else loads into the queue as "Skipped." Lets you keep
  a mixed prompt file (some video, some not) without hand-splitting it first.
- **Daily-limit detection with a clean stop** — when chat.qwen.ai reports its
  daily generation limit reached, the queue stops and reports how many
  prompts got through and how many are left, rather than erroring out one
  prompt at a time. It does **not** switch accounts to route around the
  limit — see "Why no account-switching" below.
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

## Why no account-switching

An earlier draft of this extension included stubs (`switchAccount()`,
`canContinue()`) for detecting a daily-limit error and rotating to another
logged-in account to keep generating. That's account-cycling to evade a
per-account usage quota — a ToS violation for most services, chat.qwen.ai's
5-video daily cap included, and can get every linked account banned. This
repo intentionally does not implement that. The daily-limit handling here
stops the queue and waits for the user, instead of routing around the limit.

## Before this can generate a single video

`content-scripts/qwen.js`'s selectors (`findPromptInput`,
`findGenerateButton`, `findDailyLimitMessage`, `isVideoModeOn`,
`waitForResult`/`extractResult`) are placeholder guesses, not confirmed
against the real page. Before relying on this:

1. Open chat.qwen.ai in DevTools and inspect the actual composer, submit
   control, video-mode selector, and the exact text/markup of the daily-limit
   message.
2. Confirm whether the composer is a plain `<textarea>` (the current
   assumption in `setPromptText()`) or a framework-controlled rich-text editor
   that needs the `content-scripts/qwen-main-world.js` bridge instead (see
   that file's header comment, and Overflow's `flow-main-world.js` for the
   pattern to copy if so).
3. Confirm whether the generate/submit button responds to a plain synthetic
   click, or needs a genuinely trusted click via `chrome.debugger` the way
   Overflow's Flow automation does — if so, `debugger` needs adding back to
   `manifest.json`'s permissions and the attach/click/detach relay ported
   from Overflow's `background.js`.
4. Confirm whether the finished video is a same-origin URL fetchable
   directly by `chrome.downloads.download()`, or a page-scoped `blob:` URL
   needing a different download path.

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

- DOM selectors are unverified placeholders — see "Before this can generate a
  single video" above.
- Not published to the Chrome Web Store.
- Prompt queue lives in the side panel's memory only — closing the panel
  loses progress on the current batch.
