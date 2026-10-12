// Checks a deployed UBChaos the way a player uses it: pages, game data, then a
// real room over WebSocket (it expires after 24 h like any other).
// Usage: node scripts/smoke-test.mjs [base url], production by default.
// Run daily by .github/workflows/monitor.yml.
import assert from "node:assert/strict";
import { connect, createRoom, wait } from "../test/helpers.mjs";

const base = (process.argv[2] || "https://ubchaos.pilalheur.workers.dev").replace(/\/$/, "");

async function check(name, run) {
  try {
    console.log(`ok   ${name}: ${await run()}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function get(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return res;
}

await check("home page", async () => {
  const html = await (await get("/")).text();
  assert.match(html, /<meta property="og:title"/, "no link preview tags");
  return "served with its preview tags";
});

await check("version", async () => {
  const { version, build, commit } = await (await get("/api/version")).json();
  assert.ok(version, "no version");
  return `${version} (build ${build}, ${commit})`;
});

await check("game data", async () => {
  const data = await (await get("/api/gamedata")).json();
  const champions = Object.keys(data.champions ?? {}).length;
  const items = Object.keys(data.items ?? {}).length;
  assert.ok(champions > 100, `only ${champions} champions`);
  assert.ok(items > 100, `only ${items} items`);
  return `Data Dragon ${data.version}, ${champions} champions, ${items} items`;
});

await check("room", async () => {
  const playerId = `monitor-${crypto.randomUUID()}`;
  const { status, code } = await createRoom(base, { playerId, mode: "normal" });
  assert.equal(status, 200, `room creation answered ${status}`);
  const socket = await connect(base, code, playerId, "Monitor");
  try {
    for (let i = 0; i < 20 && !socket.room; i++) await wait(250);
    assert.ok(socket.room, "no room state over WebSocket");
    const html = await (await get(`/r/${code}`)).text();
    assert.match(html, /1\/10 joueurs/, "room link preview does not describe the room");
    return `room ${code} created and joined`;
  } finally {
    socket.close();
  }
});
