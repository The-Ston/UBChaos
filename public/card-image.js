// Draws a player's build as a PNG (for pasting in Discord...). Drawn on a canvas
// rather than captured from the page, so it does not depend on page styles;
// Data Dragon serves its images with CORS, so the canvas stays exportable.
import { MODES, ROLES, findRune } from "/bravery.js";

const SCALE = 2;
const WIDTH = 560;
const PAD = 24;
const COLORS = {
  bg: "#0a0e14",
  panel: "#121a24",
  panel2: "#1a2533",
  border: "#2a3a4d",
  text: "#e6e2d6",
  muted: "#8a94a3",
  gold: "#c8aa6e",
  goldBright: "#f0e6d2",
  blue: "#0ac8b9",
};
const FONT = `system-ui, "Segoe UI", sans-serif`;

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    // A missing icon leaves an empty slot rather than failing the whole card.
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawIcon(ctx, image, x, y, size, border = COLORS.border) {
  ctx.save();
  roundRect(ctx, x, y, size, size, 6);
  ctx.fillStyle = COLORS.panel2;
  ctx.fill();
  ctx.clip();
  if (image) ctx.drawImage(image, x, y, size, size);
  ctx.restore();
  roundRect(ctx, x, y, size, size, 6);
  ctx.strokeStyle = border;
  ctx.lineWidth = border === COLORS.border ? 1 : 2;
  ctx.stroke();
}

function label(ctx, text, x, y) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(text.toUpperCase(), x, y);
}

// Lays out the card, returning its height; draws only when `ctx` is given.
function layout(ctx, card) {
  const { build, images } = card;
  let y = PAD;
  const draw = (fn) => ctx && fn();

  // Header: portrait, name, champion, role and mode.
  draw(() => {
    drawIcon(ctx, images.portrait, PAD, y, 88, COLORS.gold);
    ctx.fillStyle = COLORS.goldBright;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(card.playerName, PAD + 108, y + 30);
    ctx.fillStyle = COLORS.text;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(card.championName, PAD + 108, y + 58);
    ctx.fillStyle = COLORS.gold;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText([card.modeLabel, card.roleLabel].filter(Boolean).join("  -  ").toUpperCase(), PAD + 108, y + 82);
  });
  y += 88 + 26;

  const section = (title, height, fn) => {
    draw(() => label(ctx, title, PAD, y + 12));
    y += 22;
    draw(() => fn(y));
    y += height + 16;
  };

  section("Objets", 56, (top) => images.items.forEach((image, i) => drawIcon(ctx, image, PAD + i * 64, top, 56)));

  if (build.runes) {
    section("Runes", 52, (top) => {
      const [keystone, ...primary] = images.primaryRunes;
      drawIcon(ctx, keystone, PAD, top, 52, COLORS.gold);
      primary.forEach((image, i) => drawIcon(ctx, image, PAD + 64 + i * 46, top + 6, 40));
      const secondaryX = PAD + 64 + primary.length * 46 + 18;
      images.secondaryRunes.forEach((image, i) => drawIcon(ctx, image, secondaryX + i * 46, top + 6, 40));
    });
  }

  section("Sorts & ordre des compétences", 48, (top) => {
    images.spells.forEach((image, i) => drawIcon(ctx, image, PAD + i * 56, top, 48));
    if (build.skillOrder) {
      ctx.fillStyle = COLORS.goldBright;
      ctx.font = `800 ${build.skillOrder.some((s) => s.length > 1) ? 15 : 22}px ui-monospace, monospace`;
      ctx.fillText(build.skillOrder.join(" > "), PAD + images.spells.length * 56 + 14, top + 31);
    }
  });

  if (build.augments) {
    section("Optimisations", build.augments.length * 34 + 16, (top) => {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText("↻ : à reroll - encadré : à prendre après les rerolls", PAD, top + build.augments.length * 34 + 12);
      build.augments.forEach(({ level, reroll, pick }, row) => {
        const rowY = top + row * 34;
        ctx.fillStyle = COLORS.goldBright;
        ctx.font = `700 15px ${FONT}`;
        ctx.fillText(`Niv. ${level}`, PAD, rowY + 19);
        [1, 2, 3].forEach((position, i) => {
          const x = PAD + 70 + i * 62;
          const rerolled = reroll.includes(position);
          roundRect(ctx, x, rowY, 54, 28, 6);
          ctx.fillStyle = position === pick ? "#2a2414" : COLORS.panel2;
          ctx.fill();
          ctx.strokeStyle = position === pick ? COLORS.gold : COLORS.border;
          ctx.lineWidth = position === pick ? 2 : 1;
          ctx.stroke();
          ctx.fillStyle = rerolled ? COLORS.blue : position === pick ? COLORS.goldBright : COLORS.text;
          ctx.font = `700 14px ${FONT}`;
          ctx.textAlign = "center";
          ctx.fillText(rerolled ? `${position} ↻` : String(position), x + 27, rowY + 19);
          ctx.textAlign = "left";
        });
      });
    });
  }

  // Signature.
  y += 4;
  draw(() => {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(card.footer, WIDTH - PAD, y);
    ctx.textAlign = "left";
  });
  return y + PAD - 6;
}

// PNG of the player's card. `room` gives the mode; `data` is the game data.
export async function cardImage({ player, build, data, mode, roleLabel }) {
  const icon = (src) => (src ? loadImage(src) : Promise.resolve(null));
  const rune = (id) => icon(findRune(data, id) && data.img.rune(findRune(data, id).icon));
  const [portrait, items, primaryRunes, secondaryRunes, spells] = await Promise.all([
    icon(build.champion && data.img.champion(build.champion)),
    Promise.all(build.items.map((id) => icon(data.img.item(id)))),
    Promise.all((build.runes?.primary ?? []).map(rune)),
    Promise.all((build.runes?.secondary ?? []).map(rune)),
    Promise.all(build.spells.map((id) => icon(data.img.spell(id)))),
  ]);

  const card = {
    build,
    images: { portrait, items, primaryRunes, secondaryRunes, spells },
    playerName: player.name,
    championName: data.championsById[build.champion]?.name ?? "",
    modeLabel: MODES[mode]?.label ?? "",
    roleLabel: roleLabel ?? (build.role ? ROLES[build.role] : ""),
    footer: `UBChaos - ${location.host}`,
  };

  const height = layout(null, card);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  roundRect(ctx, 6, 6, WIDTH - 12, height - 12, 12);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  layout(ctx, card);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// Copies the image to the clipboard, or downloads it where images cannot be copied.
// Returns "copied" or "downloaded".
export async function copyOrDownload(blobPromise, fileName) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      // The promise is handed over as is: Safari requires the item within the click.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
      return "copied";
    } catch {
      // Permission refused or unsupported type: fall back to a download.
    }
  }
  const url = URL.createObjectURL(await blobPromise);
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
