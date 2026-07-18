// Qwen Video Factory — main-world bridge (runs on chat.qwen.ai)
//
// Placeholder bridge, mirroring Overflow's content-scripts/flow-main-world.js.
// Content scripts run in an "isolated world" by default, which does NOT see
// expando properties (e.g. React's __reactFiber$<hash>) that the page's own
// main-world scripts attach to DOM nodes — this only matters if
// content-scripts/qwen.js's setPromptText() (native setter + 'input' event)
// is confirmed live to NOT be enough, i.e. the composer is a
// framework-controlled rich-text editor rather than a plain textarea/input.
//
// Left unused (no postMessage listener wired up) until that's confirmed one
// way or the other against the real chat.qwen.ai page — see qwen.js's
// setPromptText() and README.md.

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// TODO: if the plain native-setter approach in qwen.js's setPromptText()
// isn't enough, add a window.addEventListener("message", ...) handler here
// that receives a { source: "qwenvideofactory-isolated", type:
// "SET_PROMPT_TEXT", requestId, text } message, drives the framework's own
// state update, and replies via window.postMessage with { source:
// "qwenvideofactory-main-world", requestId, ok, error }. See Overflow's
// flow-main-world.js for the full pattern (including the superseded-request
// guard needed once qwen.js's timeout can outlive this loop).
