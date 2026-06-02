const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "src/main.js",
  "src/preload.js",
  "src/store.js",
  "src/renderer/index.html",
  "src/renderer/src/main.tsx",
  "src/renderer/src/App.tsx",
  "src/renderer/src/styles.css",
  "dist/renderer/index.html"
];

for (const file of requiredFiles) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const jsFiles = ["src/main.js", "src/preload.js", "src/store.js"];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log("Build check passed.");
