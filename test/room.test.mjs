// Room rules enforced by the Durable Object, tested over real WebSockets.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { connect, createRoom, playerOf, send, startServer, wait } from "./helpers.mjs";

let server;
let base;
let nextId = 0;
const newId = (label = "player") => `${label}-${String(++nextId).padStart(4, "0")}-test`;

before(async () => {
  server = await startServer(8791);
  base = server.base;
});

after(() => server.stop());

describe("room creation", () => {
  it("creates a room with valid options", async () => {
    const res = await createRoom(base, { playerId: newId(), mode: "normal", buildChoices: 3, rerollLimit: 1 });
    assert.equal(res.status, 200);
    assert.match(res.code, /^[A-Z2-9]{5}$/);
  });

  it("rejects invalid modes and options", async () => {
    for (const body of [{ mode: "urf" }, { mode: "normal", buildChoices: 6 }, { mode: "normal", buildChoices: 0 }, { mode: "normal", rerollLimit: -1 }, { mode: "normal", rerollLimit: 1.5 }]) {
      assert.equal((await createRoom(base, { playerId: newId(), ...body })).status, 400, JSON.stringify(body));
    }
  });

  it("reports unknown rooms", async () => {
    assert.equal((await fetch(`${base}/api/rooms/ZZZZZ?playerId=${newId()}`)).status, 404);
  });
});

describe("link previews", () => {
  const meta = (html, property) => html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];

  it("describes the room for Discord-like crawlers", async () => {
    const host = newId("host");
    const { code } = await createRoom(base, { playerId: host, mode: "aram-chaos", buildChoices: 3, rerollLimit: 1 });
    const socket = await connect(base, code, host, "Nico");
    await wait(200);
    const html = await fetch(`${base}/r/${code}`).then((r) => r.text());
    assert.equal(meta(html, "og:title"), `Salon ${code} - UBChaos`);
    assert.equal(meta(html, "og:description"), "ARAM du Chaos - 3 builds au choix - 1 reroll - 1/10 joueurs - Hôte : Nico. Rejoins le salon pour tirer ton build !");
    assert.equal(meta(html, "og:url"), `${base}/r/${code}`);
    assert.equal(meta(html, "og:image"), `${base}/og/aram-chaos-3-1.jpg`);
    assert.ok(html.includes('src="/app.js"'), "still the app page");
    socket.close();
  });

  it("has a pre-rendered image for every room setting", async () => {
    for (const settings of [
      { mode: "normal", buildChoices: 1, rerollLimit: null },
      { mode: "aram", buildChoices: 5, rerollLimit: 0 },
      { mode: "aram-chaos", buildChoices: 5, rerollLimit: 10 },
    ]) {
      const { code } = await createRoom(base, { playerId: newId("host"), ...settings });
      const html = await fetch(`${base}/r/${code}`).then((r) => r.text());
      const res = await fetch(meta(html, "og:image"));
      assert.equal(res.headers.get("content-type"), "image/jpeg", `${meta(html, "og:image")} (run scripts/render-og-image.mjs)`);
    }
  });

  it("says when the room does not exist", async () => {
    const html = await fetch(`${base}/r/ZZZZZ`).then((r) => r.text());
    assert.equal(meta(html, "og:description"), "Ce salon n'existe pas ou a expiré.");
    assert.equal(meta(html, "og:image"), `${base}/og-image.png`);
  });

  it("escapes player names in the tags", async () => {
    const host = newId("host");
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const socket = await connect(base, code, host, encodeURIComponent('A"><b>x'));
    await wait(200);
    const html = await fetch(`${base}/r/${code}`).then((r) => r.text());
    assert.match(meta(html, "og:description"), /Hôte : A&quot;/);
    socket.close();
  });

  it("serves the preview image", async () => {
    const res = await fetch(`${base}/og-image.png`);
    assert.equal(res.headers.get("content-type"), "image/png");
  });
});

describe("players", () => {
  it("refuses an 11th player but lets members come back", async () => {
    const ids = Array.from({ length: 10 }, () => newId());
    const { code } = await createRoom(base, { playerId: ids[0], mode: "normal" });
    const sockets = [];
    for (const id of ids) sockets.push(await connect(base, code, id));
    assert.equal((await fetch(`${base}/api/rooms/${code}?playerId=${newId()}`)).status, 403);
    await assert.rejects(connect(base, code, newId()));
    assert.equal((await fetch(`${base}/api/rooms/${code}?playerId=${ids[3]}`)).status, 200);
    sockets.forEach((socket) => socket.close());
  });

  it("only lets the host kick, and kicked players cannot come back", async () => {
    const [host, a, b] = [newId("host"), newId(), newId()];
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const hostSocket = await connect(base, code, host);
    const aSocket = await connect(base, code, a);
    const bSocket = await connect(base, code, b);
    await wait(200);

    await send(aSocket, { type: "kick", playerId: b });
    assert.ok(playerOf(hostSocket.room, b), "non-host kick ignored");
    await send(hostSocket, { type: "kick", playerId: host });
    assert.ok(playerOf(hostSocket.room, host), "host cannot kick themselves");

    await send(hostSocket, { type: "kick", playerId: b });
    assert.equal(playerOf(hostSocket.room, b), undefined);
    assert.ok(bSocket.kicked, "kicked player is told");
    const res = await fetch(`${base}/api/rooms/${code}?playerId=${b}`);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "Kicked from this room");
    [hostSocket, aSocket].forEach((socket) => socket.close());
  });
});

describe("host role", () => {
  it("can be handed over by the host only", async () => {
    const [host, a, b] = [newId("host"), newId(), newId()];
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const hostSocket = await connect(base, code, host);
    const aSocket = await connect(base, code, a);
    await connect(base, code, b);
    await wait(200);

    await send(aSocket, { type: "promote", playerId: b });
    assert.equal(hostSocket.room.hostId, host);
    await send(hostSocket, { type: "promote", playerId: b });
    assert.equal(hostSocket.room.hostId, b);
  });

  it("goes to the earliest online player when the host quits", async () => {
    const [host, a, b] = [newId("host"), newId(), newId()];
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const hostSocket = await connect(base, code, host);
    await wait(50);
    const aSocket = await connect(base, code, a);
    await wait(50);
    const bSocket = await connect(base, code, b);
    await wait(200);

    aSocket.close();
    await wait(300);
    await send(hostSocket, { type: "leave" });
    assert.equal(bSocket.room.hostId, b, "offline players are skipped");
  });

  it("goes to the next player to connect when nobody is online", async () => {
    const [host, c] = [newId("host"), newId()];
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const hostSocket = await connect(base, code, host);
    await wait(200);
    await send(hostSocket, { type: "leave" });
    const cSocket = await connect(base, code, c);
    await wait(250);
    assert.equal(cSocket.room.hostId, c);
  });
});

describe("choices", () => {
  it("accepts roles in Normal only", async () => {
    const id = newId();
    const normal = await connect(base, (await createRoom(base, { playerId: id, mode: "normal" })).code, id);
    assert.equal(playerOf(await send(normal, { type: "role", role: "jungle" }), id).role, "jungle");
    assert.equal(playerOf(await send(normal, { type: "role", role: "coach" }), id).role, "jungle");

    const aram = await connect(base, (await createRoom(base, { playerId: id, mode: "aram" })).code, id);
    assert.equal(playerOf(await send(aram, { type: "role", role: "mid" }), id).role, null);
  });

  it("limits ARAM candidates to 3 and keeps the random pick exclusive", async () => {
    const id = newId();
    const socket = await connect(base, (await createRoom(base, { playerId: id, mode: "aram" })).code, id);
    await send(socket, { type: "candidates", champions: ["Ahri", "Lux"] });
    assert.deepEqual(playerOf(await send(socket, { type: "candidates", champions: ["Ahri", "Lux", "Zed", "Jinx"] }), id).candidates, ["Ahri", "Lux"]);
    assert.deepEqual(playerOf(await send(socket, { type: "candidates", champions: ["random", "Ahri"] }), id).candidates, ["Ahri", "Lux"]);
    assert.deepEqual(playerOf(await send(socket, { type: "candidates", champions: ["random"] }), id).candidates, ["random"]);
  });

  it("clears only the sender's choices", async () => {
    const [a, b] = [newId(), newId()];
    const { code } = await createRoom(base, { playerId: a, mode: "normal" });
    const aSocket = await connect(base, code, a);
    const bSocket = await connect(base, code, b);
    for (const socket of [aSocket, bSocket]) {
      await send(socket, { type: "role", role: "mid" });
      await send(socket, { type: "pick", champion: "Ahri" });
      await send(socket, { type: "build", build: { champion: "Ahri" } });
    }
    const room = await send(bSocket, { type: "clear" });
    assert.ok(playerOf(room, a).build);
    assert.equal(playerOf(room, b).build, null);
    assert.equal(playerOf(room, b).role, null);
  });
});

describe("builds", () => {
  it("offers exactly the room's number of builds and keeps the chosen one", async () => {
    const id = newId();
    const socket = await connect(base, (await createRoom(base, { playerId: id, mode: "normal", buildChoices: 3 })).code, id);
    assert.equal(playerOf(await send(socket, { type: "options", builds: [{ n: 1 }, { n: 2 }] }), id).options.length, 0);
    assert.equal(playerOf(await send(socket, { type: "options", builds: [{ n: 1 }, { n: 2 }, { n: 3 }] }), id).options.length, 3);
    assert.deepEqual(playerOf(await send(socket, { type: "choose", index: 5 }), id).options.length, 3);
    const room = await send(socket, { type: "choose", index: 1 });
    assert.deepEqual(playerOf(room, id).build, { n: 2 });
    assert.equal(playerOf(room, id).options.length, 0);
  });

  it("locks the build once the rerolls are used up", async () => {
    const id = newId();
    const socket = await connect(base, (await createRoom(base, { playerId: id, mode: "normal", rerollLimit: 1 })).code, id);
    await send(socket, { type: "build", build: { n: 1 } });
    await send(socket, { type: "build", build: { n: 2 } });
    for (const message of [{ type: "build", build: { n: 3 } }, { type: "role", role: "mid" }, { type: "clear" }]) {
      const me = playerOf(await send(socket, message), id);
      assert.deepEqual(me.build, { n: 2 }, message.type);
      assert.equal(me.generations, 2);
    }
  });

  it("lets a player lock their own build, which freezes it until unlocked", async () => {
    const id = newId();
    const socket = await connect(base, (await createRoom(base, { playerId: id, mode: "normal" })).code, id);
    assert.equal(playerOf(await send(socket, { type: "lock", locked: true }), id).locked, false, "no build to lock yet");
    await send(socket, { type: "build", build: { n: 1 } });
    assert.equal(playerOf(await send(socket, { type: "lock", locked: true }), id).locked, true);
    for (const message of [{ type: "build", build: { n: 2 } }, { type: "role", role: "mid" }, { type: "clear" }]) {
      assert.deepEqual(playerOf(await send(socket, message), id).build, { n: 1 }, message.type);
    }
    await send(socket, { type: "lock", locked: false });
    assert.deepEqual(playerOf(await send(socket, { type: "build", build: { n: 3 } }), id).build, { n: 3 });
  });

  it("lets only the host lock the whole room, and a reset unlocks it", async () => {
    const [host, a] = [newId("host"), newId()];
    const { code } = await createRoom(base, { playerId: host, mode: "normal" });
    const hostSocket = await connect(base, code, host);
    const aSocket = await connect(base, code, a);
    await send(aSocket, { type: "build", build: { n: 1 } });

    assert.equal((await send(aSocket, { type: "lockAll", locked: true })).locked, false, "non-host ignored");
    assert.equal((await send(hostSocket, { type: "lockAll", locked: true })).locked, true);
    assert.deepEqual(playerOf(await send(aSocket, { type: "build", build: { n: 2 } }), a).build, { n: 1 }, "frozen");
    assert.equal(playerOf(await send(aSocket, { type: "lock", locked: false }), a).locked, false, "cannot unlock past the host");
    assert.deepEqual(playerOf(await send(aSocket, { type: "build", build: { n: 2 } }), a).build, { n: 1 }, "still frozen");

    const room = await send(hostSocket, { type: "reset" });
    assert.equal(room.locked, false);
    assert.deepEqual(playerOf(await send(aSocket, { type: "build", build: { n: 3 } }), a).build, { n: 3 });
  });

  it("gives the rerolls back on a host reset", async () => {
    const id = newId("host");
    const socket = await connect(base, (await createRoom(base, { playerId: id, mode: "normal", rerollLimit: 0 })).code, id);
    await send(socket, { type: "build", build: { n: 1 } });
    assert.deepEqual(playerOf(await send(socket, { type: "build", build: { n: 2 } }), id).build, { n: 1 });
    await send(socket, { type: "reset" });
    assert.deepEqual(playerOf(await send(socket, { type: "build", build: { n: 3 } }), id).build, { n: 3 });
  });
});
