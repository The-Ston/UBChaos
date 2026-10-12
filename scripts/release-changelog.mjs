// Adds a release section with one "Fixed" entry right after [Unreleased] in
// CHANGELOG.md, leaving [Unreleased] as it is. Used by the item groups bot.
// Usage: node scripts/release-changelog.mjs <X.Y.Z> <YYYY-MM-DD> "<entry>" [changelog path]
import { readFileSync, writeFileSync } from "node:fs";

const [version, date, entry, path = "CHANGELOG.md"] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !entry) {
  throw new Error('Usage: release-changelog.mjs <X.Y.Z> <YYYY-MM-DD> "<entry>" [changelog path]');
}

const changelog = readFileSync(path, "utf8");
const unreleased = changelog.indexOf("## [Unreleased]");
if (unreleased < 0) throw new Error(`No [Unreleased] section in ${path}`);
// The next section starts at the following "## [" heading, or the end of the file.
const next = changelog.indexOf("\n## [", unreleased + 1);
const at = next < 0 ? changelog.length : next + 1;
const section = `## [${version}] - ${date}\n\n### Fixed\n- ${entry}\n\n`;
writeFileSync(path, changelog.slice(0, at) + section + changelog.slice(at));
