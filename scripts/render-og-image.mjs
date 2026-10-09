// Renders scripts/og-image.html to public/og-image.png (1200x630), the image
// shown in link previews (Discord...). Usage: node scripts/render-og-image.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { findBrowser } from "../test/helpers.mjs";

const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found (set CHROME_PATH)");

const template = fileURLToPath(new URL("og-image.html", import.meta.url));
const output = fileURLToPath(new URL("../public/og-image.png", import.meta.url));

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.goto(pathToFileURL(template).href);
await page.screenshot({ path: output, type: "png" });
await browser.close();
console.log(`Wrote ${output}`);
