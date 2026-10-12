import pkg from "../package.json";
import { MODES, compactGameData, fetchDataDragon } from "../public/bravery.js";
import { CODE_RE, MAX_BUILD_CHOICES, MAX_PLAYERS, MAX_REROLL_LIMIT, ROOM_MODES, Room, type RoomMode } from "./room";

export { Room };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Compact Data Dragon copy, kept for an hour per isolate: a new patch shows up
// within the hour, and visitors never wait on Riot's 1 MB of files.
const GAME_DATA_TTL_MS = 60 * 60 * 1000;
let gameDataCache: { body: string; expires: number } | undefined;

async function gameData(): Promise<Response> {
  if (!gameDataCache || gameDataCache.expires < Date.now()) {
    try {
      const body = JSON.stringify(compactGameData(await fetchDataDragon()));
      gameDataCache = { body, expires: Date.now() + GAME_DATA_TTL_MS };
    } catch {
      // Riot unreachable: keep serving the previous copy if there is one.
      if (!gameDataCache) return error(502, "Data Dragon unavailable");
    }
  }
  return new Response(gameDataCache!.body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

// The app page, with link preview tags (Discord...) pointing at absolute URLs and,
// for a room link, describing the room: crawlers do not run the page's script.
async function page(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new Request(new URL("/", url), request));
  let title = "UBChaos - Ultimate Bravery entre amis";
  let description = "Crée un salon, envoie le lien, chacun choisit son champion et tire son build.";
  let image = "/og-image.png";

  const code = url.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1]?.toUpperCase();
  if (code) {
    const summary = CODE_RE.test(code) ? await env.ROOMS.getByName(code).summary() : null;
    title = `Salon ${code} - UBChaos`;
    description = summary ? describeRoom(summary) : "Ce salon n'existe pas ou a expiré.";
    if (summary) image = roomImage(summary);
  }

  const setContent = (content: string) => ({ element: (el: Element) => void el.setAttribute("content", content) });
  return new HTMLRewriter()
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[name="description"]', setContent(description))
    .on('meta[property="og:url"]', setContent(url.href))
    .on('meta[property="og:image"]', setContent(new URL(image, url).href))
    .transform(asset);
}

// Preview image showing the room settings, pre-rendered for every combination
// by scripts/render-og-image.mjs.
function roomImage(summary: { mode: RoomMode; buildChoices: number; rerollLimit: number | null }): string {
  return `/og/${summary.mode}-${summary.buildChoices}-${summary.rerollLimit ?? "x"}.jpg`;
}

// "Normal - 3 builds au choix - 1 reroll - 2/10 joueurs - Hôte : Nico"
function describeRoom(summary: { mode: RoomMode; buildChoices: number; rerollLimit: number | null; players: number; hostName: string | null }): string {
  const parts = [
    MODES[summary.mode]?.label ?? summary.mode,
    summary.buildChoices > 1 && `${summary.buildChoices} builds au choix`,
    summary.rerollLimit !== null && `${summary.rerollLimit} reroll${summary.rerollLimit > 1 ? "s" : ""}`,
    `${summary.players}/${MAX_PLAYERS} joueurs`,
    summary.hostName && `Hôte : ${summary.hostName}`,
  ];
  return `${parts.filter(Boolean).join(" - ")}. Rejoins le salon pour tirer ton build !`;
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  type Body = { playerId?: unknown; mode?: unknown; buildChoices?: unknown; rerollLimit?: unknown };
  const body = await request.json<Body>().catch(() => ({}) as Body);
  if (typeof body.playerId !== "string" || !PLAYER_ID_RE.test(body.playerId)) {
    return error(400, "Invalid player id");
  }
  if (!ROOM_MODES.includes(body.mode as RoomMode)) {
    return error(400, "Invalid mode");
  }
  const mode = body.mode as RoomMode;
  const buildChoices = body.buildChoices ?? 1;
  if (!Number.isInteger(buildChoices) || (buildChoices as number) < 1 || (buildChoices as number) > MAX_BUILD_CHOICES) {
    return error(400, "Invalid build choices");
  }
  // null (or absent) means unlimited rerolls.
  const rerollLimit = body.rerollLimit ?? null;
  if (rerollLimit !== null && (!Number.isInteger(rerollLimit) || (rerollLimit as number) < 0 || (rerollLimit as number) > MAX_REROLL_LIMIT)) {
    return error(400, "Invalid reroll limit");
  }
  // Codes are short, so retry on the rare collision with a live room.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    if (await env.ROOMS.getByName(code).create(code, body.playerId, mode, buildChoices as number, rerollLimit as number | null)) {
      return Response.json({ code });
    }
  }
  return error(503, "Could not allocate a room code");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname.startsWith("/r/")) {
      return page(request, env);
    }

    if (url.pathname === "/api/gamedata") {
      return gameData();
    }

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
        const status = await room.joinStatus(url.searchParams.get("playerId") ?? "");
        if (status === "missing") return error(404, "Room not found");
        if (status === "full") return error(403, "Room is full");
        if (status === "kicked") return error(403, "Kicked from this room");
        return Response.json({ code });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return error(426, "Expected WebSocket upgrade");
      }
      return room.fetch(request);
    }

    return error(404, "Not found");
  },
} satisfies ExportedHandler<Env>;
