// Original SVG piece set for Twisted Gambit (chunky, flat, outlined).
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
  B: `
    <circle cx="50" cy="13" r="6"/>
    <path d="M50 19 C65 29 68 43 61 55 H39 C32 43 35 29 50 19 Z"/>
    <rect x="36" y="54" width="28" height="8" rx="4"/>
    <path d="M40 62 H60 L66 77 H34 Z"/>
    ${BASE}
    <path class="d" d="M55 31 L45 43"/>`,
  N: `
    <path d="M31 80 C30 68 38 61 47 55 C41 58 35 60 29 61 C22 62 17 57 18 51
             C19 45 25 40 31 33 C37 26 42 21 48 19 L52 9 L59 18
             C74 22 83 40 81 58 C80 68 76 76 74 80 Z"/>
    ${BASE}
    <circle class="f" cx="41" cy="33" r="3.2"/>
    <circle class="f" cx="24" cy="52" r="2"/>
    <path class="d" d="M60 22 C70 30 74 45 72 62"/>`,
  Q: `
    <path d="M21 33 L33 66 H67 L79 33 L63 50 L65 23 L54 45 L50 18 L46 45 L35 23 L37 50 Z"/>
    <circle cx="21" cy="31" r="5.5"/><circle cx="35" cy="21" r="5.5"/><circle cx="50" cy="16" r="5.5"/>
    <circle cx="65" cy="21" r="5.5"/><circle cx="79" cy="31" r="5.5"/>
    <rect x="31" y="64" width="38" height="9" rx="4"/>
    ${BASE}`,
  K: `
    <path d="M46.5 5 H53.5 V11 H59.5 V18 H53.5 V27 H46.5 V18 H40.5 V11 H46.5 Z"/>
    <ellipse cx="50" cy="36" rx="8" ry="10"/>
    <path d="M30 46 C30 35 41 31 50 40 C59 31 70 35 70 46 C70 56 62 61 62 66 H38 C38 61 30 56 30 46 Z"/>
    <rect x="34" y="64" width="32" height="9" rx="4"/>
    ${BASE}
    <path class="d" d="M50 40 V64"/>`,
};

const STYLE = {
  w: { fill: '#ffffff', stroke: '#302e2c', accent: '#302e2c' },
  b: { fill: '#565351', stroke: '#1b1a19', accent: '#b0adaa' },
};

const cache = {};
export function pieceSVG(type, color) {
  const key = type + color;
  if (cache[key]) return cache[key];
  const s = STYLE[color];
  cache[key] = `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true">
    <g fill="${s.fill}" stroke="${s.stroke}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round">${SHAPES[type]
      .replace(/class="d"/g, `fill="none" stroke="${s.accent}" stroke-width="3"`)
      .replace(/class="f"/g, `fill="${s.stroke === '#302e2c' ? '#302e2c' : s.accent}" stroke="none"`)}</g></svg>`;
  return cache[key];
}

export function tokenSVG(color) {
  const s = STYLE[color];
  return `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="54" r="30" fill="${s.fill}" stroke="${s.stroke}" stroke-width="3.6"/>
    <circle cx="50" cy="54" r="21" fill="none" stroke="${s.accent}" stroke-width="2.5" stroke-dasharray="5 5" opacity=".6"/>
    <text x="50" y="66" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="34" fill="${s.accent}">?</text></svg>`;
}
