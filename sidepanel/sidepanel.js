// Qwen Video Factory — side panel logic
//
// Owns the queue state and drives it forward one prompt at a time, sending
// each prompt to the content script via background.js and waiting for the
// result before moving on. Only lines tagged [video] are actually submitted
// — everything else loads into the queue as "skipped" so a mixed prompt
// file doesn't need to be split by hand first.
//
// Deliberately does NOT retry a different account when chat.qwen.ai reports
// its daily limit reached — the queue stops cleanly instead, reporting how
// much got done and how much is left, for the user to resume once their
// quota resets. See README.md for why.

const promptsEl = document.getElementById("prompts");
const promptFileEl = document.getElementById("prompt-file");
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
const VIDEO_TAG_PATTERN = /^\s*\[video\]\s*/i;

let queue = []; // [{ text, tagged, status }]
let currentIndex = -1;
let running = false;
let paused = false;
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
	skipped: "Skipped",
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
		const dot = document.createElement("span");
		dot.className = `status-dot ${item.status}`;
		const text = document.createElement("span");
		text.className = "item-text";
		text.textContent = item.text;
		li.appendChild(dot);
		li.appendChild(text);

		const badge = document.createElement("span");
		badge.className = `status-badge ${item.status}`;
		badge.textContent = STATUS_LABELS[item.status] || item.status;
		li.appendChild(badge);
		queueListEl.appendChild(li);
	});
	const taggedItems = queue.filter((q) => q.tagged);
	const done = taggedItems.filter((q) => q.status === "done").length;
	queueProgressEl.textContent = `${done} / ${taggedItems.length}`;
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
				if (!response || !response.ok) {
					setStatus(
						`Download failed: ${(response && response.error) || "no response from background"}`,
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
			resolve(
				response || { ok: false, error: "No response — is a chat.qwen.ai tab open?" },
			);
		});
	});
}

function refreshQwenTab() {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{ target: "background", type: "REFRESH_QWEN_TAB" },
			(response) => {
				resolve(response || { ok: false, error: "No response from background script." });
			},
		);
	});
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

	const taggedCount = queue.filter((q) => q.tagged).length;
	let submittedCount = 0;

	for (let i = 0; i < queue.length; i++) {
		if (!running) break;
		while (paused || focusPaused) {
			await sleep(300);
			if (!running) break;
		}
		if (!running) break;

		if (!queue[i].tagged || queue[i].status === "done") continue; // untagged, or already completed in a prior run

		currentIndex = i;
		queue[i].status = "running";
		renderQueue();
		setStatus(`Running ${submittedCount + 1} of ${taggedCount}...`, "running");

		const result = await sendToContent("RUN_PROMPT", { text: queue[i].text });

		if (result.ok && result.dailyLimitReached) {
			queue[i].status = "limit";
			renderQueue();
			setStatus(
				`Daily limit reached — ${submittedCount} of ${taggedCount} submitted. Resume once your quota resets.`,
				"error",
			);
			break;
		}

		queue[i].status = result.ok ? "done" : "error";
		renderQueue();

		if (!result.ok) {
			setStatus(`Prompt ${i + 1} failed: ${result.error}`, "error");
		} else {
			submittedCount++;
			if (autoDownloadEl.checked) await downloadResult(result.result, i);
		}

		// No point counting down a delay after the last tagged prompt, or if
		// every remaining tagged item is already done.
		const hasMoreWork = queue
			.slice(i + 1)
			.some((item) => item.tagged && item.status !== "done");
		if (running && hasMoreWork) {
			await delayWithCountdown();
		}
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
	// If the current queue still has unfinished tagged items (stopped
	// partway through, hit the daily limit, or a prompt errored out), resume
	// it in place rather than rebuilding from the textarea and losing track
	// of what's already done. Only load a fresh queue from the textarea once
	// everything tagged in the current one is done (or there's no queue yet).
	const hasUnfinishedWork =
		queue.length > 0 && queue.some((item) => item.tagged && item.status !== "done");

	if (hasUnfinishedWork) {
		queue.forEach((item) => {
			if (item.tagged && item.status !== "done") item.status = "pending";
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

		queue = lines.map((line) => {
			const tagged = VIDEO_TAG_PATTERN.test(line);
			const text = line.replace(VIDEO_TAG_PATTERN, "");
			return { text, tagged, status: tagged ? "pending" : "skipped" };
		});

		if (queue.every((item) => !item.tagged)) {
			setStatus("No [video]-tagged prompts found in the list.", "error");
			renderQueue();
			return;
		}
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
