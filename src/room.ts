import { DurableObject } from "cloudflare:workers";

export const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
// Keep in sync with MODES in public/bravery.js.
export const ROOM_MODES = ["normal", "aram", "aram-chaos"] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
// Keep in sync with ROLES in public/bravery.js. Only used in normal mode.
const ROLES = ["top", "jungle", "mid", "adc", "support", "random"] as const;
type Role = (typeof ROLES)[number];

const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const CHAMPION_RE = /^[A-Za-z0-9]{1,32}$/;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_BUILD_BYTES = 4 * 1024;
const MAX_PLAYERS = 10;
// How many builds a player may be offered to choose from.
export const MAX_BUILD_CHOICES = 5;
export const MAX_REROLL_LIMIT = 10;
// In ARAM modes a player selects their champion or the few the game offers them.
const CANDIDATE_MODES: ReadonlySet<RoomMode> = new Set(["aram", "aram-chaos"]);
const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 3;
// An idle room is wiped after this delay.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

interface Meta {
  code: string;
  hostId: string;
  mode: RoomMode;
  // Builds offered per generation; the player keeps one.
  buildChoices: number;
  // Rerolls allowed per player; null means unlimited.
  rerollLimit: number | null;
  createdAt: number;
}

interface Player {
  id: string;
  name: string;
  champion: string | null;
  // ARAM modes only: champions offered in game; `champion` is drawn from them.
  candidates: string[];
  role: Role | null;
  // Rolled by the client from Data Dragon; stored and relayed as-is.
  build: unknown;
  // Pending builds to choose from when the room offers several.
  options: unknown[];
  // Builds generated so far (single builds or sets of options); all but the first are rerolls.
  generations: number;
  joinedAt: number;
}

interface Attachment {
  playerId: string;
}

type ClientMessage =
  | { type: "pick"; champion: string | null }
  | { type: "candidates"; champions: string[] }
  | { type: "role"; role: Role | null }
  | { type: "build"; build: unknown }
  | { type: "options"; builds: unknown[] }
  | { type: "choose"; index: number }
  | { type: "rename"; name: string }
  | { type: "clear" }
  | { type: "leave" }
  | { type: "kick"; playerId: string }
  | { type: "reset" };

// Keep in sync with RANDOM_CHAMPION in public/app.js.
const RANDOM_CHAMPION = "random";

// WebSocket close code telling a client it was kicked by the host.
export const KICKED_CLOSE_CODE = 4001;

// Messages that would roll again or change the choices behind a generated build.
const LOCKABLE_MESSAGES = new Set<ClientMessage["type"]>(["pick", "candidates", "role", "clear", "build", "options"]);

function isLocked(meta: Meta, player: Player): boolean {
  const limit = meta.rerollLimit ?? null;
  return limit !== null && (player.generations ?? 0) > limit;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

export class Room extends DurableObject<Env> {
  async create(code: string, hostId: string, mode: RoomMode, buildChoices: number, rerollLimit: number | null): Promise<boolean> {
    if (await this.ctx.storage.get<Meta>("meta")) return false;
    await this.ctx.storage.put<Meta>("meta", { code, hostId, mode, buildChoices, rerollLimit, createdAt: Date.now() });
    await this.ctx.storage.put<Player[]>("players", []);
    await this.touch();
    return true;
  }

  // Whether this player may enter: players already in the room can always come back.
  async joinStatus(playerId: string): Promise<"ok" | "full" | "missing" | "kicked"> {
    if (!(await this.ctx.storage.get<Meta>("meta"))) return "missing";
    if ((await this.kicked()).includes(playerId)) return "kicked";
    const players = await this.players();
    if (players.some((p) => p.id === playerId)) return "ok";
    return players.length >= MAX_PLAYERS ? "full" : "ok";
  }

  async fetch(request: Request): Promise<Response> {
    const meta = await this.ctx.storage.get<Meta>("meta");
    if (!meta) return new Response("Room not found", { status: 404 });

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") ?? "";
    const name = cleanName(url.searchParams.get("name"));
    if (!PLAYER_ID_RE.test(playerId) || !name) {
      return new Response("Invalid player", { status: 400 });
    }

    if ((await this.kicked()).includes(playerId)) return new Response("Kicked from this room", { status: 403 });
    const players = await this.players();
    let player = players.find((p) => p.id === playerId);
    if (!player) {
      if (players.length >= MAX_PLAYERS) return new Response("Room is full", { status: 403 });
      player = { id: playerId, name, champion: null, candidates: [], role: null, build: null, options: [], generations: 0, joinedAt: Date.now() };
      players.push(player);
    } else {
      player.name = name;
    }
    await this.ctx.storage.put("players", players);
    await this.touch();

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies Attachment);
    await this.broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const { playerId } = ws.deserializeAttachment() as Attachment;
    const meta = await this.ctx.storage.get<Meta>("meta");
    let players = await this.players();
    const player = players.find((p) => p.id === playerId);
    if (!meta || !player) return;
    // Out of rerolls, the generated build is final: no new roll and no edits.
    if (LOCKABLE_MESSAGES.has(message.type) && isLocked(meta, player)) return;

    switch (message.type) {
      case "pick":
        if (message.champion !== null && !(typeof message.champion === "string" && CHAMPION_RE.test(message.champion))) return;
        if (CANDIDATE_MODES.has(meta.mode) && message.champion !== null) {
          const candidates = player.candidates ?? [];
          if (candidates.length < MIN_CANDIDATES || !candidates.includes(message.champion)) return;
        }
        player.champion = message.champion;
        player.build = null;
        player.options = [];
        break;
      case "candidates": {
        if (!CANDIDATE_MODES.has(meta.mode) || !Array.isArray(message.champions)) return;
        const champions = [...new Set(message.champions)];
        if (champions.length > MAX_CANDIDATES || !champions.every((c) => typeof c === "string" && CHAMPION_RE.test(c))) return;
        // The random pick cannot be combined with real champions.
        if (champions.length > 1 && champions.includes(RANDOM_CHAMPION)) return;
        player.candidates = champions;
        player.champion = null;
        player.build = null;
        player.options = [];
        break;
      }
      case "build":
        if (JSON.stringify(message.build ?? null).length > MAX_BUILD_BYTES) return;
        player.build = message.build ?? null;
        player.generations = (player.generations ?? 0) + 1;
        break;
      case "options": {
        const builds = message.builds;
        if ((meta.buildChoices ?? 1) < 2 || !Array.isArray(builds) || builds.length !== meta.buildChoices) return;
        if (builds.some((build) => JSON.stringify(build ?? null).length > MAX_BUILD_BYTES)) return;
        player.options = builds;
        player.build = null;
        player.generations = (player.generations ?? 0) + 1;
        break;
      }
      case "choose": {
        const option = player.options?.[message.index];
        if (!Number.isInteger(message.index) || option === undefined) return;
        player.build = option;
        player.options = [];
        break;
      }
      case "role":
        if (meta.mode !== "normal" || (message.role !== null && !ROLES.includes(message.role))) return;
        player.role = message.role;
        player.build = null;
        player.options = [];
        break;
      case "rename": {
        const name = cleanName(message.name);
        if (!name) return;
        player.name = name;
        break;
      }
      case "leave":
        players = players.filter((p) => p.id !== playerId);
        ws.close(1000, "Left the room");
        break;
      // Only ever affects the sender, so nobody can clear someone else's build.
      case "clear":
        player.champion = null;
        player.candidates = [];
        player.role = null;
        player.build = null;
        player.options = [];
        break;
      // Host only. The kicked player stays banned from this room for its lifetime.
      case "kick": {
        const target = message.playerId;
        if (playerId !== meta.hostId || target === meta.hostId || !players.some((p) => p.id === target)) return;
        players = players.filter((p) => p.id !== target);
        await this.ctx.storage.put("kicked", [...(await this.kicked()), target]);
        for (const socket of this.ctx.getWebSockets()) {
          if ((socket.deserializeAttachment() as Attachment).playerId === target) {
            // Explicit message first: the close frame alone may not reach the client promptly.
            socket.send(JSON.stringify({ type: "kicked" }));
            socket.close(KICKED_CLOSE_CODE, "Kicked by the host");
          }
        }
        break;
      }
      case "reset":
        if (playerId !== meta.hostId) return;
        for (const p of players) {
          p.champion = null;
          p.candidates = [];
          p.build = null;
          p.options = [];
          p.generations = 0;
        }
        break;
      default:
        return;
    }

    await this.ctx.storage.put("players", players);
    await this.touch();
    await this.broadcast(message.type === "leave" ? ws : undefined);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the runtime.
    }
    await this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.broadcast(ws);
  }

  async alarm(): Promise<void> {
    // Keep the room alive while someone is still connected.
    if (this.ctx.getWebSockets().length > 0) {
      await this.touch();
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  private async kicked(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("kicked")) ?? [];
  }

  private async players(): Promise<Player[]> {
    return (await this.ctx.storage.get<Player[]>("players")) ?? [];
  }

  private async touch(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  // Sends the full room state to every connected socket except `closing`.
  private async broadcast(closing?: WebSocket): Promise<void> {
    const meta = await this.ctx.storage.get<Meta>("meta");
    if (!meta) return;
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== closing);
    const online = new Set(sockets.map((ws) => (ws.deserializeAttachment() as Attachment).playerId));
    const players = (await this.players()).map((p) => ({ ...p, candidates: p.candidates ?? [], role: p.role ?? null, options: p.options ?? [], generations: p.generations ?? 0, online: online.has(p.id) }));

    const payload = JSON.stringify({
      type: "state",
      room: { code: meta.code, hostId: meta.hostId, mode: meta.mode ?? "normal", buildChoices: meta.buildChoices ?? 1, rerollLimit: meta.rerollLimit ?? null, players },
    });
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Socket is going away; its close handler will rebroadcast.
      }
    }
  }
}
