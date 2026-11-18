// Regenerates the images of showcase/ (read by the Home site that lists the projects):
// screenshots of a local server, the cover, the icon and the link preview image.
// The text of showcase/project.md is written by hand and never touched here.
// Rolls use a fixed seed and the room code shown is fixed, so the images only
// change when the site, the game data or the version in the footer change; an image
// is only rewritten when more than 0.1% of its pixels differ (icon scaling varies slightly).
// Usage: node scripts/update-showcase.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { findBrowser, startServer } from "../test/helpers.mjs";

const PORT = 8794;
const VIEWPORT = { width: 1440, height: 900 };
const ROOM_CODE = "UBX42";
const path = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const shot = (name) => path(`showcase/screenshots/${name}.png`);

const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found (set CHROME_PATH)");
mkdirSync(path("showcase/screenshots"), { recursive: true });

const server = await startServer(PORT);
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  // Pixels compared in a blank page: [width, height, changed pixels].
  const scratch = await browser.newPage();
  async function save(file, png) {
    if (existsSync(file)) {
      const [width, height, changed] = await scratch.evaluate(async (a, b) => {
        const pixels = async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = new OffscreenCanvas(image.width, image.height);
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height);
        };
        const [before, after] = await Promise.all([pixels(a), pixels(b)]);
        if (before.width !== after.width || before.height !== after.height) return [after.width, after.height, Infinity];
        let changed = 0;
        for (let i = 0; i < before.data.length; i += 4) {
          if (before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] || before.data[i + 2] !== after.data[i + 2] || before.data[i + 3] !== after.data[i + 3]) changed++;
        }
        return [after.width, after.height, changed];
      }, readFileSync(file).toString("base64"), Buffer.from(png).toString("base64"));
      if (changed <= width * height * 0.001) return;
    }
    writeFileSync(file, png);
  }

  const imagesLoaded = (page) =>
    page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0), { timeout: 30_000 });

  // Each player gets their own browser context (own player id) and seeded Math.random.
  async function newPlayer(seed) {
    const context = await browser.createBrowserContext();
    await context.overridePermissions(server.base, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    const page = await context.newPage();
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument((seed) => {
      // mulberry32
      let state = seed >>> 0;
      Math.random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, seed);
    return page;
  }

  // Room codes are random: show a fixed one so the images stay the same between runs.
  const fixRoomCode = (page) =>
    page.evaluate((code) => document.querySelectorAll(".code-text").forEach((el) => (el.textContent = code)), ROOM_CODE);

  const waitForPicker = (page) =>
    page.waitForFunction(() => document.querySelector(".player.me") && !document.querySelector(".picker").hidden, { timeout: 30_000 });

  async function rollEverything(page) {
    await waitForPicker(page);
    await page.click(".big-random");
    await page.waitForSelector(".player.me .build", { timeout: 30_000 });
  }

  const host = await newPlayer(1009);
  await host.goto(server.base, { waitUntil: "networkidle0" });
  await imagesLoaded(host);
  await save(shot("accueil"), await host.screenshot());

  await host.type("input[placeholder='Ton pseudo']", "Lune");
  await host.locator("::-p-text(Créer un salon)").click();
  await waitForPicker(host);
  await imagesLoaded(host);
  await fixRoomCode(host);
  await save(shot("choix-champion"), await host.screenshot());
  const code = new URL(host.url()).pathname.split("/").pop();

  for (const [name, seed] of [["Pixel", 52711], ["Kaiser", 900913]]) {
    const guest = await newPlayer(seed);
    await guest.goto(`${server.base}/r/${code}`, { waitUntil: "networkidle0" });
    await guest.type("input[placeholder='Ton pseudo']", name);
    await guest.locator("::-p-text(Rejoindre)").click();
    await rollEverything(guest);
  }
  await host.bringToFront();
  await rollEverything(host);
  await host.waitForFunction(() => document.querySelectorAll(".player .build").length === 3, { timeout: 30_000 });
  await imagesLoaded(host);
  await fixRoomCode(host);
  await save(shot("salon"), await host.screenshot());

  // The player's card, as copied by the "Copier ma carte en image" button.
  await host.click(".card-actions button[title='Copier ma carte en image']");
  await host.waitForSelector(".copy-card[data-state='copied']", { timeout: 15_000 });
  const card = await host.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bytes = new Uint8Array(await (await item.getType("image/png")).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await save(shot("carte"), Buffer.from(card, "base64"));

  // Cover (uses the room capture above) and icon.
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(pathToFileURL(path("scripts/showcase-cover.html")).href);
  await imagesLoaded(page);
  await save(path("showcase/cover.png"), await page.screenshot());

  await page.setViewport({ width: 512, height: 512 });
  await page.goto(pathToFileURL(path("public/logo.svg")).href);
  await save(path("showcase/icon.png"), await page.screenshot({ omitBackground: true }));

  copyFileSync(path("public/og-image.png"), shot("apercu-discord"));
  console.log("Wrote the showcase images");
} finally {
  await browser.close();
  await server.stop();
}
