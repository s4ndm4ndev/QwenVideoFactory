// Qwen Video Factory — content script (runs on chat.qwen.ai)
//
// This file is a SKELETON, mirroring the structure of Overflow's
// content-scripts/flow.js (this extension's sister project for Google Flow).
// The functions below are stubbed with the interface the rest of the
// extension expects, but the actual DOM selectors are NOT filled in yet —
// that requires inspecting the live chat.qwen.ai page in DevTools first (see
// README.md).
//
// Two things confirmed true of Overflow's target (a React SPA) that are
// worth checking here too before assuming either way:
//   1. Selectors may be unstable/obfuscated (generated CSS classes). Prefer
//      stable attributes: aria-label, data-testid, placeholder text, role,
//      or the accessible name of the element.
//   2. If the composer turns out to be a framework-controlled rich-text
//      editor (not a plain <textarea>), `input.value = "..."` alone won't be
//      seen by the framework's own state — see
//      content-scripts/qwen-main-world.js for the fallback bridge pattern
//      Overflow needed for Google Flow's Slate.js editor. Try the plain
//      native-setter + 'input'-event approach in setPromptText() below
//      first; only reach for the main-world bridge if that's confirmed not
//      to work live.

// Diagnostic-only: added after a real test hit a total silent hang (no
// error, no status update — see runPrompt()'s qvfLog() calls below) that none
// of the existing error tagging caught. These specifically answer a question
// that determines what kind of fix is even possible: does chat.qwen.ai do a
// REAL navigation as part of whatever recovery/reset is happening (which
// would explain a dead message port that never fires chrome.runtime.lastError
// the way it normally does), or does the visible "back to the landing page"
// reset happen with no navigation at all (a pure React-internal remount,
// which is a same-page, same-content-script-instance problem instead)? A
// real navigation fires beforeunload/pagehide; a same-page remount does not.
window.addEventListener("beforeunload", () => qvfLog("window beforeunload — a real navigation is happening"));
window.addEventListener("pagehide", () => qvfLog("window pagehide — a real navigation is happening"));
window.addEventListener("error", (e) => qvfLog(`window error event: ${e.message}`));
window.addEventListener("unhandledrejection", (e) =>
	qvfLog(`window unhandledrejection: ${(e.reason && e.reason.message) || e.reason}`),
);

// Ad-blocker detection: attempt requests to real ad-serving URLs known to
// get network-blocked by content blockers. A cosmetic DOM-bait element
// (classic "ad-banner"/"adsbygoogle" class names, checked for a collapsed
// height) was tried first and confirmed live, via direct DevTools
// inspection with AdGuard enabled, to NOT get hidden — modern ad blockers
// increasingly leave well-known honeypot elements alone specifically to
// defeat anti-adblock detection scripts. A single network-bait URL
// (pagead2.googlesyndication.com/pagead/js/adsbygoogle.js) was tried next
// and also confirmed live not to trip, even with AdGuard actively blocking
// other trackers on the same page (an Alibaba tracking script) — that
// specific Google script is apparently allowlisted by AdGuard's filter set
// even though it blocks plenty else. Two independent, well-established
// bait URLs are used now instead of one, so one blocker's specific filter
// quirks can't silently defeat this again:
//   - static.doubleclick.net/instream/ad_status.js — the de facto standard
//     ad-blocker-detection resource used across the industry (the same URL
//     libraries like just-detect-adblock rely on), blocked by essentially
//     every major filter list (EasyList, AdGuard Base, etc.) specifically
//     because publishers already lean on it for exactly this purpose.
//   - pagead2.googlesyndication.com/pagead/js/adsbygoogle.js — kept as a
//     second, independent signal; not blocked by this user's AdGuard setup,
//     but may be by others.
// Any one of them failing counts as a blocker being active.
//
// mode: "no-cors" means each request always resolves (an opaque response)
// if it's allowed through — no CORS headers required, same as any tracking
// pixel — so a thrown/rejected fetch can only mean something intercepted
// the request before it reached the network, i.e. a blocker. Checked once
// immediately and re-checked periodically (not on every PING, to avoid a
// network round-trip on every 3s panel poll); PING reads whatever this last
// resolved to.
const AD_BLOCKER_TEST_URLS = [
	"https://static.doubleclick.net/instream/ad_status.js",
	"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
];

let adBlockerActive = false;

async function refreshAdBlockerStatus() {
	const results = await Promise.allSettled(
		AD_BLOCKER_TEST_URLS.map((url) => fetch(url, { mode: "no-cors", cache: "no-store" })),
	);
	adBlockerActive = results.some((r) => r.status === "rejected");
}

refreshAdBlockerStatus();
setInterval(refreshAdBlockerStatus, 20000);

/**
 * Find the prompt composer on the page. Confirmed live: a plain <textarea
 * class="message-input-textarea ...">, no framework-controlled rich-text
 * editor — setPromptText()'s native-setter approach is sufficient, the
 * MAIN-world bridge (qwen-main-world.js) is not needed for this field.
 */
function findPromptInput() {
	return document.querySelector("textarea.message-input-textarea");
}

/**
 * Find the submit button next to the prompt composer. Confirmed live:
 * <button aria-label="Send" class="send-button">, which only renders once
 * the composer has text in it (absent while the textarea is empty).
 */
function findGenerateButton() {
	return document.querySelector('button[aria-label="Send"]');
}

/**
 * Set the composer's text via the native value setter + a real 'input'
 * event, so a framework tracking the input's state (React, Vue, etc.) picks
 * up the change. This is the simpler case; if live inspection shows the
 * composer is a rich-text editor like Flow's Slate instance, this needs to
 * be replaced with a postMessage relay to qwen-main-world.js instead (see
 * that file's header comment, and Overflow's flow.js/flow-main-world.js for
 * the pattern to copy).
 *
 * Types character by character (each with its own native-setter call + a
 * fresh 'input' event) with a small randomized per-character delay, rather
 * than setting the whole string in a single call — requested after real
 * testing showed the automation moving faster than a real user would type,
 * and one incidental benefit: a single big value-set + one 'input' event is
 * a more distinctive, all-at-once signal than a real user's per-keystroke
 * pattern, so spreading it out is a small step toward not looking like a
 * script even though it wasn't confirmed to be the direct cause of any
 * specific failure.
 */
async function setPromptText(text) {
	const input = findPromptInput();
	if (!input) throw new Error("PAGE_NOT_READY: Could not find the prompt input on the page.");

	const nativeSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;

	let typed = "";
	for (const char of text) {
		typed += char;
		nativeSetter.call(input, typed);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await sleep(15 + Math.random() * 35);
	}
}

/**
 * Whether chat.qwen.ai's video-generation mode/tool is currently selected.
 * Confirmed live: selecting "Create Video" from the "+" tools menu renders a
 * <div class="mode-select"><div class="mode-select-current-mode"><span>Create
 * Video</span>...</div></div> pill next to the composer; it's absent (or
 * shows a different mode's name) otherwise.
 */
function isVideoModeOn() {
	const current = document.querySelector(".mode-select-current-mode");
	return !!current && current.textContent.includes("Create Video");
}

/**
 * Turn on "Create Video" mode if it isn't already active. Confirmed live:
 * the "+" trigger next to the composer (<div aria-label="Select Mode"
 * class="mode-select-open">, always present alongside whatever mode pill is
 * currently selected) opens an Ant Design dropdown; its "Create Video" entry
 * is <li role="menuitem" class="... mode-select-common-item">. Selecting it
 * replaces/adds the "Create Video" pill (`.mode-select-current-mode`) that
 * isVideoModeOn() checks for. No-ops if video mode is already on, since a
 * fresh chat likely needs this every time but a mid-conversation call
 * shouldn't re-trigger it needlessly.
 */
async function enableVideoMode() {
	if (isVideoModeOn()) return;

	// Waited for (not just queried once) because background.js's post-reload
	// readiness check only confirms the prompt textarea has mounted
	// (composerReady), not the rest of the composer toolbar — right after the
	// queue's start-of-batch reload, the textarea can appear a beat before
	// this trigger does, and a same-tick querySelector here would throw on
	// the very first prompt even though the page is genuinely still loading,
	// not actually broken.
	const trigger = await waitFor(
		() => document.querySelector('[aria-label="Select Mode"]'),
		20000,
		200,
	);
	// All three failure points below are tagged "PAGE_NOT_READY:" — originally
	// only the trigger-not-found case was, on the theory that it was the
	// clearest signal of a React hydration crash (an uncaught "Minified React
	// error #418" in react-dom-vendor.js, confirmed via a user devtools
	// screenshot, correlated with third-party ad-tracker requests getting
	// blocked mid-hydration). Real testing after that fix showed the same
	// symptom (composer never becomes interactive, item stuck on "Generating")
	// recurring even with the trigger present and found — i.e. the mode-select
	// dropdown opening but its item never registering, or the confirmation
	// pill never appearing, are just as much a "the page silently isn't
	// actually interactive yet" signal as the trigger missing entirely was.
	// Nothing was ever submitted at any of these three points, so all of them
	// are safe for sidepanel.js's runQueue() to reload-and-retry automatically
	// — unlike a failure after Send is actually clicked, where a retry could
	// double-submit (see the plain, untagged errors after button.click() in
	// runPrompt() below, and waitForResult()'s own timeout).
	if (!trigger)
		throw new Error("PAGE_NOT_READY: Could not find the mode-select trigger on the page.");
	trigger.click();

	// Small human-paced delay before picking the menu item, as if someone
	// actually looked at the dropdown before clicking, rather than clicking
	// the instant it opens.
	await sleep(250 + Math.random() * 400);

	const item = await waitFor(
		() =>
			Array.from(document.querySelectorAll("li.mode-select-common-item")).find((li) =>
				li.textContent.includes("Create Video"),
			),
		20000,
		200,
	);
	if (!item)
		throw new Error(
			"PAGE_NOT_READY: Could not find the 'Create Video' option in the mode menu.",
		);
	item.click();

	const enabled = await waitFor(isVideoModeOn, 20000, 200);
	if (!enabled)
		throw new Error("PAGE_NOT_READY: Selected 'Create Video' but video mode did not turn on.");
}

/**
 * Look for chat.qwen.ai's own "daily usage limit" message on the page.
 * Confirmed live (screenshot) to appear in two places, both containing the
 * phrase "daily usage limit": a page-level banner ("You have reached the
 * daily usage limit. Please wait 19 hours before trying again.") and an
 * inline chat-bubble error ("Oops! There was an issue connecting to
 * Qwen3.7-Plus. You have reached the daily usage limit..."). A single
 * document.body.innerText scan catches either placement, so no
 * selector-specific handling is needed for this part — this is the signal
 * the queue uses to trigger an account switch (or stop gracefully if none
 * are available) instead of erroring prompt-by-prompt (see RUN_PROMPT below
 * and runQueue()/tryRotateToNextAccount() in sidepanel.js).
 */
function findDailyLimitMessage() {
	const text = document.body.innerText || "";
	if (/daily usage limit/i.test(text)) return text.match(/[^.\n]*daily usage limit[^.\n]*/i)[0];
	return null;
}

/**
 * Detects chat.qwen.ai's own rate-limit response — confirmed live via a
 * user devtools screenshot: "Oops! There was an issue connecting to
 * Qwen3.7-Plus. Too many requests in a short period." This is a distinct,
 * short-lived condition from the daily usage limit above (that one needs
 * account rotation; this one just needs to wait out the rate window and
 * retry the same account) — before this existed, RUN_PROMPT had nothing that
 * recognized this message at all, so a rate-limited submission (which
 * genuinely never produces a video) left waitForResult() blindly polling for
 * one until its full 180s timeout, which is exactly what "stuck on
 * Generating with no error" turned out to be in that reproduction.
 *
 * Returns a *count* of matches, not a boolean/text match like
 * findDailyLimitMessage() — deliberately, because this error bubble stays
 * visible in the chat transcript after it happens. A plain whole-page text
 * scan (like findDailyLimitMessage() uses) would keep matching that same old
 * bubble forever on every later prompt, even once the rate-limit window has
 * passed and a fresh submission would actually succeed. waitForResult()
 * below snapshots this count when generation starts and only treats a rise
 * in the count as a genuinely new occurrence, the same "new, not
 * pre-existing" principle it already applies to detecting a finished video
 * via the `alreadyPresent` src Set.
 */
function countRateLimitOccurrences() {
	const text = document.body.innerText || "";
	const matches = text.match(/too many requests in a short period/gi);
	return matches ? matches.length : 0;
}

function findRateLimitMessage() {
	const text = document.body.innerText || "";
	const match = text.match(/[^.\n]*too many requests in a short period[^.\n]*/i);
	return match ? match[0] : "Too many requests in a short period.";
}

/**
 * Find the "Log out" item inside the account menu (bottom-left profile
 * button). Confirmed live: opening <button class="user-menu-btn"> (no
 * aria-label) renders a dropdown with rows
 * <div class="user-menu-dropdown-item">...<div
 * class="user-menu-dropdown-item-text">Log out</div></div> — this only
 * finds the item, it doesn't open the menu first (see performLogout()).
 */
function findLogoutControl() {
	const items = document.querySelectorAll(".user-menu-dropdown-item");
	return Array.from(items).find((item) => item.textContent.includes("Log out")) || null;
}

/**
 * Open the account menu (if not already open) and click "Log out". Confirmed
 * live: this does NOT navigate anywhere — the page stays on the same URL and
 * just re-renders into its logged-out state (composer becomes a generic
 * placeholder, "Log in"/"Sign up" buttons appear top-right instead of the
 * account menu). The actual login form lives at a distinct URL
 * (https://chat.qwen.ai/auth), which background.js's switchAccountAndWait()
 * navigates to directly after this resolves, rather than this function
 * hunting for a "Log in" button to click.
 */
async function performLogout() {
	if (!findLogoutControl()) {
		const trigger = document.querySelector("button.user-menu-btn");
		if (!trigger) throw new Error("Could not find the account menu button on the page.");
		trigger.click();
	}

	const control = await waitFor(findLogoutControl, 3000, 150);
	if (!control) throw new Error("Could not find the logout control on the page.");
	control.click();
}

/**
 * Find the login form's email and password inputs, and its submit button.
 * Confirmed live at https://chat.qwen.ai/auth: an Ant Design form with
 * <input name="email"> and <input name="password" type="password">, and a
 * <button type="submit" class="... qwenchat-auth-pc-submit-button ...">
 * ("Sign in") that carries a "disabled" class/attribute until both fields
 * hold a value the framework recognizes as filled in.
 */
function findLoginEmailInput() {
	return document.querySelector('input[name="email"]');
}

function findLoginPasswordInput() {
	return document.querySelector('input[name="password"]');
}

function findLoginSubmitButton() {
	return document.querySelector("button.qwenchat-auth-pc-submit-button");
}

/**
 * Whether the login form is currently on screen — used by the PING handler
 * so background.js can tell "still on the login page" apart from "composer
 * is back" while polling through an account switch.
 */
function isLoginFormPresent() {
	return !!(findLoginEmailInput() && findLoginPasswordInput());
}

/**
 * Fill in and submit the login form with the given credentials. Confirmed
 * live end-to-end, including a real submission: the native-setter +
 * 'input'-event approach below (mirroring setPromptText() above) is enough
 * to fill both fields, and a plain synthetic submit.click() — no trusted
 * click via chrome.debugger needed — logged straight in with no CAPTCHA
 * shown, landing back on the composer. The MAIN-world bridge is not needed
 * for this form.
 *
 * A CAPTCHA remains possible for other accounts/circumstances (rate-limited
 * IPs, flagged accounts, etc.) even though none appeared during testing —
 * if one does appear after submitting, this must resolve
 * { ok: false, error } rather than attempt to interact with or bypass it.
 * That's a hard stop for that account, not a selector problem to iterate
 * on.
 */
async function performLogin(email, password) {
	const emailInput = findLoginEmailInput();
	const passwordInput = findLoginPasswordInput();
	if (!emailInput || !passwordInput) {
		throw new Error("Could not find the login form on the page.");
	}

	const setNativeValue = (el, value) => {
		const nativeSetter = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(el),
			"value",
		).set;
		nativeSetter.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	};

	setNativeValue(emailInput, email);
	setNativeValue(passwordInput, password);

	await sleep(300 + Math.random() * 500);

	const submit = findLoginSubmitButton();
	if (!submit) throw new Error("Could not find the login submit button.");
	submit.click();
}

/**
 * Poll `check` until it returns a truthy value or `timeoutMs` elapses.
 */
function waitFor(check, timeoutMs, intervalMs = 300) {
	return new Promise((resolve) => {
		const start = Date.now();
		const poll = () => {
			const result = check();
			if (result) {
				resolve(result);
				return;
			}
			if (Date.now() - start > timeoutMs) {
				resolve(null);
				return;
			}
			setTimeout(poll, intervalMs);
		};
		poll();
	});
}

/**
 * Watch for either a finished video result or the daily-limit message,
 * whichever appears first. Confirmed live (via DOM inspection of a completed
 * generation): a finished result does NOT render as a <video> element — it's
 * a poster/thumbnail, <div class="qwen-video-control"><img class="video-cover"
 * src="..." />...<div class="qwen-video-control-time">00:05</div></div>, with
 * the actual <video> only mounting later if the user clicks play. Watches for
 * a new `.qwen-video-control img.video-cover` (one with a real src that
 * wasn't already on the page when generation started).
 *
 * Previously the daily-limit message was only checked in a separate, fixed
 * 5-second poll right after submitting, before this function was ever
 * called — if Qwen's own limit response took longer than that to actually
 * render (server/UI latency), it was missed entirely and this function's
 * full timeout ran out blind, waiting on a video that was never going to
 * arrive. Checking both conditions on the same observer removes that fixed
 * window: whichever shows up first, any time before the overall timeout,
 * wins.
 */
function waitForResult(timeoutMs = 180000) {
	const alreadyPresent = new Set(
		Array.from(document.querySelectorAll(".qwen-video-control img.video-cover")).map(
			(img) => img.src,
		),
	);
	// See countRateLimitOccurrences()'s comment: a rise from this snapshot, not
	// the mere presence of the phrase, is what distinguishes a fresh rate-limit
	// hit from an old error bubble still sitting in the chat transcript.
	const rateLimitCountAtStart = countRateLimitOccurrences();

	return new Promise((resolve, reject) => {
		const finish = (fn) => {
			clearTimeout(timeout);
			observer.disconnect();
			fn();
		};

		const timeout = setTimeout(() => {
			qvfLog("waitForResult: timed out after " + timeoutMs + "ms with no video, no daily-limit message, and no new rate-limit message");
			finish(() => reject(new Error("Timed out waiting for the video to finish generating.")));
		}, timeoutMs);

		const check = () => {
			const limitMessage = findDailyLimitMessage();
			if (limitMessage) {
				qvfLog("waitForResult: daily-limit message detected");
				finish(() => resolve({ dailyLimitReached: true, message: limitMessage }));
				return;
			}
			if (countRateLimitOccurrences() > rateLimitCountAtStart) {
				qvfLog("waitForResult: rate-limit message detected");
				finish(() =>
					resolve({ dailyLimitReached: false, rateLimited: true, message: findRateLimitMessage() }),
				);
				return;
			}
			const cover = Array.from(
				document.querySelectorAll(".qwen-video-control img.video-cover"),
			).find((img) => img.src && !alreadyPresent.has(img.src));
			if (cover) {
				qvfLog("waitForResult: video result detected");
				finish(() =>
					resolve({ dailyLimitReached: false, rateLimited: false, result: extractResult(cover) }),
				);
			}
		};

		check(); // catches a limit/rate-limit message that's already on the page by the time this starts
		const observer = new MutationObserver(check);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		});
	});
}

/**
 * Pull the downloadable video URL out of a finished result's cover image.
 * Confirmed live: the cover <img>'s src IS the video's own URL (same path,
 * same signed `key` query param), with an extra `x-oss-process=video/
 * snapshot,...` param appended that tells the CDN to serve a jpg frame
 * instead of the video itself. Stripping that param off gives back a
 * same-origin, directly downloadable URL — not a page-scoped blob: URL, so
 * chrome.downloads.download() can use it as-is (same as Overflow found for
 * Google Flow).
 */
function extractResult(coverImg) {
	const url = new URL(coverImg.src);
	url.searchParams.delete("x-oss-process");
	return {
		url: url.toString(),
		mediaType: "video",
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timestamped, greppable console output for each major step of runPrompt().
 * Added specifically because a real test hit a total silent hang — no error,
 * no status update, nothing — that none of the existing PAGE_NOT_READY /
 * CONNECTION_LOST tagging caught, so there was no way to tell from the side
 * panel alone which step it actually got stuck on. Open DevTools on the
 * chat.qwen.ai tab (F12 → Console) before clicking Start Queue to capture
 * this next time it happens.
 *
 * Also broadcast to the side panel's Log tab, same pattern as
 * background.js's QWEN_FOCUS_CHANGED broadcast — the panel isn't always
 * open to receive it, so a missing-listener rejection is expected and
 * swallowed rather than surfaced.
 *
 * Wrapped in try/catch, not just a promise .catch(): if this content script
 * instance is a stale one left over from before the extension was
 * reloaded/updated (page never refreshed), chrome.runtime.sendMessage()
 * throws "Extension context invalidated" synchronously, before it ever
 * returns a promise — a .catch() alone doesn't run in time to swallow that.
 * This is a routine dev-reload situation (an already-open chat.qwen.ai tab
 * outliving an extension reload), not a real bug in the running batch, so
 * it's silently swallowed the same as a missing panel listener.
 */
function qvfLog(step) {
	console.log(`[QVF ${new Date().toISOString()}] ${step}`);
	try {
		chrome.runtime
			.sendMessage({ target: "panel", type: "QVF_LOG", payload: { step, ts: Date.now() } })
			.catch(() => {});
	} catch (err) {
		void err;
	}
}

/**
 * Run a single prompt end-to-end: fill in the text, submit, wait for
 * result. Checks for the daily-limit message before submitting (in case it's
 * already on the page from a prior prompt) and relies on waitForResult() to
 * keep watching for it afterward too, so the queue can stop cleanly rather
 * than treating a limit hit as a generic per-prompt error.
 */
async function runPrompt(text) {
	qvfLog("runPrompt: start");
	const preExisting = findDailyLimitMessage();
	if (preExisting) {
		qvfLog("runPrompt: daily limit message already on page, bailing out");
		return { dailyLimitReached: true, message: preExisting };
	}

	const input = findPromptInput();
	if (!input) throw new Error("PAGE_NOT_READY: Could not find the prompt input on the page.");

	// Small settle delay before the first interaction on this page load, as if
	// someone glanced at the fresh chat before starting to work — also gives a
	// page that's still finishing hydration a bit more margin before the first
	// click/dispatch, on top of the composerReady+toolbarReady gate already
	// checked before the queue's first RUN_PROMPT.
	await sleep(600 + Math.random() * 900);

	qvfLog("runPrompt: enableVideoMode (1st call) starting");
	await enableVideoMode();
	qvfLog("runPrompt: enableVideoMode (1st call) done, videoModeOn=" + isVideoModeOn());

	qvfLog("runPrompt: setPromptText starting");
	await setPromptText(text);
	qvfLog(
		"runPrompt: setPromptText done, live textarea value length=" +
			(findPromptInput() ? findPromptInput().value.length : "no textarea found"),
	);

	// Short randomized pause before submitting, as if someone typed the
	// prompt and glanced over it, rather than submitting the instant the
	// field is filled (same rationale as Overflow's flow.js).
	await sleep(600 + Math.random() * 1200);

	// Re-check right before submitting rather than trusting enableVideoMode()'s
	// earlier confirmation: on a brand-new chat (no session yet, composer's
	// very first render), typing the prompt text has been observed to redraw
	// the composer — the aspect-ratio control that only appears once "Create
	// Video" is on mounts around here — and that redraw can silently drop the
	// mode pill back to nothing, so the prompt goes out as a normal text chat
	// instead of a video generation with no error raised anywhere. Re-assert
	// it here, at the last moment before clicking Send.
	if (!isVideoModeOn()) {
		qvfLog("runPrompt: video mode dropped before Send, re-enabling (2nd call)");
		await enableVideoMode();
		qvfLog("runPrompt: enableVideoMode (2nd call) done, videoModeOn=" + isVideoModeOn());
	}

	qvfLog("runPrompt: looking for the submit button");
	const button = findGenerateButton();
	if (!button) throw new Error("PAGE_NOT_READY: Could not find the submit button.");
	qvfLog("runPrompt: clicking Send, entering waitForResult()");
	button.click();

	return waitForResult();
}

// Listen for commands from the side panel (relayed via background.js).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.target !== "content") return;

	if (message.type === "PING") {
		// composerReady lets background.js's post-reload wait confirm the page
		// has actually mounted the prompt input, rather than guessing with a
		// fixed delay after the page's load event. loginFormReady does the same
		// for switchAccountAndWait()'s wait on the login page appearing.
		//
		// toolbarReady checks for the mode-select trigger specifically, not just
		// the textarea — confirmed live that the textarea alone is too weak a
		// signal: a React hydration crash on chat.qwen.ai's own page (see the
		// PAGE_NOT_READY comment in enableVideoMode() above) can leave a
		// textarea sitting inertly in the DOM while the rest of the composer
		// toolbar around it never mounts. reloadTabAndWait() in background.js
		// now waits for both before letting the queue proceed, closing the
		// window where the very first RUN_PROMPT of a batch fires at a page
		// that looks ready but isn't actually interactive yet.
		sendResponse({
			ok: true,
			videoModeOn: isVideoModeOn(),
			composerReady: !!findPromptInput(),
			toolbarReady: !!document.querySelector('[aria-label="Select Mode"]'),
			loginFormReady: isLoginFormPresent(),
			dailyLimitReached: !!findDailyLimitMessage(),
			adBlockerActive,
		});
		return;
	}

	if (message.type === "REFRESH_AD_BLOCKER") {
		// On-demand recheck for the panel's "Re-check now" button — PING alone
		// only reads the cached adBlockerActive value (refreshed every 20s by
		// refreshAdBlockerStatus() above), which would otherwise leave the
		// button waiting up to 20s to reflect a blocker the user just disabled.
		refreshAdBlockerStatus().then(() => sendResponse({ ok: true, adBlockerActive }));
		return true; // async response
	}

	if (message.type === "RUN_PROMPT") {
		runPrompt(message.payload.text)
			.then((result) => sendResponse({ ok: true, ...result }))
			.catch((err) => sendResponse({ ok: false, error: err.message }));
		return true; // async response
	}

	if (message.type === "PERFORM_LOGOUT") {
		performLogout()
			.then(() => sendResponse({ ok: true }))
			.catch((err) => sendResponse({ ok: false, error: err.message }));
		return true; // async response
	}

	if (message.type === "PERFORM_LOGIN") {
		performLogin(message.payload.email, message.payload.password)
			.then(() => sendResponse({ ok: true }))
			.catch((err) => sendResponse({ ok: false, error: err.message }));
		return true; // async response
	}
});
