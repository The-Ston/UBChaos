// Item groups (items that cannot be owned together) read from the game files,
// as published by CommunityDragon: Data Dragon does not expose them. Shared by
// scripts/update-item-groups.mjs and the test that checks public/item-groups.js.
import { buildGameData, compactGameData, fetchDataDragon } from "../public/bravery.js";

const CDRAGON_ITEMS = process.env.CDRAGON_URL ||"https://raw.communitydragon.org/latest/game/items.cdtb.bin.json";
const GROUP_PREFIX = "Items/ItemGroups/";

// CommunityDragon could not be reached: callers may skip rather than fail.
export class CDragonUnavailable extends Error {}

// Game file entries are keyed by path, or by the FNV-1a hash of the lowercased
// path when CommunityDragon does not know the path.
function fnv1a(path) {
  let hash = 0x811c9dc5;
  for (const char of path.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `{${hash.toString(16).padStart(8, "0")}}`;
}

// Groups limited to one item that hold at least two of the given items, as
// { name: [ids] } with sorted keys and ids. Throws if the format changed.
export function itemGroupsFromGameFiles(bin, itemIds) {
  if (!Object.values(bin).some((entry) => entry?.__type === "ItemGroup")) {
    throw new Error("No ItemGroup in the game files: the format changed");
  }
  const maxOwnable = (path) => (bin[path] ?? bin[fnv1a(path)])?.mMaxGroupOwnable;
  const groups = {};
  for (const id of itemIds) {
    for (const path of bin[`Items/${id}`]?.mItemGroups ?? []) {
      if (maxOwnable(path) === 1) (groups[path.replace(GROUP_PREFIX, "")] ??= []).push(id);
    }
  }
  const result = Object.fromEntries(
    Object.entries(groups)
      .filter(([, ids]) => ids.length > 1)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ids]) => [name, ids.sort((a, b) => Number(a) - Number(b))]),
  );
  if (!result.LastWhisper) throw new Error("No LastWhisper group in the game files: the format changed");
  return result;
}

// Groups of the legendaries the rolls draw from, with the data they come from.
export async function fetchGameItemGroups() {
  let bin;
  try {
    const res = await fetch(CDRAGON_ITEMS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bin = await res.json();
  } catch (error) {
    throw new CDragonUnavailable(`CommunityDragon unavailable (${CDRAGON_ITEMS}): ${error.message}`);
  }
  const data = buildGameData(compactGameData(await fetchDataDragon()));
  const legendaryIds = new Set(Object.values(data.pools).flatMap((pool) => pool.legendaries.map((item) => item.id)));
  return { groups: itemGroupsFromGameFiles(bin, [...legendaryIds]), data };
}
