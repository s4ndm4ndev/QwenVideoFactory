#!/usr/bin/env node
// Zips up exactly the files Chrome needs to load the extension (manifest.json
// plus the runtime code/assets it references) into a Chrome-Web-Store-ready
// archive. Deliberately excludes repo-only files (README, CHANGELOG, docs/,
// scripts/, .git, etc.) that the store package doesn't need.
//
// Usage: node scripts/package.js
// Output: <repo root>/qwen-video-factory-<version>.zip (gitignored via *.zip)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const INCLUDE = ["manifest.json", "background.js", "content-scripts", "sidepanel", "icons"];

const outName = `qwen-video-factory-${manifest.version}.zip`;
const outPath = path.join(root, outName);

if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

if (process.platform === "win32") {
	const psPaths = INCLUDE.map((p) => `"${path.join(root, p)}"`).join(",");
	execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Compress-Archive -Path ${psPaths} -DestinationPath "${outPath}" -CompressionLevel Optimal`,
		],
		{ stdio: "inherit" },
	);
} else {
	execFileSync("zip", ["-r", outPath, ...INCLUDE], { cwd: root, stdio: "inherit" });
}

console.log(`Packaged ${outName} (${INCLUDE.join(", ")})`);
