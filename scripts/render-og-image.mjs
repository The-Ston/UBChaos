// Renders scripts/og-image.html to the images shown in link previews (Discord...),
// 1200x630: public/og-image.png for the site, and one public/og/*.jpg per room
// setting combination, named as roomImage() in src/index.ts expects.
// Usage: node scripts/render-og-image.mjs
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { MODES } from "../public/bravery.js";
import { findBrowser } from "../test/helpers.mjs";

// Keep in sync with MAX_BUILD_CHOICES and MAX_REROLL_LIMIT in src/room.ts.
const MAX_BUILD_CHOICES = 5;
const MAX_REROLL_LIMIT = 10;

const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found (set CHROME_PATH)");

const template = pathToFileURL(fileURLToPath(new URL("og-image.html", import.meta.url))).href;
const output = (path) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));

const buildsLabel = (choices) => (choices === 1 ? "1 build" : `${choices} builds au choix`);
const rerollsLabel = (limit) =>
  limit === null ? "Rerolls illimités" : limit === 0 ? "Aucun reroll" : `${limit} reroll${limit > 1 ? "s" : ""}`;

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });

await page.goto(template);
await page.screenshot({ path: output("og-image.png"), type: "png" });

rmSync(output("og"), { recursive: true, force: true });
mkdirSync(output("og"));
const rerollLimits = [null, ...Array.from({ length: MAX_REROLL_LIMIT + 1 }, (_, i) => i)];
let count = 0;
for (const [mode, { label }] of Object.entries(MODES)) {
  for (let choices = 1; choices <= MAX_BUILD_CHOICES; choices++) {
    for (const limit of rerollLimits) {
      const chips = [label, buildsLabel(choices), rerollsLabel(limit)].join("|");
      await page.goto(`${template}?chips=${encodeURIComponent(chips)}`);
      await page.screenshot({ path: output(`og/${mode}-${choices}-${limit ?? "x"}.jpg`), type: "jpeg", quality: 85 });
      count++;
    }
  }
}
await browser.close();
console.log(`Wrote public/og-image.png and ${count} room images in public/og/`);
