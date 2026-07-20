// Qwen Video Factory — side panel logic
//
// Owns the queue state and drives it forward one prompt at a time, sending
// each prompt to the content script via background.js and waiting for the
// result before moving on. Every non-blank line in the prompts textarea is
// submitted, in order.

const promptsEl = document.getElementById("prompts");
const promptFileEl = document.getElementById("prompt-file");
const accountFileEl = document.getElementById("account-file");
const accountStatusEl = document.getElementById("account-status");
const delayMinEl = document.getElementById("delay-min");
const delayMaxEl = document.getElementById("delay-max");
const autoDownloadEl = document.getElementById("auto-download");
const downloadSettingsHintEl = document.getElementById("download-settings-hint");
const openDownloadSettingsBtn = document.getElementById("open-download-settings");
const downloadFolderEl = document.getElementById("download-folder");
const referenceImagesToggleEl = document.getElementById("reference-images-toggle");
const referenceImagesPanelEl = document.getElementById("reference-images-panel");
const referenceImagesDropzoneEl = document.getElementById("reference-images-dropzone");
const referenceImagesFileInputEl = document.getElementById("reference-images-file-input");
const referenceImagesListEl = document.getElementById("reference-images-list");
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const clearBtn = document.getElementById("clear");
const queueListEl = document.getElementById("queue-list");
const queueProgressEl = document.getElementById("queue-progress");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const blockingOverlayEl = document.getElementById("blocking-overlay");
const blockingTitleEl = document.getElementById("blocking-title");
const blockingMessageEl = document.getElementById("blocking-message");
const blockingActionEl = document.getElementById("blocking-action");
const confirmOverlayEl = document.getElementById("confirm-overlay");
const confirmTitleEl = document.getElementById("confirm-title");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmYesBtn = document.getElementById("confirm-yes");
const confirmNoBtn = document.getElementById("confirm-no");
const tabButtons = document.querySelectorAll(".tab-button");
const controlsViewEl = document.getElementById("controls-view");
const aboutViewEl = document.getElementById("about-view");
const logViewEl = document.getElementById("log-view");
const logListEl = document.getElementById("log-list");
const copyLogBtn = document.getElementById("copy-log");
const clearLogBtn = document.getElementById("clear-log");
const aboutVersionEl = document.getElementById("about-version");
const aboutWebsiteLinkEl = document.getElementById("about-website-link");
const downloadLocationNoticeEl = document.getElementById("download-location-notice");
const dismissDownloadNoticeBtn = document.getElementById("dismiss-download-notice");

const QWEN_TOOL_URL = "https://chat.qwen.ai/";
const AUTHOR_WEBSITE_URL = "https://s4ndm4n.dev/";

let queue = []; // [{ text, status }]
let currentIndex = -1;
let running = false;
let paused = false;

// Accounts loaded from the accounts file, kept in memory only — never
// written to chrome.storage.local — so plaintext passwords never touch
// disk. Re-upload the file after closing the panel, same as the prompt
// queue itself losing progress on close.
let accounts = []; // [{ email, password, status }] status: unused | active | exhausted | failed
let activeAccount = null;
let switchAttempts = 0; // bounds total account switches to accounts.length
// Auto-pause driven by background.js's QWEN_FOCUS_CHANGED, distinct from the
// user-controlled `paused` flag above so a manual pause isn't silently
// cleared by regaining focus, and so a focus-driven pause doesn't flip the
// Pause/Resume button's own state. The wait loops in delayWithCountdown()
// and runQueue() block on either flag.
let focusPaused = false;

// Content-script qvfLog() steps, mirrored here via the QVF_LOG broadcast
// (see the onMessage listener below). In memory only, same convention as
// the queue/accounts above — cleared on panel close, capped so a long
// batch can't grow it unbounded.
let logEntries = []; // [{ step, ts }]
const MAX_LOG_ENTRIES = 500;

// Reference images, paired to prompt lines purely by array position (image
// at index i pairs with the queue item built from prompt line i). In-memory
// only, same convention as queue/accounts above — cleared on panel close and
// after a successful batch (see resetToStartingState()), never written to
// chrome.storage.local. Only the *enabled* toggle itself is a persisted
// preference (see SETTINGS_KEY below), not this list.
let referenceImages = []; // [{ dataUrl, fileName, mimeType }]

// Guards checkLoginState() from firing more than once per relevant trigger
// point (panel load, each accounts-file load) — it's a one-shot check, not
// tied to checkBlockingState()'s 3s poll, so nothing else needs to reset
// this once a login prompt has been shown or skipped for a given trigger.
let loginCheckInFlight = false;

// Set for the duration of onLoginConfirmed()'s background-driven navigation
// (chat.qwen.ai gets navigated to /auth and back before `running` is ever
// set true by the queue that follows). checkBlockingState()'s independent
// 3s poll doesn't know that navigation is expected, and a tick landing mid-
// navigation reads a transiently-unreachable content script as "not on
// chat.qwen.ai," showing the blocking overlay — which then never gets
// cleared once the queue's own auto-start flips `running` true right after,
// since checkBlockingState() no-ops entirely while running. Confirmed live:
// this is exactly what left the panel stuck showing a stale "Not on
// chat.qwen.ai" / CONNECTION_LOST overlay on top of an actually-running
// queue. checkBlockingState() also skips while this is true, closing the
// race at its source.
let accountFlowInProgress = false;

const SETTINGS_KEY = "qwen_video_factory_settings";
const DOWNLOAD_NOTICE_KEY = "qwen_video_factory_download_notice_dismissed";

function loadSettings() {
	return new Promise((resolve) => {
		chrome.storage.local.get(SETTINGS_KEY, (result) =>
			resolve(result[SETTINGS_KEY] || {}),
		);
	});
}

function saveSettings(partial) {
	loadSettings().then((current) => {
		chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...partial } });
	});
}

// Show the "where do my downloads go" notice exactly once, the first time
// the panel is ever opened — not tied to the auto-download toggle (that has
// its own conditional hint below, for the "ask where to save" edge case).
chrome.storage.local.get(DOWNLOAD_NOTICE_KEY, (result) => {
	if (!result[DOWNLOAD_NOTICE_KEY]) downloadLocationNoticeEl.hidden = false;
});

dismissDownloadNoticeBtn.addEventListener("click", () => {
	downloadLocationNoticeEl.hidden = true;
	chrome.storage.local.set({ [DOWNLOAD_NOTICE_KEY]: true });
});

loadSettings().then((settings) => {
	if (settings.delayMin != null) delayMinEl.value = settings.delayMin;
	if (settings.delayMax != null) delayMaxEl.value = settings.delayMax;
	if (settings.autoDownload != null) {
		autoDownloadEl.checked = settings.autoDownload;
		downloadSettingsHintEl.hidden = !settings.autoDownload;
		downloadFolderEl.disabled = !settings.autoDownload;
	}
	if (settings.downloadFolder != null) downloadFolderEl.value = settings.downloadFolder;
	if (settings.referenceImagesEnabled != null) {
		referenceImagesToggleEl.checked = settings.referenceImagesEnabled;
		referenceImagesPanelEl.hidden = !settings.referenceImagesEnabled;
	}
});

delayMinEl.addEventListener("change", () => saveSettings({ delayMin: delayMinEl.value }));
delayMaxEl.addEventListener("change", () => saveSettings({ delayMax: delayMaxEl.value }));
downloadFolderEl.addEventListener("change", () =>
	saveSettings({ downloadFolder: downloadFolderEl.value }),
);

function setStatus(text, mode = "idle") {
	statusText.textContent = text;
	statusDot.className = `dot ${mode}`;
}

const STATUS_LABELS = {
	pending: "Pending",
	running: "Generating…",
	done: "Done ✓",
	error: "Error",
	limit: "Limit reached",
};

function updateClearButton() {
	clearBtn.disabled = running || queue.length === 0;
}

function renderQueue() {
	queueListEl.innerHTML = "";
	queue.forEach((item) => {
		const li = document.createElement("li");
		if (item.status === "running") li.classList.add("active");

		const row = document.createElement("div");
		row.className = "item-row";
		const dot = document.createElement("span");
		dot.className = `status-dot ${item.status}`;
		const text = document.createElement("span");
		text.className = "item-text";
		text.textContent = item.text;
		row.appendChild(dot);
		row.appendChild(text);

		// Lets the user visually confirm image-to-prompt pairing before
		// starting a batch — item.referenceImage is set at queue-build time
		// (see buildQueueFromPrompts()) from referenceImages[i] when the
		// toggle is on, so this reflects the exact pairing that will actually
		// be sent to the content script.
		if (item.referenceImage) {
			const thumb = document.createElement("img");
			thumb.className = "item-thumb-img";
			thumb.src = item.referenceImage.dataUrl;
			thumb.title = item.referenceImage.fileName;
			row.appendChild(thumb);
		}

		const badge = document.createElement("span");
		badge.className = `status-badge ${item.status}`;
		badge.textContent = STATUS_LABELS[item.status] || item.status;
		row.appendChild(badge);
		li.appendChild(row);

		// Shown as a persistent second line rather than only in the transient
		// status bar text, which the next queue event (the inter-prompt
		// countdown, the next item starting, ...) overwrites within seconds —
		// too easy to miss when diagnosing why a specific item failed.
		if ((item.status === "error" || item.status === "limit") && item.error) {
			const errorLine = document.createElement("div");
			errorLine.className = "item-error";
			errorLine.textContent = item.error;
			li.appendChild(errorLine);
		}

		queueListEl.appendChild(li);
	});
	const done = queue.filter((q) => q.status === "done").length;
	queueProgressEl.textContent = `${done} / ${queue.length}`;
	updateClearButton();
}

/**
 * Strip characters that are invalid in Windows/Unix file paths so a
 * user-supplied folder name is safe to pass into chrome.downloads.download().
 */
function sanitizeFolderName(name) {
	return name
		.trim()
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
		.replace(/^\.+/, "")
		.replace(/-+$/, "")
		.slice(0, 60);
}

promptFileEl.addEventListener("change", () => {
	const file = promptFileEl.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = () => {
		promptsEl.value = String(reader.result).replace(/\r\n/g, "\n");
	};
	reader.readAsText(file);
	promptFileEl.value = ""; // allow re-selecting the same file later
});

/**
 * Parse an accounts file into a list of { email, password, status }.
 * Blocks are separated by a blank line, each with a "User name:" and a
 * "Password:" line (see README.md for the exact format).
 */
function parseAccountsFile(text) {
	return text
		.replace(/\r\n/g, "\n")
		.split(/\n\s*\n/)
		.map((block) => {
			const email = /^User name:\s*(.+)$/im.exec(block);
			const password = /^Password:\s*(.+)$/im.exec(block);
			return email && password
				? { email: email[1].trim(), password: password[1].trim(), status: "unused" }
				: null;
		})
		.filter(Boolean);
}

/**
 * Includes a per-status breakdown (not just "current: X"), so it's possible
 * to tell, after a batch stops on "Limit reached", whether that's because
 * every loaded account has now been used and exhausted (nothing left to
 * rotate to — expected, not a bug) versus something failing partway through
 * a switch — rather than only showing "current: <email>" and leaving that
 * question to guesswork.
 */
function accountStatusBreakdown() {
	const counts = accounts.reduce((acc, a) => {
		acc[a.status] = (acc[a.status] || 0) + 1;
		return acc;
	}, {});
	return Object.entries(counts)
		.map(([status, count]) => `${count} ${status}`)
		.join(", ");
}

function updateAccountStatusUI() {
	if (accounts.length === 0) {
		accountStatusEl.textContent = "No accounts loaded — daily limit will stop the queue.";
		return;
	}
	const active = activeAccount ? activeAccount.email : "none active";
	accountStatusEl.textContent = `${accounts.length} account${accounts.length === 1 ? "" : "s"} loaded — current: ${active} (${accountStatusBreakdown()}).`;
}

accountFileEl.addEventListener("change", () => {
	const file = accountFileEl.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = () => {
		accounts = parseAccountsFile(String(reader.result));
		// Not assumed to be accounts[0]: whatever account is actually logged
		// into the chat.qwen.ai tab right now isn't necessarily the first (or
		// any) entry in this file — the extension never checks who's really
		// logged in. Leaving activeAccount null (and every loaded account
		// "unused") means the first daily-limit hit correctly rotates to
		// accounts[0], instead of tryRotateToNextAccount() treating an
		// unrelated already-logged-in account as if it were accounts[0] and
		// skipping straight to accounts[1].
		activeAccount = null;
		switchAttempts = 0;
		updateAccountStatusUI();
		checkLoginState();
	};
	reader.readAsText(file);
	accountFileEl.value = ""; // allow re-selecting the same file later
});

/**
 * Ask the background service worker to download a completed result, named
 * "{index}.{ext}" (zero-padded, e.g. "001.mp4") inside the optional
 * user-supplied subfolder. No-ops if there's no result URL.
 *
 * There's no extension API to read Chrome's "Ask where to save each file"
 * setting, and if it's on, Chrome shows a native Save-As dialog per download
 * regardless of the saveAs:false passed here — that would otherwise stall
 * the entire queue indefinitely on the first download. Give it a window to
 * complete normally, then move on rather than hang forever.
 */
function downloadResult(resultData, index) {
	return new Promise((resolve) => {
		if (!resultData || !resultData.url) {
			resolve();
			return;
		}

		const baseIndex = String(index + 1).padStart(3, "0");
		const folder = sanitizeFolderName(downloadFolderEl.value);

		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			resolve();
		};

		const timeout = setTimeout(() => {
			setStatus(
				'Download is waiting on a Save dialog — check for it, or disable "Ask where to save each file" in Chrome\'s downloads settings.',
				"error",
			);
			settle();
		}, 8000);

		chrome.runtime.sendMessage(
			{
				target: "background",
				type: "DOWNLOAD_RESULT",
				payload: { url: resultData.url, folder, baseIndex },
			},
			(response) => {
				clearTimeout(timeout);
				const lastError = chrome.runtime.lastError;
				if (!response || !response.ok) {
					setStatus(
						`Download failed: ${(response && response.error) || (lastError && lastError.message) || "no response from background"}`,
						"error",
					);
				}
				settle();
			},
		);
	});
}

autoDownloadEl.addEventListener("change", () => {
	downloadSettingsHintEl.hidden = !autoDownloadEl.checked;
	downloadFolderEl.disabled = !autoDownloadEl.checked;
	saveSettings({ autoDownload: autoDownloadEl.checked });
});

openDownloadSettingsBtn.addEventListener("click", () => {
	chrome.tabs.create({ url: "chrome://settings/downloads" });
});

referenceImagesToggleEl.addEventListener("change", () => {
	referenceImagesPanelEl.hidden = !referenceImagesToggleEl.checked;
	saveSettings({ referenceImagesEnabled: referenceImagesToggleEl.checked });
});

function blobToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error || new Error("Failed to read an image."));
		reader.readAsDataURL(file);
	});
}

/**
 * Append newly uploaded images to referenceImages in upload order — numbering
 * is purely positional (index in this array), not derived from the
 * filenames, so a batch of any filenames pairs with prompt lines 1, 2, 3...
 * in the order they were added.
 */
async function addReferenceImageFiles(fileList) {
	const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
	for (const file of files) {
		referenceImages.push({
			dataUrl: await blobToDataUrl(file),
			fileName: file.name,
			mimeType: file.type,
		});
	}
	if (files.length > 0) renderReferenceImagesList();
}

/**
 * Removing an image shifts every later image's number down by one — correct
 * here since pairing is purely positional (array index), unlike Overflow's
 * name-matched character library where removal doesn't renumber anything.
 */
function removeReferenceImage(index) {
	referenceImages.splice(index, 1);
	renderReferenceImagesList();
}

function renderReferenceImagesList() {
	referenceImagesListEl.innerHTML = "";
	referenceImages.forEach((image, index) => {
		const li = document.createElement("li");

		const thumb = document.createElement("img");
		thumb.className = "image-thumb";
		thumb.src = image.dataUrl;
		thumb.alt = image.fileName;

		// Same zero-padded convention as downloadResult()'s baseIndex, so image
		// "001" lines up with the same indexing as this batch's own result
		// filenames (queue index 0 -> "001").
		const badge = document.createElement("span");
		badge.className = "image-number-badge";
		badge.textContent = String(index + 1).padStart(3, "0");

		const name = document.createElement("span");
		name.className = "image-file-name";
		name.textContent = image.fileName;

		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "image-remove";
		removeBtn.textContent = "×";
		removeBtn.title = `Remove ${image.fileName}`;
		removeBtn.addEventListener("click", () => removeReferenceImage(index));

		li.appendChild(thumb);
		li.appendChild(badge);
		li.appendChild(name);
		li.appendChild(removeBtn);
		referenceImagesListEl.appendChild(li);
	});
}

referenceImagesDropzoneEl.addEventListener("click", () => referenceImagesFileInputEl.click());

referenceImagesDropzoneEl.addEventListener("dragover", (e) => {
	e.preventDefault();
	referenceImagesDropzoneEl.classList.add("dragover");
});

referenceImagesDropzoneEl.addEventListener("dragleave", () => {
	referenceImagesDropzoneEl.classList.remove("dragover");
});

referenceImagesDropzoneEl.addEventListener("drop", (e) => {
	e.preventDefault();
	referenceImagesDropzoneEl.classList.remove("dragover");
	addReferenceImageFiles(e.dataTransfer.files);
});

referenceImagesFileInputEl.addEventListener("change", () => {
	addReferenceImageFiles(referenceImagesFileInputEl.files);
	referenceImagesFileInputEl.value = ""; // allow re-selecting the same file later
});

const tabViews = { controls: controlsViewEl, about: aboutViewEl, log: logViewEl };

tabButtons.forEach((button) => {
	button.addEventListener("click", () => {
		tabButtons.forEach((b) => b.classList.toggle("active", b === button));
		for (const [name, el] of Object.entries(tabViews)) el.hidden = name !== button.dataset.tab;
	});
});

aboutVersionEl.textContent = chrome.runtime.getManifest().version;

aboutWebsiteLinkEl.addEventListener("click", () => {
	chrome.tabs.create({ url: AUTHOR_WEBSITE_URL });
});

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race a promise against a hard timeout, resolving to `onTimeout` if the
 * timer wins. Exists specifically to bound RUN_PROMPT below: normally a dead
 * content-script connection surfaces via chrome.runtime.lastError (tagged
 * CONNECTION_LOST: in background.js), but real testing showed a case where
 * neither that nor any of the tagged PAGE_NOT_READY errors ever fired —
 * status text never updated, the item just sat on "Generating" with no
 * further feedback at all. The likely cause is chat.qwen.ai itself doing a
 * real navigation (not just a React remount) as part of its own crash
 * recovery, landing in a Chrome-messaging edge case where the sendMessage
 * callback this extension depends on for every other failure signal never
 * fires. Rather than chase that specific edge case blind, this makes the
 * queue unable to hang indefinitely regardless of the exact cause.
 */
function withTimeout(promise, timeoutMs, onTimeout) {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(onTimeout);
		}, timeoutMs);
		promise.then((value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		});
	});
}

function sendToContent(type, payload) {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage({ target: "content", type, payload }, (response) => {
			const lastError = chrome.runtime.lastError;
			resolve(
				response || {
					ok: false,
					error: (lastError && lastError.message) || "No response — is a chat.qwen.ai tab open?",
				},
			);
		});
	});
}

function refreshQwenTab() {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{ target: "background", type: "REFRESH_QWEN_TAB" },
			(response) => {
				const lastError = chrome.runtime.lastError;
				resolve(
					response || {
						ok: false,
						error: (lastError && lastError.message) || "No response from background script.",
					},
				);
			},
		);
	});
}

function switchAccount(account) {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{
				target: "background",
				type: "SWITCH_ACCOUNT",
				payload: { email: account.email, password: account.password },
			},
			(response) => {
				const lastError = chrome.runtime.lastError;
				resolve(
					response || {
						ok: false,
						error: (lastError && lastError.message) || "No response from background script.",
					},
				);
			},
		);
	});
}

/**
 * Log into a chat.qwen.ai tab that isn't logged in at all yet — distinct from
 * switchAccount() above, which assumes an already-logged-in session to log
 * out of first (see background.js's LOGIN_ACCOUNT vs SWITCH_ACCOUNT
 * handlers).
 */
function loginAccount(account) {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{
				target: "background",
				type: "LOGIN_ACCOUNT",
				payload: { email: account.email, password: account.password },
			},
			(response) => {
				const lastError = chrome.runtime.lastError;
				resolve(
					response || {
						ok: false,
						error: (lastError && lastError.message) || "No response from background script.",
					},
				);
			},
		);
	});
}

/**
 * Log the exhausted account out of rotation and log the next unused one in,
 * via background.js's SWITCH_ACCOUNT orchestration. Bounded by
 * switchAttempts so a run of bad credentials can't loop forever — each
 * account gets at most one attempt per queue run.
 */
async function tryRotateToNextAccount(submittedCount) {
	// Marked exhausted unconditionally, before checking whether there's
	// anywhere left to rotate to — this function only ever gets called
	// because the current account just hit its real daily limit, so that's
	// true regardless of whether a next account exists. Previously this only
	// ran in the branch below (after confirming a next account was found),
	// so the account actually in use when the queue finally ran out of
	// accounts stayed mislabeled "active" forever — reading as a switch that
	// silently failed rather than what it actually was: correctly running out
	// of loaded accounts.
	if (activeAccount) activeAccount.status = "exhausted";

	const next = accounts.find((a) => a.status === "unused");
	if (!next || switchAttempts >= accounts.length) {
		updateAccountStatusUI(); // reflect the final exhausted/failed breakdown, not a stale earlier one
		return { ok: false, finalMessage: buildExhaustionSummary(submittedCount, queue.length) };
	}
	switchAttempts++;
	updateAccountStatusUI();
	setStatus(
		`Daily limit reached${activeAccount ? ` on ${activeAccount.email}` : ""} — switching to ${next.email}...`,
		"running",
	);
	const result = await switchAccount(next);
	if (!result.ok) {
		next.status = "failed";
		updateAccountStatusUI();
		return tryRotateToNextAccount(submittedCount);
	}
	next.status = "active";
	activeAccount = next;
	updateAccountStatusUI();
	return { ok: true };
}

// Includes the same per-status breakdown as updateAccountStatusUI() directly
// in the summary text — this is what ends up as the persistent per-item error
// line (see runQueue()), so it needs to answer "genuinely out of quota" vs
// "a login/switch attempt itself failed" (a nonzero "failed" count) on its
// own, without the user having to separately notice the account-status line
// above the queue.
function buildExhaustionSummary(submittedCount, total) {
	return accounts.length
		? `All loaded accounts exhausted or failed to log in (${accountStatusBreakdown()}) — ${submittedCount} of ${total} prompts completed.`
		: `Daily limit reached — ${submittedCount} of ${total} submitted. Resume once your quota resets, or load an accounts file to rotate automatically.`;
}

/**
 * Full-panel modal that blocks every control underneath it — not just a
 * status message — for states where automation genuinely cannot proceed:
 * not on chat.qwen.ai, or an ad blocker is active on that page (see
 * checkBlockingState() below). `options.title`/`actionLabel`/`onAction`
 * default to the not-on-chat.qwen.ai case.
 */
function showBlockingOverlay(message, options = {}) {
	blockingTitleEl.textContent = options.title || "Not on chat.qwen.ai";
	blockingMessageEl.textContent =
		message || "Qwen Video Factory only works when you're on chat.qwen.ai.";
	blockingActionEl.textContent = options.actionLabel || "Navigate to chat.qwen.ai";
	blockingActionEl.onclick =
		options.onAction || (() => chrome.tabs.create({ url: QWEN_TOOL_URL }));
	blockingOverlayEl.hidden = false;
}

function hideBlockingOverlay() {
	blockingOverlayEl.hidden = true;
}

/**
 * Small yes/no modal, visually consistent with #blocking-overlay (reuses
 * .blocking-card) but a distinct element — #blocking-overlay's documented
 * semantics are "automation cannot proceed at all," which doesn't fit a
 * dismissible question like "log in now?", and only ever has one action
 * button. onYes/onNo are wired directly to the buttons rather than
 * auto-hiding on click, so onYes can show a busy state (e.g. "Logging
 * in...") before the caller itself calls hideConfirmModal().
 */
function showConfirmModal({ title, message, yesLabel, noLabel, onYes, onNo }) {
	confirmTitleEl.textContent = title;
	confirmMessageEl.textContent = message;
	confirmYesBtn.textContent = yesLabel || "Yes";
	confirmNoBtn.textContent = noLabel || "No";
	confirmYesBtn.disabled = false;
	confirmNoBtn.disabled = false;
	confirmYesBtn.onclick = onYes;
	confirmNoBtn.onclick = onNo;
	confirmOverlayEl.hidden = false;
}

function hideConfirmModal() {
	confirmOverlayEl.hidden = true;
}

function showAdBlockerOverlay() {
	showBlockingOverlay(
		"An ad blocker was detected. Disable it for this site, then re-check.",
		{
			title: "Ad blocker detected",
			actionLabel: "Re-check now",
			onAction: () => checkBlockingState({ forceAdBlockerRefresh: true }),
		},
	);
}

/**
 * Poll for a live, ready chat.qwen.ai tab — and for an active ad blocker on
 * that same page — so the status bar (and the blocking overlay) reflect
 * reality instead of a static placeholder. Skipped while a queue is running
 * so it doesn't clobber the in-progress status text — the overlay would
 * otherwise physically prevent the running queue's own Pause/Stop controls
 * from being clicked. This is deliberately an idle-time gate only: it stops
 * a new batch from starting, but never interrupts one already running.
 *
 * The ad-blocker signal comes from the content script's PING response
 * (`adBlockerActive`, computed in content-scripts/qwen.js) rather than
 * anything checked here. Two earlier approaches didn't pan out: a bait
 * element in this side panel's own chrome-extension:// page never got seen
 * by a real ad blocker at all (Chrome doesn't let one extension's content
 * scripts run inside another extension's UI pages); a cosmetic bait element
 * moved onto chat.qwen.ai's own page was confirmed live, via DevTools with
 * AdGuard enabled, to not get hidden either — modern blockers increasingly
 * leave well-known honeypot elements alone to defeat anti-adblock scripts.
 * The content script now checks via an actual network request instead (see
 * its refreshAdBlockerStatus()), which blockers can't suppress without also
 * not blocking ads. That check only runs every 20s on its own, so PING
 * alone would leave the "Re-check now" button waiting up to 20s to reflect
 * a blocker the user just disabled — `forceAdBlockerRefresh` sends a
 * REFRESH_AD_BLOCKER message first to force an immediate on-demand check.
 */
async function checkBlockingState({ forceAdBlockerRefresh = false } = {}) {
	if (running || accountFlowInProgress) return;

	if (forceAdBlockerRefresh) await sendToContent("REFRESH_AD_BLOCKER");

	const ping = await sendToContent("PING");
	if (!ping.ok) {
		setStatus(ping.error || "No chat.qwen.ai tab found.", "error");
		showBlockingOverlay(ping.error);
		return;
	}
	if (ping.adBlockerActive) {
		setStatus("Ad blocker detected on chat.qwen.ai — disable it to continue.", "error");
		showAdBlockerOverlay();
		return;
	}
	setStatus("chat.qwen.ai detected — ready to start.", "idle");
	hideBlockingOverlay();
}

/**
 * Runs when the user clicks "Yes, log in" on the login-on-load confirm
 * modal. Logs accounts[0] in from scratch (see loginAccount() vs
 * switchAccount()'s comment), and — if the prompts textarea already has
 * content — rolls straight into the queue, same as clicking Start.
 */
async function onLoginConfirmed() {
	confirmYesBtn.disabled = true;
	confirmNoBtn.disabled = true;
	confirmMessageEl.textContent = "Logging in...";

	// See accountFlowInProgress's declaration comment — this blocks
	// checkBlockingState()'s independent 3s poll from misreading the
	// background-driven /auth navigation below as "not on chat.qwen.ai."
	accountFlowInProgress = true;
	let result;
	try {
		result = await loginAccount(accounts[0]);
	} finally {
		accountFlowInProgress = false;
	}

	if (!result.ok) {
		hideConfirmModal();
		setStatus(`Login failed: ${result.error}`, "error");
		return;
	}

	accounts[0].status = "active";
	activeAccount = accounts[0];
	updateAccountStatusUI();
	hideConfirmModal();

	const built = buildQueueFromPrompts();
	if (built) {
		queue = built;
		renderQueue();
		runQueue();
	} else {
		setStatus("Logged in — add prompts and start the queue when ready.", "idle");
	}
}

/**
 * One-shot login-on-load check — deliberately NOT tied to checkBlockingState()'s
 * 3s poll, since it should only ask once per relevant trigger point (panel
 * load, and each time an accounts file is (re)loaded — see the two call sites
 * below), not repeatedly while the panel sits idle. No-ops if there's nothing
 * to offer logging in with yet (accounts are in-memory only and reset to
 * empty on every panel reload, per the comment above their declaration), or
 * while a queue is already running, or if the tab isn't reachable / has an ad
 * blocker (checkBlockingState()'s own polling already owns surfacing those).
 */
async function checkLoginState() {
	if (accounts.length === 0 || running || loginCheckInFlight || accountFlowInProgress) return;
	loginCheckInFlight = true;
	try {
		const ping = await sendToContent("PING");
		if (!ping.ok || ping.adBlockerActive) return;
		if (ping.loggedIn) return;

		showConfirmModal({
			title: "Not logged in",
			message: `You're not logged into chat.qwen.ai. Log in with ${accounts[0].email} now?`,
			yesLabel: "Yes, log in",
			noLabel: "No, continue",
			onYes: onLoginConfirmed,
			onNo: hideConfirmModal,
		});
	} finally {
		loginCheckInFlight = false;
	}
}

// Best-effort refresh once when the panel first opens, so automation always
// starts from a clean page load rather than a tab that's been sitting open
// accumulating state. Silent on failure — checkBlockingState()'s own
// polling (below) already surfaces that clearly via the blocking overlay.
refreshQwenTab();

checkBlockingState();
setInterval(checkBlockingState, 3000);
checkLoginState();

/**
 * Wait the configured (randomized) delay before the next prompt, ticking the
 * status text down every second so the pause is actually visible instead of
 * looking like nothing is happening between prompts.
 */
async function delayWithCountdown() {
	let minSec = Number(delayMinEl.value) || 1;
	let maxSec = Number(delayMaxEl.value) || minSec;
	if (minSec > maxSec) [minSec, maxSec] = [maxSec, minSec]; // swap rather than error

	const delaySec = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;

	for (let remaining = delaySec; remaining > 0; remaining--) {
		if (!running) break;
		while (paused || focusPaused) {
			await sleep(300);
			if (!running) break;
		}
		if (!running) break;
		setStatus(`Next prompt in ${remaining}s...`, "idle");
		await sleep(1000);
	}
}

/**
 * Wait out a rate-limit hit before retrying the same item, ticking a visible
 * countdown the same way delayWithCountdown() does. Deliberately longer than
 * the normal inter-prompt delay and escalating per attempt (45s, 75s, 105s,
 * ..., capped at 4 minutes) — this fires only after chat.qwen.ai has already
 * said "too many requests," so the normal 8–20s pacing clearly wasn't enough
 * for whatever's currently happening (heavy same-session testing, a shared
 * IP, etc.), and retrying too eagerly risks tripping the same limit again
 * immediately.
 */
async function rateLimitCooldown(attempt) {
	const totalSec = Math.min(45 + (attempt - 1) * 30 + Math.floor(Math.random() * 20), 240);

	for (let remaining = totalSec; remaining > 0; remaining--) {
		if (!running) break;
		while (paused || focusPaused) {
			await sleep(300);
			if (!running) break;
		}
		if (!running) break;
		setStatus(
			`Rate limited by chat.qwen.ai — cooling down, retrying in ${remaining}s (attempt ${attempt})...`,
			"error",
		);
		await sleep(1000);
	}
}

async function runQueue() {
	running = true;
	paused = false;
	// tryRotateToNextAccount()'s own comment says each account gets "at most
	// one attempt per queue run," but switchAttempts was only ever reset on
	// re-uploading the accounts file — never here — so across many Start/Stop
	// cycles in the same panel session (exactly today's testing pattern) it
	// kept accumulating, capable of blocking a rotation to a genuinely
	// `"unused"` account just because an earlier, unrelated run had already
	// used up the budget. Reset per run to match the stated intent; each
	// account's own status (exhausted/failed/active/unused) is untouched by
	// this and still correctly blocks rotating to an account that's actually
	// out of accounts, not just out of attempts.
	switchAttempts = 0;
	startBtn.disabled = true;
	pauseBtn.disabled = false;
	stopBtn.disabled = false;
	updateClearButton();

	setStatus("Refreshing chat.qwen.ai tab...", "running");
	const refresh = await refreshQwenTab();
	if (!refresh.ok) {
		setStatus(refresh.error || "No chat.qwen.ai tab found.", "error");
		resetControls();
		return;
	}

	const ping = await sendToContent("PING");
	if (!ping.ok) {
		setStatus(ping.error || "No chat.qwen.ai tab found.", "error");
		resetControls();
		return;
	}

	// Defense in depth alongside accountFlowInProgress above: this PING just
	// reconfirmed the content script is genuinely reachable, so any blocking
	// overlay still showing at this point is stale (e.g. from a
	// checkBlockingState() tick that landed mid-navigation before `running`
	// was set, or any other transient timing race) — clear it now that a
	// real, successful connection has just been made.
	hideBlockingOverlay();

	let submittedCount = 0;

	for (let i = 0; i < queue.length; ) {
		if (!running) break;
		while (paused || focusPaused) {
			await sleep(300);
			if (!running) break;
		}
		if (!running) break;

		if (queue[i].status === "done") {
			i++;
			continue; // already completed in a prior run
		}

		currentIndex = i;
		queue[i].status = "running";
		renderQueue();
		setStatus(`Running ${submittedCount + 1} of ${queue.length}...`, "running");

		// Bounded well above the legitimate worst case (settle delay +
		// attachReferenceImage's up to ~90s upload wait (confirmed live: a real
		// image upload can genuinely take ~45s, see that function's header
		// comment) + enableVideoMode's up-to-two attempts at ~60s each + typing
		// + waitForResult()'s own 180s ≈ 6.8 minutes) so a real, still-in-progress
		// generation is never mistaken for a hang — see withTimeout()'s comment
		// for why this exists at all. Widened from 6 to 8 minutes when the
		// reference-image upload wait was added, since that alone eats most of
		// the previous budget's slack.
		const result = await withTimeout(
			sendToContent("RUN_PROMPT", { text: queue[i].text, image: queue[i].referenceImage || null }),
			480000,
			{
				ok: false,
				error:
					"CONNECTION_LOST: No response from chat.qwen.ai after 8 minutes — the page likely became unresponsive or silently reloaded.",
			},
		);

		// A single RUN_PROMPT can take up to waitForResult()'s 180s timeout to
		// resolve, and Stop only flips `running` — it doesn't (can't) cancel the
		// in-flight content-script call. If Stop was clicked while this was
		// pending, `running` is false by the time we get here; if Clear was
		// also clicked (Stop leaves it enabled), `queue` itself has been
		// reassigned to a new, empty array, so `queue[i]` below would be
		// undefined. Bail out before touching it either way, rather than
		// crashing on `queue[i].status = ...`.
		if (!running) break;

		// See background.js's content-relay comment: a dead message port during
		// a RUN_PROMPT can only be caused by something external navigating the
		// tab away mid-request (in practice, the user manually reloading
		// chat.qwen.ai while a prompt was still generating) — never by this
		// extension's own code. There's no way to know from here whether that
		// in-flight generation actually finished, so this must not be treated
		// like a normal per-prompt failure and silently advanced past — doing
		// so was the actual cause of the queue appearing to not wait for a
		// video that was still generating. Pause instead, without advancing i,
		// so the user can check the tab and Resume to retry the same item.
		if (!result.ok && /^CONNECTION_LOST:/.test(result.error || "")) {
			queue[i].status = "pending";
			queue[i].error = null;
			renderQueue();
			paused = true;
			pauseBtn.textContent = "Resume";
			setStatus(
				"Lost connection to chat.qwen.ai mid-prompt — the tab was likely reloaded or navigated away while this item was still generating. Queue paused so it doesn't race ahead. Check the tab, then press Resume to retry this item.",
				"error",
			);
			continue; // don't advance i
		}

		// See enableVideoMode()'s PAGE_NOT_READY comment in
		// content-scripts/qwen.js — the mode-select trigger never mounting at
		// all is the strongest available signal that the page hit a React
		// hydration crash and is genuinely stuck, not just slow. Nothing was
		// ever submitted in this failure mode (it fails before Send is
		// clicked), so a fresh reload-and-retry is safe, unlike the
		// CONNECTION_LOST case above. Bounded so a page that's persistently
		// broken still surfaces as a real error instead of retrying forever.
		if (!result.ok && /^PAGE_NOT_READY:/.test(result.error || "")) {
			const attempts = (queue[i].pageNotReadyRetries || 0) + 1;
			queue[i].pageNotReadyRetries = attempts;
			if (attempts <= 2) {
				const reason = (result.error || "").replace(/^PAGE_NOT_READY:\s*/, "");
				setStatus(
					`chat.qwen.ai wasn't ready (${reason}) — reloading and retrying (attempt ${attempts})...`,
					"running",
				);
				const refresh = await refreshQwenTab();
				if (!running) break;
				if (refresh.ok) {
					queue[i].status = "pending";
					renderQueue();
					continue; // don't advance i
				}
				// Refresh itself failed (e.g. no chat.qwen.ai tab at all anymore) —
				// fall through to the normal error path below rather than retrying
				// against a tab that isn't there.
			}
		}

		if (result.ok && result.dailyLimitReached) {
			const switched = await tryRotateToNextAccount(submittedCount);
			if (switched.ok) {
				queue[i].status = "pending"; // never actually accepted — retry it on the new account
				renderQueue();
				continue; // don't advance i
			}
			queue[i].status = "limit";
			queue[i].error = switched.finalMessage;
			renderQueue();
			setStatus(switched.finalMessage, "error");
			break;
		}

		// Confirmed live: chat.qwen.ai's own rate limiter ("Too many requests in
		// a short period") is a distinct, short-lived condition from the daily
		// usage limit above — the prompt was never actually accepted, so nothing
		// downstream would ever appear, and without this check runPrompt() used
		// to just sit blind for the full 180s waitForResult() timeout watching
		// for a video that was never coming. Same account, no rotation needed —
		// just wait out the rate window and retry the same item. Escalating
		// cooldown, bounded retries: if a real account/IP is genuinely being
		// rate-limited, every other item would hit the same wall immediately
		// after this one, so this stops the whole queue rather than continuing
		// to hammer the server item by item.
		if (result.ok && result.rateLimited) {
			const attempts = (queue[i].rateLimitRetries || 0) + 1;
			queue[i].rateLimitRetries = attempts;
			if (attempts <= 5) {
				queue[i].status = "pending";
				queue[i].error = null;
				renderQueue();
				await rateLimitCooldown(attempts);
				if (!running) break;
				continue; // don't advance i
			}
			queue[i].status = "error";
			queue[i].error = `Still rate-limited by chat.qwen.ai after ${attempts - 1} retries — stopping rather than keep hammering it: ${result.message}`;
			renderQueue();
			setStatus(queue[i].error, "error");
			break;
		}

		// Only reached for PAGE_NOT_READY here if its retry budget above was
		// exhausted (or the retry reload itself failed) — strip the internal
		// tag prefix, it's not meaningful to the user at this point.
		const displayError = result.ok ? null : (result.error || "").replace(/^PAGE_NOT_READY:\s*/, "");
		queue[i].status = result.ok ? "done" : "error";
		queue[i].error = displayError;
		renderQueue();

		if (!result.ok) {
			setStatus(`Prompt ${i + 1} failed: ${displayError}`, "error");
		} else {
			submittedCount++;
			if (autoDownloadEl.checked) await downloadResult(result.result, i);
		}

		// No point counting down a delay after the last prompt, or if every
		// remaining item is already done.
		const hasMoreWork = queue.slice(i + 1).some((item) => item.status !== "done");
		if (running && hasMoreWork) {
			await delayWithCountdown();
		}
		i++;
	}

	if (running) {
		// Ran to natural completion (as opposed to being stopped, or stopped by
		// a daily-limit hit) — clear the queue so the next "Start queue" click
		// loads a fresh batch from the textarea instead of silently re-running
		// the same one.
		const hadErrors = queue.some((item) => item.status === "error");
		const hitLimit = queue.some((item) => item.status === "limit");
		if (!hitLimit) {
			queue = [];
			renderQueue();
			if (hadErrors) {
				setStatus("Queue complete — some prompts failed. Review and try again.", "error");
			} else {
				resetToStartingState();
				setStatus("Batch complete. Ready for the next batch.", "idle");
			}
		}
	}
	resetControls();
}

function resetControls() {
	running = false;
	paused = false;
	focusPaused = false;
	startBtn.disabled = false;
	pauseBtn.disabled = true;
	stopBtn.disabled = true;
	updateClearButton();
	pauseBtn.textContent = "Pause";
}

// Clears the prompts textarea and queue/index back to a fresh-panel state
// after a fully successful batch. Deliberately leaves Auto Download (toggle,
// folder) and the delay fields alone — those are per-user preferences that
// should carry over batch to batch, not per-batch inputs. Reference images
// clear the same way prompts do — they're per-batch data, positionally paired
// to prompt lines that no longer exist after this — but the Reference Images
// toggle itself is left on, same treatment as Auto Download, since it's a
// preference rather than per-batch data.
function resetToStartingState() {
	promptsEl.value = "";
	queue = [];
	currentIndex = -1;
	renderQueue();
	referenceImages = [];
	renderReferenceImagesList();
}

/**
 * Auto-pause/resume the queue as the chat.qwen.ai tab gains or loses
 * "visible, active tab" status, per background.js's QWEN_FOCUS_CHANGED
 * broadcast. Separate from the user's own Pause button (`paused`) so the two
 * don't fight: if the user manually paused before switching away, regaining
 * focus clears `focusPaused` but the manual `paused` flag still holds the
 * queue.
 */
chrome.runtime.onMessage.addListener((message) => {
	if (message.target !== "panel" || message.type !== "QWEN_FOCUS_CHANGED") return;
	if (!running) {
		focusPaused = false;
		return;
	}
	const wasFocusPaused = focusPaused;
	focusPaused = !message.payload.focused;
	if (focusPaused && !wasFocusPaused) {
		setStatus(
			"Paused — chat.qwen.ai tab isn't focused (avoiding background-tab throttling). Switch back to resume.",
			"idle",
		);
	} else if (!focusPaused && wasFocusPaused && !paused) {
		setStatus("chat.qwen.ai tab focused again — resuming...", "running");
	}
});

/**
 * Append one qvfLog() step (broadcast from content-scripts/qwen.js) to the
 * Log tab. Kept purely additive/in-memory — see logEntries above.
 */
function appendLogEntry(step, ts) {
	logEntries.push({ step, ts });
	if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();

	const li = document.createElement("li");
	const time = document.createElement("span");
	time.className = "log-ts";
	time.textContent = new Date(ts).toLocaleTimeString();
	li.appendChild(time);
	li.appendChild(document.createTextNode(step));
	logListEl.appendChild(li);
	while (logListEl.children.length > MAX_LOG_ENTRIES) logListEl.removeChild(logListEl.firstChild);
	logListEl.scrollTop = logListEl.scrollHeight;
}

chrome.runtime.onMessage.addListener((message) => {
	if (message.target !== "panel" || message.type !== "QVF_LOG") return;
	appendLogEntry(message.payload.step, message.payload.ts);
});

clearLogBtn.addEventListener("click", () => {
	logEntries = [];
	logListEl.replaceChildren();
});

copyLogBtn.addEventListener("click", () => {
	const text = logEntries
		.map((e) => `[${new Date(e.ts).toISOString()}] ${e.step}`)
		.join("\n");
	navigator.clipboard.writeText(text).catch(() => {});
});

/**
 * Split the prompts textarea into a fresh queue, one item per non-blank
 * line. Pairs in a reference image per item (by array position) when the
 * toggle is on — reused both by startBtn's click handler below and by
 * onLoginConfirmed()'s auto-start path after a successful login-on-load.
 * Returns null if there are no prompts to run.
 */
function buildQueueFromPrompts() {
	const lines = promptsEl.value
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	if (lines.length === 0) return null;

	return lines.map((line, i) => {
		const item = { text: line, status: "pending" };
		if (referenceImagesToggleEl.checked) {
			const img = referenceImages[i];
			item.referenceImage = img
				? { dataUrl: img.dataUrl, fileName: img.fileName, mimeType: img.mimeType }
				: null;
		}
		return item;
	});
}

startBtn.addEventListener("click", () => {
	// If the current queue still has unfinished items (stopped partway
	// through, hit the daily limit, or a prompt errored out), resume it in
	// place rather than rebuilding from the textarea and losing track of
	// what's already done. Only load a fresh queue from the textarea once
	// everything in the current one is done (or there's no queue yet).
	const hasUnfinishedWork = queue.length > 0 && queue.some((item) => item.status !== "done");

	if (hasUnfinishedWork) {
		queue.forEach((item) => {
			if (item.status !== "done") item.status = "pending";
		});
	} else {
		const built = buildQueueFromPrompts();
		if (!built) {
			setStatus("Add at least one prompt first.", "error");
			return;
		}
		queue = built;
	}

	renderQueue();
	runQueue();
});

pauseBtn.addEventListener("click", () => {
	paused = !paused;
	pauseBtn.textContent = paused ? "Resume" : "Pause";
	setStatus(paused ? "Paused." : "Resuming...", paused ? "idle" : "running");
});

stopBtn.addEventListener("click", () => {
	running = false;
	setStatus("Stopped.", "idle");
	resetControls();
});

clearBtn.addEventListener("click", () => {
	queue = [];
	renderQueue();
	setStatus("Queue cleared.", "idle");
});
