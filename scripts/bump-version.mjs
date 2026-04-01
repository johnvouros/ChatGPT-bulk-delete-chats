#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const changelogPath = path.join(root, "CHANGELOG.md");
const input = process.argv[2];

if (!input) {
  printUsage();
  process.exit(1);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const currentVersion = manifest.version;
const nextVersion = resolveNextVersion(currentVersion, input);

if (nextVersion === currentVersion) {
  console.log(`Version already at ${currentVersion}`);
  process.exit(0);
}

manifest.version = nextVersion;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await ensureChangelogEntry(nextVersion);

console.log(`Bumped version: ${currentVersion} -> ${nextVersion}`);
console.log("Next steps:");
console.log("  1. Add release notes under the new changelog heading");
console.log("  2. Rebuild Chrome/Firefox ZIPs");
console.log("  3. Submit the updated package to the stores");

function resolveNextVersion(current, inputValue) {
  if (/^\d+\.\d+\.\d+$/.test(inputValue)) return inputValue;

  const [major, minor, patch] = current.split(".").map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    throw new Error(`Current manifest version is not semantic: ${current}`);
  }

  if (inputValue === "patch") return `${major}.${minor}.${patch + 1}`;
  if (inputValue === "minor") return `${major}.${minor + 1}.0`;
  if (inputValue === "major") return `${major + 1}.0.0`;

  throw new Error(`Unsupported version target: ${inputValue}`);
}

async function ensureChangelogEntry(version) {
  const today = new Date().toISOString().slice(0, 10);
  const heading = `## [${version}] - ${today}`;
  const changelog = await fs.readFile(changelogPath, "utf8");
  if (changelog.includes(heading)) return;

  const updated = changelog.replace(
    "## [1.0.0] - 2026-03-30",
    `${heading}\n\n- TODO: add release notes\n\n## [1.0.0] - 2026-03-30`
  );

  await fs.writeFile(changelogPath, updated);
}

function printUsage() {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>");
}
