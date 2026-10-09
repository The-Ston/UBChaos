import { MODES, ROLES, findRune, loadGameData, patchName, randomChampion, rollBuild } from "/bravery.js";
import { searchKeys, searchRank } from "/search.js";

const app = document.getElementById("app");
const gameData = loadGameData();
const MIN_CANDIDATES = 1;
// Keep in sync with KICKED_CLOSE_CODE in src/room.ts.
const KICKED_CLOSE_CODE = 4001;
// Picked champion meaning "draw a random one when generating the build".
const RANDOM_CHAMPION = "random";
// Keep in sync with MAX_BUILD_CHOICES in src/room.ts.
const MAX_BUILD_CHOICES = 5;
// Reroll limits offered at room creation; null is unlimited.
const REROLL_LIMITS = [0, 1, 2, 3, null];
const MAX_CANDIDATES = 3;

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or blocked storage: the session still works without it.
    }
  },
};

function playerId() {
  let id = storage.get("ubchaos.playerId");
  if (!id) {
    id = crypto.randomUUID();
    storage.set("ubchaos.playerId", id);
  }
  return id;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

function nameInput() {
  return h("input", { maxlength: 24, placeholder: "Ton pseudo", value: storage.get("ubchaos.name") ?? "" });
}

function readName(input, errorEl) {
  const name = input.value.trim();
  if (!name) {
    errorEl.textContent = "Choisis un pseudo.";
    input.focus();
    return null;
  }
  storage.set("ubchaos.name", name);
  return name;
}

// ---------- Home ----------

function showHome(message = "") {
  const name = nameInput();
  const code = h("input", { maxlength: 5, placeholder: "CODE", autocapitalize: "characters" });
  const error = h("p", { class: "error" }, message);
  let mode = "normal";
  const modeButtons = Object.entries(MODES).map(([key, { label }]) =>
    h("button", { class: "secondary", "aria-pressed": String(key === mode), onclick: () => selectMode(key) }, label),
  );

  function selectMode(key) {
    mode = key;
    for (const [i, button] of modeButtons.entries()) {
      button.setAttribute("aria-pressed", String(Object.keys(MODES)[i] === key));
    }
  }

  let buildChoices = 1;
  const choiceButtons = Array.from({ length: MAX_BUILD_CHOICES }, (_, i) =>
    h("button", { class: "secondary", "aria-pressed": String(i === 0), onclick: () => selectChoices(i + 1) }, String(i + 1)),
  );

  function selectChoices(count) {
    buildChoices = count;
    for (const [i, button] of choiceButtons.entries()) button.setAttribute("aria-pressed", String(i + 1 === count));
    updateOptionsSummary();
  }

  // null means unlimited.
  let rerollLimit = null;
  const rerollButtons = REROLL_LIMITS.map((limit) =>
    h("button", { class: "secondary", "aria-pressed": String(limit === null), onclick: () => selectRerolls(limit) }, limit === null ? "∞" : String(limit)),
  );

  function selectRerolls(limit) {
    rerollLimit = limit;
    for (const [i, button] of rerollButtons.entries()) button.setAttribute("aria-pressed", String(REROLL_LIMITS[i] === limit));
    updateOptionsSummary();
  }

  // Room options stay folded behind a one-line reminder of their values.
  const optionsSummary = h("span", { class: "options-summary" });
  const optionsPanel = h(
    "div",
    { class: "options-panel", hidden: true },
    h("div", { class: "section-label" }, "Builds proposés au choix"),
    h("div", { class: "row choice-toggle" }, choiceButtons),
    h("div", { class: "section-label" }, "Rerolls autorisés"),
    h("div", { class: "row choice-toggle" }, rerollButtons),
  );
  const optionsToggle = h(
    "button",
    {
      class: "options-toggle",
      "aria-expanded": "false",
      onclick: () => {
        optionsPanel.hidden = !optionsPanel.hidden;
        optionsToggle.setAttribute("aria-expanded", String(!optionsPanel.hidden));
      },
    },
    "⚙ Options : ",
    optionsSummary,
    h("span", { class: "options-sign", "aria-hidden": "true" }),
  );

  function updateOptionsSummary() {
    const builds = buildChoices === 1 ? "1 build" : `${buildChoices} builds au choix`;
    const rerolls = rerollLimit === null ? "rerolls illimités" : `${rerollLimit} reroll${rerollLimit > 1 ? "s" : ""}`;
    optionsSummary.textContent = `${builds}, ${rerolls}`;
  }
  updateOptionsSummary();

  async function create() {
    if (!readName(name, error)) return;
    error.textContent = "";
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: playerId(), mode, buildChoices, rerollLimit }),
    }).catch(() => null);
    if (!res?.ok) {
      error.textContent = "Impossible de créer le salon.";
      return;
    }
    const { code } = await res.json();
    location.assign(`/r/${code}`);
  }

  function join() {
    if (!readName(name, error)) return;
    const value = code.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(value)) {
      error.textContent = "Le code fait 5 caractères.";
      return;
    }
    location.assign(`/r/${value}`);
  }

  app.replaceChildren(
    h(
      "div",
      { class: "home" },
      h("div", {}, h("h1", {}, "Ultimate Bravery"), h("p", { class: "muted" }, "Crée un salon, envoie le lien, chacun choisit son champion et tire son build.")),
      h("div", { class: "panel" }, h("label", {}, "Pseudo", name)),
      h(
        "div",
        { class: "panel create" },
        h("div", { class: "section-label" }, "Mode de jeu"),
        h("div", { class: "row mode-toggle" }, modeButtons),
        optionsToggle,
        optionsPanel,
        h("button", { onclick: create }, "Créer un salon"),
      ),
      h(
        "div",
        { class: "panel" },
        h("label", {}, "Rejoindre avec un code", h("div", { class: "row" }, code, h("button", { class: "secondary", onclick: join }, "Rejoindre"))),
      ),
      error,
    ),
  );
}

// ---------- Room ----------

// Whether this player may enter the room: "ok", "offline" (server unreachable),
// or the message explaining why not.
async function roomAccess(code) {
  const res = await fetch(`/api/rooms/${code}?playerId=${encodeURIComponent(playerId())}`).catch(() => null);
  if (!res) return "offline";
  if (res.ok) return "ok";
  const { error } = (await res.json().catch(() => null)) ?? {};
  if (error === "Kicked from this room") return `Tu as été exclu du salon ${code}.`;
  if (res.status === 403) return `Le salon ${code} est complet (10 joueurs max).`;
  return `Le salon ${code} n'existe pas ou a expiré.`;
}

function leaveToHome(message) {
  document.body.classList.remove("picking", "modal-open");
  history.replaceState(null, "", "/");
  showHome(message);
}

async function showRoom(code) {
  const access = await roomAccess(code);
  if (access !== "ok") {
    leaveToHome(access === "offline" ? "Impossible de joindre le serveur." : access);
    return;
  }

  const name = storage.get("ubchaos.name");
  if (!name) {
    const input = nameInput();
    const error = h("p", { class: "error" });
    const submit = () => readName(input, error) && showRoom(code);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    app.replaceChildren(
      h(
        "div",
        { class: "home" },
        h("h1", {}, `Salon ${code}`),
        h("div", { class: "panel" }, h("label", {}, "Pseudo", input)),
        h("button", { onclick: submit }, "Rejoindre"),
        error,
      ),
    );
    return;
  }

  app.replaceChildren(h("p", { class: "muted" }, "Chargement des données du jeu…"));
  let data;
  try {
    data = await gameData;
  } catch {
    app.replaceChildren(h("p", { class: "error" }, "Impossible de charger les données Data Dragon."));
    return;
  }

  new RoomView(code, name, data).start();
}

class RoomView {
  constructor(code, name, data) {
    this.code = code;
    this.name = name;
    this.data = data;
    this.me = playerId();
    this.room = null;
    this.socket = null;
    this.leaving = false;
    this.retryDelay = 1000;
  }

  start() {
    // Only shown while the connection is down.
    this.status = h("span", { class: "status muted", hidden: true });
    this.modeLabel = h("span", { class: "mode-badge" });
    this.resetButton = h("button", { class: "secondary", hidden: true, onclick: () => this.reset() }, "Tout réinitialiser");
    // Host padlock for the whole room, styled like the card padlocks.
    this.lockAllButton = h("button", { class: "secondary lock-button lock-all", hidden: true, onclick: () => this.send({ type: "lockAll", locked: !this.room?.locked }) });
    // "Prêts : 2/4" counts locked builds; also says when the host locked the room.
    this.readyLabel = h("div", { class: "ready-label" });
    this.playersEl = h("div", { class: "players" });
    this.search = h("input", { placeholder: "Rechercher un champion…", oninput: () => this.filterChampions() });
    this.rollButton = h("button", { disabled: true, onclick: () => this.roll() }, "Générer mon build");
    // Normal mode only: one click rolls role, champion and build.
    this.randomBlock = h(
      "div",
      { class: "random-block" },
      h("button", { class: "big-random", onclick: () => this.allRandom() }, "Tout aléatoire"),
      h("div", { class: "divider" }, "ou choisis toi-même"),
    );
    this.championLabel = h("div", { class: "section-label" }, "Ton champion");
    this.roleButtons = Object.entries(ROLES).map(([role, label]) =>
      h("button", { class: "secondary", "data-role": role, "aria-pressed": "false", onclick: () => this.selectRole(role) }, label),
    );
    this.rolePicker = h("div", { hidden: true }, h("div", { class: "section-label" }, "Ton rôle"), h("div", { class: "row role-toggle" }, this.roleButtons));
    this.pickerHint = h("p", { class: "muted", hidden: true }, "Sélectionne ton champion, ou les 2-3 proposés en jeu : le tirage choisira lequel tu joues.");
    this.searchKeys = new Map(this.data.champions.map((champion) => [champion.id, searchKeys(champion)]));
    this.championButtons = this.data.champions.map((champion) =>
      h(
        "button",
        { title: champion.name, "data-id": champion.id, onclick: () => this.clickChampion(champion.id) },
        h("img", { src: this.data.img.champion(champion.id), alt: "", loading: "lazy" }),
        champion.name,
      ),
    );

    // Normal mode: a "champion" tile meaning "draw one at generation time".
    this.randomChampionTile = h(
      "button",
      { title: "Champion aléatoire", class: "random-tile", onclick: () => this.clickChampion(RANDOM_CHAMPION) },
      h("span", { class: "random-portrait" }, "?"),
      "Aléatoire",
    );
    this.championGrid = h("div", { class: "champion-grid" }, this.randomChampionTile, this.championButtons);
    this.optionsModal = h("div", { class: "modal-backdrop", hidden: true });
    // Hidden until the first room state arrives, so nothing is sent on a closed socket.
    this.picker = h(
      "section",
      { class: "panel picker", hidden: true },
      this.randomBlock,
      this.rolePicker,
      this.pickerHint,
      this.championLabel,
      h("div", { class: "row" }, this.search, this.rollButton),
      this.championGrid,
    );

    app.replaceChildren(
      h(
        "div",
        { class: "room-header" },
        h("div", {}, h("div", { class: "section-label" }, "Code du salon"), h("div", { class: "row" }, h("button", { class: "room-code", title: "Copier le code", onclick: (e) => this.copyCode(e.currentTarget) }, h("span", { class: "code-text" }, this.code), h("span", { class: "copied-text" }, "Copié !")), this.modeLabel), this.readyLabel, this.status),
        h(
          "div",
          { class: "row" },
          h("button", { class: "secondary", onclick: (e) => this.copyLink(e.currentTarget) }, "Copier le lien"),
          this.lockAllButton,
          this.resetButton,
          h("button", { class: "danger", onclick: () => this.leave() }, "Quitter"),
        ),
      ),
      this.playersEl,
      this.picker,
      this.optionsModal,
    );

    this.connect();
  }

  kicked() {
    if (this.leaving) return;
    this.leaving = true;
    this.socket?.close();
    leaveToHome(`Tu as été exclu du salon ${this.code}.`);
  }

  promote(player) {
    if (confirm(`Nommer ${player.name} hôte du salon ? Tu perdras ce rôle.`)) {
      this.send({ type: "promote", playerId: player.id });
    }
  }

  kick(player) {
    if (confirm(`Exclure ${player.name} du salon ? Il ne pourra plus revenir.`)) {
      this.send({ type: "kick", playerId: player.id });
    }
  }

  clearMine() {
    if (confirm("Effacer ton build et tes choix pour recommencer ?")) this.send({ type: "clear" });
  }

  connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ playerId: this.me, name: this.name });
    const socket = new WebSocket(`${protocol}://${location.host}/api/rooms/${this.code}/ws?${params}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retryDelay = 1000;
      this.status.hidden = true;
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") this.render(message.room);
      else if (message.type === "kicked") this.kicked();
    });
    socket.addEventListener("close", (event) => {
      if (this.leaving) return;
      if (event.code === KICKED_CLOSE_CODE) {
        this.kicked();
        return;
      }
      this.status.textContent = "Déconnecté, reconnexion…";
      this.status.hidden = false;
      setTimeout(() => this.reconnect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    });
  }

  // Reconnects only if the room still exists and accepts us; an expired room
  // would otherwise reject the socket forever.
  async reconnect() {
    if (this.leaving) return;
    const access = await roomAccess(this.code);
    if (access === "ok" || access === "offline") {
      this.connect();
      return;
    }
    this.leaving = true;
    leaveToHome(access);
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  myPlayer() {
    return this.room?.players.find((p) => p.id === this.me);
  }

  usesRoles() {
    return MODES[this.room?.mode]?.roles === true;
  }

  selectRole(role) {
    const current = this.myPlayer()?.role ?? null;
    this.send({ type: "role", role: role === current ? null : role });
  }

  // Short enough to fit next to the card buttons: "🎲 Support" for a rolled random role.
  roleLabel(player) {
    if (player.role !== "random") return ROLES[player.role];
    const rolled = player.build?.role;
    return `🎲 ${rolled ? ROLES[rolled] : ROLES.random}`;
  }

  usesCandidates() {
    return MODES[this.room?.mode]?.candidates === true;
  }

  clickChampion(id) {
    if (!this.usesCandidates()) {
      this.send({ type: "pick", champion: id });
      return;
    }
    // The random tile excludes real champions, and vice versa.
    const current = this.myPlayer()?.candidates ?? [];
    const candidates = id === RANDOM_CHAMPION ? current.filter((c) => c === RANDOM_CHAMPION) : current.filter((c) => c !== RANDOM_CHAMPION);
    if (candidates.includes(id)) {
      this.send({ type: "candidates", champions: candidates.filter((c) => c !== id) });
    } else if (candidates.length < MAX_CANDIDATES) {
      this.send({ type: "candidates", champions: [...candidates, id] });
    }
  }

  // Generates a build from the current choices, which are left untouched so the
  // same roll can be redone: "random" picks are drawn again each time and the
  // drawn champion is stored in the build.
  roll() {
    const me = this.myPlayer();
    // A first generation is always allowed; later ones need a reroll left (null: unlimited).
    const left = this.rerollsLeft(me);
    if (me?.generations > 0 && left !== null && left <= 0) return;
    if (this.usesCandidates()) {
      if ((me?.candidates.length ?? 0) < MIN_CANDIDATES) return;
      this.sendBuilds(() => this.rollOne(me.role, me.candidates[Math.floor(Math.random() * me.candidates.length)]));
    } else {
      if (!me?.champion || (this.usesRoles() && !me.role)) return;
      this.sendBuilds(() => this.rollOne(me.role, me.champion));
    }
  }

  // One build for a champion choice, which may be the random pick.
  rollOne(role, choice) {
    const champion = choice === RANDOM_CHAMPION ? randomChampion(this.data, this.takenChampions()) : choice;
    return rollBuild(this.data, this.room.mode, role, champion);
  }

  // Sends one build, or several independent ones to choose from when the room offers them.
  sendBuilds(makeBuild) {
    const count = this.room?.buildChoices ?? 1;
    if (count < 2) this.send({ type: "build", build: makeBuild() });
    else this.send({ type: "options", builds: Array.from({ length: count }, () => makeBuild()) });
  }

  // Rerolls a player has left, or null when unlimited. The first generation is free.
  rerollsLeft(player) {
    const limit = this.room?.rerollLimit ?? null;
    if (limit === null) return null;
    return limit - Math.max(0, (player?.generations ?? 0) - 1);
  }

  // Champion actually played by a player: the drawn one once a build exists.
  playedChampion(player) {
    return player.build?.champion ?? (player.champion === RANDOM_CHAMPION ? null : player.champion);
  }

  // Real champions already played or picked by the other players.
  takenChampions() {
    return (this.room?.players ?? [])
      .filter((p) => p.id !== this.me)
      .map((p) => this.playedChampion(p))
      .filter(Boolean);
  }

  // Rolls everything: the role (when the mode has roles), the champion and the build.
  allRandom() {
    const role = this.usesRoles() ? "random" : null;
    if (role) this.send({ type: "role", role });
    this.send({ type: "pick", champion: RANDOM_CHAMPION });
    this.sendBuilds(() => this.rollOne(role, RANDOM_CHAMPION));
  }

  reset() {
    if (confirm("Réinitialiser les champions et builds de tout le monde ?")) this.send({ type: "reset" });
  }

  leave() {
    this.leaving = true;
    this.send({ type: "leave" });
    location.assign("/");
  }

  async copyCode(button) {
    try {
      await navigator.clipboard.writeText(this.code);
      // The label overlays the code, so the button keeps its size.
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1500);
    } catch {
      // Clipboard unavailable: the code stays visible to copy by hand.
    }
  }

  async copyLink(button) {
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Lien copié !";
    } catch {
      button.textContent = location.href;
    }
    setTimeout(() => (button.textContent = "Copier le lien"), 2000);
  }

  filterChampions() {
    const query = this.search.value;
    // Stable sort keeps the alphabetical order within each rank.
    const ranked = this.championButtons
      .map((button) => ({ button, rank: searchRank(this.searchKeys.get(button.dataset.id), query) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    for (const { button, rank } of ranked) button.hidden = rank === null;
    this.championGrid.replaceChildren(this.randomChampionTile, ...ranked.map(({ button }) => button));
    this.updateRandomTile();
  }

  // Hidden while searching.
  updateRandomTile() {
    const me = this.myPlayer();
    const selected = this.usesCandidates() ? (me?.candidates ?? []).includes(RANDOM_CHAMPION) : me?.champion === RANDOM_CHAMPION;
    this.randomChampionTile.hidden = this.search.value.trim() !== "";
    this.randomChampionTile.classList.toggle("selected", selected);
  }

  render(room) {
    this.room = room;
    const me = this.myPlayer();
    const taken = new Set(this.takenChampions());

    const choices = room.buildChoices ?? 1;
    const limit = room.rerollLimit ?? null;
    this.modeLabel.textContent = [
      MODES[room.mode]?.label ?? room.mode,
      choices > 1 && `${choices} builds au choix`,
      limit !== null && `${limit} reroll${limit > 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join(" - ");
    this.resetButton.hidden = room.hostId !== this.me;
    this.lockAllButton.hidden = room.hostId !== this.me;
    this.lockAllButton.textContent = room.locked ? "🔒" : "🔓";
    this.lockAllButton.title = room.locked ? "Tout déverrouiller" : "Tout verrouiller";
    this.lockAllButton.classList.toggle("locked", Boolean(room.locked));
    const ready = room.players.filter((p) => p.locked && p.build).length;
    this.readyLabel.textContent = room.locked ? "🔒 Salon verrouillé par l'hôte" : `Prêts : ${ready}/${room.players.length}`;
    this.readyLabel.classList.toggle("all-ready", room.locked || (ready > 0 && ready === room.players.length));
    const withCandidates = this.usesCandidates();
    const candidates = me?.candidates ?? [];
    // Once rolled, the picker only takes space; the card's clear button brings it back.
    // Also hidden while the host keeps the room locked: nothing could be generated.
    this.picker.hidden = Boolean(me?.build || me?.options?.length || room.locked);
    document.body.classList.toggle("picking", !this.picker.hidden);
    this.rolePicker.hidden = !this.usesRoles();
    for (const button of this.roleButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.role === me?.role));
    }
    this.pickerHint.hidden = !withCandidates;
    this.randomBlock.hidden = withCandidates;
    this.championLabel.hidden = withCandidates;
    if (withCandidates) {
      this.rollButton.disabled = candidates.length < MIN_CANDIDATES;
      this.rollButton.textContent =
        candidates.length < MIN_CANDIDATES
          ? `Sélectionne 1 à ${MAX_CANDIDATES} champions`
          : candidates.length === 1
            ? me?.build ? "Relancer mon build" : "Tirer mon build"
            : me?.build ? "Relancer champion + build" : "Tirer champion + build";
    } else {
      const needsRole = this.usesRoles() && !me?.role;
      this.rollButton.disabled = !me?.champion || needsRole;
      this.rollButton.textContent = needsRole ? "Choisis ton rôle" : !me?.champion ? "Choisis ton champion" : "Générer mon build";
    }
    for (const button of this.championButtons) {
      button.classList.toggle("selected", withCandidates ? candidates.includes(button.dataset.id) : button.dataset.id === me?.champion);
      button.classList.toggle("taken", taken.has(button.dataset.id));
    }
    this.updateRandomTile();

    // Own card first, then by arrival order.
    const players = [...room.players].sort((a, b) => (b.id === this.me) - (a.id === this.me) || a.joinedAt - b.joinedAt);
    this.playersEl.replaceChildren(...players.map((player) => this.playerCard(player, room.hostId)));
    this.renderOptionsModal(me);
  }

  playerCard(player, hostId) {
    const played = this.playedChampion(player);
    const champion = played ? this.data.championsById[played] : null;
    const randomPick = !player.build && player.champion === RANDOM_CHAMPION;
    const generated = Boolean(player.build || player.options.length);
    const isMe = player.id === this.me;
    const classes = ["panel", "player", isMe && "me", !player.online && "offline"].filter(Boolean).join(" ");

    return h(
      "article",
      { class: classes },
      h(
        "div",
        { class: "player-head" },
        champion
          ? h("img", { class: "portrait", src: this.data.img.champion(champion.id), alt: champion.name, title: champion.name })
          : h("div", { class: `portrait ${randomPick ? "random-portrait" : ""}` }, randomPick ? "?" : ""),
        h(
          "div",
          {},
          h("div", { class: "row" }, h("span", { class: `dot ${player.online ? "on" : ""}` }), h("span", { class: "name" }, player.name), player.id === hostId && h("span", { title: "Hôte" }, "👑"), !isMe && player.locked && h("span", { title: "Build verrouillé : prêt" }, "🔒"), this.usesRoles() && player.role && h("span", { class: "role-badge" }, this.roleLabel(player))),
          h("div", { class: "muted" }, champion ? champion.name : randomPick ? "Champion aléatoire" : this.usesCandidates() ? `${player.candidates.length}/${MAX_CANDIDATES} champions sélectionnés` : "Choisit son champion…"),
        ),
        h(
          "div",
          { class: "card-actions" },
          isMe && generated && this.buildActions(player),
          !isMe && this.me === hostId && h("button", { class: "secondary icon-button", title: "Nommer hôte", onclick: () => this.promote(player) }, "👑"),
          !isMe && this.me === hostId && h("button", { class: "danger icon-button", title: "Exclure du salon", onclick: () => this.kick(player) }, "✕"),
        ),
      ),
      this.usesCandidates() && player.candidates.length > 0 && this.candidatesView(player),
      player.build
        ? this.buildView(player.build)
        : player.options.length
          ? h("p", { class: "muted" }, isMe ? "Choisis ton build dans la fenêtre." : `Choisit parmi ${player.options.length} builds…`)
          : this.room?.locked
            ? h("p", { class: "muted" }, "Salon verrouillé par l'hôte.")
            : champion && h("p", { class: "muted" }, "Pas encore de build."),
    );
  }

  // ↺ (regenerate with the same choices) and the bin (clear the choices), for the own card and the options window.
  buildActions(player) {
    const roomLocked = Boolean(this.room?.locked);
    const remaining = this.rerollsLeft(player);
    const frozen = roomLocked || player.locked;
    const noReroll = frozen || (remaining !== null && remaining <= 0);
    const frozenTitle = roomLocked ? "Salon verrouillé par l'hôte" : player.locked ? "Build verrouillé" : "Plus de reroll : build définitif";
    const rerollTitle = noReroll
      ? frozenTitle
      : `Regénérer avec les mêmes choix${remaining === null ? "" : ` (${remaining} reroll${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""})`}`;
    return [
      // Locking needs a kept build, not pending options.
      player.build &&
        h(
          "button",
          {
            class: `secondary icon-button lock-button ${player.locked ? "locked" : ""}`,
            title: roomLocked ? "Salon verrouillé par l'hôte" : player.locked ? "Déverrouiller mon build" : "Verrouiller mon build (je suis prêt)",
            disabled: roomLocked,
            onclick: () => this.send({ type: "lock", locked: !player.locked }),
          },
          player.locked || roomLocked ? "🔒" : "🔓",
        ),
      h("button", { class: "secondary icon-button", title: rerollTitle, disabled: noReroll, onclick: () => this.roll() }, remaining === null ? "↺" : `↺ ${remaining}`),
      h("button", { class: "danger icon-button", title: noReroll ? frozenTitle : "Effacer mes choix", disabled: noReroll, onclick: () => this.clearMine() }, "🗑"),
    ];
  }

  // Window over the page showing the offered builds side by side.
  renderOptionsModal(me) {
    const options = me?.options ?? [];
    this.optionsModal.hidden = options.length === 0;
    document.body.classList.toggle("modal-open", options.length > 0);
    if (!options.length) return;
    this.optionsModal.replaceChildren(
      h(
        "div",
        { class: "modal" },
        h("div", { class: "modal-head" }, h("h2", {}, "Choisis ton build"), h("div", { class: "card-actions" }, this.buildActions(me))),
        this.optionsView(options),
      ),
    );
  }

  // Builds offered to the player, each with its own champion and role draws.
  optionsView(options) {
    return h(
      "div",
      { class: "options" },
      options.map((build, index) => {
        const champion = this.data.championsById[build.champion];
        const title = [`Build ${index + 1}`, champion?.name, build.role && ROLES[build.role]].filter(Boolean).join(" - ");
        return h(
          "section",
          { class: "option" },
          h(
            "div",
            { class: "option-head" },
            champion && h("img", { class: "option-portrait", src: this.data.img.champion(champion.id), alt: champion.name }),
            h("span", { class: "option-title" }, title),
            h("button", { onclick: () => this.send({ type: "choose", index }) }, "Choisir"),
          ),
          this.buildView(build),
        );
      }),
    );
  }

  candidatesView(player) {
    const played = player.build?.champion;
    // A drawn champion that is not among the candidates came from the random tile.
    const isPlayed = (id) => id === played || (id === RANDOM_CHAMPION && played && !player.candidates.includes(played));
    return h(
      "div",
      {},
      h("div", { class: "section-label" }, "Champions proposés"),
      h(
        "div",
        { class: "icons small" },
        player.candidates.map((id) => {
          const cls = isPlayed(id) ? "keystone" : "";
          if (id === RANDOM_CHAMPION) {
            return h("span", { class: `random-portrait random-icon ${cls}`, title: "Champion aléatoire" }, "?");
          }
          const name = this.data.championsById[id]?.name ?? id;
          return h("img", { src: this.data.img.champion(id), title: name, alt: name, class: cls });
        }),
      ),
    );
  }

  buildView(build) {
    const icon = (src, title, cls) => h("img", { src, title, alt: title, class: cls });
    const rune = (id, cls) => {
      const r = findRune(this.data, id);
      return r ? icon(this.data.img.rune(r.icon), r.name, cls) : null;
    };

    return h(
      "div",
      { class: "build" },
      h("div", { class: "section-label" }, "Objets"),
      h("div", { class: "icons" }, build.items.map((id) => icon(this.data.img.item(id), this.data.items[id]?.name ?? id))),
      build.runes && [
        h("div", { class: "section-label" }, "Runes"),
        h(
          "div",
          { class: "icons small" },
          build.runes.primary.map((id, i) => rune(id, i === 0 ? "keystone" : "")),
          h("span", { class: "muted" }, " · "),
          build.runes.secondary.map((id) => rune(id)),
        ),
      ],
      h("div", { class: "section-label" }, "Sorts & ordre des compétences"),
      h(
        "div",
        { class: "row" },
        h("div", { class: "icons small" }, build.spells.map((id) => icon(this.data.img.spell(id), this.data.spellsById[id]?.name ?? id))),
        build.skillOrder && h("span", { class: "skill-order" }, build.skillOrder.join(" > ")),
      ),
      build.augments && [h("div", { class: "section-label" }, "Optimisations"), this.augmentsView(build.augments)],
      build.role === "adc" && h("p", { class: "build-note" }, "ADC : tes bottes passeront dans l'emplacement de quête, d'où un légendaire en plus."),
    );
  }

  augmentsView(augments) {
    return h(
      "div",
      { class: "augments" },
      augments.map(({ level, reroll, pick }) => {
        const cards = [1, 2, 3].map((position) => {
          const rerolled = reroll.includes(position);
          const classes = ["augment-card", rerolled && "reroll", position === pick && "pick"].filter(Boolean).join(" ");
          const title = [rerolled && "À reroll", position === pick && "À prendre"].filter(Boolean).join(", ");
          return h("span", { class: classes, title }, rerolled ? `${position} ↻` : String(position));
        });
        return h("div", { class: "augment-row" }, h("span", { class: "augment-level" }, `Niv. ${level}`), h("div", { class: "row" }, cards));
      }),
      h("p", { class: "muted augment-legend" }, "↻ : à reroll - encadré : à prendre après les rerolls"),
    );
  }
}

// ---------- Version ----------

fetch("/api/version")
  .then((res) => res.json())
  .then(({ version, build, commit }) => {
    const el = document.getElementById("version");
    el.textContent = ` - v${version}`;
    el.title = build === "dev" ? "Build local" : `Build ${build} (${commit})`;
  })
  .catch(() => {});

// Patch of the Data Dragon data the builds are rolled from.
gameData
  .then(({ version }) => {
    const el = document.getElementById("patch");
    el.textContent = ` - Patch ${patchName(version)}`;
    el.title = `Données Data Dragon ${version}`;
  })
  .catch(() => {});

// ---------- Routing ----------

const roomMatch = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})\/?$/);
if (roomMatch) showRoom(roomMatch[1].toUpperCase());
else showHome();
