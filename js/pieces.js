(function () {
// Original SVG piece set for Gerasimos Gambit (chunky, flat, outlined).
// viewBox 0 0 100 100. Each piece is a list of shapes; `detail` shapes use the accent stroke.

const BASE = '<rect x="22" y="76" width="56" height="12" rx="5"/>';

const SHAPES = {
  P: `
    <path d="M35 77 C37 64 43 57 44 51 H56 C57 57 63 64 65 77 Z"/>
    <rect x="35" y="45" width="30" height="8" rx="4"/>
    <circle cx="50" cy="31" r="13"/>
    <rect x="25" y="74" width="50" height="13" rx="5"/>`,
  R: `
    <path d="M27 18 H38 V26 H45 V18 H55 V26 H62 V18 H73 V36 L66 43 H34 L27 36 Z"/>
    <path d="M35 43 H65 L68 74 H32 Z"/>
    ${BASE}
    <path class="d" d="M34 43 H66 M33 68 H67"/>`,
  // Bishop: egg-shaped mitre
  B: `
    <circle cx="50" cy="12" r="5.5"/>
    <ellipse cx="50" cy="36" rx="15" ry="19"/>
    <rect x="36" y="53" width="28" height="8" rx="4"/>
    <path d="M40 61 H60 L66 77 H34 Z"/>
    ${BASE}
    <path class="d" d="M56 28 L44 42"/>`,
  // Knight: flowing mane down the back of the neck
  N: `
    <path d="M31 80 C30 68 38 61 47 55 C41 58 35 60 29 61 C22 62 17 57 18 51
             C19 45 25 40 31 33 C37 26 42 21 48 19 L52 9 L59 18
             C66 17 71 21 71 26 C77 27 80 33 77 38 C83 41 84 49 80 53
             C85 59 83 69 77 71 L75 80 Z"/>
    ${BASE}
    <circle class="f" cx="41" cy="33" r="3.2"/>
    <circle class="f" cx="24" cy="52" r="2"/>
    <path class="d" d="M60 22 C68 30 71 44 70 62"/>`,
  Q: `
    <path d="M21 33 L33 66 H67 L79 33 L63 50 L65 23 L54 45 L50 18 L46 45 L35 23 L37 50 Z"/>
    <circle cx="21" cy="31" r="5.5"/><circle cx="35" cy="21" r="5.5"/><circle cx="50" cy="16" r="5.5"/>
    <circle cx="65" cy="21" r="5.5"/><circle cx="79" cy="31" r="5.5"/>
    <rect x="31" y="64" width="38" height="9" rx="4"/>
    ${BASE}`,
  // Snake (Power Chess prize): three coils and a raised head with a forked tongue
  S: `
    ${BASE}
    <ellipse cx="50" cy="69" rx="25" ry="8.5"/>
    <ellipse cx="50" cy="57" rx="20" ry="7.5"/>
    <ellipse cx="49" cy="46" rx="14" ry="6.5"/>
    <path d="M41 45 C38 34 42 24 50 19 C56 15 66 16 69 22 C72 28 67 34 60 33 C55 32 53 36 54 44 Z"/>
    <circle class="f" cx="62" cy="23.5" r="2.6"/>
    <path class="d" d="M70 26 L76 27.5 M76 27.5 L79.5 24.5 M76 27.5 L79 31"/>`,
  // King: spiked crown with a jewel, topped by a small cross
  K: `
    <path d="M47.5 4 H52.5 V9 H57 V13 H52.5 V20 H47.5 V13 H43 V9 H47.5 Z"/>
    <path d="M30 46 L28 22 L39 33 L50 18 L61 33 L72 22 L70 46 Z"/>
    <rect x="30" y="45" width="40" height="8" rx="3"/>
    <path d="M36 53 H64 L67 74 H33 Z"/>
    ${BASE}
    <circle class="f" cx="50" cy="37" r="3"/>`,
};

const STYLE = {
  w: { fill: '#ffffff', stroke: '#302e2c', accent: '#302e2c' },
  b: { fill: '#565351', stroke: '#1b1a19', accent: '#b0adaa' },
};

const cache = {};
function pieceSVG(type, color) {
  const key = type + color;
  if (cache[key]) return cache[key];
  const s = STYLE[color];
  cache[key] = `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true">
    <g fill="${s.fill}" stroke="${s.stroke}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round">${SHAPES[type]
      .replace(/class="d"/g, `fill="none" stroke="${s.accent}" stroke-width="3"`)
      .replace(/class="f"/g, `fill="${s.stroke === '#302e2c' ? '#302e2c' : s.accent}" stroke="none"`)}</g></svg>`;
  return cache[key];
}

function tokenSVG(color) {
  const s = STYLE[color];
  return `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="54" r="30" fill="${s.fill}" stroke="${s.stroke}" stroke-width="3.6"/>
    <circle cx="50" cy="54" r="21" fill="none" stroke="${s.accent}" stroke-width="2.5" stroke-dasharray="5 5" opacity=".6"/>
    <text x="50" y="66" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="34" fill="${s.accent}">?</text></svg>`;
}

globalThis.TGPieces = { pieceSVG, tokenSVG };
})();
