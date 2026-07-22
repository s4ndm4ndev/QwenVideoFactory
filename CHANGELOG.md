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

## 2026-07-22 — Chrome Web Store publishing readiness pass

- **Request**: get the extension ready to publish on the Chrome Web Store.
- **`docs/privacy.html` was stale and inaccurate** — it explicitly claimed
  the extension "does not create, manage, or switch between multiple
  chat.qwen.ai accounts" and never touches "authentication credentials or
  passwords," both written before the account-rotation feature existed (see
  README's "Account rotation on daily-limit"). It also claimed chat.qwen.ai
  is "the only site" the extension interacts with, which misses the
  ad-blocker-detection requests to `static.doubleclick.net` and
  `pagead2.googlesyndication.com` (`content-scripts/qwen.js`). Rewrote the
  affected sections to match actual behavior: a new "Account rotation and
  credentials" section describing in-memory-only credential handling
  (matches the README's existing security note), and disclosure of the
  ad-blocker probe requests (network-only, no data sent or read).
- **Added a Privacy Policy link to the About tab** (`sidepanel/sidepanel.html`,
  `sidepanel/sidepanel.js`), same pattern as the existing Web Site link,
  pointing at `https://s4ndm4ndev.github.io/QwenVideoFactory/privacy.html`
  (the `docs/` folder convention for GitHub Pages) — **GitHub Pages isn't
  confirmed enabled on this repo yet**; verify that URL resolves before
  actually publishing, and update `PRIVACY_POLICY_URL` if the real hosting
  location differs.
- **Added `scripts/package.js`**: zips exactly the runtime files Chrome needs
  (`manifest.json`, `background.js`, `content-scripts/`, `sidepanel/`,
  `icons/`) into `qwen-video-factory-<version>.zip` for dashboard upload —
  excludes README/CHANGELOG/docs/scripts so the store package doesn't carry
  repo-only files. Output stays untracked (already covered by the existing
  `*.zip` gitignore rule). Uses `Compress-Archive` on Windows, `zip`
  elsewhere.
- **Added `docs/store-listing.md`**: draft copy for the Developer Dashboard's
  Store Listing and Privacy Practices tabs (category, descriptions, single
  purpose statement, permission justifications, data-usage disclosure
  table) plus a checklist of what's still manual (screenshots, GitHub Pages
  confirmation, the $5 registration fee and the submission itself — none of
  which can be done on the user's behalf).
- **Deliberately not changed**: the extension's name ("Qwen Video Factory")
  still uses Alibaba's "Qwen" trademark in the title. Flagged as a possible
  Chrome Web Store review risk (trademark-in-title policies), mitigated by
  the existing non-affiliation disclaimer in `docs/privacy.html`'s footer —
  left as a call for the user to make, not changed unilaterally.

## 2026-07-21 — Made mode-select clicks self-healing instead of relying on a full page reload every time one silently didn't register

- **Request**: the user ran a real batch with reference images (screenshot:
  console showed `setPromptText done` → `attachReferenceImage starting`,
  then a stall) and reported the underlying pattern clearly for the first
  time: item 1 fails its first two attempts — both enabling "Create Video"
  mode and attaching the reference image fail — and only succeeds on the
  3rd attempt, after 2 automatic reload-and-retry cycles. Called out that
  this looks broken to a user even though it does eventually self-heal, and
  asked for it to be root-caused properly, offering live debugging.
- **Confirmed the exact mechanics** (Explore-agent read of the current code,
  no guessing): `runQueue()` in `sidepanel/sidepanel.js` does exactly ONE
  full page reload at the very start of a batch, before item 1's first
  attempt; every subsequent `PAGE_NOT_READY:` failure (any item) triggers up
  to 2 more reload-and-retries through the identical mechanism — 3 total
  attempts, matching the reported pattern exactly. Item 1's first attempt is
  the only one in a normal run structurally guaranteed to start immediately
  after a fresh reload, making it the most exposed to any post-reload
  flakiness. The reload-readiness gate (`composerReady`/`toolbarReady`) only
  checks that the textarea and mode-select trigger *exist* in the DOM, not
  that they're actually interactive yet.
- **The real root cause isn't new** — `enableVideoMode()`'s own header
  comment already documented it from an earlier session: a click on an
  element that demonstrably exists can silently fail to register (menu
  doesn't open, or a selection doesn't confirm), previously correlated with
  an intermittent React hydration crash never fully nailed down across
  several prior sessions. Live-tested this again directly (Claude in Chrome,
  the user's own real, already-logged-in chat.qwen.ai session, no
  credentials entered): several fresh reloads all hydrated cleanly within
  ~1-1.75s with working clicks — consistent with this being a real but
  intermittent issue, not a constant timing gap, and it couldn't be forced
  to reproduce on demand in a handful of tries.
- **Decision**: rather than continue chasing the exact crash cause (already
  resisted diagnosis across multiple sessions), fixed the thing that's
  cheap to fix regardless of cause — made each individual attempt recover
  from a silently-swallowed click within its own existing timeout budget,
  instead of relying on an expensive whole-page-reload as the only recovery
  path.
- **`content-scripts/qwen.js`**: added `retryClickUntil()` (right after
  `waitFor()`) — clicks a target, and if the expected DOM change hasn't
  happened after ~3.5s and time remains in the same total timeout the caller
  already had, re-queries the target (DOM may have re-rendered) and clicks
  it again, repeating until success or timeout. Applied it to
  `enableVideoMode()`'s two click-then-wait steps (trigger→menu-open,
  item→mode-pill-confirm — the latter's target-getter also re-clicks the
  trigger to reopen the dropdown if it auto-closed after an apparently-silent
  selection) and `attachReferenceImage()`'s one click-then-wait step
  (trigger→menu-open). Worst-case duration for each step is unchanged (still
  ≤20000ms) — only how that time gets spent changes. Deliberately left
  unchanged: `attachReferenceImage()`'s item-click→`#filesUpload` existence
  check (never evidenced as a failure point) and its 90s upload-confirmation
  wait (confirmed live, 2026-07-20, to be genuine upload duration — retrying
  there would mean re-dispatching the file, a real risk of a duplicate
  upload for no upside).
- **Deferred, not done now**: hooking the existing (currently
  diagnostic-only) `error`/`unhandledrejection` listeners to detect the
  crash signature and short-circuit an in-flight wait faster. Correlating a
  global error event to one specific in-flight wait safely needs either a
  shared flag threaded through every wait site or a narrow message match, to
  avoid false-failing an otherwise-fine slow-but-real wait — better scoped
  after seeing real `retryClickUntil` reclick logs from a live run, which
  will show whether this is even still needed.
- **`sidepanel.js`/`background.js`**: untouched by design. The
  `PAGE_NOT_READY:` reload-and-retry path stays exactly as-is, as defense in
  depth for whatever `retryClickUntil` doesn't catch — this fix only reduces
  how often that path gets exercised. New reclick activity is visible for
  free through the existing `qvfLog()` → panel Log-tab pipeline.
- **Verified this session**: `node --check` passed. Also sanity-checked
  `retryClickUntil()` standalone against the real page (Claude in Chrome,
  same live session) — it correctly found and clicked the mode-select
  trigger and resolved on the very first click with no spam or errors on a
  normal (working) page, confirming the happy path is sound.
- **Confirmed live in the user's next real batch (6 items, reference images
  enabled)**: items 1–5 all completed `DONE` with no `PAGE_NOT_READY`
  reload-retries at all — a real improvement over the previous "2 retries
  before success" pattern. Item 6 did trigger one reclick
  (`attachReferenceImage: open menu` — "no change after 3500ms,
  re-clicking"), and it resolved in place on the very next check rather than
  falling through to a full reload — exactly the intended behavior. This
  fix is confirmed working, not just plausible.

## 2026-07-21 — Recognized a third limit message (Alibaba Cloud's own API rate limit) that previously left the queue stuck on "Generating" instead of rotating accounts

- **Request**: in the same live batch run above, the user reported that
  after one account hit its limit and rotation worked correctly, the next
  account also hit some kind of limit — but this time the extension did
  *not* rotate to a third, available account. It just sat on "Generating"
  until it naturally timed out.
- **Root cause, visible directly in the shared screenshot's console**: the
  actual failure was `"Oops! There was an issue connecting to Qwen3.7-Plus.
  Requests rate limit exceeded, please try again later. For details, see:
  https://www.alibabacloud.com/help/en/model-studio/error-code#rate-limit"`
  — a third, distinct message from both existing checks:
  `findDailyLimitMessage()`'s "daily usage limit" banner (rotates accounts)
  and `findRateLimitMessage()`'s "too many requests in a short period"
  client-side throttle (cooldown-retries the same account). This new message
  matched neither, so `waitForResult()` never recognized anything had
  happened and ran blind to its full 180s timeout — exactly the reported
  symptom, and exactly why no rotation was attempted.
- **`content-scripts/qwen.js`**: added `countApiRateLimitOccurrences()` /
  `findApiRateLimitMessage()`, matching on the doc-URL fragment
  (`model-studio/error-code#rate-limit`) as the primary anchor plus the
  message phrase as fallback — same "rising count, not just presence"
  principle as the existing rate-limit check, since this bubble also stays
  in the transcript afterward. `waitForResult()` now resolves
  `{ apiRateLimited: true, message }` when this rises, checked alongside the
  other two conditions.
- **`sidepanel/sidepanel.js`**: new `apiRateLimited` branch in `runQueue()`.
  Judgment call, not yet live-confirmed: unlike the existing "too many
  requests" throttle (assumed browser/IP-wide, so rotating accounts wouldn't
  help), this message is Alibaba's own backend API rate limit — plausibly
  scoped to the specific account/API key, not shared — so this does a few
  short cooldown-retries on the same account first (reusing
  `rateLimitCooldown()`, now with an optional `label` param so the status
  text reads "Hit Qwen's API rate limit" instead of reusing the other
  throttle's wording), and if that doesn't clear it within 3 attempts,
  rotates to the next account via the existing `tryRotateToNextAccount()` —
  the same path the daily-limit case already uses — rather than stopping the
  whole queue. This directly addresses the reported gap: an available next
  account was never tried.
- **Not yet independently tested live** — implemented directly from the
  user's own real screenshot (strong evidence for the detection side), but
  the retry-then-rotate behavior itself hasn't been exercised against a real
  repeat of this condition yet. Next real-world test: if this message
  recurs, confirm the Log tab / status line shows "Hit Qwen's API rate
  limit" cooldowns first, then (if it persists past 3 attempts) an actual
  rotation to the next available account — not another silent stall.

## 2026-07-20 — The new logging paid off immediately: found the "Upload attachment" menu item gets 4x less wait time than the equivalent "Create Video" check, for no real reason

- **Request**: the user ran a batch and shared three screenshots from a real
  failure. Thanks to the previous entry's logging fix, the Log tab now named
  the exact failure for the first time:
  `attachReferenceImage: 'Upload attachment' option not found in the mode
  menu after waiting 5s` — confirming the instrumentation worked as
  intended.
- **Found a real, concrete bug**: `attachReferenceImage()`'s wait for the
  "Upload attachment" menu item was hardcoded to 5000ms, while
  `enableVideoMode()`'s wait for "Create Video" — the exact same shape of
  check, same dropdown, same `li.mode-select-common-item` selector — gets a
  full 20000ms. There was never a documented reason for this asymmetry; it
  looks like an oversight from whenever `attachReferenceImage()` was first
  written, not a deliberate choice.
- **`content-scripts/qwen.js`**: widened this wait from 5000ms to 20000ms to
  match `enableVideoMode()`'s equivalent check, with a comment noting the
  live evidence and the asymmetry that motivated it. Updated the failure
  qvfLog() to say "after waiting 20s" to match.
- **Also visible in the same screenshots, worth flagging separately**: two
  distinct chat.qwen.ai-side page errors recurred on essentially every fresh
  reload in this session — `Uncaught TypeError: Cannot read properties of
  undefined (reading '1')` from `jquery.min.js`, and in one reload, the
  actual `Minified React error #418` hydration crash this project's history
  (2026-07-19) already correlated with ad/tracker-blocking interference. The
  extension's own ad-blocker hard-block overlay did not appear during this
  session despite the crash recurring, meaning whatever is causing it here
  isn't tripping the two specific bait URLs (`static.doubleclick.net`,
  `pagead2.googlesyndication.com`) `refreshAdBlockerStatus()` currently
  checks. Not fixed this entry — flagged for the user to check (any ad
  blocker, privacy extension, or DNS-level blocking currently active) and
  for a future entry if it turns out to still matter after this timeout fix.
- **Not independently re-tested live** — the fix is narrowly scoped and
  directly evidenced by this session's own Log tab output, but hasn't itself
  been run against a real batch yet. Next real-world test: run a batch with
  reference images again; if item 1 still fails, the Log tab will now show
  either a different, more specific reason (progress), or the same "not
  found after waiting 20s" (meaning the underlying page-side crash is severe
  enough to block this for over 20s, at which point the ad-blocker/hydration
  question above becomes the real next lead, not another timeout bump).

## 2026-07-20 — Closed a logging blind spot: most PAGE_NOT_READY failure points threw silently, with no way to tell which check failed on a given attempt

- **Request**: the user reported the first attempt at a prompt keeps
  failing regardless of which underlying issue gets fixed, and it always
  takes a reload-retry to succeed — asked why this keeps happening and
  whether it can actually be fixed, understandably frustrated after several
  rounds of this.
- **Traced through the actual log gap**: a real transcript showed
  `setPromptText done` → `attachReferenceImage starting` → **20+ seconds of
  nothing** → a fresh `runPrompt: start` for the next item, with no
  completion, error, or reason logged anywhere in between for the first
  attempt. Reading through every `PAGE_NOT_READY:`-tagged throw site in
  `content-scripts/qwen.js` explains why: only one of `attachReferenceImage()`'s
  four failure points (the final upload-confirmation timeout) ever called
  `qvfLog()` before throwing. The other three there, both of
  `setPromptText()`'s/`runPrompt()`'s prompt-input checks, `enableVideoMode()`'s
  three failure points, and `runPrompt()`'s submit-button check all threw
  completely silently. Whatever failed on that first attempt was real and is
  presumably still happening — there was simply no way to ever see which
  check it was, since the reload-and-retry that follows a `PAGE_NOT_READY`
  wipes the console (`Console was cleared` from the page reload) and the
  sidepanel's own retry status text was a generic "reloading and retrying",
  never the actual reason.
- **`content-scripts/qwen.js`**: added a `qvfLog()` call immediately before
  every previously-silent `PAGE_NOT_READY:` throw (both `findPromptInput()`
  checks, all three of `enableVideoMode()`'s, all three of
  `attachReferenceImage()`'s pre-upload checks, and the submit-button check),
  naming exactly which precondition failed.
- **`sidepanel/sidepanel.js`**: the reload-and-retry status line (`runQueue()`)
  now includes the actual (tag-stripped) failure reason —
  `` chat.qwen.ai wasn't ready (<reason>) — reloading and retrying... `` —
  instead of a generic message that looked identical no matter which check
  actually failed.
- **This is not itself a fix for whatever is failing on the first attempt**
  — it's instrumentation, deliberately, since guessing a specific selector or
  timing fix without knowing which of ~8 different checks is actually
  failing would just be another round of the same guessing loop the user is
  reasonably tired of. The next test run's Log tab (or the retry status
  line, now that it carries the reason too) will name the exact failing
  check directly, turning "why does this keep happening" into an answerable
  question instead of another guess.
- **Next step**: run a batch again and, if the first-attempt failure recurs,
  check the Log tab (or Copy it) for whichever new line fired right before
  the reload — that pinpoints the real root cause for a real fix, rather
  than guessing at ordering/timing again.

## 2026-07-20 — Found the real cause of the reference-image "could not confirm attached" failure via live network tracing: a 20s timeout was just too short for a real upload

- **Request**: the user tested the previous entry's text→image→video-mode
  reorder live. It "kind of worked" but was flaky — the page reloaded (the
  auto-retry logic) a few times before an attach finally succeeded on the
  third try, then a later item timed out again with the same "Could not
  confirm the reference image was attached." error. Asked to properly
  synchronize these steps instead of continuing to guess.
- **Investigated live** (Claude in Chrome, the user's own real, already
  logged-in chat.qwen.ai session — no credentials entered) rather than guess
  a fourth time. First re-confirmed the previous entry's fix actually holds:
  with "Create Video" mode already selected, the mode-select dropdown *does*
  still offer "Upload attachment" (contradicting the read of the very first
  live investigation that motivated last entry's reorder) — so the "menu
  item not found" failure from two entries ago was specific to that run, not
  a structural rule. The real, reproducible issue is different: dispatching
  a tiny (68-byte) test file produces a confirmed `img.vision-item-image`
  with a real OSS CDN `src` in a few seconds every time, exactly as
  originally documented — but dispatching a realistically-sized file (tested
  at ~1.6MB, close to a real reference photo) instead renders a plain
  filename+size chip (e.g. "mid-test.png 1.6 MB") that sits there with *zero*
  network upload activity for many seconds, then eventually — confirmed via
  chat.qwen.ai's own analytics beacon, which reports the upload's timing
  directly — completes after **~45 seconds**, at which point it does turn
  into a real `img.vision-item-image`. The 20-second confirmation timeout
  `attachReferenceImage()` has had since it was first written was simply
  never enough for a real-sized image; every previous "failure" and the
  flaky reload-retry-eventually-works pattern the user just described is
  fully explained by this alone.
- **`content-scripts/qwen.js`**: widened `attachReferenceImage()`'s
  confirmation `waitFor()` from 20000ms to 90000ms (real observed time was
  ~45s; doubled for margin against slower connections/larger images). Added
  a qvfLog() line right after dispatch so the Log tab shows the wait is in
  progress, not silent, and updated the function's header comment and
  failure-log wording with the live network-tracing evidence above.
- **`sidepanel/sidepanel.js`**: `runQueue()`'s outer `withTimeout()` guard
  around the whole `RUN_PROMPT` call was calculated (2026-07-19) before
  reference images existed and no longer generously covers the worst case
  once a ~90s upload wait is added on top of `enableVideoMode()`'s own
  up-to-two ~60s attempts and `waitForResult()`'s 180s — widened from 6
  minutes (360000ms) to 8 minutes (480000ms), with the comment and the
  CONNECTION_LOST message text updated to match, so a legitimately slow but
  successful upload can no longer be killed by the outer timeout instead of
  the inner one.
- **Confirmed live via direct network-request tracing, not reasoned through
  blind** — the ~45s figure came from chat.qwen.ai's own
  `FileUpload-AllTime` analytics beacon (`c6` param, milliseconds) during a
  real dispatch against the user's live session, not an estimate. The
  ordering fix from the previous entry (text → image → video mode) was not
  changed, since the menu-item-availability problem it fixed didn't actually
  reproduce in this session's live re-check. Next real-world test: run a
  batch with reference images (ideally photo-sized, not tiny) and confirm in
  the Log tab that `attachReferenceImage: file dispatched, waiting for
  upload...` is followed by a success line well before the new 90s bound,
  with no more spurious PAGE_NOT_READY reload-retries for this step.

## 2026-07-20 — Reordering reference-image upload after video mode broke the upload; moved it to run after the prompt text but still before video mode

- **Request**: the user tested the previous entry's reorder live. Item 1
  failed with `"Could not find the 'Upload attachment' option in the mode
  menu."`, and the Log tab confirmed it: `enableVideoMode (1st call) done,
  videoModeOn=true` → `setPromptText done` → `attachReferenceImage starting`
  → (error, no `attachReferenceImage done`).
- **Root cause**: with "Create Video" mode already selected, opening the
  mode-select dropdown (`[aria-label="Select Mode"]`) no longer offers an
  "Upload attachment" entry at all — that option apparently only exists in
  the dropdown's no-mode-chosen state, alongside "Create Video" as a sibling
  entry (per the earlier live investigation that first confirmed the attach
  flow). The previous entry's assumption — that the upload-menu click was
  "confirmed independent of video-mode state" — turned out to only cover the
  file-dispatch step *after* the menu item was already found and clicked,
  not whether the menu item is even present once a mode is active. Moving
  `attachReferenceImage()` to run after `enableVideoMode()` broke it outright.
- **`content-scripts/qwen.js`**: reordered `runPrompt()` again —
  `setPromptText()` first (addresses the original report: image no longer
  uploads before the prompt is typed), then `attachReferenceImage()` (if
  present) while the mode-select dropdown is still in its pre-mode state,
  then `enableVideoMode()` last. Updated both the `runPrompt()` doc comment
  and the re-check-before-Send comment (which previously described a
  typing-drops-the-mode-pill risk that no longer applies now that typing
  happens before video mode is enabled, not after) to match.
- **Not independently tested live** — this exact order (text → image → video
  mode) is the only one consistent with both live results so far (the
  original order's image-before-text race, and this session's
  image-after-video-mode failure), not a fresh guess, but hasn't itself been
  run against the real site yet. Next real-world test: run a batch with
  reference images enabled and confirm in the Log tab that
  `attachReferenceImage: starting` logs after `setPromptText: done` but
  `enableVideoMode (1st call) starting` logs after `attachReferenceImage:
  done`, and that the image still attaches successfully.

## 2026-07-20 — Reordered reference-image upload to run after the prompt is typed, not before

- **Request**: the user reported the upload mechanism was firing before the
  prompt text got typed in, and even before the page had fully materialized
  — asked to sync the two steps, or upload the image only after the text.
- **Root cause**: `runPrompt()`'s call order had `attachReferenceImage()`
  first, before `enableVideoMode()`/`setPromptText()`. `attachReferenceImage()`
  does its own independent page interaction (opening the mode-select
  dropdown, clicking "Upload attachment", dispatching the file input) gated
  only by the initial 600–1500ms settle delay — no dependency on the composer
  having proven itself interactive first. That made it the very first real
  interaction with a freshly loaded page on any prompt with a reference
  image, exactly matching the report.
- **`content-scripts/qwen.js`**: reordered `runPrompt()` so
  `attachReferenceImage()` now runs after `enableVideoMode()` (1st call) and
  `setPromptText()`, right before the pre-Send pause — a pure reorder, no
  changes to any of the three functions' own logic or selectors. Safe per the
  previous entry's finding that the upload-menu click works independent of
  video-mode state, so there's no correctness reason it needed to go first.
  Updated the doc comment above `runPrompt()` to match.
- **Superseded by the entry above the same day** — this order was live-tested
  next and confirmed broken; kept here for the historical record of the
  guessing sequence, per this changelog's convention.

## 2026-07-20 — Found and fixed the real cause of the reference-image attach failure, via direct live DOM investigation

- **Request**: the previous entry's fix (confirmed file-input selector, new
  "new &lt;img&gt; appeared" detection) still failed identically in the
  user's next test — same Log tab message, no new image ever detected. The
  user offered to log into a real account so this could be investigated
  directly instead of guessing a third time, and this session used Claude in
  Chrome (the user's own real Chrome, with their existing logged-in
  chat.qwen.ai session — no credentials were entered by the assistant at any
  point) to inspect the live composer.
- **Investigated live, methodically**: opened the "+" tools menu and found
  "Create Video" and "Upload attachment" (subtext "file, image" once a mode
  is selected) are two separate, independent menu entries — not "an upload
  option that only appears once you're in video mode." Selecting "Create
  Video" first, then manually driving `#filesUpload` via the exact same
  DataTransfer/change-event technique `attachReferenceImage()` uses,
  produced a real `<img class="vision-item-image">` (56×56, `src` on
  chat.qwen.ai's own OSS CDN — a genuine network upload, not an instant
  local preview) within a few seconds. Re-running the identical dispatch
  moments later — same page, same mode, a freshly-generated unique image —
  produced **nothing**. Isolated the actual variable through repeated
  A/B tests: the very first successful attempt happened to be preceded by a
  real UI click on the "Upload attachment" menu item (before Escape-ing out
  of what turned out to be a picker that Chrome silently refused to open for
  an untrusted click); every subsequent cold dispatch — with or without
  "Create Video" mode selected — failed until that same menu-item click was
  repeated first. Confirmed this is genuinely the load-bearing step (not
  video-mode state, not file-content deduplication — tested and ruled both
  out directly) via a final clean test using only actions a content script
  can actually perform: `element.click()` (untrusted, script-triggered —
  confirmed this does **not** open a real native file-picker dialog; Chrome
  restricts that specifically to trusted user gestures, so this is safe to
  automate) and `setTimeout`-based delays, no trusted keypress involved.
- **Root cause**: chat.qwen.ai's `#filesUpload` input only actually
  registers a synthetic file selection if the real "Upload attachment" menu
  item (`li.mode-select-common-item`, same class `enableVideoMode()` already
  matches "Create Video" against) was clicked first — dispatching straight
  at a cold input, this function's approach in both previous entries, is
  silently ignored by chat.qwen.ai's React app regardless of video-mode
  state or file content.
- **`content-scripts/qwen.js`**: `attachReferenceImage()` now clicks
  `[aria-label="Select Mode"]` (the existing, already-confirmed mode-select
  trigger) to open the menu, waits, clicks the "Upload attachment" item,
  waits again, then does the same DataTransfer/change dispatch as before.
  Tightened the confirmation check from "any new `<img>` anywhere on the
  page" to `img.vision-item-image` specifically, now that the real class is
  known — more precise, less prone to a false-positive match from some
  unrelated dynamic content elsewhere on the page.
- **Confirmed live end-to-end, repeatably** — unlike every entry above it
  today, this one was validated directly against the real site through
  several independent test runs (with video mode, without it, with and
  without the trigger click, with unique vs. repeated file content) before
  being written into the extension, not reasoned through blind. Next
  real-world test through the actual extension should confirm this now
  succeeds in the queue itself, not just in an ad hoc console test.

## 2026-07-20 — Confirmed the reference-image file input live; replaced the guessed confirmation selector with a proven detection pattern

- **Request**: the user shared the Log tab / DevTools console output from the
  previous entry's diagnostic logging.
- **Good news buried in the failure**: the log line
  `attachReferenceImage: found 1 input[type="file"] on the page: [0] <input
  type="file" id="filesUpload" multiple="" style="display:none"
  aria-label="Upload files" tabindex="-1"> (parent: <div
  class="mode-select">...)` confirms the file-input guess was actually
  right — a single file input on the whole page, `aria-label="Upload
  files"`, sitting inside `.mode-select`, i.e. genuinely the composer's own
  upload control. The only thing that failed was the confirmation check
  immediately after — a guessed CSS class selector
  (`[class*="image-upload"] img, [class*="attachment"] img`) that never
  matched anything.
- **`content-scripts/qwen.js`**: `attachReferenceImage()` now targets
  `document.getElementById("filesUpload")` directly (confirmed selector,
  falling back to the diagnostic scan's first result). Replaced the guessed
  confirmation class with the same "new, not pre-existing" detection
  `waitForResult()` already uses successfully for finding a finished video
  (via its `alreadyPresent` Set) — snapshot every `<img src>` on the page
  before dispatching the synthetic `DataTransfer`/`change` event, then poll
  for any `<img>` whose `src` wasn't in that snapshot. A real, evidence-based
  improvement over guessing a fourth class name blind, though still not
  independently confirmed to work — whether the synthetic event even
  registers with chat.qwen.ai's framework at all is still open (the first
  test got past this point without an *input-not-found* error, but never
  proved the upload itself succeeded either).
- **`sidepanel/sidepanel.js`**: also added, per the user's separate request,
  a thumbnail preview in the queue list itself
  (`.item-thumb-img`, mirroring Overflow's own `#queue-list
  .item-thumbs`/`.item-thumb-img` pattern) — `renderQueue()` now shows each
  item's paired reference image (if any) directly next to its prompt text,
  so image-to-prompt pairing can be visually double-checked before a batch
  starts, independent of whatever ends up fixing the attach step itself.
- **Not independently tested live** — the file-input selector is confirmed
  from the user's own console output, but the new confirmation logic hasn't
  been. Next real-world test: run a batch with reference images enabled and
  check the Log tab for either `attachReferenceImage: confirmed via new
  image element: ...` (success — and worth sanity-checking that the logged
  `<img>` really is the uploaded file's own preview, not some coincidental
  unrelated image that loaded in the same window) or the new "no new
  &lt;img&gt; appeared" message (still failing — the next diagnostic step
  from there would be checking whether the upload registered with the
  framework at all, e.g. via the Network tab for an upload request, rather
  than guessing what kind of element the preview renders as).

## 2026-07-20 — Reference-image attach still unconfirmed; added a queue-preview thumbnail and richer diagnostics instead of guessing a third selector blind

- **Request**: the user tested the reference-images feature live (screenshot:
  6 images uploaded and numbered correctly, queue built) — item 1 failed
  with "Could not confirm the reference image was attached." (the
  `PAGE_NOT_READY:`-tagged error from `attachReferenceImage()`'s
  confirmation `waitFor()`, exhausted after 2 auto-retries). Asked for two
  things: fix the error, and let the user visually confirm image-to-prompt
  pairing in the queue before starting a batch.
- **Queue-preview thumbnail (done, no live testing needed)**:
  `sidepanel/sidepanel.js`'s `renderQueue()` now renders a small
  `.item-thumb-img` next to any queue item that has a paired
  `referenceImage` (same CSS/markup pattern as Overflow's own
  `#queue-list .item-thumbs`/`.item-thumb-img`, adapted for a single image
  per item instead of an array) — reflects the exact pairing that will
  actually be sent to the content script, since it reads `item.referenceImage`
  directly rather than recomputing anything.
- **The attach error itself is not actually fixed** — it can't be, blind.
  `attachReferenceImage()`'s file-input selector
  (`document.querySelector('input[type="file"]')`, unscoped, grabs the
  *first* file input anywhere on the page) was always flagged UNCONFIRMED;
  the live failure is the first real evidence it's wrong, but not enough to
  know *how* — chat.qwen.ai may have an unrelated file input elsewhere in
  the DOM (profile picture upload, etc.) that this blindly grabbed instead
  of a real composer image-attach control, or the composer may have no such
  control at all. Guessing a fourth selector without new information has
  low odds, per this project's own established pattern (see the many
  earlier entries where guessing without live evidence took several rounds
  to converge, or didn't).
- **`content-scripts/qwen.js`**: `attachReferenceImage()` now logs (via the
  existing `qvfLog()`/Log-tab mechanism) every `input[type="file"]` found on
  the page — up to 5, with each one's truncated `outerHTML` and its parent
  element's — before picking the first one, and logs explicitly if the
  confirmation-signal wait times out. Turns the next live test into a
  diagnostic that identifies the real control (or confirms none exists)
  directly from the Log tab, no DevTools needed.
- **Next step needs the user's help**: run a batch with reference images
  enabled again, then check the Log tab (or Copy it) for the new
  `attachReferenceImage: found N input[type="file"]...` line — that answers
  whether a real candidate exists and what it looks like. Separately, it'd
  help to know whether chat.qwen.ai's "Create Video" composer visibly offers
  *any* way to attach a starting/reference image at all (an icon near the
  "+"/mode-select area, etc.) — if it doesn't, this feature may need a
  different approach entirely, not just a selector fix.

## 2026-07-20 — Fixed the login-on-load overlay getting stuck over an actually-running queue

- **Request**: the user tested the previous entry's login-on-load feature
  live. Login itself worked and the queue auto-started (item 1 visibly at
  4%, queue list populated behind it) — but a "Not on chat.qwen.ai" /
  "CONNECTION_LOST: Could not establish connection. Receiving end does not
  exist." blocking overlay stayed stuck on top of it the whole time,
  screenshot attached. Their own read: "it started the queue process before
  the extension got a chance to detect the page."
- **Root cause, confirmed from the screenshot's exact error text**: that
  message/title combination only ever comes from `checkBlockingState()`'s
  independent 3s poll calling `showBlockingOverlay(ping.error)` on a failed
  PING. `onLoginConfirmed()`'s `loginAccount()` call has `background.js`
  navigate the tab to `https://chat.qwen.ai/auth` and back — during that
  window the content script is genuinely unreachable for a moment, a normal
  part of the flow, but `checkBlockingState()`'s poll doesn't know that and
  has no way to tell it apart from actually not being on chat.qwen.ai. If a
  poll tick's PING lands during that exact window (a real race — the login
  navigation and the 3s poll interval are entirely independent timers), it
  sets the overlay. The queue then auto-starts moments later and sets
  `running = true`, and `checkBlockingState()`'s very first line (`if
  (running) return;`) means **every future tick — including the one that
  would eventually call `hideBlockingOverlay()`** — now no-ops for the rest
  of the batch. The overlay was never wrong at the instant it was shown; it
  just had no way to ever un-show itself once the queue took over.
- **`sidepanel/sidepanel.js`**: added a module-level `accountFlowInProgress`
  flag, set for the duration of `onLoginConfirmed()`'s `loginAccount()` call
  (`try`/`finally`, so it clears on both success and failure) and checked
  alongside `running` in both `checkBlockingState()`'s and
  `checkLoginState()`'s early-return guards — stops the racing poll tick
  from ever firing during the login navigation in the first place, rather
  than trying to clean up after it. As defense in depth (covers any other
  timing edge this doesn't anticipate), `runQueue()` now also calls
  `hideBlockingOverlay()` explicitly right after its own startup PING
  succeeds — at that point connectivity has just been reconfirmed directly,
  so any overlay still showing is definitely stale.
- **Not independently re-tested live** — diagnosed with high confidence
  directly from the screenshot's exact error text and this codebase's own
  message-tagging conventions (the `CONNECTION_LOST:` prefix only originates
  from one place, `background.js`'s content-script relay), not reasoned
  through blind. Next real-world test: repeat the exact login-on-load →
  auto-start sequence and confirm the overlay never appears (or, if a poll
  tick still somehow races in, that it clears itself once the queue's own
  first PING succeeds instead of staying stuck for the batch).

## 2026-07-20 — Built three new features: login-on-load prompt, reference images, and clearing them with the queue

- **Request**: three features, planned together first (Plan mode, with a
  Plan agent doing the file-by-file design after research into both this
  repo and Overflow, this extension's sister project) then implemented in
  one pass. Three scope decisions were made with the user before writing any
  code: (1) since `accounts` is deliberately in-memory-only and resets to
  empty on every panel reload, the login-check re-runs both at panel load
  *and* every time an accounts file is (re)loaded, rather than trying to
  make it fire literally once "on first load" (which would only ever see an
  empty account list); (2) reference images are auto-numbered by **upload
  order** (001, 002, 003...), not parsed from user-supplied filenames; (3)
  whether chat.qwen.ai's "Create Video" composer even has a reference-image
  upload control at all is unconfirmed — built as a best-guess skeleton
  (same approach the rest of `content-scripts/qwen.js` was originally built
  with) rather than blocked on live access this session doesn't have.
- **Feature 1 — login-on-load prompt**:
  - **`content-scripts/qwen.js`**: added `isLoggedIn()` (best guess:
    `!!document.querySelector("button.user-menu-btn")`, inferred from
    `performLogout()`'s existing comment that this button disappears once
    logged out — **not yet confirmed live**, unlike this file's other
    selectors). PING now reports `loggedIn`.
  - **`background.js`**: extracted `switchAccountAndWait()`'s navigate →
    poll-login-form → login → poll-composer tail into a shared
    `performLoginAndWaitForComposer()`. `switchAccountAndWait()` (account
    rotation) now does `PERFORM_LOGOUT` then calls it; a new
    `loginAccountAndWait()` (logging in from scratch, nothing to log out of)
    calls it directly. New `LOGIN_ACCOUNT` message, mirroring the existing
    `SWITCH_ACCOUNT` handler shape.
  - **`sidepanel/`**: new `#confirm-overlay` modal (`.html`/`.css`) — visually
    consistent with the existing single-button `#blocking-overlay`
    (`.blocking-card`) but a distinct element with Yes/No buttons, since
    `#blocking-overlay`'s documented semantics ("automation cannot proceed
    at all") don't fit a dismissible question. `sidepanel.js` adds
    `showConfirmModal()`/`hideConfirmModal()`, `loginAccount()` (parallel to
    the existing `switchAccount()`), `checkLoginState()` (one-shot, guarded
    by a `loginCheckInFlight` flag, deliberately *not* tied to
    `checkBlockingState()`'s 3s poll — called once at panel init and again
    inside `accountFileEl`'s change handler), and `onLoginConfirmed()` (logs
    `accounts[0]` in, then auto-starts the queue via the new
    `buildQueueFromPrompts()` if the textarea already has content).
- **Feature 2 — reference images**: new `#reference-images-toggle` (same
  `.switch` pattern as Auto-download) shows/hides `#reference-images-panel`
  — a click/drag dropzone plus a thumbnail list, styled and wired directly
  on Overflow's `.character-panel`/`.dropzone`/`.character-list` CSS and
  `addCharacterFiles()`/dropzone-event pattern (visual/structural
  inspiration only — this feature pairs images to prompts by upload-order
  array index, not Overflow's filename-to-character-name text matching).
  `sidepanel.js` keeps uploaded images in a new in-memory-only
  `referenceImages` array (`{dataUrl, fileName, mimeType}`, converted via
  `FileReader.readAsDataURL` since the content script can't reach the panel's
  memory directly), never persisted — same convention as `queue`/`accounts`
  — while the toggle's on/off *state* persists via the existing
  `SETTINGS_KEY` mechanism, same as Auto-download. Numbering badges reuse
  `downloadResult()`'s existing zero-padded convention
  (`String(index+1).padStart(3,"0")`) so image "001" lines up with the same
  indexing as this batch's own result filenames. `content-scripts/qwen.js`
  gets a new `attachReferenceImage()` — a best-guess skeleton (File rebuilt
  from the data URL, driven into a guessed file-input selector via a
  synthetic `DataTransfer` + `change` event, then `waitFor()` a guessed
  "attached" confirmation signal) — called from `runPrompt(text, image)`
  before `enableVideoMode()`/`setPromptText()`, tagged `PAGE_NOT_READY:` on
  failure so the existing reload-and-retry logic in `runQueue()` applies
  with no changes needed there.
- **Feature 3 — clear images with the queue**: `resetToStartingState()`
  (already the exact function that clears the prompt textarea/queue on a
  fully successful, zero-error, zero-limit-hit batch completion) now also
  clears `referenceImages` and re-renders the list. The toggle itself stays
  on, same treatment as Auto-download's own toggle/folder fields — only the
  per-batch data clears, not the preference. The manual "Clear queue" button
  is deliberately untouched (it already doesn't clear the prompt textarea
  either), preserving that existing asymmetry rather than adding new
  behavior to it.
- **Genuinely unconfirmed, not just "not independently tested live" —
  flagged explicitly in code comments for the next real session**:
  `isLoggedIn()`'s selector; whether chat.qwen.ai's video composer has any
  reference-image control at all; that control's file-input selector, if it
  exists; whether a synthetic `DataTransfer`/`change` event is sufficient or
  whether (like Overflow's Flow target) it needs a trusted click via
  `chrome.debugger` (not added speculatively — this extension currently has
  no `"debugger"` permission or `DEBUGGER_*` handlers, unlike Overflow); the
  "image attached" confirmation signal; and whether the attach step needs to
  happen before or after `enableVideoMode()`'s first call. All of feature 2
  hinges on live testing against the real site to even confirm the feature
  is possible as designed.
- **Verified this session**: `node --check` passed on all three changed JS
  files; no duplicate element IDs introduced in `sidepanel.html`; opened
  `sidepanel.html` as a static file to visually confirm the new toggle,
  dropzone, thumbnail-list, and confirm-modal markup render correctly
  (`chrome.*` APIs aren't available outside an installed-extension context,
  so this only checks structure/CSS, not behavior). **Not tested as an
  installed extension** — this session's browser automation can't drive
  `chrome://extensions`' native "Load unpacked" file picker — and login
  credentials were never entered anywhere, by design. Next real-world test:
  load unpacked, confirm the login-on-load modal appears/behaves correctly
  with a real accounts file and a logged-out session; enable reference
  images, upload a few, and use the Log tab to see exactly where
  `attachReferenceImage()` succeeds or fails against the live composer —
  that trace is what will resolve the "genuinely unconfirmed" list above.

## 2026-07-20 — Confirmed ad-blocker detection working live; simplified the overlay message

- **Confirmed live**: the two-bait-URL fix from the previous entry works —
  with AdGuard enabled, the blocking overlay now appears as intended. First
  live confirmation of this feature after three prior attempts (side-panel
  DOM bait, then a single network bait URL, both confirmed dead ends via
  direct evidence rather than guesswork).
- **`sidepanel/sidepanel.js`**: trimmed `showAdBlockerOverlay()`'s message
  from "An ad blocker was detected. It's been correlated with
  chat.qwen.ai's composer silently breaking during testing — disable it for
  this site, then re-check." down to "An ad blocker was detected. Disable
  it for this site, then re-check." — the backstory belongs in this
  changelog, not in a UI message the user has to read every time the
  overlay shows.

## 2026-07-20 — The network-bait URL itself wasn't blocked by this AdGuard config; added a second, industry-standard bait URL

- **Request**: the user re-tested the network-bait fix. The status bar still
  showed "ready to start," no overlay — but their own DevTools console
  showed AdGuard actively blocking an unrelated Alibaba tracking request
  (`7w3ukp.tdum.alibaba.com/dss.js`, `ERR_BLOCKED_BY_CLIENT`) on the very
  same chat.qwen.ai page, proving AdGuard genuinely was active and blocking
  *something* there.
- **Root cause**: this project's specific bait URL
  (`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`) simply isn't on
  this user's AdGuard filter set, even though other trackers on the same
  page are — plausible, since that particular Google script is a common
  allowlist/compatibility exception in several filter lists. Not a wiring
  bug, and not the structural issue from two entries ago either (network
  requests from a content script are attributed to the page, unlike DOM
  visibility) — just an unlucky choice of single bait URL, and a single URL
  was always going to be fragile to exactly this kind of per-blocker
  filter-list variance.
- **`content-scripts/qwen.js`**: `refreshAdBlockerStatus()` now checks two
  independent bait URLs via `Promise.allSettled`, flagging
  `adBlockerActive` if *either* fails:
  `static.doubleclick.net/instream/ad_status.js` (the de facto industry-
  standard ad-blocker-detection resource — the same one libraries like
  just-detect-adblock use, blocked by essentially every major filter list
  specifically because publishers already rely on it for this exact
  purpose) plus the existing `pagead2.googlesyndication.com` one (blocked by
  other configurations even if not this one). One misallowlisted URL can no
  longer defeat the whole check.
- **Not independently tested live** — same tooling constraint as every
  other entry today. Next real-world test, AdGuard still enabled: confirm
  the overlay now appears. If it somehow still doesn't, the next diagnostic
  step is checking the Network tab directly for these two specific bait
  requests (filter by "ad_status" or "adsbygoogle") to see whether either
  one shows `ERR_BLOCKED_BY_CLIENT`, rather than guessing a fourth URL
  blind.

## 2026-07-20 — Ad-blocker detection still didn't trip against AdGuard; replaced the cosmetic bait with a real network-request check

- **Request**: the user re-tested with AdGuard enabled after the previous
  entry's fix (moving the bait element onto chat.qwen.ai's own page). The
  extension still never showed the blocking overlay. Rather than guess a
  third time, asked the user to check the bait element directly via
  DevTools on the chat.qwen.ai tab.
- **Live evidence**: `document.getElementById('qvf-ad-bait')` →
  `offsetHeight: 1, display: "block"` — the element was correctly placed
  and present, but AdGuard simply wasn't hiding it. This rules out a wiring
  bug: the cosmetic-hiding approach itself doesn't work against AdGuard.
  Most likely cause: modern ad blockers (AdGuard among them) have started
  deliberately leaving well-known honeypot elements (`adsbygoogle`,
  `ad-banner`, etc.) unhidden specifically to defeat sites' anti-adblock
  detection scripts — the same arms race that motivated this feature.
  Cosmetic-filter-based detection is fundamentally unreliable against a
  blocker built to resist exactly that.
- **`content-scripts/qwen.js`**: replaced the DOM bait element and
  `isAdBlockerActive()` entirely with a network-based check,
  `refreshAdBlockerStatus()` — a `fetch()` (mode: `"no-cors"`, so no CORS
  headers are needed and any successful response resolves) against the
  exact `pagead2.googlesyndication.com` ad-script URL this project observed
  being blocked (`ERR_BLOCKED_BY_CLIENT`) during the 2026-07-19
  hydration-crash investigation. A blocker can hide a honeypot `<div>`
  without consequence, but it can't skip blocking a real ad-network request
  without also just not blocking ads — a much harder signal to fake. Run
  once on content-script load and re-checked every 20s (not on every 3s
  panel PING, to avoid a network round-trip on every poll); the module-level
  `adBlockerActive` it maintains is what PING now reports, same field name
  as before so `sidepanel.js` needed no changes beyond a doc-comment update.
  Also added a `REFRESH_AD_BLOCKER` message the content script handles by
  awaiting a fresh `refreshAdBlockerStatus()` before responding — needed
  because the overlay's "Re-check now" button would otherwise only ever see
  the last 20s-old cached value via a plain PING, leaving it looking like it
  didn't work for up to 20s right after actually disabling the blocker.
  `sidepanel.js`'s `checkBlockingState()` takes a `forceAdBlockerRefresh`
  option that sends this before its PING; the button passes it, the regular
  3s idle poll doesn't.
- **Trade-off worth noting**: this sends a periodic real request to a
  Google ad-serving domain (an opaque, cookie-less `no-cors` fetch, not
  meaningfully different from a tracking pixel any ad-supported site would
  load anyway) purely to test whether it's blocked. Necessary for the
  detection to mean anything, but worth being aware of if it's ever a
  concern.
- **Not independently tested live** — same tooling constraint as every
  other entry today. Next real-world test: with AdGuard still enabled,
  confirm the overlay now appears within ~20s of opening the panel (or
  immediately if `refreshAdBlockerStatus()`'s first check already landed
  before the panel's first PING); disable AdGuard and confirm "Re-check
  now" clears it without waiting for the next interval tick.

## 2026-07-20 — Fixed an uncaught "Extension context invalidated" error from the new Log broadcast

- **Request**: before testing either of today's two new features, the user
  saw an uncaught `Error: Extension context invalidated.` in
  `chrome://extensions`'s Errors page, stack trace pointing at
  `content-scripts/qwen.js:478` — a plain object literal
  (`extractResult()`'s `{ url, mediaType: "video" }` return value) that
  cannot itself throw. Chrome's error reporting for this specific error
  class doesn't carry a real stack, so the reported location is
  circumstantial, not the actual cause.
- **Root cause**: `qvfLog()`'s new panel broadcast
  (`chrome.runtime.sendMessage(...).catch(() => {})`, added earlier today)
  only guards against the message being *rejected* — a missing panel
  listener. It does not guard against the call itself *throwing
  synchronously*, which is exactly what `chrome.runtime.sendMessage()` does
  when called from a content-script instance left over from before the
  extension was reloaded (a normal dev-workflow situation: an already-open
  chat.qwen.ai tab whose content script never got a fresh page load after
  the reload). A `.catch()` never gets attached in that case, because the
  exception propagates before `sendMessage()` ever returns a promise.
- **`content-scripts/qwen.js`**: wrapped `qvfLog()`'s broadcast in a
  try/catch around the whole call, not just a promise `.catch()`, silently
  swallowing both failure modes the same way (missing listener, or a fully
  invalidated context).
- **Not independently tested live** — same tooling constraint as the rest
  of today's entries. Next real-world test: reload the extension, then
  either refresh the chat.qwen.ai tab or open a fresh one before starting a
  batch (the stale-tab scenario itself isn't “fixed” — it can't be, from
  inside a dead context — this just stops it from surfacing as a crash).

## 2026-07-20 — Fixed ad-blocker detection never tripping: the bait element was in the wrong page

- **Request**: the user tested the previous entry's two new features. The
  Log tab worked. Ad-blocker detection did not: with AdGuard installed and
  enabled, the panel never showed the blocking overlay.
- **Root cause**: the bait element (`#ad-bait`) lived in the side panel's
  own `chrome-extension://` page, not on chat.qwen.ai. Chrome does not let
  one extension's content scripts run inside another extension's UI
  surfaces — an ad blocker's cosmetic-filtering content script has no way
  to ever see, let alone hide, an element sitting in this extension's own
  side panel. The detection was checking a page no real ad blocker could
  reach, so it could never trip, regardless of which blocker or how it was
  configured. (The correlated evidence that motivated this feature in the
  first place — blocked `pagead2.googlesyndication.com` requests — was
  always observed on chat.qwen.ai's own page, which in hindsight was
  already the tell that detection belonged there too.)
- **`content-scripts/qwen.js`**: moved the bait element and
  `isAdBlockerActive()` here, created once at content-script injection time
  (so it has the page's full lifetime to be caught by cosmetic filters
  before it's ever read) and appended to chat.qwen.ai's own DOM. The PING
  handler's response now includes `adBlockerActive`, alongside the existing
  `composerReady`/`toolbarReady`/`loginFormReady`/`dailyLimitReached`
  fields.
- **`sidepanel/sidepanel.js`**: removed the non-functional local bait
  element/check entirely. `checkBlockingState()` now reads
  `ping.adBlockerActive` from the PING response instead — which also
  simplified the control flow, since it no longer needs to guess whether to
  check the ad blocker before or independent of tab presence; one PING call
  now answers both questions together.
- **`sidepanel/sidepanel.html`/`sidepanel.css`**: removed the dead
  `#ad-bait` element and its styling.
- **Not independently tested live** — same tooling constraint noted in the
  previous entry. Next real-world test (with AdGuard still enabled) should
  confirm the blocking overlay now appears within one poll tick.

## 2026-07-20 — Built the two features planned yesterday: an in-panel Log tab, and a hard ad-blocker block

- **Request**: implement the two features recorded as planning notes in the
  previous entry, without building either yet. Before implementing, three
  scope questions were clarified: the Log tab carries only the content
  script's `qvfLog()` output (not panel/background events too); ad-blocker
  detection uses a cosmetic bait element, not a network bait request; and
  the block is an idle-time gate only — it stops a new batch from starting
  but never interrupts one already running.
- **Log tab** (`content-scripts/qwen.js`, `sidepanel/sidepanel.{html,js,css}`):
  `qvfLog()` now broadcasts each step to the panel via
  `chrome.runtime.sendMessage({ target: "panel", type: "QVF_LOG", ... })`,
  the same broadcast-and-swallow-if-no-listener pattern `background.js`
  already uses for `QWEN_FOCUS_CHANGED` — no `background.js` relay changes
  needed, since panel-targeted messages were already documented as
  broadcast-as-is. The side panel's tab-switch handler (previously a
  hardcoded controls/about boolean) is now a generic map over
  `{ controls, about, log }`, so adding the third tab didn't need new
  branching logic. Log entries are kept in memory only (same convention as
  the prompt queue and accounts list — never `chrome.storage`), capped at
  500 entries, with Copy (clipboard) and Clear buttons.
- **Ad-blocker hard block** (`sidepanel/sidepanel.{html,js,css}`): added a
  hidden bait element (`#ad-bait`, classic ad-related class names like
  `ad-banner`/`adsbygoogle`) sitting in the side panel's own DOM — ad
  blockers apply their element-hiding filter lists to any page they run on,
  including extension pages, so no network request or extra permission is
  needed. `isAdBlockerActive()` checks whether a filter list collapsed its
  explicit 1px height. `showBlockingOverlay()` (previously hardcoded to the
  "not on chat.qwen.ai" text) now takes an optional title/action-label/
  action-handler, reused for the new "Ad blocker detected" case with a
  "Re-check now" button instead of a "Navigate to chat.qwen.ai" one. The
  old `checkQwenTab()` poll is now `checkBlockingState()`: same `if
  (running) return;` idle-only guard, but checks the ad blocker first and
  short-circuits before the chat.qwen.ai PING check if one's detected.
- **Not independently tested live** — same tooling constraint as most of
  this changelog's history: this session's browser automation can't load
  an unpacked MV3 extension (`chrome://extensions` is blocked from
  automation). Verified statically (`node --check` on both changed JS
  files, manual re-read of the HTML/CSS for tag/selector consistency).
  Next real-world test should confirm: the Log tab streams `qvfLog()` steps
  live during a running queue and Copy/Clear both work; and that enabling
  a real ad blocker (e.g. uBlock Origin) shows the new overlay within one
  3s poll tick, "Re-check now" clears it immediately once disabled, and an
  already-running queue is untouched if a blocker gets enabled mid-batch.

## 2026-07-19 — Planned (not yet implemented): an in-panel Log tab, and blocking use while an ad blocker is active

- **Request**: the user confirmed today's rate-limit fix (previous entry)
  works. Asked to record two features to plan and implement tomorrow,
  without building either today.
- **Feature 1 — a "Log" tab** in the side panel (alongside the existing
  Controls/About tabs), showing the same kind of step-by-step activity
  currently only visible via DevTools' console on the chat.qwen.ai tab (the
  `qvfLog()` calls added in `content-scripts/qwen.js` earlier today). Goal:
  make troubleshooting/bug reports easier for users who don't have DevTools
  open — today's whole diagnosis only became possible once the user
  happened to have the console open at the right moment. Will need a way to
  get that output from the content script's page-context console up to the
  side panel UI — likely by extending the existing content-script →
  `background.js` → panel broadcast pattern (`background.js` already relays
  `target: "panel"` messages, used today by `QWEN_FOCUS_CHANGED`) rather than
  inventing a new channel.
- **Feature 2 — ad-blocker detection**, blocking use until it's disabled. If
  an ad-blocking extension is detected active, show the same full-panel
  blocking overlay already used for "not on chat.qwen.ai"
  (`showBlockingOverlay()` in `sidepanel.js`), telling the user to disable it
  before continuing — not just a warning, a hard block on using the
  extension at all. Motivated directly by today's earlier investigation: the
  uncaught React hydration crash (error #418) from the user's live-testing
  session was correlated with blocked `pagead2.googlesyndication.com`
  ad-tracker requests — i.e. an ad blocker interfering with chat.qwen.ai's
  own script execution in a way that can break the composer. (Today's actual
  reproduced bug turned out to be a separate rate-limit issue, not this —
  but the correlation from the earlier live-testing session is real and
  still worth guarding against.) Will need an actual detection mechanism —
  likely a bait network request to a known ad-related URL pattern that a
  blocker intercepts (a standard client-side ad-blocker-detection
  technique) — checked alongside the existing composerReady/toolbarReady
  gate.
- **Not implemented** — both are planning notes for tomorrow's session, no
  code changed for either yet.

## 2026-07-19 — Found and fixed the actual root cause: chat.qwen.ai's own rate limiter, invisible to every check that existed before today's console-log diagnostics

- **Request**: the user ran the diagnostics from the previous entry (DevTools
  console open on the chat.qwen.ai tab before Start Queue) and shared a
  screenshot. This closes out the guessing loop the last three entries were
  in.
- **The console output was decisive**: `enableVideoMode` (1st call) completed
  in under a second with `videoModeOn=true`; `setPromptText` completed
  cleanly (~11s for a 306-character prompt, matching the new per-character
  typing pace); the submit button was found and Send was clicked right on
  schedule. Everything the extension does was working correctly. The visible
  page content told the rest of the story: a red banner reading "Oops! There
  was an issue connecting to Qwen3.7-Plus. Too many requests in a short
  period." — chat.qwen.ai's own rate limiter, a completely different message
  from the "daily usage limit" text `findDailyLimitMessage()` has ever
  checked for. Nothing in `runPrompt()` or `waitForResult()` recognized this
  message at all, so after a rate-limited submission (which, correctly,
  never produces a video, since the request was rejected before generation
  ever started), `waitForResult()` just sat there blind for its full 180s
  timeout, watching for something that could never appear — exactly what
  "stuck on Generating, no error, no status update" turned out to be. None
  of the previous three entries' theories (React hydration crash, dead
  message port, stale DOM references) were the cause of *this*
  reproduction; the earlier evidence (the #418 console error, the blocked ad
  requests) may be a real, separate issue, or may itself have been a
  downstream symptom of the same rapid repeated testing that trips this rate
  limiter — not resolved either way, but no longer needs to be, since this
  reproduction is now fully explained end to end.
- **`content-scripts/qwen.js`**:
  - Added `findRateLimitMessage()` and `countRateLimitOccurrences()`. The
    count-based approach (not a simple presence check like
    `findDailyLimitMessage()`) is deliberate: this error bubble stays visible
    in the chat transcript afterward, so a plain whole-page text scan would
    keep matching that same old bubble on every later prompt forever, even
    once the rate-limit window has actually passed. `waitForResult()`
    snapshots the count when generation starts and only treats a *rise* in
    the count as a genuinely new hit — the same "new, not pre-existing"
    principle already used for detecting a finished video via the
    `alreadyPresent` src `Set`.
  - `waitForResult()` now also resolves (quickly, not after the full 180s)
    when a new rate-limit occurrence appears, with `{ rateLimited: true,
    message }`. Added `qvfLog()` calls at each of its three resolution paths
    (daily-limit, rate-limit, video found) and its timeout, so the console
    log always shows which one actually happened, not just that
    `waitForResult()` was entered.
- **`sidepanel/sidepanel.js`**: `runQueue()` now branches on
  `result.rateLimited` the same way it already does for
  `dailyLimitReached`, but without account rotation (same account, no reason
  to switch) — instead it waits out a new `rateLimitCooldown()`: an
  escalating, visibly-counting-down pause (45s, 75s, 105s, ... capped at 4
  minutes) before retrying the *same* item in place. Bounded to 5 attempts
  per item, tracked via a new `queue[i].rateLimitRetries` counter; if still
  rate-limited after that, the whole queue stops (not just that one item) —
  since a real rate limit is shared across the account/IP, every remaining
  item would almost certainly hit the same wall immediately, so continuing
  to hammer the server item-by-item would likely make it worse, not better.
- **Confirmed live, unlike every fix in the previous three entries** — this
  one was diagnosed directly from the user's own real reproduction and
  console output, not reasoned through blind. The fix logic itself (the new
  branch in `runQueue()`, the cooldown, the count-based detection) wasn't
  independently re-run against a live rate-limited response after being
  written, so the next real-world test is still what confirms it end-to-end
  — but the diagnosis this time is solid, not a guess.

## 2026-07-19 — Added a hard timeout safety net for RUN_PROMPT and step-by-step console logging, after a screen recording showed a hang that no existing error tag caught

- **Request**: the user recorded a screen video (couldn't be played back in
  this session — no ffmpeg/VLC/similar installed, and installing one wasn't
  pursued given the user could just describe it) of a test: click Start → the
  expected initial reload happens → the extension's actions visibly "flicker"
  → the page resets to the plain landing UI → the item sits on "Generating"
  indefinitely. Follow-up questions confirmed two things that rule out both
  of the two previous entries' fixes as the explanation: the status line
  never showed the "reloading and retrying" text from the PAGE_NOT_READY
  auto-retry path, and the flicker/reset happened only once, not repeatedly
  (a retry loop would show it up to 2 more times).
- **Reasoned through why every existing tagged path should have caught this,
  and none did**: every `waitFor()` in `enableVideoMode()` is bounded to 20s,
  the typing loop in `setPromptText()` is bounded by the prompt's own length,
  and a dead message port during RUN_PROMPT was already supposed to surface
  as `CONNECTION_LOST:` via `chrome.runtime.lastError` in background.js's
  relay. Since none of that fired, the most plausible remaining explanation
  is that chat.qwen.ai's own crash-recovery does a real
  `window.location.reload()` (not just a same-page React remount) at a point
  where Chrome's extension messaging doesn't reliably invoke the pending
  `sendMessage` callback with `lastError` — a real gap, but not one worth
  chasing further blind (this repo has hit that dead end before — see the
  2026-07-19 entry about surfacing per-item error text after two blind
  guesses didn't converge).
- **Decided not to keep guessing the exact cause, and instead made two
  changes that don't depend on identifying it correctly**:
  - **`sidepanel/sidepanel.js`**: added `withTimeout()`, and wrapped the
    `RUN_PROMPT` call in `runQueue()` with a 360000ms (6 minute) bound —
    generous enough to cover the legitimate worst case (settle delay +
    `enableVideoMode()`'s up-to-two ~60s attempts + typing +
    `waitForResult()`'s own 180s ≈ 5.4 minutes) without false-triggering on a
    real, still-in-progress generation. If nothing else ever calls back, this
    resolves to the same `CONNECTION_LOST:`-tagged shape the existing
    (working) pause-and-explain path already handles — so regardless of
    what's actually causing the hang, the queue can no longer sit frozen
    forever with zero feedback; worst case, it pauses after 6 minutes with a
    clear explanation instead.
  - **`content-scripts/qwen.js`**: added `qvfLog()`, a timestamped
    `console.log` helper, called at every major step of `runPrompt()` (start,
    daily-limit pre-check, each `enableVideoMode()` attempt, `setPromptText()`
    start/done with the live textarea's resulting value length, Send click).
    Also added page-level `beforeunload`/`pagehide`/`error`/
    `unhandledrejection` listeners — specifically to answer, with certainty
    next time, the open question above: does a real navigation happen
    (`beforeunload`/`pagehide` fire) or does the page only visually reset with
    no navigation at all (a same-page React remount, a different kind of bug
    with a different fix)? Purely diagnostic, no behavior change. Documented
    the intent directly in the code: open DevTools on the chat.qwen.ai tab
    before the next Start Queue click, and the console (filterable by
    `[QVF`) should show exactly which step it was on, in what order, at what
    timestamps, when the hang happened.
- **Not independently reproduced live** — same tooling constraint as the
  previous two entries. Next real-world test should either resolve
  cleanly, or — if it hangs again — pause after at most 6 minutes with a
  clear message instead of sitting frozen indefinitely, and the DevTools
  console from that run should make the exact failing step and whether a
  real navigation occurred unambiguous, closing the guessing loop these last
  three entries have been in.

## 2026-07-19 — Broadened PAGE_NOT_READY tagging past the mode-select trigger; added human-paced typing/delays; made the exhaustion summary self-diagnostic

- **Request**: the user tested the previous entry's fix. With their ad
  blocker off, the first run worked, but a second run (ad blocker still off)
  hit the same "nothing gets set, no error, stuck on Generating" symptom
  again — meaning it isn't only caused by the ad-blocker-correlated hydration
  crash from the previous entry, since that variable was controlled for this
  time. They also hit "Limit reached" on the very first (unlisted, currently
  logged-in) account and couldn't tell from the message whether that was
  genuine quota exhaustion or a rotation failure. They also still believe
  manual refresh is problematic, and asked to slow the whole interaction down
  to look more like a real human user.
- **Root cause of the recurring silent failure**: the previous entry's
  `PAGE_NOT_READY` tagging only covered `enableVideoMode()`'s *first* failure
  point (the mode-select trigger never mounting). But the user's second run
  showed the prompt text, the video-mode tag, *and* the send action all
  failing to register — meaning the trigger was likely found and clicked, but
  a later step (the dropdown item, or the confirmation pill) silently didn't
  register, which threw a plain, untagged error instead — not
  auto-retried, and reached only after further ~20s waits, so it kept
  presenting as a long, silent "Generating" hang before anything visible
  happened.
- **`content-scripts/qwen.js`**:
  - All three of `enableVideoMode()`'s failure points (trigger not found,
    "Create Video" item not found, confirmation pill not appearing) are now
    tagged `"PAGE_NOT_READY:"`, not just the first — the underlying signal
    (nothing was ever submitted, so a reload-and-retry is safe) is the same
    for all three, and real testing showed the failure isn't confined to the
    trigger step. Same tag added to the two remaining pre-Send throws in
    `runPrompt()` (`findPromptInput()` and `findGenerateButton()` both
    returning nothing) for the same reason. Deliberately did **not** tag
    anything after `button.click()` (`waitForResult()`'s own timeout) — a
    submission was actually attempted there, so blindly retrying risks a
    double-submit; that boundary ("was Send actually clicked?") is what
    decides safe-to-auto-retry vs. not.
  - `setPromptText()` now types character-by-character (native-setter call +
    a fresh `'input'` event per character, ~15–35ms apart) instead of setting
    the whole string in one call — both to look less like a single
    all-at-once scripted action, and because per-keystroke events are a more
    typical input pattern for a framework's controlled-input state to react
    to than one big value swap.
  - Added a 600–1500ms settle delay in `runPrompt()` before the first
    interaction on a page load (on top of the existing
    composerReady+toolbarReady gate), a 250–650ms pause in `enableVideoMode()`
    between opening the mode dropdown and clicking an item in it, and widened
    the existing pre-Send pause from 400–1300ms to 600–1800ms — all aimed at
    not clicking/typing the instant something becomes possible, per the
    user's request to slow the whole flow toward human pacing.
- **`sidepanel/sidepanel.js`**: `buildExhaustionSummary()` (the text that
  ends up as the persistent per-item error line when every account is used
  up) now includes the same per-status breakdown `updateAccountStatusUI()`
  already showed separately (factored out into a shared
  `accountStatusBreakdown()` helper) — e.g. "(1 exhausted, 1 failed, 1
  unused)" — directly in the message, so a nonzero "failed" count (a rotation
  attempt that didn't work) is visible without the user having to separately
  check the account-status line above the queue. This doesn't change the
  actual rotation logic — whether the first account's "Limit reached" this
  time was genuine same-day exhaustion (very plausible after this much
  testing on the same real account today) or an actual switch failure wasn't
  independently diagnosed; the breakdown text is what should answer that on
  the next occurrence.
- **Not independently reproduced live** — same tooling constraint as the
  previous entry (no installed-extension context available to this session's
  browser automation). The typing-simulation and broadened-tagging changes
  are reasoned through from the exact mechanics involved, not observed
  firsthand. Next real-world test should confirm: the second-run-only-style
  failure (mode tag/prompt/send all silently not registering) now surfaces
  as a fast, auto-retried `PAGE_NOT_READY` instead of a long silent hang: and
  that the next "Limit reached" stop shows a clear breakdown distinguishing
  genuine exhaustion from a failed switch attempt.

## 2026-07-19 — Fixed the first-prompt-stuck-on-fresh-session bug and the queue racing ahead after a manual refresh, by treating both as one root cause

- **Request**: the user reported three linked symptoms from real testing: (1)
  the first prompt of a batch still tends to fail when chat.qwen.ai starts on
  a brand-new session — Start Queue reloads the tab, nothing gets typed, no
  error appears, but the item sits at "Generating…" forever, until a few
  manual page refreshes eventually get it working; (2) once it does start
  working after those refreshes, the queue stops waiting for the
  currently-generating video and fires the next prompt while the previous one
  is still running; (3) manually refreshing chat.qwen.ai while the queue is
  running seems to cause more problems than it solves. Asked to investigate
  using Claude-in-Chrome rather than guessing.
- **Investigated live** (Claude-in-Chrome, unauthenticated — no accounts file
  was provided, so login/generation itself wasn't re-tested): repeated fresh
  loads of chat.qwen.ai consistently mounted the composer *and* the
  mode-select toolbar within about a second, with no hydration errors and no
  `googlesyndication.com` ad-tracker requests at all in this environment —
  unlike the user's own devtools screenshot, which showed an uncaught
  "Minified React error #418" (a React hydration-mismatch crash) in
  `react-dom-vendor.js`, occurring alongside several blocked
  `pagead2.googlesyndication.com` requests (`ERR_BLOCKED_BY_CLIENT`, i.e. the
  user's own ad/tracker blocking) and an "[APLUS] -- APLUS INIT SUCCESS" log
  line from an Alibaba tracking script. This strongly points to third-party ad
  scripts racing chat.qwen.ai's own React hydration on the user's machine, not
  reproducible here without that same blocking setup in front of the same ad
  scripts — the *crash* itself is not something this extension can fix (it's
  chat.qwen.ai's own page, interacting with the user's browser
  configuration), so the fix instead makes the extension resilient to it.
- **Root cause, tying all three symptoms together**: `composerReady` (checked
  by `reloadTabAndWait()` in `background.js` before the queue's first
  `RUN_PROMPT`) only ever confirmed the `<textarea>` element exists — not that
  the page around it had actually finished mounting/hydrating. A React
  hydration crash can leave that textarea sitting inertly in the DOM
  (satisfying `composerReady`) while the rest of the composer toolbar
  (`enableVideoMode()`'s mode-select trigger) never mounts, so dispatching
  input events at it does nothing and nothing throws — `enableVideoMode()`'s
  own 20s+20s+20s waits (widened in an earlier entry) just poll a dead page
  for up to a minute-plus before finally erroring, reading as "stuck on
  Generating" the whole time. The user's own reasonable response — manually
  reloading the tab — is what actually caused symptom 2: it severs the
  in-flight `RUN_PROMPT`'s message port mid-request, which
  `background.js`'s content relay already caught, but only ever surfaced as a
  generic per-prompt error, which `runQueue()` then silently advanced past
  (`i++`) exactly like any other failed prompt — racing ahead to the next
  item while the previous one's generation (real or orphaned) was still
  unresolved, with no way to know which. Symptom 3 (refreshing causes more
  problems) is just this same mechanism from the user's side: there was no
  code path that treated "the tab just got yanked out from under an in-flight
  request" as meaningfully different from "the content script reported a real
  failure."
- **`content-scripts/qwen.js`**:
  - PING's response now also reports `toolbarReady` (whether
    `[aria-label="Select Mode"]` exists), alongside the existing
    `composerReady`.
  - `enableVideoMode()`'s first wait (for the mode-select trigger) now throws
    with a `"PAGE_NOT_READY: "` prefix specifically when the trigger never
    appears at all — the strongest available signal that the page hit a
    hydration crash rather than just being slow, since nothing else in that
    function distinguishes "toolbar never mounted" from "menu item took a
    moment to render."
- **`background.js`**:
  - `reloadTabAndWait()`'s post-reload poll now requires `toolbarReady` in
    addition to `composerReady` before letting the queue proceed — closes the
    gap where the first `RUN_PROMPT` of a batch could fire at a page that
    merely *looks* ready.
  - The `target: "content"` relay now tags a dead message port during a
    `RUN_PROMPT` with a `"CONNECTION_LOST: "` prefix — reasoned through why
    this specific relay can only ever see that from something external
    navigating the tab (this extension's own code never touches the tab URL
    while a `RUN_PROMPT` is in flight), so it's always attributable to a
    manual refresh/navigation, never a false positive from this extension's
    own automation.
  - **`sidepanel/sidepanel.js`**'s `runQueue()`: `CONNECTION_LOST` results now
    pause the queue (without advancing `i`) and show a message explaining
    what happened and telling the user to check the tab before resuming,
    instead of being marked a normal error and silently continued past.
    `PAGE_NOT_READY` results now trigger an automatic reload-and-retry of the
    same item (bounded to 2 attempts via a new per-item
    `pageNotReadyRetries` counter, since nothing was ever actually submitted
    in this failure mode) instead of surfacing as an error immediately — this
    replaces the user's own manual-refresh workaround with the extension
    doing the same recovery safely, at a point where there's no in-flight
    generation to worry about, rather than requiring it to happen while a
    `RUN_PROMPT` might already be running (which is exactly what caused
    symptom 2/3 above).
- **Not independently reproduced live**: the actual React #418 hydration
  crash itself (couldn't reproduce chat.qwen.ai's page under the same
  ad/tracker-blocking conditions as the user's real browser — see above), and
  the two new retry/pause code paths weren't exercised against a real
  extension load (this session's Claude-in-Chrome instance doesn't have the
  unpacked extension installed, and `chrome://extensions` is blocked from
  automation, same constraint noted in several earlier entries). Reasoned
  through from the exact mechanics of the message-passing chain instead,
  which is fully traceable statically. Next real-world test should confirm:
  a fresh-session batch either starts cleanly, or self-recovers via one or
  two automatic reload-and-retry cycles without the user needing to touch
  chat.qwen.ai at all; and that manually refreshing mid-generation now pauses
  the queue with a clear explanation instead of silently racing ahead.

## 2026-07-19 — Fixed the in-use account never getting relabeled "exhausted" once rotation genuinely runs out of accounts

- **Request**: the user reported account switching "not working" — after the
  previous fix, the unlisted starting account rotated successfully to the
  first list account, generation continued, but when that account hit its
  own limit, the switch "failed" with `accountStatusEl` showing "current:
  angry.fly8655@maildrop.cc (1 exhausted, 1 active)."
- **Traced through and found this was not actually a failed switch**: the
  breakdown is consistent with a *third* rotation attempt — unlisted → list
  account 1 (marked exhausted once its limit hit) → list account 2
  (angry.fly8655, switched to successfully) → angry.fly8655 then also hit
  its own real daily limit on the retry, and with only 2 accounts loaded,
  there was nothing left to rotate to. The queue correctly stopped; it just
  looked like a broken switch because of a real, separate labeling bug.
- **The actual bug**: `tryRotateToNextAccount()` only set
  `activeAccount.status = "exhausted"` *after* confirming a next account
  existed to rotate to. When there wasn't one — the exact case here — that
  line never ran, so the account that had genuinely just hit its limit
  stayed labeled `"active"` forever, reading as "switch silently failed"
  rather than "correctly ran out of loaded accounts."
- **`sidepanel/sidepanel.js`'s `tryRotateToNextAccount()`**: moved the
  exhausted-marking to run unconditionally at the top of the function,
  before checking whether a next account exists — it only ever gets called
  because the current account just hit its limit, so that's true either way.
  Purely a labeling fix; which account gets found as `next` was already
  unaffected by this ordering (the search only ever looked for `"unused"`
  accounts, which `"active"` and `"exhausted"` both correctly exclude).
- **Not a bug with only 2 accounts loaded and 3 accounts (1 unlisted + 2
  listed) having now hit real daily limits in one test run**: that's
  genuinely out of rotation options, not a defect. If more resilience is
  needed, that means loading more accounts into the file, not further code
  changes.

## 2026-07-19 — Fixed accounts[0] being wrongly assumed to be the already-logged-in account

- **Request**: the user clarified the previous entry's scenario further —
  neither of the 2 loaded accounts had actually hit a real daily limit; the
  account logged into the chat.qwen.ai tab during testing isn't in the
  accounts file at all. Once that (unlisted) account's limit was hit,
  rotation should have gone to the first account in the list.
- **Root cause**: `accountFileEl`'s `change` handler set
  `activeAccount = accounts[0]` and marked it `"active"` immediately on file
  load — assuming the first entry in the file is whatever's already logged
  into the browser. The extension never actually checks who's really logged
  in. So when the real (unlisted) account's limit hit,
  `tryRotateToNextAccount()` found `accounts[0]` already marked
  `"active"`/`"exhausted"` and rotated straight to `accounts[1]`, silently
  skipping the first list account, which had never actually been used.
- **`sidepanel/sidepanel.js`**: the file-load handler now leaves
  `activeAccount = null` and every loaded account `"unused"` — no assumption
  about which account (if any) is currently logged in. `tryRotateToNextAccount()`
  already null-checks `activeAccount` before marking anything exhausted
  (`if (activeAccount) activeAccount.status = "exhausted";`), so this was the
  only change needed: the first daily-limit hit now correctly rotates to
  `accounts[0]` instead of skipping it.

## 2026-07-19 — Made account-rotation failures diagnosable; fixed switchAttempts persisting across queue runs instead of resetting per-run

- **Request**: with the first prompt now succeeding after the reload/hydration
  fixes, the user hit a daily-limit response on their first item of a fresh
  batch, and the queue went straight to "Limit reached" with no visible
  logout/login activity at all — not "the switch failed," but the switch was
  never attempted in the first place. The user's expected flow (pause the
  queue → log out → log in as the next account → resume from where it
  stopped) is exactly what `tryRotateToNextAccount()` + the queue's
  `continue`-without-advancing-`i` logic already implements; the question was
  why it didn't fire this time.
- **`tryRotateToNextAccount()` only rotates while some account still has
  `status === "unused"`.** The user had confirmed the switch mechanism
  itself worked earlier in this same panel session — meaning that earlier
  success had already consumed the account it switched to. If that account
  (now "current") has also hit its real daily limit, there is genuinely no
  third account to rotate to, and stopping immediately, without any visible
  logout, is actually correct — just easy to mistake for a bug when the only
  feedback was a status-bar message overwritten within 3 seconds by the
  periodic `checkQwenTab()` poll.
- **Found a second, independent, and definitely-real bug while reading the
  code for this**: `switchAttempts` (bounding total rotation attempts to
  `accounts.length`, per `tryRotateToNextAccount()`'s own comment — "at most
  one attempt per queue run") was only ever reset when the accounts file is
  re-uploaded, never when a fresh queue run starts. Across many Start/Stop
  cycles in one panel session (today's exact testing pattern), that counter
  keeps accumulating, capable of silently blocking a rotation to a genuinely
  `"unused"` account just because an earlier, unrelated run had already used
  up the lifetime budget — a real cause of "rotation didn't fire," separate
  from the accounts simply being out of quota.
- **`sidepanel/sidepanel.js`**:
  - `runQueue()` now resets `switchAttempts = 0` at the start of every run,
    matching the "per queue run" intent already stated in the comment.
    Per-account statuses (exhausted/failed/active/unused) are untouched by
    this, so a rotation still correctly refuses once every account is
    genuinely used up — only the artificial attempt-budget staleness is
    fixed.
  - `updateAccountStatusUI()` now shows a full per-status breakdown (e.g.
    "current: X (1 exhausted, 1 active)"), not just which account is
    current, called at every point an account's status actually changes
    (including the give-up path) — makes "genuinely out of accounts" versus
    "a switch attempt itself failed" (a `"failed"` entry would show up in
    the breakdown) distinguishable without guessing.
  - The exhaustion summary (`switched.finalMessage`) is now also stored on
    the queue item (`queue[i].error`) and rendered in the same persistent
    per-item error line added in the previous entry — broadened to show for
    `"limit"` status too, not just `"error"`.
- Next real-world test should show, if the limit is hit again: either a
  visible logout → login → retry sequence (if an account was actually still
  available and the stale-counter bug was the cause), or a clear "all
  accounts exhausted" breakdown confirming both loaded accounts have
  genuinely hit their real daily limit today, rather than an unexplained
  silent stop either way.

## 2026-07-19 — Widened the two remaining enableVideoMode() waits, using the now-persistent error text to actually pin down the failure

- **Request**: with the previous entry's per-item error text now visible,
  the user's screenshot showed item 1 failing with "Selected 'Create Video'
  but video mode did not turn on." — a different, more specific failure than
  any earlier guess.
- **This confirmed exactly where it broke**: the mode-select trigger wait
  (widened to 20000ms two entries ago) succeeded — the trigger was found. The
  "Create Video" menu-item wait (still 3000ms) also succeeded — the item was
  found and clicked. Only the final confirmation wait — `waitFor(isVideoModeOn,
  3000, 150)`, checking that the mode pill actually rendered after the click —
  timed out. Two of `enableVideoMode()`'s three waits were still on their
  original tight budgets; only the first had been widened for post-reload
  slowness, even though the same slowness plainly affects the whole function,
  not just the first step.
- **`content-scripts/qwen.js`'s `enableVideoMode()`**: widened the menu-item
  wait and the final confirmation wait from 3000ms/150ms to 20000ms/200ms
  each, matching the trigger wait instead of leaving them tighter.
- Next real-world test should confirm item 1 finally succeeds outright. If
  it still doesn't, the per-item error text (previous entry) will say
  exactly which of these three steps is still too tight, rather than another
  blind guess.

## 2026-07-19 — Surfaced per-item error text in the queue list, since guessing at the reload/hydration race blind wasn't converging

- **Request**: after widening `enableVideoMode()`'s trigger wait to 20s, the
  user reported item 1 of a fresh batch was *still* failing right after the
  start-of-batch reload, with a clean devtools console. Two guesses at this
  exact failure (the mode-drop re-check, then the wait-time widening) hadn't
  fully fixed it, and the actual error text was never captured — it only
  ever exists in the status bar's transient text, which gets overwritten by
  the next queue event (the inter-prompt countdown, etc.) within seconds, so
  both prior screenshot attempts caught it after that text was already gone.
- **Decided to stop guessing further blind** and make the real error message
  discoverable instead, so the next test actually pins down the cause rather
  than producing a fourth speculative fix.
- **`sidepanel/sidepanel.js`**: `runQueue()` now stores `result.error` on the
  queue item (`queue[i].error`) alongside its `"error"` status, not just in
  the transient status bar. `renderQueue()` renders it as a persistent
  second line under any item marked "error" — visible in a plain screenshot
  of the queue list itself, no precise timing or hover needed.
- **`sidepanel/sidepanel.html`/`sidepanel.css`**: restructured each queue
  `<li>` from a single flex row into a column — the existing dot/text/badge
  row (now `.item-row`) plus the new conditional `.item-error` line below it
  (small, `--error`-colored, wraps instead of truncating).

## 2026-07-19 — Widened the post-reload hydration wait; merged daily-limit detection into the result wait instead of a fixed 5s window

- **Request**: the user re-tested the previous two fixes. Two new issues
  surfaced: (1) item 1 of a fresh batch still failed right after the
  start-of-batch reload — the previous fix's 5s wait for the mode-select
  trigger to mount wasn't long enough; item 2 worked because enough time
  (its own failed-item-1 attempt plus the 8–20s inter-prompt delay) had
  passed by the time it ran. (2) When an account was already at its daily
  limit right at the start of a batch, the queue stalled for the full
  `waitForResult()` timeout before switching accounts, instead of noticing
  the limit quickly — account rotation itself was confirmed working once it
  finally kicked in.
- **Fix 1 — `enableVideoMode()`'s trigger wait**: widened from 5000ms/150ms
  to 20000ms/200ms. Same underlying gap as the earlier fix (a hard reload
  reboots the whole SPA from scratch and the composer toolbar can take
  longer to mount than the textarea alone), just needed more margin than
  first assumed.
- **Fix 2 — found the real cause of the stall**: `runPrompt()` only checked
  for the daily-limit message in a separate, fixed 5-second poll
  (`waitFor(findDailyLimitMessage, 5000, 500)`) immediately after clicking
  Send. If Qwen's own "you've hit your limit" response took longer than 5s
  to actually render (server/UI latency), that check missed it, and
  execution fell straight into `waitForResult()`'s full 180-second blind
  wait for a video that was never coming, since generation had never
  actually started.
- **`content-scripts/qwen.js`**: merged the two checks. `waitForResult()`
  now watches for *either* a finished video *or* the daily-limit message on
  the same `MutationObserver`, resolving with whichever appears first, for
  the whole timeout window — not just a short slice of it right at the
  start. `runPrompt()` no longer does the separate pre-`waitForResult()`
  poll; it just calls `waitForResult()` directly after clicking Send (the
  pre-submit `findDailyLimitMessage()` check, for a limit message already on
  the page from a prior prompt, is unchanged).
- **Not independently reproduced live** — both diagnosed from the user's
  real testing (timing pattern across items 1–2, and the observed stall
  before account rotation kicked in), same tooling constraint as the
  previous entry (no `chrome.*` API access outside an installed-extension
  context). Next real-world test should confirm item 1 succeeds without a
  retry-needed error, and that an already-at-limit account gets detected and
  rotated past well under the old ~180s stall.

## 2026-07-19 — Fixed a crash on Stop+Clear mid-generation, and a reload/hydration race on the first queued prompt

- **Request**: the user hit an uncaught `TypeError: Cannot set properties of
  undefined (setting 'status')` at `sidepanel.js:515` while testing, shown
  via `chrome://extensions`'s Errors page with a full stack trace.
- **Root cause (traced statically from the stack trace, not reproduced
  live)**: `runQueue()` writes `queue[i].status = ...` right after `await
  sendToContent("RUN_PROMPT", ...)` resolves — and a single `RUN_PROMPT` can
  stay pending for up to `waitForResult()`'s 180s timeout. Clicking **Stop**
  only flips the `running` flag; it can't cancel that in-flight message. Stop
  also re-enables the **Clear** button (`updateClearButton()` disables it
  only while `running` is true). Clicking Clear while a prompt was still
  generating reassigns `queue` to a brand-new empty array out from under the
  still-pending call — when it finally resolves, `queue[i]` no longer exists.
- **`sidepanel/sidepanel.js`'s `runQueue()`**: added `if (!running) break;`
  immediately after the `RUN_PROMPT` await, before `queue[i]` is touched
  again — `running` is already `false` in both the Stop-only and
  Stop-then-Clear cases by the time a stale continuation resumes, so this
  closes the crash without needing a bigger generation-token rework.
- **Second, related bug found while the user re-tested the fix above**: item
  1 of a fresh 6-item batch failed immediately after the queue's
  start-of-batch tab reload, while items 2–6 (run once the page had fully
  settled) worked fine — the user's own hypothesis that "refreshing the page
  right after clicking start seems to break the process" turned out to be
  exactly right. `background.js`'s `reloadTabAndWait()` only polls for the
  prompt textarea to exist (`composerReady`) before letting the queue
  proceed, but `enableVideoMode()` in `content-scripts/qwen.js` looked up the
  "Select Mode" trigger with a single un-retried `querySelector` — right
  after a hard reload the whole SPA reboots from scratch, and the textarea
  can mount a beat before the rest of the composer toolbar does, so the very
  first prompt could throw "Could not find the mode-select trigger on the
  page" even though the page was just still loading, not actually broken.
  Fixed by wrapping that lookup in the same `waitFor()` polling pattern
  already used twice later in the same function, instead of a single
  same-tick check.
- **Not independently reproduced live for either fix** (both were diagnosed
  from the user's real testing — a devtools stack trace for the first, a
  reload-then-immediate-first-prompt-error pattern for the second) — a
  Manifest V3 side panel/content script depends on `chrome.*` APIs and an
  installed-extension context that this session's browser automation tools
  can't provide (`chrome://extensions` itself is blocked from automation).
  Confirmed by re-reading the exact control flow instead. Next real-world
  test should confirm item 1 of a fresh batch no longer errors right after
  the start-of-batch reload, and that Stop followed immediately by Clear
  during an in-flight generation no longer throws.

## 2026-07-19 — Fixed "Create Video" mode silently dropping on brand-new chats

- **Request**: the user reported that testing had moved past an earlier error
  state to a subtler bug — starting the queue while *not* already in an
  existing chat session (i.e. from chat.qwen.ai's plain "Ready to get
  started?" landing screen) now creates a new chat successfully, but as a
  normal text chat, not a video generation, because the "Create Video" tag
  isn't applied. No error is surfaced anywhere.
- **Investigated live** (via the user's real, already-logged-in chat.qwen.ai
  session): manually replicating `runPrompt()`'s exact sequence — open
  "Select Mode", click "Create Video", set the prompt text via the same
  native-setter + `input`-event mechanism `setPromptText()` uses, wait, click
  Send — worked end-to-end and produced a real generated video from the bare
  landing screen. So the individual selectors and mechanism are all still
  correct; this ruled out a stale-selector explanation.
- **Found the actual race**: `enableVideoMode()` already confirms
  `.mode-select-current-mode` shows "Create Video" before returning, but
  `runPrompt()` never rechecks that between then and the click on Send —
  it just trusts the earlier confirmation. Reproduced the drop directly:
  after `enableVideoMode()` resolves, forcibly clearing the mode pill (as a
  stand-in for whatever redraw is silently doing this on a truly fresh
  chat — the aspect-ratio control that only appears once video mode is on
  mounts around the same point `setPromptText()`'s `input` event would
  trigger a re-render) leaves `isVideoModeOn()` reporting `false` again with
  nothing downstream noticing.
- **`content-scripts/qwen.js`'s `runPrompt()`**: added a recheck of
  `isVideoModeOn()` immediately before clicking the submit button, calling
  `enableVideoMode()` again if it dropped, rather than only checking once
  earlier in the sequence. Confirmed the fix directly: simulated the drop
  live, then ran the same guard logic and watched it correctly detect
  `isVideoModeOn() === false` and re-enable "Create Video" before the
  (skipped, to avoid spending a third real generation on this) Send click
  would have fired.

## 2026-07-19 — Fixed unchecked runtime.lastError on the content-script relay

- **Request**: the user saw "Unchecked runtime.lastError: Could not
  establish connection. Receiving end does not exist." in
  `chrome://extensions`'s Errors page (Context: Unknown, an anonymous stack
  frame) before doing any real testing, and asked if it needed fixing first.
- **Root cause**: `background.js`'s generic `target: "content"` message
  relay called `chrome.tabs.sendMessage(tab.id, message, callback)` without
  ever reading `chrome.runtime.lastError` inside the callback. Whenever the
  content script isn't injected yet on the target tab (page still loading,
  right after a reload, or the panel pinging before the tab has caught up),
  that call fails with "Receiving end does not exist" — an expected,
  recoverable case elsewhere in this same file (`reloadTabAndWait()` and
  `switchAccountAndWait()` already guard for it with
  `void chrome.runtime.lastError`), but this one relay path didn't, so
  Chrome logged it as unchecked instead of it being silently handled.
- **Fixed**: the relay now checks `chrome.runtime.lastError` and responds
  with `{ ok: false, error: "..." }` instead of `undefined`, so the side
  panel gets an actionable message instead of nothing. Applied the same
  `chrome.runtime.lastError` check to `sidepanel.js`'s four
  `chrome.runtime.sendMessage` callers (`sendToContent`, `refreshQwenTab`,
  `switchAccount`, the `DOWNLOAD_RESULT` sender) for consistency, even
  though those target the always-live background listener and were less
  likely to actually trigger this.
- Existing error entries in `chrome://extensions` are historical — reload
  the unpacked extension and use "Clear all" there to confirm it doesn't
  recur.

## 2026-07-19 — Fixed video-result extraction based on a real completed generation; retired the "Before this can generate a single video" README section

- **Request**: the user shared a DevTools screenshot of a completed video
  result's DOM, plus the actual video URL they'd found
  (`https://cdn.qwenlm.ai/output/.../<id>.mp4?key=<signed-jwt>&x-oss-process=video/snapshot,t_0,w_0,h_500,f_jpg`),
  and asked to remove the README's "Before this can generate a single
  video" section as no longer needed.
- **Found the previous `waitForResult()`/`extractResult()` implementation
  was wrong**, not just unconfirmed: it polled for a `<video>` element, but
  a finished result actually renders as a poster/thumbnail —
  `.qwen-video-control` containing `<img class="video-cover" src="...">`
  and a `.qwen-video-control-time` duration label — with no `<video>` tag
  present unless the user clicks play. The old code would have polled until
  its own timeout on every real completion.
- **The pasted URL turned out to be the snapshot URL**, not the video
  itself — its trailing `x-oss-process=video/snapshot,t_0,w_0,h_500,f_jpg`
  param tells the CDN to serve a jpg frame instead of the video. It's the
  exact same URL as the cover `<img>`'s `src` (same path, same signed `key`
  query param), just with that one param appended. Stripping it off gives
  back the real, same-origin, directly downloadable video URL — confirming
  the video is **not** a page-scoped `blob:` URL, so
  `chrome.downloads.download()` can use it as-is.
- **`content-scripts/qwen.js` rewritten**: `waitForResult()` now polls for a
  new `.qwen-video-control img.video-cover` (one not already present when
  generation started) instead of a `<video>` element; `extractResult()` now
  takes that `<img>`, parses its `src` as a URL, and deletes the
  `x-oss-process` query param to recover the downloadable video URL.
- **README.md**: removed the "Before this can generate a single video"
  section entirely — every item it was tracking is now either confirmed
  live or fixed based on real evidence, and this changelog is the durable
  record of what was verified and how (per this repo's own memory-mechanism
  convention). Trimmed the "Status" header and one "Known limitations"
  bullet that referenced the removed section.

## 2026-07-19 — Confirmed a real login submission end-to-end, using a throwaway account

- **Request**: the user offered throwaway account credentials so the actual
  login submission (not just the fill mechanism) could be tested. Declined
  to accept the credentials directly — entering passwords into fields is a
  hard rule regardless of how disposable the account is — and instead asked
  the user to type them into the already-open `/auth` tab themselves.
- **The user typed the throwaway credentials in directly**, never pasted to
  or handled by this session. Confirmed both fields were non-empty and
  "Sign in" was enabled via a boolean-only DOM check (`value.length > 0`),
  without ever reading the actual field contents into this session.
- **Clicked "Sign in" programmatically** (`button.click()`, no
  `chrome.debugger`/trusted click) — logged in successfully on the first
  try: no CAPTCHA, page redirected to the account's home with the composer
  ready. This is the exact mechanism `performLogin()` already used, so no
  code changes to the fill/submit logic were needed — just resolving the
  submit-time unknowns that could only be confirmed with a real submission.
- **`content-scripts/qwen.js`**: `performLogin()`'s comment updated from
  "trusted-click unconfirmed" to confirmed-unnecessary; added a note that a
  CAPTCHA remains possible for other accounts/circumstances even though none
  appeared here, and that `performLogin()` still has no specific
  CAPTCHA-detection logic (a generic composerReady-poll timeout is what
  currently happens if one shows up).
- **README.md**: "Still unconfirmed" list is now down to one real item — the
  blob-vs-same-origin video URL question, which needs an actual completed
  generation to resolve, not just a login.

## 2026-07-19 — Confirmed performLogin()'s fill mechanism actually works, closing the last open selector question

- **Request**: the user disabled a browser extension that had been
  overlaying the chat.qwen.ai text box (likely why the very first live-typing
  attempt earlier this session landed on nothing) and asked to retry
  validating the login inputs.
- **Real typing now landed**: with the interfering extension disabled,
  typing fake test values (`test@example.com` / a fake password) into
  `input[name="email"]`/`input[name="password"]` via the browser tool worked
  and enabled the "Sign in" button — confirming those are the right,
  interactive elements.
- **Confirmed `performLogin()`'s actual mechanism, not just manual typing**:
  ran the exact native-setter + `input`-event pattern the content script
  uses (mirroring `setPromptText()`) directly against the login form via
  `javascript_tool` — clearing the fields this way disabled "Sign in" again,
  filling them this way (with different fake values) re-enabled it. This is
  the real code path `performLogin()` ships with, not an approximation of
  it, so the MAIN-world bridge is now confirmed unnecessary for this form,
  same as the composer. Fields were cleared immediately after and the submit
  button was never clicked — no login attempt, real or fake, was ever
  submitted.
- **`content-scripts/qwen.js`**: updated `performLogin()`'s comment from "TODO:
  confirm the fill mechanism" to confirmed; the only remaining open question
  for that function is the trusted-click requirement on submit, since
  clicking it for real (even with fake credentials) was never attempted.
- **README.md**: "Still unconfirmed" list now down to three submit-time-only
  questions (trusted click, CAPTCHA, blob vs. same-origin video URL) — every
  DOM selector and fill mechanism in the account-rotation flow is confirmed.

## 2026-07-19 — Confirmed login/logout selectors live, with real logout of the user's own account

- **Request**: the user explicitly authorized using their real, live
  chat.qwen.ai session for this testing (following on from the read-only
  verification pass earlier the same day), specifically to close the one
  remaining gap: the login form's real DOM selectors.
- **Logged out for real**: clicked the actual "Log out" row in the account
  menu against the user's live session. Confirmed it does **not** navigate
  anywhere — the page just re-renders the same URL in a logged-out state
  (generic composer, "Log in"/"Sign up" buttons top-right instead of the
  account menu). The user's account was left logged out at the end of this
  session — they need to log back in by hand, since this project doesn't
  handle real passwords even during its own testing.
- **Found the real login form** at a distinct URL, `https://chat.qwen.ai/auth`
  (reached by clicking "Log in", or by navigating there directly): an Ant
  Design form with `input[name="email"]`, `input[name="password"]`, and a
  submit button (`button.qwenchat-auth-pc-submit-button`, text "Sign in")
  that stays disabled until both fields are filled. Filled in
  `findLoginEmailInput()`, `findLoginPasswordInput()`, and
  `findLoginSubmitButton()` in `content-scripts/qwen.js` with these
  selectors, replacing the `null`-returning placeholders.
- **`background.js`'s `switchAccountAndWait()` rewritten**: since logout
  doesn't navigate on its own, it now explicitly navigates the tab to
  `https://chat.qwen.ai/auth` via `chrome.tabs.update()` after logout
  succeeds (waiting for `tabs.onUpdated` "complete" before polling), instead
  of assuming a login form would just appear in-page.
- **Deliberately not tested**: actually typing into the email/password
  fields, even with fake test values — attempting this via the browser
  automation tool was itself blocked by that tool's own safety classifier
  (correctly: entering data into a live login form is treated as too
  sensitive to script blind, real credentials or not). So whether
  `setPromptText()`'s native-setter + `input`-event pattern is enough to
  make these specific fields register with the page's framework state (or
  whether they need the MAIN-world bridge instead) remains unconfirmed —
  documented as the next open question in `performLogin()`'s comment and
  README's "Still unconfirmed" list. Also still unconfirmed: trusted-click
  requirement for the submit button, and CAPTCHA presence.
- **README.md** updated: login/logout selectors moved from "still
  unconfirmed" to "confirmed live"; the unconfirmed list is now narrower
  (framework-state registration, trusted click, blob URL, CAPTCHA).

## 2026-07-19 — Confirmed core selectors live via Claude-in-Chrome, using the user's own logged-in chat.qwen.ai session

- **Request**: verify the placeholder selectors in `content-scripts/qwen.js`
  against the real page, using the Claude-in-Chrome browser tool (the
  user's actual Chrome, with their existing chat.qwen.ai login) rather than
  continuing to guess.
- **Confirmed and fixed**: `findPromptInput()` now targets
  `textarea.message-input-textarea` (a real, framework-tracked textarea —
  the MAIN-world bridge is confirmed unnecessary for this field);
  `findGenerateButton()` now targets `button[aria-label="Send"]`;
  `isVideoModeOn()` now checks `.mode-select-current-mode` for the text
  "Create Video" instead of stubbing `return true`. Added
  `enableVideoMode()`, which opens the mode-select dropdown
  (`[aria-label="Select Mode"]`) and clicks the "Create Video"
  `li.mode-select-common-item` — run end-to-end on a fresh page load and
  confirmed working, so `runPrompt()` now actually turns video mode on
  before every prompt instead of assuming it's already selected.
  `findLogoutControl()` now targets the real `.user-menu-dropdown-item`
  "Log out" row inside the `button.user-menu-btn` account menu, and
  `performLogout()` (now async) was confirmed to correctly open that menu
  and locate the row — but the actual "Log out" click was deliberately never
  tested (see below), so `performLogout()` still stops one step short of
  verified.
- **Deliberately not tested**: clicking "Log out" for real, and everything
  downstream of it (the login page/modal, its email/password/submit
  selectors, whether it needs the MAIN-world bridge or a trusted click).
  Doing that against the user's real logged-in session would have ended it
  with no way back in — this project doesn't handle real passwords in
  testing, by design. `findLoginEmailInput`/`findLoginPasswordInput`/
  `findLoginSubmitButton` remain `null`-returning placeholders. Also
  deliberately not tested: actually clicking "Send" on a real prompt (would
  have spent a real quota slot) — the button's selector, enabled state, and
  appearance-on-text-entry are confirmed instead.
- **README.md** rewritten to distinguish confirmed-live selectors from the
  remaining unconfirmed login/logout ones, with a recommendation to confirm
  those by deliberately logging out of an account the user is prepared to
  log back into by hand, DevTools open, rather than scripting it blind.

## 2026-07-19 — Reversed the no-account-switching decision; removed [video] tag requirement

- **Request**: explicitly reverse the 2026-07-18 decision documented below
  not to build account-cycling — the user confirmed they want full automated
  account rotation (including automating the login step itself, not just
  detecting-and-pausing) for their own accounts, accepting the ToS/ban-risk
  tradeoff previously declined on their behalf. Also requested removing the
  `[video]` line-tag requirement entirely — every non-blank prompt line is
  now submitted, no tagged/skipped distinction.
- **Account rotation**: loads accounts from a plaintext `.txt` file (format
  in README's "Account rotation on daily-limit"), parsed by
  `parseAccountsFile()` in `sidepanel/sidepanel.js`. Kept in the side panel's
  in-memory state only — deliberately never written to
  `chrome.storage.local` — matching the existing "prompt queue lives in
  memory only" limitation rather than persisting plaintext passwords to
  disk. New `SWITCH_ACCOUNT` message type, orchestrated from
  `background.js`'s new `switchAccountAndWait()` (mirrors
  `reloadTabAndWait()`'s poll-for-composerReady pattern, since the switch
  involves navigation that unloads/reinjects the content script). New
  placeholder DOM functions in `content-scripts/qwen.js`
  (`findLogoutControl`, `findLoginEmailInput`, `findLoginPasswordInput`,
  `findLoginSubmitButton`, `performLogin`) — unverified against the live
  page, same convention as the existing composer/submit selectors.
  `performLogin()` is documented to fail cleanly rather than attempt to
  solve a CAPTCHA if one appears — a hard requirement, not a placeholder
  detail to fill in later.
- **Confirmed the daily-limit message text** via a live screenshot: the
  actual phrase is "daily usage limit" (appearing in both a page banner and
  an inline chat-bubble error), not "daily limit" as the old placeholder
  regex assumed — that regex would never have matched. Fixed in
  `findDailyLimitMessage()`.
- **On a daily-limit hit**, the queue now retries the prompt that hit the
  limit after switching accounts (it was never actually accepted), rather
  than marking it skipped/failed. Stops once every loaded account is
  exhausted or fails to log in, reporting progress — same clean-stop UX as
  before, just extended across multiple accounts instead of one.
- **`.gitignore`**: added `accounts*.txt` / `credentials*.txt` so a
  locally-kept plaintext accounts file can't be committed by accident.
- **Removed `[video]` tag filtering**: every non-blank prompt line is now
  queued and submitted; the "Skipped" status and `VIDEO_TAG_PATTERN` are
  gone from `sidepanel/sidepanel.js`.

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
