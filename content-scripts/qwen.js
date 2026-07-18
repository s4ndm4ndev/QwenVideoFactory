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

/**
 * Find the prompt composer on the page.
 * TODO: confirm the real selector via live inspection. Placeholder guesses
 * a plain textarea with a placeholder mentioning "message" or "prompt" —
 * verify and replace with something stable (data-testid, aria-label, etc).
 */
function findPromptInput() {
	return document.querySelector("textarea");
}

/**
 * Find the submit button next to the prompt composer.
 * TODO: confirm the real selector via live inspection.
 */
function findGenerateButton() {
	const input = findPromptInput();
	if (!input) return null;
	let container = input.parentElement;
	while (container) {
		const button = container.querySelector('button[type="submit"]');
		if (button) return button;
		container = container.parentElement;
	}
	return null;
}

/**
 * Set the composer's text via the native value setter + a real 'input'
 * event, so a framework tracking the input's state (React, Vue, etc.) picks
 * up the change. This is the simpler case; if live inspection shows the
 * composer is a rich-text editor like Flow's Slate instance, this needs to
 * be replaced with a postMessage relay to qwen-main-world.js instead (see
 * that file's header comment, and Overflow's flow.js/flow-main-world.js for
 * the pattern to copy).
 */
function setPromptText(text) {
	const input = findPromptInput();
	if (!input) throw new Error("Could not find the prompt input on the page.");

	const nativeSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;
	nativeSetter.call(input, text);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Whether chat.qwen.ai's video-generation mode/tool is currently selected.
 * TODO: confirm the real DOM signal via live inspection — this gates the
 * "only submit prompts tagged [video]" feature (see runPrompt() and the
 * queue-tagging logic in sidepanel/sidepanel.js): a prompt tagged for video
 * generation should only be submitted once this is actually on.
 */
function isVideoModeOn() {
	return true;
}

/**
 * Look for chat.qwen.ai's own "daily limit reached" message on the page.
 * TODO: confirm the actual error text/selector via live inspection — this
 * is the signal the queue uses to stop gracefully instead of erroring
 * prompt-by-prompt (see RUN_PROMPT below and runQueue() in sidepanel.js).
 */
function findDailyLimitMessage() {
	const text = document.body.innerText || "";
	if (/daily limit/i.test(text)) return text.match(/[^.\n]*daily limit[^.\n]*/i)[0];
	return null;
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
 * Watch for a finished video result appearing on the page.
 * TODO: confirm the real completion signal via live inspection — likely a
 * <video> tag gaining a real `src`, or a download/share control appearing
 * next to the generated result. Placeholder polls for any <video> element
 * with a populated src that wasn't there when generation started.
 */
function waitForResult(timeoutMs = 180000) {
	const alreadyPresent = new Set(
		Array.from(document.querySelectorAll("video")).map((v) => v.currentSrc || v.src),
	);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			observer.disconnect();
			reject(new Error("Timed out waiting for the video to finish generating."));
		}, timeoutMs);

		const observer = new MutationObserver(() => {
			const video = Array.from(document.querySelectorAll("video")).find((v) => {
				const src = v.currentSrc || v.src;
				return src && !alreadyPresent.has(src);
			});
			if (video) {
				clearTimeout(timeout);
				observer.disconnect();
				resolve(extractResult(video));
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		});
	});
}

/**
 * Pull the downloadable URL out of a finished video element.
 * TODO: confirm live whether this is a same-origin URL fetchable directly by
 * chrome.downloads.download() (as Overflow found for Flow), or a page-scoped
 * blob: URL that would need fetching here and relaying as a data: URL
 * instead.
 */
function extractResult(videoEl) {
	return {
		url: videoEl.currentSrc || videoEl.src,
		mediaType: "video",
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single prompt end-to-end: fill in the text, submit, wait for
 * result. Checks for the daily-limit message before and after submitting so
 * the queue can stop cleanly rather than treating a limit hit as a generic
 * per-prompt error.
 */
async function runPrompt(text) {
	const preExisting = findDailyLimitMessage();
	if (preExisting) {
		return { dailyLimitReached: true, message: preExisting };
	}

	const input = findPromptInput();
	if (!input) throw new Error("Could not find the prompt input on the page.");
	if (!isVideoModeOn()) {
		throw new Error("Video generation mode isn't selected on the page.");
	}

	setPromptText(text);

	// Short randomized pause before submitting, as if someone typed the
	// prompt and glanced over it, rather than submitting the instant the
	// field is filled (same rationale as Overflow's flow.js).
	await sleep(400 + Math.random() * 900);

	const button = findGenerateButton();
	if (!button) throw new Error("Could not find the submit button.");
	button.click();

	const limitAfterSubmit = await waitFor(findDailyLimitMessage, 5000, 500);
	if (limitAfterSubmit) {
		return { dailyLimitReached: true, message: limitAfterSubmit };
	}

	const result = await waitForResult();
	return { dailyLimitReached: false, result };
}

// Listen for commands from the side panel (relayed via background.js).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.target !== "content") return;

	if (message.type === "PING") {
		// composerReady lets background.js's post-reload wait confirm the page
		// has actually mounted the prompt input, rather than guessing with a
		// fixed delay after the page's load event.
		sendResponse({
			ok: true,
			videoModeOn: isVideoModeOn(),
			composerReady: !!findPromptInput(),
			dailyLimitReached: !!findDailyLimitMessage(),
		});
		return;
	}

	if (message.type === "RUN_PROMPT") {
		runPrompt(message.payload.text)
			.then((result) => sendResponse({ ok: true, ...result }))
			.catch((err) => sendResponse({ ok: false, error: err.message }));
		return true; // async response
	}
});
