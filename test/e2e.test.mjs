// End-to-end flows in a real browser. Skipped when no Chromium-based browser is found
// (set CHROME_PATH to point at one), except in CI where a missing browser fails.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import puppeteer from "puppeteer-core";
import { findBrowser, startServer, wait } from "./helpers.mjs";

const executablePath = findBrowser();
if (!executablePath && process.env.CI) throw new Error("No Chromium-based browser found in CI (set CHROME_PATH)");
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 360, height: 760, isMobile: true, deviceScaleFactor: 2 };

let server;
let browser;
const pageErrors = [];

before(async () => {
  if (!executablePath) return;
  server = await startServer(8792);
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

async function newPage(label, viewport = DESKTOP) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", (error) => pageErrors.push(`[${label}] ${error.message}`));
  // Confirmations (kick, promote, clear) are accepted.
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}

async function typeName(page, name) {
  await page.waitForSelector("input[placeholder='Ton pseudo']");
  await page.type("input[placeholder='Ton pseudo']", name);
}

// Creates a room from the home page; options are { buildChoices: 1-5, rerolls: 0-3 or null }.
async function createRoom(page, name, mode = "Normal", options = {}) {
  await page.goto(server.base);
  await typeName(page, name);
  await page.locator(`::-p-text(${mode})`).click();
  if (options.buildChoices || options.rerolls !== undefined) {
    await page.click(".options-toggle");
    const [choices, rerolls] = await page.$$(".choice-toggle");
    if (options.buildChoices) await (await choices.$(`button:nth-child(${options.buildChoices})`)).click();
    if (options.rerolls !== undefined) await (await rerolls.$(`button:nth-child(${options.rerolls === null ? 5 : options.rerolls + 1})`)).click();
  }
  await page.locator("::-p-text(Créer un salon)").click();
  await waitForRoom(page);
  return page.url().split("/r/")[1];
}

async function joinRoom(page, code, name) {
  await page.goto(`${server.base}/r/${code}`);
  await typeName(page, name);
  await page.locator("::-p-text(Rejoindre)").click();
  await waitForRoom(page);
}

const waitForRoom = (page) => page.waitForFunction(() => document.querySelector(".player.me") && !document.querySelector(".picker").hidden);
const myCard = (page) =>
  page.$eval(".player.me", (card) => ({
    champion: card.querySelector(".player-head .muted").textContent,
    role: card.querySelector(".role-badge")?.textContent ?? null,
    hasBuild: Boolean(card.querySelector(".build")),
    actions: [...card.querySelectorAll(".card-actions button")].map((b) => b.className.split(" ").filter((c) => !["secondary", "danger", "icon-button", "locked"].includes(c)).join(" ")),
  }));
const generateButton = (page) => page.$eval(".picker .row:not(.role-toggle) button", (b) => ({ text: b.textContent, disabled: b.disabled }));

describe("browser", { skip: !executablePath && "no Chromium-based browser found" }, () => {
  it("home: options folded, mode buttons on one line with equal widths", async () => {
    for (const viewport of [DESKTOP, PHONE, { ...PHONE, width: 320 }]) {
      const page = await newPage("home", viewport);
      await page.goto(server.base);
      await page.waitForSelector(".mode-toggle");
      assert.equal(await page.$eval(".options-panel", (p) => p.hidden), true);
      const buttons = await page.$$eval(".mode-toggle > button", (bs) => bs.map((b) => ({ w: Math.round(b.getBoundingClientRect().width), top: Math.round(b.getBoundingClientRect().top), clipped: b.scrollWidth > b.clientWidth })));
      assert.equal(new Set(buttons.map((b) => b.w)).size, 1, `widths at ${viewport.width}px`);
      assert.equal(new Set(buttons.map((b) => b.top)).size, 1, `one line at ${viewport.width}px`);
      assert.ok(buttons.every((b) => !b.clipped), `text fits at ${viewport.width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    }
  });

  it("normal: role, search, generate, regenerate and clear", async () => {
    const page = await newPage("normal");
    await createRoom(page, "Hote");
    assert.equal((await generateButton(page)).text, "Choisis ton rôle");
    await page.click(".role-toggle button[data-role='mid']");
    await page.type("input[placeholder='Rechercher un champion…']", "tf");
    await wait(200);
    assert.deepEqual(await page.$$eval(".champion-grid button[data-id]:not([hidden])", (bs) => bs.map((b) => b.textContent)), ["Twisted Fate"]);
    await page.click(".champion-grid button[data-id='TwistedFate']");
    await page.waitForFunction(() => document.querySelector(".champion-grid button[data-id='TwistedFate']").classList.contains("selected"));
    assert.deepEqual(await generateButton(page), { text: "Générer mon build", disabled: false });

    await page.locator("::-p-text(Générer mon build)").click();
    await page.waitForSelector(".player.me .build");
    assert.equal(await page.$eval(".picker", (p) => p.hidden), true);
    const before = await page.$eval(".player.me .build", (b) => b.innerHTML);
    await page.click(".card-actions button[title^='Regénérer']");
    await page.waitForFunction((html) => document.querySelector(".player.me .build")?.innerHTML !== html, {}, before);
    assert.equal((await myCard(page)).champion, "Twisted Fate", "same choices kept");

    await page.click(".card-actions button[title='Effacer mes choix']");
    await page.waitForFunction(() => !document.querySelector(".picker").hidden);
    assert.equal(await page.$$eval(".role-toggle button[aria-pressed='true']", (b) => b.length), 0);
  });

  it("normal: big random button and random champion tile", async () => {
    const page = await newPage("random");
    await createRoom(page, "Hasard");
    await page.click(".big-random");
    await page.waitForSelector(".player.me .build");
    const card = await myCard(page);
    assert.match(card.role, /^(Top|Jungle|Mid|ADC|Support)$/);
    assert.ok(await page.$(".player.me .role-badge.random-role .icon"), "dice shown for a random role");
    assert.notEqual(card.champion, "Champion aléatoire");

    await page.click(".card-actions button[title='Effacer mes choix']");
    await page.waitForFunction(() => !document.querySelector(".picker").hidden);
    await page.click(".role-toggle button[data-role='top']");
    await page.click(".random-tile");
    await page.waitForFunction(() => document.querySelector(".random-tile").classList.contains("selected"));
    assert.equal((await myCard(page)).champion, "Champion aléatoire");
    await page.locator("::-p-text(Générer mon build)").click();
    await page.waitForSelector(".player.me .build");
    assert.notEqual((await myCard(page)).champion, "Champion aléatoire");
  });

  it("aram du chaos: random tile is exclusive, augments are shown", async () => {
    const page = await newPage("chaos");
    await createRoom(page, "Chaos", "ARAM du Chaos");
    const selected = () => page.$$eval(".champion-grid button.selected", (bs) => bs.map((b) => b.dataset.id ?? "random"));
    await page.click(".champion-grid button[data-id='Ahri']");
    // Each click waits for the room state echo, which would otherwise undo the next local toggle.
    await page.waitForSelector(".champion-grid button[data-id='Ahri'].selected");
    await wait(300);
    await page.click(".champion-grid button[data-id='Lux']");
    await wait(300);
    assert.deepEqual(await selected(), ["Ahri", "Lux"]);
    await page.click(".random-tile");
    await wait(300);
    assert.deepEqual(await selected(), ["random"]);
    await page.click(".champion-grid button[data-id='Zed']");
    await wait(300);
    assert.deepEqual(await selected(), ["Zed"]);

    await page.locator("::-p-text(Tirer mon build)").click();
    await page.waitForSelector(".player.me .build");
    assert.equal(await page.$$eval(".player.me .augment-row:not(.stat-row)", (rows) => rows.length), 4);
    assert.ok(await page.$(".player.me .stat-row img.stat-icon"), "stat bonus icon shown");
    assert.match(await page.$eval(".player.me .stat-hint", (p) => p.textContent), /toujours (à gauche|au centre|à droite)/);
    const labels = await page.$$eval(".player.me .section-label", (ls) => ls.map((l) => l.textContent));
    assert.ok(!labels.includes("Runes"));
  });

  it("several builds: choose one in the window; rerolls run out", async () => {
    const page = await newPage("options");
    await createRoom(page, "Choix", "Normal", { buildChoices: 3, rerolls: 1 });
    assert.equal(await page.$eval(".mode-badge", (b) => b.textContent), "Normal - 3 builds au choix - 1 reroll");
    await page.click(".big-random");
    await page.waitForFunction(() => !document.querySelector(".modal-backdrop").hidden);
    assert.equal(await page.$$eval(".modal .option", (o) => o.length), 3);
    const tops = await page.$$eval(".modal .option", (o) => o.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, "builds side by side");

    await page.click(".modal .card-actions button[title^='Regénérer']");
    await page.waitForFunction(() => document.querySelector(".modal .card-actions .reroll .icon-label")?.textContent === "0");
    await page.click(".modal .option:nth-child(2) .option-head button");
    await page.waitForFunction(() => document.querySelector(".modal-backdrop").hidden && document.querySelector(".player.me .build"));
    const card = await myCard(page);
    assert.deepEqual(card.actions, ["copy-card", "lock-button", "reroll", "clear"]);
    assert.equal(await page.$eval(".player.me .card-actions .reroll", (b) => b.textContent), "0");
    assert.ok(await page.$eval(".player.me .card-actions .reroll", (b) => b.disabled), "no reroll left");
  });

  it("host: promote and kick from the cards; kicked player is sent home", async () => {
    const host = await newPage("host");
    const code = await createRoom(host, "Hote");
    const guest = await newPage("guest");
    await joinRoom(guest, code, "Ami");
    const third = await newPage("third");
    await joinRoom(third, code, "Tiers");
    await host.waitForFunction(() => document.querySelectorAll(".player").length === 3);
    assert.equal(await guest.$$eval(".player .card-actions button[title='Exclure du salon']", (b) => b.length), 0);

    await host.click(".player:not(.me):last-child .card-actions button[title='Exclure du salon']");
    await third.waitForFunction(() => location.pathname === "/" && document.querySelector(".error")?.textContent.includes("exclu"));
    // The host re-renders the cards when the kick lands: wait for it before clicking again.
    await host.waitForFunction(() => document.querySelectorAll(".player").length === 2);

    await host.click(".player:not(.me) .card-actions button[title='Nommer hôte']");
    await guest.waitForFunction(() => document.querySelectorAll(".player .card-actions button[title='Exclure du salon']").length === 1);
    await host.waitForFunction(() => document.querySelectorAll(".player .card-actions button[title='Exclure du salon']").length === 0);
  });

  it("locks: player ready lock and host room lock", async () => {
    const host = await newPage("lock-host");
    const code = await createRoom(host, "Hote");
    const guest = await newPage("lock-guest");
    await joinRoom(guest, code, "Ami");
    await guest.click(".big-random");
    await guest.waitForSelector(".player.me .build");
    await host.waitForFunction(() => document.querySelector(".ready-label").textContent === "Prêts : 0/2");

    await guest.click(".player.me .lock-button");
    await host.waitForFunction(() => document.querySelector(".ready-label").textContent === "Prêts : 1/2");
    assert.ok(await host.$(".player:not(.me) .lock-indicator"), "lock visible to others");
    assert.ok(await guest.$eval(".player.me .card-actions button[title='Build verrouillé']", (b) => b.disabled), "reroll disabled");

    await host.click(".lock-all[title='Tout verrouiller']");
    await guest.waitForFunction(() => document.querySelector(".ready-label").textContent.includes("Salon verrouillé"));
    assert.ok(await guest.$eval(".player.me .lock-button", (b) => b.disabled), "player cannot unlock");
    assert.equal(await host.$eval(".picker", (p) => p.hidden), true, "host without build cannot generate");

    await host.click(".lock-all[title='Tout déverrouiller']");
    await guest.waitForFunction(() => document.querySelector(".ready-label").textContent === "Prêts : 1/2");
  });

  it("copies the own card as a PNG image", async () => {
    const page = await newPage("card-image");
    await page.browserContext().overridePermissions(server.base, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    await createRoom(page, "Photo", "ARAM du Chaos");
    await page.click(".random-tile");
    await wait(300);
    await page.locator("::-p-text(Tirer mon build)").click();
    await page.waitForSelector(".player.me .build");
    await page.bringToFront();
    await page.click(".card-actions button[title='Copier ma carte en image']");
    await page.waitForSelector(".copy-card[data-state='copied']", { timeout: 15_000 });
    const image = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType("image/png");
      const bitmap = await createImageBitmap(blob);
      return { type: blob.type, width: bitmap.width, height: bitmap.height };
    });
    assert.equal(image.type, "image/png");
    assert.equal(image.width, 1120, "560 px at 2x");
    assert.ok(image.height > 600, `height ${image.height}`);
  });

  it("phone: room fits the screen", async () => {
    const host = await newPage("phone-host");
    const code = await createRoom(host, "Hote");
    const phone = await newPage("phone", PHONE);
    await joinRoom(phone, code, "Mobile");
    await phone.click(".big-random");
    await phone.waitForSelector(".player.me .build");
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  });

  it("sends players home when their room has expired", async () => {
    // A dedicated server, restarted with empty storage: the room is gone, as after expiry.
    const port = 8793;
    let expiring = await startServer(port);
    const page = await newPage("expired");
    await page.goto(expiring.base);
    await typeName(page, "Perdu");
    await page.locator("::-p-text(Créer un salon)").click();
    await waitForRoom(page);
    const code = page.url().split("/r/")[1];

    await expiring.stop();
    expiring = await startServer(port);
    try {
      await page.waitForFunction(() => location.pathname === "/" && document.querySelector(".error")?.textContent, { timeout: 30_000 });
      assert.equal(await page.$eval(".error", (e) => e.textContent), `Le salon ${code} n'existe pas ou a expiré.`);
    } finally {
      await expiring.stop();
    }
  });

  it("serves compact game data and shows the patch in the footer", async () => {
    const res = await fetch(`${server.base}/api/gamedata`);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    const body = await res.text();
    assert.ok(body.length < 300_000, `compact data is ${Math.round(body.length / 1024)} KB`);
    const { version } = JSON.parse(body);

    const page = await newPage("patch");
    await page.goto(server.base);
    await page.waitForFunction(() => document.getElementById("patch").textContent);
    assert.equal(await page.$eval("#patch", (el) => el.textContent), ` - Patch ${version.split(".").slice(0, 2).join(".")}`);
  });

  it("raises no JavaScript errors", () => {
    assert.deepEqual(pageErrors, []);
  });
});
