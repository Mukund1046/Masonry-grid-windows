const fs = require("fs");
const path = require("path");
const os = require("os");

const projectRoot = __dirname;
const envPath = path.join(projectRoot, ".env");

loadEnvFile(envPath);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function firstDefined(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "");
}

function resolvePath(value, fallback) {
  return path.resolve(projectRoot, firstDefined(value, fallback));
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Missing ${name}. Set it in your environment or .env file before running this script.`
    );
  }
  return value.trim();
}

function getDataDir() {
  return firstDefined(
    process.env.FT_DATA_DIR,
    path.join(os.homedir(), ".ft-bookmarks")
  );
}

function getJsonlPath() {
  const explicitPath = firstDefined(process.env.X_BOOKMARKS_JSONL);
  if (explicitPath) {
    return resolvePath(explicitPath);
  }

  const ftPath = path.resolve(getDataDir(), "bookmarks.jsonl");
  if (fs.existsSync(ftPath)) {
    return ftPath;
  }

  return path.resolve(projectRoot, "bookmarks", "bookmarks.jsonl");
}

function getOutputDir() {
  return resolvePath(process.env.X_OUTPUT_DIR, projectRoot);
}

function getBookmarksOutputPath() {
  return resolvePath(
    process.env.X_BOOKMARKS_OUTPUT,
    path.join(getOutputDir(), "bookmarks-data.json")
  );
}

function getFoldersOutputPath() {
  return resolvePath(
    process.env.X_FOLDERS_OUTPUT,
    path.join(getOutputDir(), "folders-data.json")
  );
}

module.exports = {
  envPath,
  getRequiredEnv,
  getJsonlPath,
  getOutputDir,
  getBookmarksOutputPath,
  getFoldersOutputPath,
};
