import { DurableObject } from "cloudflare:workers";

export const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const CHAMPION_RE = /^[A-Za-z0-9]{1,32}$/;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_BUILD_BYTES = 4 * 1024;
const MAX_PLAYERS = 10;
// An idle room is wiped after this delay.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

interface Meta {
  code: string;
  hostId: string;
  createdAt: number;
}

interface Player {
  id: string;
  name: string;
  champion: string | null;
  // Rolled by the client from Data Dragon; stored and relayed as-is.
  build: unknown;
  joinedAt: number;
}

interface Attachment {
  playerId: string;
}

type ClientMessage =
  | { type: "pick"; champion: string | null }
  | { type: "build"; build: unknown }
  | { type: "rename"; name: string }
  | { type: "leave" }
  | { type: "reset" };

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

export class Room extends DurableObject<Env> {
  async create(code: string, hostId: string): Promise<boolean> {
    if (await this.ctx.storage.get<Meta>("meta")) return false;
    await this.ctx.storage.put<Meta>("meta", { code, hostId, createdAt: Date.now() });
    await this.ctx.storage.put<Player[]>("players", []);
    await this.touch();
    return true;
  }

  async exists(): Promise<boolean> {
    return (await this.ctx.storage.get<Meta>("meta")) !== undefined;
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

    const players = await this.players();
    let player = players.find((p) => p.id === playerId);
    if (!player) {
      if (players.length >= MAX_PLAYERS) return new Response("Room is full", { status: 403 });
      player = { id: playerId, name, champion: null, build: null, joinedAt: Date.now() };
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

    switch (message.type) {
      case "pick":
        if (message.champion !== null && !(typeof message.champion === "string" && CHAMPION_RE.test(message.champion))) return;
        player.champion = message.champion;
        player.build = null;
        break;
      case "build":
        if (JSON.stringify(message.build ?? null).length > MAX_BUILD_BYTES) return;
        player.build = message.build ?? null;
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
      case "reset":
        if (playerId !== meta.hostId) return;
        for (const p of players) {
          p.champion = null;
          p.build = null;
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
    const players = (await this.players()).map((p) => ({ ...p, online: online.has(p.id) }));

    const payload = JSON.stringify({
      type: "state",
      room: { code: meta.code, hostId: meta.hostId, players },
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
