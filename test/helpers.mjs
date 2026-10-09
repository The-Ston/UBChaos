// Shared test helpers: an isolated `wrangler dev` per test file and small
// WebSocket utilities.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the Worker on its own port and storage directory, so test files never
// share rooms with each other or with a running `npm run dev`.
export async function startServer(port) {
  const persistDir = mkdtempSync(join(tmpdir(), "ubchaos-test-"));
  const child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persistDir], {
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/version`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await wait(500);
  }

  async function stop() {
    // wrangler spawns workerd: kill the whole process tree.
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    await wait(500);
    rmSync(persistDir, { recursive: true, force: true });
  }

  return { base, stop };
}

export async function createRoom(base, body) {
  const res = await fetch(`${base}/api/rooms`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

// Connects a player and keeps the latest room state on `socket.room`.
export function connect(base, code, playerId, name = playerId.slice(0, 8)) {
  const url = `${base.replace("http", "ws")}/api/rooms/${code}/ws?playerId=${playerId}&name=${name}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.room = null;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") socket.room = message.room;
      if (message.type === "kicked") socket.kicked = true;
    });
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => reject(new Error("WebSocket rejected")));
  });
}

// Sends a message and waits for the server to apply it.
export async function send(socket, message) {
  socket.send(JSON.stringify(message));
  await wait(250);
  return socket.room;
}

export const playerOf = (room, id) => room.players.find((p) => p.id === id);

// A Chromium-based browser for end-to-end tests, or null when none is installed.
export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}
