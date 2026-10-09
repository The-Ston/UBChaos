// Fuzzy champion search: every typed letter must appear in the name, in order
// ("tf" -> Twisted Fate), or a community nickname. Closer matches rank first.

// Keyed by Data Dragon champion id.
const NICKNAMES = {
  AurelionSol: ["asol"],
  Blitzcrank: ["blitz"],
  Caitlyn: ["cait"],
  Cassiopeia: ["cassio"],
  Ezreal: ["ez"],
  Fiddlesticks: ["fiddle", "fid"],
  Gangplank: ["gp"],
  Heimerdinger: ["heimer", "donger"],
  JarvanIV: ["j4"],
  Kassadin: ["kass"],
  Katarina: ["kata"],
  KogMaw: ["kog"],
  Malphite: ["malph"],
  Malzahar: ["malz"],
  MonkeyKing: ["wk"],
  Mordekaiser: ["morde"],
  Nidalee: ["nid"],
  Nocturne: ["noc"],
  TahmKench: ["tk"],
  Tryndamere: ["trynd"],
  Volibear: ["voli"],
  Warwick: ["ww"],
};

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// "Twisted Fate" -> "tf", "LeBlanc" -> "lb", "Kai'Sa" -> "ks".
function initials(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}0-9]+/u)
    .filter(Boolean)
    .map((word) => normalize(word)[0] ?? "")
    .join("");
}

function isSubsequence(query, text) {
  let i = 0;
  for (const char of text) {
    if (char === query[i]) i++;
    if (i === query.length) return true;
  }
  return false;
}

export function searchKeys(champion) {
  return { name: normalize(champion.name), initials: initials(champion.name), nicknames: NICKNAMES[champion.id] ?? [] };
}

// Returns a rank (lower is better), or null when the champion does not match.
export function searchRank(keys, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return 0;
  if (keys.name.startsWith(query)) return 0;
  if (keys.initials.startsWith(query) || keys.nicknames.some((nickname) => nickname.startsWith(query))) return 1;
  if (keys.name.includes(query)) return 2;
  if (isSubsequence(query, keys.name)) return 3;
  return null;
}
