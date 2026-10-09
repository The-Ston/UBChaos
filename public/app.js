import { MODES, ROLES, findRune, loadGameData, randomChampion, rollBuild } from "/bravery.js";
import { searchKeys, searchRank } from "/search.js";

const app = document.getElementById("app");
const gameData = loadGameData();
const MIN_CANDIDATES = 1;
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

  async function create() {
    if (!readName(name, error)) return;
    error.textContent = "";
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: playerId(), mode }),
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

async function showRoom(code) {
  const res = await fetch(`/api/rooms/${code}`).catch(() => null);
  if (!res?.ok) {
    history.replaceState(null, "", "/");
    showHome(`Le salon ${code} n'existe pas ou a expiré.`);
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
    this.status = h("span", { class: "status muted" }, "Connexion…");
    this.modeLabel = h("span", { class: "mode-badge" });
    this.resetButton = h("button", { class: "secondary", hidden: true, onclick: () => this.reset() }, "Tout réinitialiser");
    this.playersEl = h("div", { class: "players" });
    this.search = h("input", { placeholder: "Rechercher un champion…", oninput: () => this.filterChampions() });
    this.rollButton = h("button", { disabled: true, onclick: () => this.roll() }, "Tirer mon build");
    this.randomButton = h("button", { class: "secondary", onclick: () => this.allRandom() }, "Tout aléatoire");
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

    this.championGrid = h("div", { class: "champion-grid" }, this.championButtons);
    this.picker = h(
      "section",
      { class: "panel picker" },
      this.rolePicker,
      this.pickerHint,
      h("div", { class: "row" }, this.search, this.randomButton, this.rollButton),
      this.championGrid,
    );

    app.replaceChildren(
      h(
        "div",
        { class: "room-header" },
        h("div", {}, h("div", { class: "section-label" }, "Code du salon"), h("div", { class: "row" }, h("span", { class: "room-code" }, this.code), this.modeLabel), this.status),
        h(
          "div",
          { class: "row" },
          h("button", { class: "secondary", onclick: (e) => this.copyLink(e.currentTarget) }, "Copier le lien"),
          this.resetButton,
          h("button", { class: "danger", onclick: () => this.leave() }, "Quitter"),
        ),
      ),
      this.playersEl,
      this.picker,
    );

    this.connect();
  }

  clearMine() {
    if (confirm("Effacer ton build et recommencer depuis le début ?")) this.send({ type: "clear" });
  }

  connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ playerId: this.me, name: this.name });
    const socket = new WebSocket(`${protocol}://${location.host}/api/rooms/${this.code}/ws?${params}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retryDelay = 1000;
      this.status.textContent = "Connecté";
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") this.render(message.room);
    });
    socket.addEventListener("close", () => {
      if (this.leaving) return;
      this.status.textContent = "Déconnecté, reconnexion…";
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    });
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

  roleLabel(player) {
    const rolled = player.build?.role;
    return player.role === "random" && rolled ? `Aléatoire : ${ROLES[rolled]}` : ROLES[player.role];
  }

  usesCandidates() {
    return MODES[this.room?.mode]?.candidates === true;
  }

  clickChampion(id) {
    if (!this.usesCandidates()) {
      this.send({ type: "pick", champion: id });
      return;
    }
    const candidates = this.myPlayer()?.candidates ?? [];
    if (candidates.includes(id)) {
      this.send({ type: "candidates", champions: candidates.filter((c) => c !== id) });
    } else if (candidates.length < MAX_CANDIDATES) {
      this.send({ type: "candidates", champions: [...candidates, id] });
    }
  }

  roll() {
    const me = this.myPlayer();
    if (this.usesCandidates()) {
      if ((me?.candidates.length ?? 0) < MIN_CANDIDATES) return;
      const champion = me.candidates[Math.floor(Math.random() * me.candidates.length)];
      this.send({ type: "pick", champion });
    } else if (!me?.champion || (this.usesRoles() && !me.role)) {
      return;
    }
    this.send({ type: "build", build: rollBuild(this.data, this.room.mode, me.role) });
  }

  allRandom() {
    const taken = (this.room?.players ?? []).filter((p) => p.id !== this.me && p.champion).map((p) => p.champion);
    const role = this.myPlayer()?.role ?? null;
    if (this.usesRoles() && !role) return;
    this.send({ type: "pick", champion: randomChampion(this.data, taken) });
    this.send({ type: "build", build: rollBuild(this.data, this.room?.mode, role) });
  }

  reset() {
    if (confirm("Réinitialiser les champions et builds de tout le monde ?")) this.send({ type: "reset" });
  }

  leave() {
    this.leaving = true;
    this.send({ type: "leave" });
    location.assign("/");
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
    this.championGrid.replaceChildren(...ranked.map(({ button }) => button));
  }

  render(room) {
    this.room = room;
    const me = this.myPlayer();
    const taken = new Set(room.players.filter((p) => p.id !== this.me && p.champion).map((p) => p.champion));

    this.modeLabel.textContent = MODES[room.mode]?.label ?? room.mode;
    this.resetButton.hidden = room.hostId !== this.me;
    const withCandidates = this.usesCandidates();
    const candidates = me?.candidates ?? [];
    // Once rolled, the picker only takes space; the card's clear button brings it back.
    this.picker.hidden = Boolean(me?.build);
    document.body.classList.toggle("picking", !this.picker.hidden);
    this.rolePicker.hidden = !this.usesRoles();
    for (const button of this.roleButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.role === me?.role));
    }
    this.pickerHint.hidden = !withCandidates;
    this.randomButton.hidden = withCandidates;
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
      this.randomButton.disabled = needsRole;
      this.rollButton.textContent = needsRole ? "Choisis ton rôle" : me?.build ? "Relancer mon build" : "Tirer mon build";
    }
    for (const button of this.championButtons) {
      button.classList.toggle("selected", withCandidates ? candidates.includes(button.dataset.id) : button.dataset.id === me?.champion);
      button.classList.toggle("taken", taken.has(button.dataset.id));
    }

    // Own card first, then by arrival order.
    const players = [...room.players].sort((a, b) => (b.id === this.me) - (a.id === this.me) || a.joinedAt - b.joinedAt);
    this.playersEl.replaceChildren(...players.map((player) => this.playerCard(player, room.hostId)));
  }

  playerCard(player, hostId) {
    const champion = player.champion ? this.data.championsById[player.champion] : null;
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
          : h("div", { class: "portrait" }),
        h(
          "div",
          {},
          h("div", { class: "row" }, h("span", { class: `dot ${player.online ? "on" : ""}` }), h("span", { class: "name" }, player.name), player.id === hostId && h("span", { title: "Hôte" }, "👑"), this.usesRoles() && player.role && h("span", { class: "role-badge" }, this.roleLabel(player))),
          h("div", { class: "muted" }, champion ? champion.name : this.usesCandidates() ? `${player.candidates.length}/${MAX_CANDIDATES} champions sélectionnés` : "Choisit son champion…"),
        ),
        isMe && player.build && h("button", { class: "secondary icon-button", title: "Effacer et recommencer", onclick: () => this.clearMine() }, "↺"),
      ),
      this.usesCandidates() && player.candidates.length > 0 && this.candidatesView(player),
      player.build ? this.buildView(player.build) : champion && h("p", { class: "muted" }, "Pas encore de build."),
    );
  }

  candidatesView(player) {
    return h(
      "div",
      {},
      h("div", { class: "section-label" }, "Champions proposés"),
      h(
        "div",
        { class: "icons small" },
        player.candidates.map((id) => {
          const name = this.data.championsById[id]?.name ?? id;
          return h("img", { src: this.data.img.champion(id), title: name, alt: name, class: id === player.champion ? "keystone" : "" });
        }),
      ),
    );
  }

  buildView(build) {
    const icon = (src, title, cls) => h("img", { src, title, alt: title, class: cls, loading: "lazy" });
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
        h("span", { class: "skill-order" }, build.skillOrder.join(" > ")),
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
          return h("span", { class: classes, title: rerolled ? "À reroll" : "" }, rerolled ? `${position} ↻` : String(position));
        });
        const summary = (reroll.length ? `Reroll ${reroll.join(", ")} · ` : "Aucun reroll · ") + `prends la ${pick}`;
        return h("div", { class: "augment-row" }, h("span", { class: "augment-level" }, `Niv. ${level}`), h("div", { class: "row" }, cards), h("span", { class: "muted" }, summary));
      }),
    );
  }
}

// ---------- Routing ----------

const roomMatch = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})\/?$/);
if (roomMatch) showRoom(roomMatch[1].toUpperCase());
else showHome();
