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
const tabButtons = document.querySelectorAll(".tab-button");
const controlsViewEl = document.getElementById("controls-view");
const aboutViewEl = document.getElementById("about-view");
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
function updateAccountStatusUI() {
	if (accounts.length === 0) {
		accountStatusEl.textContent = "No accounts loaded — daily limit will stop the queue.";
		return;
	}
	const active = activeAccount ? activeAccount.email : "none active";
	const counts = accounts.reduce((acc, a) => {
		acc[a.status] = (acc[a.status] || 0) + 1;
		return acc;
	}, {});
	const breakdown = Object.entries(counts)
		.map(([status, count]) => `${count} ${status}`)
		.join(", ");
	accountStatusEl.textContent = `${accounts.length} account${accounts.length === 1 ? "" : "s"} loaded — current: ${active} (${breakdown}).`;
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

tabButtons.forEach((button) => {
	button.addEventListener("click", () => {
		tabButtons.forEach((b) => b.classList.toggle("active", b === button));
		const showAbout = button.dataset.tab === "about";
		controlsViewEl.hidden = showAbout;
		aboutViewEl.hidden = !showAbout;
	});
});

aboutVersionEl.textContent = chrome.runtime.getManifest().version;

aboutWebsiteLinkEl.addEventListener("click", () => {
	chrome.tabs.create({ url: AUTHOR_WEBSITE_URL });
});

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildExhaustionSummary(submittedCount, total) {
	return accounts.length
		? `All ${accounts.length} loaded accounts exhausted or failed to log in — ${submittedCount} of ${total} prompts completed.`
		: `Daily limit reached — ${submittedCount} of ${total} submitted. Resume once your quota resets, or load an accounts file to rotate automatically.`;
}

/**
 * Full-panel modal that blocks every control underneath it — not just a
 * status message — for the one state where automation genuinely cannot
 * proceed: not on chat.qwen.ai at all.
 */
function showBlockingOverlay(message) {
	blockingTitleEl.textContent = "Not on chat.qwen.ai";
	blockingMessageEl.textContent =
		message || "Qwen Video Factory only works when you're on chat.qwen.ai.";
	blockingActionEl.onclick = () => chrome.tabs.create({ url: QWEN_TOOL_URL });
	blockingOverlayEl.hidden = false;
}

function hideBlockingOverlay() {
	blockingOverlayEl.hidden = true;
}

/**
 * Poll for a live, ready chat.qwen.ai tab so the status bar (and the
 * blocking overlay) reflect reality instead of a static placeholder. Skipped
 * while a queue is running so it doesn't clobber the in-progress status
 * text — the overlay would otherwise physically prevent the running queue's
 * own Pause/Stop controls from being clicked.
 */
async function checkQwenTab() {
	if (running) return;
	const ping = await sendToContent("PING");
	if (!ping.ok) {
		setStatus(ping.error || "No chat.qwen.ai tab found.", "error");
		showBlockingOverlay(ping.error);
		return;
	}
	setStatus("chat.qwen.ai detected — ready to start.", "idle");
	hideBlockingOverlay();
}

// Best-effort refresh once when the panel first opens, so automation always
// starts from a clean page load rather than a tab that's been sitting open
// accumulating state. Silent on failure — checkQwenTab()'s own polling
// (below) already surfaces that clearly via the blocking overlay.
refreshQwenTab();

checkQwenTab();
setInterval(checkQwenTab, 3000);

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

		const result = await sendToContent("RUN_PROMPT", { text: queue[i].text });

		// A single RUN_PROMPT can take up to waitForResult()'s 180s timeout to
		// resolve, and Stop only flips `running` — it doesn't (can't) cancel the
		// in-flight content-script call. If Stop was clicked while this was
		// pending, `running` is false by the time we get here; if Clear was
		// also clicked (Stop leaves it enabled), `queue` itself has been
		// reassigned to a new, empty array, so `queue[i]` below would be
		// undefined. Bail out before touching it either way, rather than
		// crashing on `queue[i].status = ...`.
		if (!running) break;

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

		queue[i].status = result.ok ? "done" : "error";
		queue[i].error = result.ok ? null : result.error;
		renderQueue();

		if (!result.ok) {
			setStatus(`Prompt ${i + 1} failed: ${result.error}`, "error");
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
// should carry over batch to batch, not per-batch inputs.
function resetToStartingState() {
	promptsEl.value = "";
	queue = [];
	currentIndex = -1;
	renderQueue();
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
		const lines = promptsEl.value
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);

		if (lines.length === 0) {
			setStatus("Add at least one prompt first.", "error");
			return;
		}

		queue = lines.map((line) => ({ text: line, status: "pending" }));
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
