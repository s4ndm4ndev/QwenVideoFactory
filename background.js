// Qwen Video Factory — background service worker
//
// Responsibilities:
//  1. Make the toolbar icon open the side panel (instead of a popup).
//  2. Relay messages between the side panel UI and the content script
//     running on chat.qwen.ai, since they can't talk to each other directly.
//  3. Own the actual download call for completed videos, so filenames land
//     the way the panel asks for (see onDeterminingFilename below).

chrome.runtime.onInstalled.addListener(() => {
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// FIFO queue of { folder, baseIndex } for downloads WE just started via
// DOWNLOAD_RESULT below, consumed by onDeterminingFilename. A queue (not a
// downloadId-keyed map) is used because the side panel's download() callback
// hands back a downloadId, but nothing guarantees that callback fires before
// onDeterminingFilename does for the same download — pushing onto this queue
// synchronously, right before calling chrome.downloads.download(), sidesteps
// that ordering question entirely. Safe because the queue only ever
// processes one of our own downloads at a time.
const pendingDownloadNames = [];

const MIME_EXT = {
	"video/mp4": "mp4",
	"video/webm": "webm",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/**
 * Pick a file extension for a completed download. Prefer the real
 * Content-Type Chrome detected (downloadItem.mime) over guessing ahead of
 * time — confirm what chat.qwen.ai actually serves generated videos as
 * before assuming mp4.
 */
function extensionFromDownloadItem(item) {
	if (item.mime && MIME_EXT[item.mime]) return MIME_EXT[item.mime];
	const match = /\.([a-z0-9]{2,4})$/i.exec(item.filename || "");
	if (match) return match[1].toLowerCase();
	return "mp4";
}

/**
 * The authoritative place to control a download's destination filename.
 * Passing `filename` directly to chrome.downloads.download() is not
 * authoritative — Chrome can silently fall back to a name derived from the
 * download's own URL instead (confirmed in Overflow, this extension's sister
 * project, against Google Flow's download API). onDeterminingFilename always
 * wins, so it's used here instead too.
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
	const pending = pendingDownloadNames.shift();
	if (!pending) {
		suggest();
		return;
	}
	const ext = extensionFromDownloadItem(item);
	const name = `${pending.baseIndex}.${ext}`;
	suggest({
		filename: pending.folder ? `${pending.folder}/${name}` : name,
		conflictAction: "uniquify",
	});
});

// Simple message relay.
// Side panel sends: { target: "content", type: "...", payload: {...} }
// Content script sends: { target: "panel", type: "...", payload: {...} }
//
// There's no persistent connection to the side panel, so status updates from
// the content script get broadcast via chrome.runtime.sendMessage and the
// side panel listens for them directly. This relay mainly exists for panel
// -> content script commands, which need a specific tab ID.

const QWEN_ORIGIN_PATTERN = /^https:\/\/chat\.qwen\.ai\//;

/**
 * Resolve the active tab of the focused window to a usable chat.qwen.ai tab,
 * or a specific reason it isn't one.
 */
function findActiveQwenTab() {
	return new Promise((resolve) => {
		chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
			const tab = tabs[0];
			const url = (tab && tab.url) || "";
			if (!QWEN_ORIGIN_PATTERN.test(url)) {
				resolve({
					tab: null,
					error: "chat.qwen.ai tab is not active. Switch to it to continue.",
				});
				return;
			}
			resolve({ tab, error: null });
		});
	});
}

/**
 * Reload a tab and wait for it to actually be usable, rather than just
 * firing chrome.tabs.reload() and guessing. "complete" (the tab's load
 * event) only means the network/resources finished — a heavy SPA can take
 * noticeably longer than that to actually mount its chat composer. Polls the
 * (freshly re-injected) content script's own composerReady signal after
 * "complete" fires, instead of trusting a fixed delay.
 */
function reloadTabAndWait(tabId, timeoutMs = 30000) {
	return new Promise((resolve, reject) => {
		let done = false;
		const start = Date.now();

		const timeout = setTimeout(() => {
			if (done) return;
			done = true;
			chrome.tabs.onUpdated.removeListener(listener);
			reject(
				new Error("Timed out waiting for the chat.qwen.ai tab to finish reloading."),
			);
		}, timeoutMs);

		function pollComposerReady() {
			if (done) return;
			chrome.tabs.sendMessage(
				tabId,
				{ target: "content", type: "PING" },
				(response) => {
					void chrome.runtime.lastError; // content script not injected yet right after reload — expected, ignore
					if (done) return;
					if (response && response.ok && response.composerReady) {
						done = true;
						clearTimeout(timeout);
						resolve();
						return;
					}
					if (Date.now() - start > timeoutMs) {
						done = true;
						clearTimeout(timeout);
						reject(
							new Error("chat.qwen.ai took too long to become ready after reloading."),
						);
						return;
					}
					setTimeout(pollComposerReady, 300);
				},
			);
		}

		function listener(updatedTabId, changeInfo) {
			if (updatedTabId !== tabId || changeInfo.status !== "complete" || done)
				return;
			chrome.tabs.onUpdated.removeListener(listener);
			pollComposerReady();
		}

		chrome.tabs.onUpdated.addListener(listener);
		chrome.tabs.reload(tabId);
	});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.target === "background" && message.type === "DOWNLOAD_RESULT") {
		const { url, folder, baseIndex } = message.payload;
		if (!url) {
			sendResponse({ ok: false, error: "No result URL." });
			return;
		}
		const entry = { folder, baseIndex };
		pendingDownloadNames.push(entry);
		chrome.downloads.download({ url, saveAs: false }, (downloadId) => {
			if (chrome.runtime.lastError || downloadId === undefined) {
				// This download never actually started, so it will never reach
				// onDeterminingFilename to consume its queued entry — drop it now,
				// or it would get wrongly applied to some later, unrelated download.
				const idx = pendingDownloadNames.indexOf(entry);
				if (idx !== -1) pendingDownloadNames.splice(idx, 1);
				sendResponse({
					ok: false,
					error:
						(chrome.runtime.lastError && chrome.runtime.lastError.message) ||
						"Download failed to start.",
				});
				return;
			}
			sendResponse({ ok: true, downloadId });
		});
		return true; // async response
	}

	if (message.target === "background" && message.type === "REFRESH_QWEN_TAB") {
		findActiveQwenTab().then(({ tab, error }) => {
			if (!tab) {
				sendResponse({ ok: false, error });
				return;
			}
			reloadTabAndWait(tab.id)
				.then(() => sendResponse({ ok: true }))
				.catch((err) => sendResponse({ ok: false, error: err.message }));
		});
		return true; // async response
	}

	if (message.target === "content") {
		// Forward the command only to the currently active tab in the focused
		// window, and only if that tab is actually chat.qwen.ai. A qwen tab
		// sitting open in the background shouldn't count as "detected" —
		// otherwise the panel reports readiness when there's nowhere for the
		// content script to actually run.
		findActiveQwenTab().then(({ tab, error }) => {
			if (!tab) {
				sendResponse({ ok: false, error });
				return;
			}
			chrome.tabs.sendMessage(tab.id, message, (response) => {
				sendResponse(response);
			});
		});
		return true; // keep the message channel open for the async response
	}

	// Messages from content script (target: "panel") are just broadcast as-is;
	// the side panel's own onMessage listener picks them up. Nothing to do here.
});

/**
 * Notify the side panel whenever chat.qwen.ai's "visible, active tab" status
 * changes, so the panel can auto-pause the queue while it's away — Chrome
 * throttles timers in tabs that aren't the active tab of a window, and a
 * long-running queue left generating against a throttled background tab can
 * silently stall or misbehave. Only broadcasts on actual transitions (not
 * every check) so the panel isn't spammed on every unrelated tab switch.
 */
let lastReportedQwenFocused = null;

function checkAndBroadcastFocusState() {
	findActiveQwenTab().then(({ tab }) => {
		const focused = !!tab;
		if (focused === lastReportedQwenFocused) return;
		lastReportedQwenFocused = focused;
		// No callback here means this returns a Promise in MV3, which rejects
		// with "Could not establish connection. Receiving end does not exist."
		// whenever the side panel isn't open to receive it — an expected case
		// (panel closed), not a real failure, so the rejection is swallowed
		// rather than surfacing as an uncaught error.
		chrome.runtime
			.sendMessage({
				target: "panel",
				type: "QWEN_FOCUS_CHANGED",
				payload: { focused },
			})
			.catch(() => {});
	});
}

chrome.tabs.onActivated.addListener(() => {
	checkAndBroadcastFocusState();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
	// WINDOW_ID_NONE means focus left every Chrome window entirely (switched
	// to another app, or Chrome was minimized) — lastFocusedWindow-based
	// queries wouldn't reliably reflect that (it keeps remembering the last
	// Chrome window that had focus), so treat it as unfocused directly rather
	// than re-querying.
	if (windowId === chrome.windows.WINDOW_ID_NONE) {
		if (lastReportedQwenFocused !== false) {
			lastReportedQwenFocused = false;
			chrome.runtime
				.sendMessage({
					target: "panel",
					type: "QWEN_FOCUS_CHANGED",
					payload: { focused: false },
				})
				.catch(() => {});
		}
		return;
	}
	checkAndBroadcastFocusState();
});
