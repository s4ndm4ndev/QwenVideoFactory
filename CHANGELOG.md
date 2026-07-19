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
