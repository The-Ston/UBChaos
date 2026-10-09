// Data Dragon loading and Ultimate Bravery rolls. Everything runs client-side;
// builds only store ids, so every client renders them from its own copy.

const DDRAGON = "https://ddragon.leagueoflegends.com";
const LOCALE = "fr_FR";
const SUMMONERS_RIFT = "11";
const LEGENDARY_MIN_GOLD = 2000;

export async function loadGameData() {
  const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json());
  const version = versions[0];
  const base = `${DDRAGON}/cdn/${version}/data/${LOCALE}`;
  const [champions, items, runes, summoners] = await Promise.all(
    ["champion", "item", "runesReforged", "summoner"].map((file) =>
      fetch(`${base}/${file}.json`).then((r) => r.json()),
    ),
  );

  const championList = Object.values(champions.data).sort((a, b) => a.name.localeCompare(b.name, LOCALE.replace("_", "-")));
  const shopItems = Object.entries(items.data)
    .map(([id, item]) => ({ ...item, id }))
    // Ids above 10000 are mode-specific copies (Arena, ARAM...).
    .filter((item) => Number(item.id) < 10000)
    .filter((item) => item.maps?.[SUMMONERS_RIFT] && item.gold?.purchasable && item.inStore !== false)
    .filter((item) => !item.requiredChampion && !item.requiredAlly && !item.hideFromAll);

  const boots = shopItems.filter((item) => item.tags?.includes("Boots") && item.from?.includes("1001"));
  const legendaries = uniqueByName(
    shopItems.filter(
      (item) =>
        !item.tags?.some((tag) => tag === "Boots" || tag === "Consumable" || tag === "Trinket") &&
        !item.into?.length &&
        item.gold.total >= LEGENDARY_MIN_GOLD,
    ),
  );
  const spells = Object.values(summoners.data).filter((spell) => spell.modes.includes("CLASSIC"));

  return {
    version,
    champions: championList,
    championsById: champions.data,
    items: items.data,
    boots,
    legendaries,
    runeTrees: runes,
    spells,
    spellsById: Object.fromEntries(spells.map((spell) => [spell.id, spell])),
    img: {
      champion: (id) => `${DDRAGON}/cdn/${version}/img/champion/${champions.data[id]?.image.full}`,
      item: (id) => `${DDRAGON}/cdn/${version}/img/item/${id}.png`,
      spell: (id) => `${DDRAGON}/cdn/${version}/img/spell/${summoners.data[id]?.image.full}`,
      rune: (icon) => `${DDRAGON}/cdn/img/${icon}`,
    },
  };
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

export function rollBuild(data) {
  const [primaryTree, secondaryTree] = sample(data.runeTrees, 2);
  const [keystoneSlot, ...primarySlots] = primaryTree.slots;
  const secondarySlots = sample(secondaryTree.slots.slice(1), 2);

  return {
    items: [pick(data.boots).id, ...sample(data.legendaries, 5).map((item) => item.id)],
    runes: {
      primaryTree: primaryTree.id,
      primary: [pick(keystoneSlot.runes).id, ...primarySlots.map((slot) => pick(slot.runes).id)],
      secondaryTree: secondaryTree.id,
      secondary: secondarySlots.map((slot) => pick(slot.runes).id),
    },
    spells: sample(data.spells, 2).map((spell) => spell.id),
    skillOrder: shuffle(["Q", "W", "E"]),
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
