// Data Dragon loading and Ultimate Bravery rolls. Rolls run client-side; builds
// only store ids, so every client renders them from its own copy. The Worker
// imports the fetch/compact helpers to serve /api/gamedata.
import { ITEM_GROUPS } from "./item-groups.js";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const LOCALE = "fr_FR";
const LEGENDARY_MIN_GOLD = 2000;
// ARAM: Mayhem offers 3 augments at each of these levels; each card can be rerolled once.
export const AUGMENT_LEVELS = [1, 7, 11, 15];
// "Bonus de stats": 750 gold, opens a choice of 3 permanent stat bonuses (and a hat).
export const STAT_BONUS_ITEM = "6032";
export const STAT_SIDES = { 1: "à gauche", 2: "au centre", 3: "à droite" };
const AUGMENT_CHOICES = 3;

// Keep in sync with ROOM_MODES in src/room.ts.
export const MODES = {
  normal: {
    label: "Normal",
    map: "11",
    spellMode: "CLASSIC",
    runes: true,
    candidates: false,
    augments: false,
    roles: true,
  },
  aram: { label: "ARAM", map: "12", spellMode: "ARAM", runes: true, candidates: true, augments: false, roles: false },
  // "KIWI" is Riot's internal name for ARAM: Mayhem.
  "aram-chaos": { label: "ARAM du Chaos", map: "12", spellMode: "KIWI", runes: false, candidates: true, augments: true, roles: false },
};

// Keep in sync with ROLES in src/room.ts.
export const ROLES = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  // The ADC role quest moves boots to the quest slot, freeing room for a 6th legendary.
  adc: "ADC",
  support: "Support",
  // Resolved to one of the roles above at roll time.
  random: "Aléatoire",
};
const SUPPORT_QUEST_ITEM = "3867";
const SMITE = "SummonerSmite";
// Items only ranged champions can buy (Runaan's Hurricane), and champions that
// switch range type and may buy them anyway.
const RANGED_ONLY_ITEMS = ["3085"];
const RANGE_SWITCHERS = ["Elise", "Gnar", "Jayce", "Kayle", "Nidalee"];
const MELEE_MAX_RANGE = 250;
// What gets a rolled max order. Udyr can rank R from level 1 like his other
// abilities; Aphelios spends his points on bonus stats instead of abilities.
const SKILLS_BY_CHAMPION = {
  Udyr: ["Q", "W", "E", "R"],
  Aphelios: ["Dégâts d'attaque", "Vitesse d'attaque", "Létalité"],
};
const DEFAULT_SKILLS = ["Q", "W", "E"];

// The page loads the compact data served (and cached) by the Worker.
export async function loadGameData() {
  const res = await fetch("/api/gamedata");
  if (!res.ok) throw new Error(`Game data unavailable (${res.status})`);
  return buildGameData(await res.json());
}

// Latest Data Dragon files, as published by Riot (about 1 MB).
export async function fetchDataDragon() {
  const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json());
  const version = versions[0];
  const base = `${DDRAGON}/cdn/${version}/data/${LOCALE}`;
  const [champions, items, runes, summoners] = await Promise.all(
    ["champion", "item", "runesReforged", "summoner"].map((file) => fetch(`${base}/${file}.json`).then((r) => r.json())),
  );
  return { version, champions: champions.data, items: items.data, runes, summoners: summoners.data };
}

// Keeps only what rolls and rendering use, so the page downloads a fraction of Data Dragon.
export function compactGameData({ version, champions, items, runes, summoners }) {
  const pickFields = (object, fields) => Object.fromEntries(fields.filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
  return {
    version,
    champions: Object.fromEntries(
      Object.entries(champions).map(([id, c]) => [id, { id, name: c.name, image: { full: c.image.full }, stats: { attackrange: c.stats.attackrange } }]),
    ),
    items: Object.fromEntries(
      Object.entries(items)
        // Ids above 10000 are mode-specific copies (Arena, ARAM...).
        .filter(([id]) => Number(id) < 10000)
        .map(([id, item]) => [
          id,
          {
            ...pickFields(item, ["name", "inStore", "tags", "maps", "from", "into", "requiredChampion", "requiredAlly", "hideFromAll"]),
            gold: { total: item.gold?.total, purchasable: item.gold?.purchasable },
          },
        ]),
    ),
    runes: runes.map((tree) => ({
      id: tree.id,
      name: tree.name,
      icon: tree.icon,
      slots: tree.slots.map((slot) => ({ runes: slot.runes.map((rune) => ({ id: rune.id, name: rune.name, icon: rune.icon })) })),
    })),
    summoners: Object.fromEntries(
      Object.entries(summoners).map(([id, spell]) => [id, { id: spell.id, name: spell.name, modes: spell.modes, image: { full: spell.image.full } }]),
    ),
  };
}

// Builds the per-mode pools and image helpers from compact data.
export function buildGameData({ version, champions, items, runes, summoners }) {
  const championList = Object.values(champions).sort((a, b) => a.name.localeCompare(b.name, LOCALE.replace("_", "-")));
  const shopItems = Object.entries(items)
    .map(([id, item]) => ({ ...item, id }))
    .filter((item) => item.gold?.purchasable && item.inStore !== false)
    .filter((item) => !item.requiredChampion && !item.requiredAlly && !item.hideFromAll);
  const allSpells = Object.values(summoners);

  const pools = Object.fromEntries(
    Object.entries(MODES).map(([mode, { map, spellMode }]) => {
      const onMap = shopItems.filter((item) => item.maps?.[map]);
      const boots = onMap.filter((item) => item.tags?.includes("Boots") && item.from?.includes("1001"));
      const legendaries = withExclusiveGroups(
        uniqueByName(
          onMap.filter(
            (item) =>
              !item.tags?.some((tag) => tag === "Boots" || tag === "Consumable" || tag === "Trinket") &&
              !item.into?.length &&
              item.gold.total >= LEGENDARY_MIN_GOLD,
          ),
        ),
      );
      const spells = allSpells.filter((spell) => spell.modes.includes(spellMode));
      // Starter role items: jungle pets and the final upgrades of the support quest item.
      const roleItems = {
        jungle: uniqueByName(onMap.filter((item) => item.tags?.includes("Jungle") && !item.tags.includes("Consumable") && !item.tags.includes("Trinket"))),
        support: onMap.filter((item) => item.from?.includes(SUPPORT_QUEST_ITEM)),
      };
      return [mode, { boots, legendaries, spells, roleItems }];
    }),
  );

  return {
    version,
    champions: championList,
    championsById: champions,
    items,
    pools,
    runeTrees: runes,
    spellsById: summoners,
    img: {
      champion: (id) => `${DDRAGON}/cdn/${version}/img/champion/${champions[id]?.image.full}`,
      item: (id) => `${DDRAGON}/cdn/${version}/img/item/${id}.png`,
      spell: (id) => `${DDRAGON}/cdn/${version}/img/spell/${summoners[id]?.image.full}`,
      rune: (icon) => `${DDRAGON}/cdn/img/${icon}`,
    },
  };
}

// "16.20.1" -> "16.20", the patch name players know.
export const patchName = (version) => version.split(".").slice(0, 2).join(".");

// Items in the same group cannot be owned together. Data Dragon does not expose
// these groups: public/item-groups.js is generated from the game files.
export { ITEM_GROUPS };

function withExclusiveGroups(items) {
  return items.map((item) => ({
    ...item,
    groups: Object.keys(ITEM_GROUPS).filter((group) => ITEM_GROUPS[group].includes(item.id)),
  }));
}

// Like sample(), but never returns two items from the same exclusive group.
function sampleCompatible(list, count) {
  const takenGroups = new Set();
  const result = [];
  for (const item of shuffle(list)) {
    if (item.groups.some((group) => takenGroups.has(group))) continue;
    for (const group of item.groups) takenGroups.add(group);
    result.push(item);
    if (result.length === count) break;
  }
  return result;
}

function uniqueByName(list) {
  const seen = new Set();
  return list.filter((item) => !seen.has(item.name) && seen.add(item.name));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sample(list, count) {
  return shuffle(list).slice(0, count);
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function randomChampion(data, exclude = []) {
  const pool = data.champions.filter((champion) => !exclude.includes(champion.id));
  return pick(pool.length ? pool : data.champions).id;
}

export function rollBuild(data, mode, chosenRole = null, champion = null) {
  const pool = data.pools[mode] ?? data.pools.normal;
  const role = chosenRole === "random" ? pick(Object.keys(ROLES).filter((r) => r !== "random")) : chosenRole;
  const roleItems = pool.roleItems[role] ?? [];
  const roleItem = roleItems.length ? [pick(roleItems)] : [];
  // 6 inventory slots shared by boots, the role item (jungle, support) and
  // legendaries. The ADC's boots end up in the quest slot, freeing one.
  const legendaryCount = 6 - roleItem.length - (role === "adc" ? 0 : 1);
  const legendaries = pool.legendaries.filter((item) => canBuy(data, champion, item.id));
  const items = [pick(pool.boots), ...roleItem, ...sampleCompatible(legendaries, legendaryCount)];

  return {
    role,
    items: items.map((item) => item.id),
    runes: MODES[mode]?.runes === false ? null : rollRunes(data),
    spells: rollSpells(pool, role),
    // The champion actually played: the player's pick may be "random".
    champion,
    skillOrder: rollSkillOrder(champion),
    augments: MODES[mode]?.augments ? rollAugments() : null,
    // Stats bought with surplus gold (750 gold, 3 cards): always take the card at this position.
    statPick: MODES[mode]?.augments ? pick([1, 2, 3]) : null,
  };
}

// Whether the champion's range type allows buying the item. Melee champions
// top out at 225 range and ranged ones start at 300.
function canBuy(data, champion, itemId) {
  if (!RANGED_ONLY_ITEMS.includes(itemId) || !champion || RANGE_SWITCHERS.includes(champion)) return true;
  const range = data.championsById[champion]?.stats?.attackrange;
  return range === undefined || range > MELEE_MAX_RANGE;
}

// The jungler always needs Smite (also required for jungle pets); it is
// useless in lane, so other roles never get it.
function rollSpells(pool, role) {
  const others = pool.spells.filter((spell) => spell.id !== SMITE);
  const hasSmite = pool.spells.some((spell) => spell.id === SMITE);
  if (role === "jungle" && hasSmite) return [SMITE, pick(others).id];
  return sample(others, 2).map((spell) => spell.id);
}

function rollSkillOrder(champion) {
  return shuffle(SKILLS_BY_CHAMPION[champion] ?? DEFAULT_SKILLS);
}

// Augments are not in Data Dragon, so the roll only says which card positions
// to reroll and which one to take afterwards.
function rollAugments() {
  const positions = Array.from({ length: AUGMENT_CHOICES }, (_, i) => i + 1);
  return AUGMENT_LEVELS.map((level) => ({
    level,
    reroll: positions.filter(() => Math.random() < 0.5),
    pick: pick(positions),
  }));
}

function rollRunes(data) {
  const [primaryTree, secondaryTree] = sample(data.runeTrees, 2);
  const [keystoneSlot, ...primarySlots] = primaryTree.slots;
  const secondarySlots = sample(secondaryTree.slots.slice(1), 2);
  return {
    primaryTree: primaryTree.id,
    primary: [pick(keystoneSlot.runes).id, ...primarySlots.map((slot) => pick(slot.runes).id)],
    secondaryTree: secondaryTree.id,
    secondary: secondarySlots.map((slot) => pick(slot.runes).id),
  };
}

export function findRune(data, id) {
  for (const tree of data.runeTrees) {
    if (tree.id === id) return tree;
    for (const slot of tree.slots) {
      const rune = slot.runes.find((r) => r.id === id);
      if (rune) return rune;
    }
  }
  return null;
}
