(function () {
// Gerasimos Gambit's line icons (24x24, drawn with the current text color).
const PATHS = {
  queen: '<path d="M4 19h16"/><path d="M5 19 4 8l5 4 3-6 3 6 5-4-1 11"/>',
  traitor: '<path d="M19 3l2 2-10 10-3 1 1-3z"/><path d="M6 13l5 5"/><path d="M4 20l3.5-3.5"/>',
  objective: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
  swap: '<path d="M5 8h14l-3-3"/><path d="M19 16H5l3 3"/>',
  mine: '<circle cx="12" cy="12" r="5.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  prophecy: '<circle cx="12" cy="10.5" r="7"/><path d="M7 19.5h10l-1.5 2h-7z"/><path d="M10 7.5l.7 1.6 1.6.7-1.6.7L10 12.1l-.7-1.6-1.6-.7 1.6-.7z"/>',
  shifter: '<circle cx="6.5" cy="15" r="3.5"/><rect x="14" y="11.5" width="7" height="7" rx="1"/><path d="M6.5 9c1-4 9-5 11 1"/><path d="M15.5 8.5l2 1.5 1.5-2"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1"/><circle cx="9.5" cy="12.5" r="1" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1" fill="currentColor"/><path d="M9.5 16h5"/>',
  crown: '<path d="M3 8l4.5 4.5L12 5l4.5 7.5L21 8l-2 11H5z"/><path d="M5 19h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 13.5c2.5 0 4.5 2 4.5 4.5"/>',
  bolt: '<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"/>',
  book: '<path d="M2.5 5h6.5a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2.5z"/><path d="M21.5 5H15a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7.5z"/>',
  soundOn: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  trophy: '<path d="M8 3.5h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5v1a3 3 0 0 0 3 3M16 5.5h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4M8.5 21h7M10 17h4"/>',
  warn: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  flip: '<path d="M8 20V4M4.5 7.5L8 4l3.5 3.5"/><path d="M16 4v16M12.5 16.5L16 20l3.5-3.5"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8.5V13l3 2"/>',
  boom: '<path d="M12 2.5l1.8 5.4 5.2-2.6-2.6 5.2 5.4 1.8-5.4 1.8 2.6 5.2-5.2-2.6L12 21.5l-1.8-5.4-5.2 2.6 2.6-5.2L2.5 12l5.4-1.8L5.3 5.3l5.2 2.6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const I = {};
for (const [name, d] of Object.entries(PATHS)) {
  I[name] = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
globalThis.TGIcons = I;
})();
