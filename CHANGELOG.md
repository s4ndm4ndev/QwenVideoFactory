# Changelog

Sessions with Claude Code don't sync across machines — only what's committed
to git does. This file is the running record of _why_ things changed, not
just what, so picking this up from a different machine (or a fresh session)
starts from real context instead of re-deriving it from diffs.

**This is the memory mechanism between sessions.** AI-assistant config/instruction
files (`CLAUDE.md`, `.claude/`, etc.) are gitignored and local-only — nothing
in them carries over automatically. Anything worth remembering about *why*
a change was made belongs here instead, committed like any other file.

**Commit convention**: do not add a `Co-Authored-By: Claude ...` (or any
"Co-author") trailer to commit messages in this repo.

Newest first.

## 2026-07-18 — No Co-author trailer in commit messages; memory note added to CLAUDE.md too

- **Request**: never add a "Co-author" title to commit messages, recorded as
  a standing rule in both CLAUDE.md and this changelog; also wanted the
  cross-session-memory note from the entry below copied into CLAUDE.md.
- **Added the commit-convention line** to this file's header (above) —
  matches the same rule already in [Overflow](../Overflow)'s CHANGELOG.md.
- **Created [CLAUDE.md](CLAUDE.md)**: the no-co-author commit rule, plus the
  same cross-session-memory note as this file's header (CHANGELOG.md is the
  shared memory; CLAUDE.md and other AI-assistant config are local-only and
  gitignored).

## 2026-07-18 — .gitignore covers AI-assistant local files; changelog is now the memory mechanism

- **Request**: a proper `.gitignore` that excludes AI-tool files (`CLAUDE.md`
  named explicitly as an example), and a standing note that this changelog —
  not any AI tool's local memory/config — is how context gets shared between
  sessions and machines from now on.
- **Added to `.gitignore`**: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/`
  (already present), `.cursorrules`, `.cursor/`, `.windsurfrules`,
  `.windsurf/`, `.clinerules`, `.roo/`, `.aider*`, `.continue/` — local
  config/instructions for whichever AI assistant is in use, which can differ
  machine to machine and isn't meant to be committed.
- **Added the memory-mechanism note** (above, in this file's header) —
  matches the convention already used in [Overflow](../Overflow)'s
  CHANGELOG.md, this extension's sister project.

## 2026-07-18 — Restructured to mirror Overflow's file layout

- **Request**: this is a new extension (bulk prompt automation for
  chat.qwen.ai video generation); wanted the file structure to match
  [Overflow](../Overflow) (this extension's sister project for Google Flow)
  rather than the flat `popup.html`/`popup.js`/`style.css` layout the repo
  started with.
- **Structural decisions confirmed with the user**: sidePanel UI (not a
  popup) to match Overflow; a two-file content-script split
  (`content-scripts/qwen.js` isolated-world + `content-scripts/qwen-main-world.js`
  MAIN-world bridge) in case chat.qwen.ai's composer turns out to need direct
  framework-state access the way Flow's Slate.js editor did; full scaffolding
  parity (README, CHANGELOG, `.gitignore`, `.claude/launch.json`,
  `scripts/bump-version.js`, `docs/privacy.html`).
- **Removed the account-cycling stubs** that were in the original
  `popup.js` (`switchAccount()`, `canContinue()` — daily-limit detection
  feeding into rotating to another logged-in account). That mechanism is
  designed to evade chat.qwen.ai's per-account daily generation cap, which is
  a ToS violation for most services and risks getting linked accounts
  banned — declined to port it. Replaced with a clean-stop design: the
  content script surfaces `dailyLimitReached` from chat.qwen.ai's own
  on-page message, and the queue in `sidepanel/sidepanel.js` stops there,
  reporting progress, rather than trying to route around the limit.
- **Added `[video]` line-tag filtering** to the prompt queue (a scoped-down
  substitute for one of the originally-requested features, "only submit
  prompts explicitly tagged for video generation, skip others") — lines not
  prefixed with `[video]` load into the queue as "Skipped" instead of being
  submitted.
- **Added a first-run download-location notice** (a dismissible one-time
  banner pointing to `chrome://settings/downloads`), separate from the
  existing conditional "Ask where to save each file" hint that only shows
  once Auto Download is toggled on.
- **Everything in `content-scripts/qwen.js` is an unverified placeholder** —
  no live inspection of chat.qwen.ai has happened yet. See README.md's
  "Before this can generate a single video" section for the concrete list of
  what needs confirming (composer type, submit-button click requirements,
  daily-limit message text/selector, video-result URL type).

## 2026-07-17 — Initial scaffold

- Manifest V3 extension shell with a `browser_action` popup:
  `manifest.json`, `popup.html`, `popup.js`, `style.css`, `icons/`.
- `popup.js` contained early stubs for an account list, a `canContinue()`
  daily-limit check, and a `switchAccount()` account-rotation function —
  superseded by the 2026-07-18 restructure above.
