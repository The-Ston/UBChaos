// Roll rules, checked over many draws against live Data Dragon data.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ITEM_GROUPS, buildGameData, compactGameData, fetchDataDragon, rollBuild } from "../public/bravery.js";
import { CDragonUnavailable, fetchGameItemGroups } from "../scripts/item-groups-source.mjs";

const DRAWS = 2000;
let data;

before(async () => {
  // Same path as the page: compacted by the Worker, then built client-side.
  data = buildGameData(compactGameData(await fetchDataDragon()));
});

const isBoots = (mode, id) => data.pools[mode].boots.some((item) => item.id === id);
const legendary = (mode, id) => data.pools[mode].legendaries.find((item) => item.id === id);

describe("items", () => {
  it("gives boots plus 5 legendaries to top and mid", () => {
    for (const role of ["top", "mid"]) {
      const build = rollBuild(data, "normal", role, "Ahri");
      assert.equal(build.items.length, 6);
      assert.equal(build.items.filter((id) => isBoots("normal", id)).length, 1);
    }
  });

  it("gives the ADC boots plus 6 legendaries", () => {
    const build = rollBuild(data, "normal", "adc", "Jinx");
    assert.equal(build.items.length, 7);
    assert.equal(build.items.filter((id) => isBoots("normal", id)).length, 1);
  });

  it("puts the role item in the 6 slots for jungle and support", () => {
    for (const role of ["jungle", "support"]) {
      const roleItems = new Set(data.pools.normal.roleItems[role].map((item) => item.id));
      const build = rollBuild(data, "normal", role, "Ahri");
      assert.equal(build.items.length, 6);
      assert.equal(build.items.filter((id) => roleItems.has(id)).length, 1, role);
    }
  });

  it("gives Cassiopeia boots like everyone else", () => {
    const build = rollBuild(data, "normal", "mid", "Cassiopeia");
    assert.equal(build.items.filter((id) => isBoots("normal", id)).length, 1);
  });

  it("keeps Runaan's Hurricane for ranged champions and range switchers", () => {
    const RUNAAN = "3085";
    const draws = (champion) => Array.from({ length: DRAWS }, () => rollBuild(data, "normal", "adc", champion).items).flat();
    assert.ok(!draws("Garen").includes(RUNAAN), "melee Garen never gets it");
    assert.ok(draws("Jinx").includes(RUNAAN), "ranged Jinx can get it");
    assert.ok(draws("Jayce").includes(RUNAAN), "Jayce switches range and can get it");
  });

  it("never combines two items of the same exclusive group", () => {
    for (const mode of ["normal", "aram", "aram-chaos"]) {
      for (let i = 0; i < DRAWS; i++) {
        const groups = rollBuild(data, mode, "adc", "Ahri").items.flatMap((id) => legendary(mode, id)?.groups ?? []);
        assert.equal(new Set(groups).size, groups.length, `${mode}: ${groups}`);
      }
    }
  });

  it("follows the in-game item groups", () => {
    const shareGroup = (a, b) => legendary("normal", a).groups.some((group) => legendary("normal", b).groups.includes(group));
    assert.ok(shareGroup("3071", "6694"), "Black Cleaver and Serylda's Grudge are both Fatality items");
    assert.ok(shareGroup("3302", "3135"), "Terminus and Void Staff are both Blight items");
    assert.ok(!shareGroup("3033", "3165"), "Mortal Reminder and Morellonomicon can be owned together");
  });

  it("keeps Tear items exclusive in every mode", () => {
    for (const mode of ["normal", "aram", "aram-chaos"]) {
      const shareGroup = (a, b) => legendary(mode, a).groups.some((group) => legendary(mode, b).groups.includes(group));
      assert.ok(shareGroup("3004", "3003"), `${mode}: Manamune and Archangel's Staff are both Tear items`);
    }
  });

  it("lists item groups with ids that still exist", () => {
    for (const [group, ids] of Object.entries(ITEM_GROUPS)) {
      for (const id of ids) assert.ok(data.items[id], `${group}: unknown item ${id}`);
    }
  });

  it("matches the item groups of the game files", async (t) => {
    try {
      const { groups } = await fetchGameItemGroups();
      assert.deepEqual(ITEM_GROUPS, groups, "public/item-groups.js is outdated: run node scripts/update-item-groups.mjs");
    } catch (error) {
      if (!(error instanceof CDragonUnavailable)) throw error;
      t.skip(error.message);
    }
  });
});

describe("summoner spells", () => {
  it("always gives Smite to the jungler, never to other roles", () => {
    for (let i = 0; i < DRAWS / 4; i++) {
      assert.ok(rollBuild(data, "normal", "jungle", "Ahri").spells.includes("SummonerSmite"));
      for (const role of ["top", "mid", "adc", "support"]) {
        assert.ok(!rollBuild(data, "normal", role, "Ahri").spells.includes("SummonerSmite"), role);
      }
    }
  });

  it("rolls two different spells", () => {
    for (let i = 0; i < DRAWS; i++) {
      const { spells } = rollBuild(data, "normal", "random", "Ahri");
      assert.equal(new Set(spells).size, 2);
    }
  });
});

describe("roles", () => {
  it("resolves the random role to a real role", () => {
    const roles = new Set(Array.from({ length: 200 }, () => rollBuild(data, "normal", "random", "Ahri").role));
    assert.deepEqual([...roles].sort(), ["adc", "jungle", "mid", "support", "top"]);
  });
});

describe("skill order", () => {
  it("uses Q, W and E for standard champions", () => {
    assert.deepEqual([...rollBuild(data, "normal", "mid", "Ahri").skillOrder].sort(), ["E", "Q", "W"]);
  });

  it("includes R for Udyr", () => {
    assert.deepEqual([...rollBuild(data, "normal", "top", "Udyr").skillOrder].sort(), ["E", "Q", "R", "W"]);
  });

  it("orders bonus stats for Aphelios", () => {
    assert.deepEqual([...rollBuild(data, "normal", "adc", "Aphelios").skillOrder].sort(), ["Dégâts d'attaque", "Létalité", "Vitesse d'attaque"]);
  });
});

describe("modes", () => {
  it("rolls runes and no augments in Normal and ARAM", () => {
    for (const mode of ["normal", "aram"]) {
      const build = rollBuild(data, mode, null, "Ahri");
      assert.ok(build.runes, mode);
      assert.equal(build.augments, null, mode);
      assert.equal(build.randomAugment, null, mode);
      assert.equal(build.statPick, null, mode);
    }
  });

  it("rolls no runes and augment instructions (4 levels + random augment) in ARAM du Chaos", () => {
    const build = rollBuild(data, "aram-chaos", null, "Ahri");
    assert.equal(build.runes, null);
    assert.deepEqual(build.augments.map((augment) => augment.level), [1, 7, 11, 15]);
    for (const { reroll, pick } of [...build.augments, build.randomAugment]) {
      assert.ok(reroll.every((position) => position >= 1 && position <= 3));
      assert.ok(pick >= 1 && pick <= 3);
    }
    assert.ok([1, 2, 3].includes(build.statPick));
  });

  it("keeps the played champion in the build", () => {
    assert.equal(rollBuild(data, "normal", "mid", "Ahri").champion, "Ahri");
  });
});
