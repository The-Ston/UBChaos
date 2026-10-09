import pkg from "../package.json";
import { CODE_RE, ROOM_MODES, Room, type RoomMode } from "./room";

export { Room };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  type Body = { playerId?: unknown; mode?: unknown };
  const body = await request.json<Body>().catch(() => ({}) as Body);
  if (typeof body.playerId !== "string" || !PLAYER_ID_RE.test(body.playerId)) {
    return error(400, "Invalid player id");
  }
  if (!ROOM_MODES.includes(body.mode as RoomMode)) {
    return error(400, "Invalid mode");
  }
  const mode = body.mode as RoomMode;
  // Codes are short, so retry on the rare collision with a live room.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    if (await env.ROOMS.getByName(code).create(code, body.playerId, mode)) {
      return Response.json({ code });
    }
  }
  return error(503, "Could not allocate a room code");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return Response.json({ version: pkg.version, build: env.BUILD_NUMBER, commit: env.COMMIT_SHA });
    }

    if (url.pathname === "/api/rooms") {
      if (request.method !== "POST") return error(405, "Method not allowed");
      return createRoom(request, env);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!CODE_RE.test(code)) return error(404, "Room not found");
      const room = env.ROOMS.getByName(code);

      if (!match[2]) {
        return (await room.exists()) ? Response.json({ code }) : error(404, "Room not found");
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return error(426, "Expected WebSocket upgrade");
      }
      return room.fetch(request);
    }

    return error(404, "Not found");
  },
} satisfies ExportedHandler<Env>;
