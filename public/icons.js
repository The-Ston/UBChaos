// Line icons for buttons: same 24x24 grid and stroke, so they line up the way
// emojis (each font drawing them differently) never do.
const PATHS = {
  copy: ["M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z", "M5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
  lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V7.5a4 4 0 0 1 8 0V11"],
  unlock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V7.5a4 4 0 0 1 7.6-1.7"],
  reroll: ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", "M19.5 4.5v4.5H15"],
  trash: ["M4 7h16", "M9.5 7V4.5h5V7", "M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7", "M10.5 11v5.5", "M13.5 11v5.5"],
  crown: ["M4 8.5l4 3.5 4-6 4 6 4-3.5-1.6 9.5H5.6z"],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  options: ["M4 7h9", "M17 7h3", "M15 5a2 2 0 1 1 0 4 2 2 0 1 1 0-4z", "M4 17h3", "M11 17h9", "M9 15a2 2 0 1 1 0 4 2 2 0 1 1 0-4z"],
  // Pips are tiny circles: stroked, they read as solid dots even at badge size.
  dice: [
    "M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4z",
    ...[[8.75, 8.75], [15.25, 8.75], [12, 12], [8.75, 15.25], [15.25, 15.25]].map(([x, y]) => `M${x - 0.8} ${y}a0.8 0.8 0 1 0 1.6 0a0.8 0.8 0 1 0 -1.6 0`),
  ],
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  for (const d of PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
