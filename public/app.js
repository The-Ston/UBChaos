import { findRune, loadGameData, randomChampion, rollBuild } from "/bravery.js";

const app = document.getElementById("app");
const gameData = loadGameData();

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

  async function create() {
    if (!readName(name, error)) return;
    error.textContent = "";
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: playerId() }),
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
      h("div", { class: "panel" }, h("button", { onclick: create }, "Créer un salon")),
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
    this.resetButton = h("button", { class: "secondary", hidden: true, onclick: () => this.reset() }, "Tout réinitialiser");
    this.playersEl = h("div", { class: "players" });
    this.search = h("input", { placeholder: "Rechercher un champion…", oninput: () => this.filterChampions() });
    this.rollButton = h("button", { disabled: true, onclick: () => this.roll() }, "Tirer mon build");
    this.championButtons = this.data.champions.map((champion) =>
      h(
        "button",
        { title: champion.name, "data-id": champion.id, "data-search": champion.name.toLowerCase(), onclick: () => this.send({ type: "pick", champion: champion.id }) },
        h("img", { src: this.data.img.champion(champion.id), alt: "", loading: "lazy" }),
        champion.name,
      ),
    );

    app.replaceChildren(
      h(
        "div",
        { class: "room-header" },
        h("div", {}, h("div", { class: "section-label" }, "Code du salon"), h("div", { class: "room-code" }, this.code), this.status),
        h(
          "div",
          { class: "row" },
          h("button", { class: "secondary", onclick: (e) => this.copyLink(e.currentTarget) }, "Copier le lien"),
          this.resetButton,
          h("button", { class: "danger", onclick: () => this.leave() }, "Quitter"),
        ),
      ),
      this.playersEl,
      h(
        "section",
        { class: "panel picker" },
        h("div", { class: "row" }, this.search, h("button", { class: "secondary", onclick: () => this.allRandom() }, "Tout aléatoire"), this.rollButton),
        h("div", { class: "champion-grid" }, this.championButtons),
      ),
    );

    this.connect();
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

  roll() {
    if (!this.myPlayer()?.champion) return;
    this.send({ type: "build", build: rollBuild(this.data) });
  }

  allRandom() {
    const taken = (this.room?.players ?? []).filter((p) => p.id !== this.me && p.champion).map((p) => p.champion);
    this.send({ type: "pick", champion: randomChampion(this.data, taken) });
    this.send({ type: "build", build: rollBuild(this.data) });
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
    const query = this.search.value.trim().toLowerCase();
    for (const button of this.championButtons) {
      button.hidden = query !== "" && !button.dataset.search.includes(query);
    }
  }

  render(room) {
    this.room = room;
    const me = this.myPlayer();
    const taken = new Set(room.players.filter((p) => p.id !== this.me && p.champion).map((p) => p.champion));

    this.resetButton.hidden = room.hostId !== this.me;
    this.rollButton.disabled = !me?.champion;
    this.rollButton.textContent = me?.build ? "Relancer mon build" : "Tirer mon build";
    for (const button of this.championButtons) {
      button.classList.toggle("selected", button.dataset.id === me?.champion);
      button.classList.toggle("taken", taken.has(button.dataset.id));
    }

    // Own card first, then by arrival order.
    const players = [...room.players].sort((a, b) => (b.id === this.me) - (a.id === this.me) || a.joinedAt - b.joinedAt);
    this.playersEl.replaceChildren(...players.map((player) => this.playerCard(player, room.hostId)));
  }

  playerCard(player, hostId) {
    const champion = player.champion ? this.data.championsById[player.champion] : null;
    const classes = ["panel", "player", player.id === this.me && "me", !player.online && "offline"].filter(Boolean).join(" ");

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
          h("div", { class: "row" }, h("span", { class: `dot ${player.online ? "on" : ""}` }), h("span", { class: "name" }, player.name), player.id === hostId && h("span", { title: "Hôte" }, "👑")),
          h("div", { class: "muted" }, champion ? champion.name : "Choisit son champion…"),
        ),
      ),
      player.build ? this.buildView(player.build) : champion && h("p", { class: "muted" }, "Pas encore de build."),
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
      h("div", { class: "section-label" }, "Runes"),
      h(
        "div",
        { class: "icons small" },
        build.runes.primary.map((id, i) => rune(id, i === 0 ? "keystone" : "")),
        h("span", { class: "muted" }, " · "),
        build.runes.secondary.map((id) => rune(id)),
      ),
      h("div", { class: "section-label" }, "Sorts & ordre des compétences"),
      h(
        "div",
        { class: "row" },
        h("div", { class: "icons small" }, build.spells.map((id) => icon(this.data.img.spell(id), this.data.spellsById[id]?.name ?? id))),
        h("span", { class: "skill-order" }, build.skillOrder.join(" > ")),
      ),
    );
  }
}

// ---------- Routing ----------

const roomMatch = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})\/?$/);
if (roomMatch) showRoom(roomMatch[1].toUpperCase());
else showHome();
